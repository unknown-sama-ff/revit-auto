using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RevitAutoV27;

internal sealed class DocumentLifecycleStore(string directory)
{
    private readonly string root = Path.GetFullPath(directory);
    private readonly Dictionary<string, (int Sequence, string Hash)> observed = new(StringComparer.Ordinal);
    public string PathFor(string operationId, string suffix) => Path.Combine(root, $"lifecycle-{DocumentLifecycleRules.OperationId(operationId)}-{suffix}.json");
    public static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    public static string ShaFile(string path) { using var stream = File.OpenRead(path); return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(); }
    public static JsonElement ReadJson(string path, string? expectedHash = null, int budget = DocumentLifecycleRules.MaxRecordBytes)
        => ReadRecord(path, expectedHash, budget).Value;
    private static (JsonElement Value, string Hash) ReadRecord(string path, string? expectedHash = null, int budget = DocumentLifecycleRules.MaxRecordBytes)
    {
        RequireNoAliases(path);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > budget) throw new BridgeException("lifecycle_evidence_limit", "Stored lifecycle evidence exceeded its byte budget.");
        var bytes = new byte[checked((int)stream.Length)]; stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw new BridgeException("lifecycle_evidence_changed", "Stored lifecycle evidence changed while being read.");
        var hash = Sha(bytes);
        if (expectedHash is not null && hash != DocumentLifecycleRules.Hash(expectedHash)) throw new BridgeException("lifecycle_evidence_changed", "A bound lifecycle evidence digest changed.");
        using var json = JsonDocument.Parse(bytes); return (json.RootElement.Clone(), hash);
    }
    public (string Path, string Hash) Create(string path, object value, int budget = DocumentLifecycleRules.MaxRecordBytes)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, DocumentLifecycleRules.Json);
        if (bytes.Length > budget) throw new BridgeException("lifecycle_evidence_limit", "Complete stored lifecycle evidence exceeded its byte budget.");
        Directory.CreateDirectory(root);
        if (!Path.GetFullPath(path).StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new BridgeException("lifecycle_evidence_path", "Lifecycle output escaped its private directory.");
        RequireNoAliases(root);
        var temporary = path + ".writing-" + Guid.NewGuid().ToString("N");
        using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        { stream.Write(bytes); stream.Flush(flushToDisk: true); }
        // Readers see only complete flushed records. A crash or failed move
        // retains its temporary evidence; only a winning final move allows API work.
        File.Move(temporary, path, overwrite: false);
        return (path, Sha(bytes));
    }
    public bool Exists(string op, string suffix) => File.Exists(PathFor(op, suffix));
    public (JsonElement Value, string Hash) Request(string op, string hash)
        => (ReadJson(PathFor(op, "request"), hash), DocumentLifecycleRules.Hash(hash));
    public (JsonElement Value, string Hash) Latest(string op, string requestHash, string kind = "state")
    {
        string? previous = null; JsonElement last = default;
        var key = op + ":" + kind;
        observed.TryGetValue(key, out var bound);
        var records = Directory.GetFiles(root, $"lifecycle-{DocumentLifecycleRules.OperationId(op)}-{kind}-*.json").Order(StringComparer.Ordinal).ToArray();
        if (records.Length > DocumentLifecycleRules.MaxRecords) throw new BridgeException("lifecycle_evidence_limit", "The lifecycle record count exceeded its bound.");
        for (var index = 0; index < records.Length; index++)
        {
            var expected = PathFor(op, $"{kind}-{index + 1:D6}");
            if (!string.Equals(records[index], expected, StringComparison.OrdinalIgnoreCase)) throw new BridgeException("lifecycle_evidence_changed", "Lifecycle sequence is incomplete.");
            var record = ReadRecord(records[index]); var value = record.Value;
            DocumentLifecycleRules.Exact(value, "schemaVersion", "operationId", "requestSha256", "sequence", "previousSha256", kind == "state" ? "stage" : "kind", "atUtc", "data");
            if (DocumentLifecycleRules.Integer(value, "schemaVersion", 1) != 1 || DocumentLifecycleRules.Text(value, "operationId") != op ||
                DocumentLifecycleRules.Hash(DocumentLifecycleRules.Text(value, "requestSha256")) != DocumentLifecycleRules.Hash(requestHash) ||
                DocumentLifecycleRules.Integer(value, "sequence") != index + 1 ||
                (value.GetProperty("previousSha256").ValueKind == JsonValueKind.Null ? null : DocumentLifecycleRules.Hash(value.GetProperty("previousSha256").GetString()!)) != previous)
                throw new BridgeException("lifecycle_evidence_changed", "Lifecycle hash chain did not validate.");
            if (bound.Sequence == index + 1 && record.Hash != bound.Hash)
                throw new BridgeException("lifecycle_evidence_changed", "A previously observed lifecycle prefix was rewritten.");
            previous = record.Hash; last = value;
        }
        if (records.Length < bound.Sequence)
            throw new BridgeException("lifecycle_evidence_changed", "Previously observed lifecycle evidence was removed or rewritten.");
        observed[key] = (records.Length, previous ?? "");
        return (last, previous ?? "");
    }
    public (JsonElement Value, string Hash) Append(string op, string requestHash, string stageOrKind, object data, string kind = "state")
    {
        var prior = Latest(op, requestHash, kind); var sequence = prior.Value.ValueKind == JsonValueKind.Undefined ? 1 : (int)DocumentLifecycleRules.Integer(prior.Value, "sequence") + 1;
        if (sequence > DocumentLifecycleRules.MaxRecords) throw new BridgeException("lifecycle_evidence_limit", "Lifecycle evidence cannot be truncated; record budget exhausted.");
        var record = new Dictionary<string, object?> { ["schemaVersion"] = 1, ["operationId"] = op, ["requestSha256"] = requestHash, ["sequence"] = sequence,
            ["previousSha256"] = sequence == 1 ? null : prior.Hash, [kind == "state" ? "stage" : "kind"] = stageOrKind, ["atUtc"] = DateTime.UtcNow, ["data"] = data };
        var created = Create(PathFor(op, $"{kind}-{sequence:D6}"), record);
        var stored = ReadJson(created.Path, created.Hash);
        observed[op + ":" + kind] = (sequence, created.Hash);
        return (stored, created.Hash);
    }
    public bool AttemptRecorded(string op, string hash, string action)
    {
        var path = PathFor(op, action + "-attempt");
        if (File.Exists(path))
        {
            var prior = ReadJson(path); DocumentLifecycleRules.Exact(prior, "schemaVersion", "operationId", "requestSha256", "action", "atUtc");
            if (DocumentLifecycleRules.Integer(prior, "schemaVersion", 1) != 1 || DocumentLifecycleRules.Text(prior, "operationId") != op || DocumentLifecycleRules.Hash(DocumentLifecycleRules.Text(prior, "requestSha256")) != hash || DocumentLifecycleRules.Text(prior, "action") != action)
                throw new BridgeException("lifecycle_attempt_conflict", "A prior one-time attempt belongs to different lifecycle evidence.");
            return true;
        }
        return false;
    }
    public bool Attempt(string op, string hash, string action)
    {
        if (AttemptRecorded(op, hash, action)) return false;
        var path = PathFor(op, action + "-attempt");
        Create(path, new { schemaVersion = 1, operationId = op, requestSha256 = hash, action, atUtc = DateTime.UtcNow }); return true;
    }
    internal static void RequireNoAliases(string path)
    {
        var info = Directory.Exists(path) ? (FileSystemInfo)new DirectoryInfo(Path.GetFullPath(path)) : new FileInfo(Path.GetFullPath(path));
        for (FileSystemInfo? cursor = info; cursor is not null; cursor = cursor is FileInfo file ? file.Directory : (cursor as DirectoryInfo)?.Parent)
            if (cursor.Exists && (cursor.Attributes & FileAttributes.ReparsePoint) != 0) throw new BridgeException("lifecycle_evidence_path", "Reparse-point lifecycle evidence is not permitted.");
    }
}
