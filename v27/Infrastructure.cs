using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class RuntimeFiles
{
    public static string Root { get; } = FindRoot();
    public static string DirectoryPath => Path.Combine(Root, "runtime");
    public static string SettingsFile => Path.Combine(DirectoryPath, "bridge.json");
    private static string FindRoot()
    {
        var d = new DirectoryInfo(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!);
        while (d is not null)
        {
            if (File.Exists(Path.Combine(d.FullName, "mcp", "package.json"))) return d.FullName;
            d = d.Parent;
        }
        throw new InvalidOperationException("Cannot locate the RevitAuto package root.");
    }
    public static BridgeSettings ReadSettings()
    {
        var result = JsonSerializer.Deserialize<BridgeSettings>(File.ReadAllText(SettingsFile).TrimStart('\uFEFF'), JsonDefaults.Options);
        if (result is null || result.Port is < 1024 or > 65535 || string.IsNullOrEmpty(result.Token) || result.Token.Length < 40)
            throw new InvalidOperationException("Run install-v27.ps1 to create a private bridge.json before starting Revit.");
        PlanLifetimePolicy.Expires(DateTime.UtcNow, result.PlanLifetimeMinutes);
        return result;
    }
}
internal static class Log
{
    private static readonly object Gate = new();
    public static void Write(string message)
    {
        try
        {
            Directory.CreateDirectory(RuntimeFiles.DirectoryPath);
            lock (Gate) File.AppendAllText(Path.Combine(RuntimeFiles.DirectoryPath, "revit-ai.log"), $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}");
        }
        catch { /* Logging must not invalidate a committed Revit transaction. */ }
    }
}
internal sealed class QueuedCommand(CommandEnvelope envelope, CancellationToken cancellation)
{
    public CommandEnvelope Envelope { get; } = envelope;
    public CancellationToken Cancellation { get; } = cancellation;
    public TaskCompletionSource<CommandResult> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
}
internal sealed class RevitCommandHandler : IExternalEventHandler, IDisposable
{
    private readonly ConcurrentQueue<QueuedCommand> queue = new();
    private ExternalEvent? externalEvent;
    private volatile bool disposed;
    private int executing;
    public void Attach(ExternalEvent e) => externalEvent = e;
    public Task<CommandResult> EnqueueAsync(CommandEnvelope envelope, CancellationToken cancellation)
    {
        if (disposed) return Task.FromResult(CommandResult.Failure("host_stopped", "Revit is shutting down."));
        if (queue.Count >= 50) return Task.FromResult(CommandResult.Failure("host_busy", "Revit command queue is full."));
        var item = new QueuedCommand(envelope, cancellation);
        queue.Enqueue(item);
        Wake();
        return item.Completion.Task;
    }
    public void Wake()
    {
        if (disposed || queue.IsEmpty) return;
        try { externalEvent?.Raise(); }
        catch (Exception ex) { Log.Write("ExternalEvent scheduling error: " + ex.Message); }
    }
    public void Execute(UIApplication app)
    {
        if (Interlocked.Exchange(ref executing, 1) != 0) return;
        try
        {
        var count = 0;
        while (count++ < 4 && queue.TryDequeue(out var item))
        {
            try
            {
                if (item.Cancellation.IsCancellationRequested || item.Envelope.DeadlineUnixMs < DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
                    item.Completion.TrySetResult(CommandResult.Failure("request_expired", "Request was cancelled or expired before execution; the model was not changed."));
                else
                    item.Completion.TrySetResult(RevitCommandRouter.Dispatch(app, item.Envelope.Method, item.Envelope.Params, item.Cancellation));
            }
            catch (Exception ex) { item.Completion.TrySetResult(CommandResult.Failure("host_error", ex.Message)); Log.Write(ex.ToString()); }
        }
        // Any remainder is scheduled by Idling, never by background Revit API calls.
        }
        finally { Volatile.Write(ref executing, 0); }
    }
    public string GetName() => "RevitAuto AI serialized command queue";
    public void Dispose()
    {
        disposed = true;
        while (queue.TryDequeue(out var q)) q.Completion.TrySetResult(CommandResult.Failure("host_stopped", "Revit is shutting down."));
    }
}
internal sealed class TcpCommandServer(RevitCommandHandler handler) : IDisposable
{
    private readonly CancellationTokenSource stop = new();
    private readonly ConcurrentDictionary<int, TcpClient> clients = new();
    private readonly SemaphoreSlim capacity = new(16);
    private readonly BridgeSettings settings = RuntimeFiles.ReadSettings();
    private TcpListener? listener;
    private int connectionId;
    public void Start()
    {
        listener = new TcpListener(IPAddress.Loopback, settings.Port);
        listener.Server.ExclusiveAddressUse = true;
        listener.Start();
        _ = AcceptLoop();
        Log.Write($"Bridge listening on 127.0.0.1:{settings.Port}; PID={Environment.ProcessId}.");
    }
    private async Task AcceptLoop()
    {
        try
        {
            while (!stop.IsCancellationRequested)
            {
                var client = await listener!.AcceptTcpClientAsync(stop.Token);
                if (!await capacity.WaitAsync(0, stop.Token)) { client.Dispose(); continue; }
                var id = Interlocked.Increment(ref connectionId);
                clients[id] = client;
                _ = Serve(client, id);
            }
        }
        catch (Exception ex) when (ex is OperationCanceledException or ObjectDisposedException or SocketException) { }
    }
    private async Task Serve(TcpClient client, int id)
    {
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
        lifetime.CancelAfter(TimeSpan.FromMinutes(3));
        try
        {
            using var stream = client.GetStream();
            using var reader = new StreamReader(stream, new UTF8Encoding(false, true), leaveOpen: true);
            using var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
            var line = new StringBuilder();
            var character = new char[1];
            while (true)
            {
                var n = await reader.ReadAsync(character.AsMemory(), lifetime.Token);
                if (n == 0) return;
                if (character[0] == '\n') break;
                if (line.Length > 2 * 1024 * 1024) throw new BridgeException("request_too_large", "Bridge requests must be less than 2 MB.");
                line.Append(character[0]);
            }
            using var json = JsonDocument.Parse(line.ToString());
            var root = json.RootElement;
            var token = JsonDefaults.String(root, "token") ?? "";
            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(settings.Token)))
            { await writer.WriteLineAsync(CommandResult.Failure("unauthorized", "Local bridge authentication failed.").Serialize()); return; }
            var envelope = JsonSerializer.Deserialize<CommandEnvelope>(root.GetRawText(), JsonDefaults.Options);
            if (envelope is null || string.IsNullOrWhiteSpace(envelope.RequestId) || string.IsNullOrWhiteSpace(envelope.Method) || envelope.Params.ValueKind != JsonValueKind.Object)
                throw new BridgeException("invalid_request", "method, requestId, object params, and deadlineUnixMs are required.");
            var remaining = envelope.DeadlineUnixMs - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (remaining <= 0) throw new BridgeException("request_expired", "Request deadline has expired.");
            lifetime.CancelAfter(TimeSpan.FromMilliseconds(Math.Min(remaining, 180000)));
            var task = handler.EnqueueAsync(envelope, lifetime.Token);
            // Detect client cancellation/disconnection so queued writes cannot execute later unnoticed.
            var disconnected = reader.ReadAsync(character.AsMemory(), lifetime.Token).AsTask();
            if (await Task.WhenAny(task, disconnected) == disconnected) { lifetime.Cancel(); return; }
            var result = await task;
            await writer.WriteLineAsync(result.Serialize());
        }
        catch (Exception ex)
        {
            if (ex is not OperationCanceledException && !stop.IsCancellationRequested)
            {
                Log.Write("Bridge request rejected: " + ex.Message);
                try
                {
                    var result = CommandResult.Failure(ex is BridgeException b ? b.Code : "bridge_error", ex.Message).Serialize();
                    await client.GetStream().WriteAsync(Encoding.UTF8.GetBytes(result + "\n"), stop.Token);
                }
                catch { }
            }
        }
        finally { lifetime.Cancel(); client.Dispose(); clients.TryRemove(id, out _); capacity.Release(); }
    }
    public void Dispose()
    {
        stop.Cancel(); listener?.Stop();
        foreach (var client in clients.Values) client.Dispose();
    }
}

