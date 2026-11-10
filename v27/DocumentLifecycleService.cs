using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Microsoft.Win32.SafeHandles;

namespace RevitAutoV27;

internal static class DocumentLifecycleService
{
    private static readonly DocumentLifecycleStore Store = new(RuntimeFiles.DirectoryPath);
    private static volatile bool leaseActive, exitPosted, shuttingDown;
    private static string? activeOperation, activeRequestHash;
    public static bool LeaseActive => leaseActive;
    public static bool ExitPosted => exitPosted;
    public static bool ShuttingDown => shuttingDown;
    public static Func<bool>? HasQueuedDocumentCommands { get; set; }
    public static Func<bool>? HasPendingPlans { get; set; }
    public static bool Allows(string method) => LifecycleQueuePolicy.Allowed(method, LeaseActive, ExitPosted, ShuttingDown);
    public static void Shutdown() => shuttingDown = true;
    // Idling is the first safe opportunity after a synchronous native call
    // returns when the external supervisor stopped without another command.
    public static void ConsumeSupervisorStopOnIdle()
    {
        if (!leaseActive || exitPosted || shuttingDown || activeOperation is not { } op || activeRequestHash is not { } hash) return;
        try
        {
            if (SupervisorStop(op, hash) is { } stop) Stop(op, hash, stop.Stage, stop.Reason);
            else if (DocumentLifecycleEvents.StopReason is { } reason) Stop(op, hash, "FAILED", reason);
        }
        catch (Exception exception)
        {
            try { Stop(op, hash, "FAILED", exception is BridgeException bridge ? bridge.Code : "lifecycle_stop_observation_failed"); }
            catch (Exception) { /* Evidence remains unreadable; Stop's finally released the unposted lease. */ }
        }
    }
    private static JsonElement Freeze(object value) => JsonSerializer.SerializeToElement(value, DocumentLifecycleRules.Json);
    private static string Hash(string file) => DocumentLifecycleStore.ShaFile(file);
    private static string RegistrationPath => System.IO.Path.Combine(RuntimeFiles.DirectoryPath, "local-test-copy-registration.json");

    public static object Dispatch(UIApplication app, string method, JsonElement parameters, CancellationToken cancellation)
    {
        if (method == "revit.lifecycle.prepare") { DocumentLifecycleRules.Exact(parameters); return Prepare(app, cancellation); }
        var input = DocumentLifecycleRules.Action(parameters, method == "revit.lifecycle.verify_scope");
        var request = Store.Request(input.Id, input.Hash).Value;
        if (activeOperation is not null && leaseActive && activeOperation != input.Id) throw new BridgeException("lifecycle_busy", "Another lifecycle operation owns the execution lease.");
        if (method == "revit.lifecycle.get") return Response(input.Id, input.Hash, request);
        if (method == "revit.lifecycle.stop") { Stop(input.Id, input.Hash, "STOPPED", "requested_stop"); return Response(input.Id, input.Hash, request); }
        if (shuttingDown) throw new BridgeException("host_stopped", "The lifecycle host is shutting down.");
        var prior = Store.Latest(input.Id, input.Hash).Value;
        if (DocumentLifecycleRules.Terminal(Stage(prior))) return Response(input.Id, input.Hash, request);
        if (method == "revit.lifecycle.save_once" && Store.AttemptRecorded(input.Id, input.Hash, "save") ||
            method == "revit.lifecycle.post_exit_once" && Store.AttemptRecorded(input.Id, input.Hash, "exit") ||
            method == "revit.lifecycle.open_saved_copy_once" && Store.AttemptRecorded(input.Id, input.Hash, "open")) return Response(input.Id, input.Hash, request);
        // A malformed/replayed read index is rejected before the execution
        // failure boundary; it cannot poison a successfully advancing request.
        if (method == "revit.lifecycle.verify_scope") DocumentLifecycleRules.ScopeIndex(Stage(prior),
            (int)DocumentLifecycleRules.Integer(prior.GetProperty("data"), "readIndex"), input.ReadIndex!.Value,
            (int)DocumentLifecycleRules.Integer(request, "recipeCount", DocumentLifecycleRules.MaxRecipes));
        cancellation.ThrowIfCancellationRequested();
        try
        {
            CheckStop(input.Id, input.Hash);
            return method switch
            {
                "revit.lifecycle.save_once" => Save(app, input.Id, input.Hash, request, cancellation),
                "revit.lifecycle.verify_scope" => Verify(app, input.Id, input.Hash, request, input.ReadIndex!.Value, cancellation),
                "revit.lifecycle.post_exit_once" => Exit(app, input.Id, input.Hash, request, cancellation),
                "revit.lifecycle.open_saved_copy_once" => Open(app, input.Id, input.Hash, request, cancellation),
                _ => throw DocumentLifecycleRules.Invalid("Unknown lifecycle route.")
            };
        }
        catch (Exception exception)
        {
            var terminal = exception is OperationCanceledException ? "CANCELLED" : "FAILED";
            try
            {
                var stage = Stage(Store.Latest(input.Id, input.Hash).Value);
                if (stage == "SAVE_STARTED") terminal = "SAVE_OUTCOME_UNKNOWN";
                if (stage == "OPEN_STARTED") terminal = "OPEN_OUTCOME_UNKNOWN";
            }
            catch (Exception) { /* Invalid evidence cannot permit continuation. */ }
            try { Stop(input.Id, input.Hash, terminal, exception is BridgeException bridge ? bridge.Code : exception.GetType().Name); }
            catch (Exception) { /* Preserve the original failure; Stop finally releases any unposted lease. */ }
            throw;
        }
    }
    private static object Prepare(UIApplication app, CancellationToken cancellation)
    {
        if (leaseActive || shuttingDown) throw new BridgeException("lifecycle_busy", "Lifecycle preview cannot be created during an active lifecycle lease.");
        var registrationHash = Hash(RegistrationPath);
        var registration = DocumentLifecycleStore.ReadJson(RegistrationPath, registrationHash); DocumentLifecycleRules.Registration(registration);
        var model = LocalFile(DocumentLifecycleRules.Text(registration, "modelPath"), rvt: true);
        var evidence = DocumentLifecycleRules.Text(registration, "baselineEvidenceFile");
        if (!System.IO.Path.GetFullPath(evidence).StartsWith(System.IO.Path.GetFullPath(RuntimeFiles.DirectoryPath).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) throw DocumentLifecycleRules.Invalid("Baseline evidence must remain within private runtime.");
        DocumentLifecycleStore.ReadJson(evidence, DocumentLifecycleRules.Text(registration, "baselineEvidenceSha256"), DocumentLifecycleRules.MaxSnapshotBytes);
        var doc = Active(app, model.GetProperty("path").GetString()!);
        if (HasQueuedDocumentCommands is null || HasPendingPlans is null || HasQueuedDocumentCommands() || HasPendingPlans()) throw new BridgeException("lifecycle_busy", "A pending bridge command or model plan prevents lifecycle preview.");
        var context = DocPin(doc); var process = ProcessPin(); var config = ConfigPin();
        cancellation.ThrowIfCancellationRequested();
        var recipes = registration.GetProperty("readRecipes").EnumerateArray().ToArray();
        JsonElement CaptureRecipe(JsonElement recipe)
        {
            RequirePin(app, context, process, config, allowSaved: false);
            var value = Read(app, recipe, cancellation);
            RequirePin(app, context, process, config, allowSaved: false);
            return value;
        }
        var values = recipes.Select(CaptureRecipe).ToArray();
        CheckSearchCoverage(recipes, values);
        for (var index = 0; index < recipes.Length; index++)
            RequireEqual(values[index], CaptureRecipe(recipes[index]), recipes[index].GetProperty("method").GetString()!, reopened: false);
        DocumentLifecycleStore.ReadJson(RegistrationPath, registrationHash);
        DocumentLifecycleStore.ReadJson(evidence, DocumentLifecycleRules.Text(registration, "baselineEvidenceSha256"), DocumentLifecycleRules.MaxSnapshotBytes);
        RequirePin(app, context, process, config, allowSaved: false); RequireFile(LocalFile(context.GetProperty("path").GetString()!, true), model);
        var op = Guid.NewGuid().ToString("N"); var now = DateTime.UtcNow;
        var snapshot = Store.Create(Store.PathFor(op, "baseline-snapshot"), new { recipes, values }, DocumentLifecycleRules.MaxSnapshotBytes);
        var request = Freeze(new { schemaVersion = 1, operationId = op, createdAtUtc = now, expiresAtUtc = now.AddMinutes(10), registrationSha256 = registrationHash, registration,
            document = context, process, bridgeConfig = config, savedFile = model, baselineSnapshotFile = snapshot.Path, baselineSnapshotSha256 = snapshot.Hash, recipeCount = recipes.Length });
        var created = Store.Create(Store.PathFor(op, "request"), request);
        Store.Append(op, created.Hash, "PREVIEW_READY", new { readIndex = 0 });
        return Response(op, created.Hash, request);
    }
    private static object Save(UIApplication app, string op, string hash, JsonElement request, CancellationToken cancellation)
    {
        DocumentLifecycleRules.RequireStage(Stage(Store.Latest(op, hash).Value), "PREVIEW_READY");
        DocumentLifecycleRules.RequireLivePreview(request.GetProperty("createdAtUtc").GetDateTime().ToUniversalTime(), request.GetProperty("expiresAtUtc").GetDateTime().ToUniversalTime(), DateTime.UtcNow);
        RequireRequestFiles(request); RequirePin(app, request.GetProperty("document"), request.GetProperty("process"), request.GetProperty("bridgeConfig"), false);
        var backup = DocumentLifecycleStore.ReadJson(Store.PathFor(op, "backup"));
        DocumentLifecycleRules.Exact(backup, "schemaVersion", "operationId", "requestSha256", "backupPath", "backupSha256", "sourceFile");
        Bound(backup, op, hash); RequireFile(backup.GetProperty("sourceFile"), request.GetProperty("savedFile"));
        var backupPath = DocumentLifecycleRules.Text(backup, "backupPath");
        if (!System.IO.Path.GetFullPath(backupPath).StartsWith(System.IO.Path.GetFullPath(RuntimeFiles.DirectoryPath).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase) || string.Equals(System.IO.Path.GetFullPath(backupPath), request.GetProperty("document").GetProperty("path").GetString(), StringComparison.OrdinalIgnoreCase)) throw new BridgeException("lifecycle_backup_invalid", "A pre-save backup must be a distinct private runtime file.");
        DocumentLifecycleStore.RequireNoAliases(backupPath);
        if (Hash(DocumentLifecycleRules.Text(backup, "backupPath")) != DocumentLifecycleRules.Hash(DocumentLifecycleRules.Text(backup, "backupSha256")) ||
            DocumentLifecycleRules.Hash(DocumentLifecycleRules.Text(backup, "backupSha256")) != request.GetProperty("savedFile").GetProperty("sha256").GetString()) throw new BridgeException("lifecycle_backup_invalid", "The pre-save disk backup did not match the bound file.");
        if (HasQueuedDocumentCommands is null || HasPendingPlans is null || HasQueuedDocumentCommands() || HasPendingPlans()) throw new BridgeException("lifecycle_busy", "Bridge queue or pending plans are not empty or cannot be verified.");
        activeOperation = op; activeRequestHash = hash; leaseActive = true;
        DocumentLifecycleEvents.Arm(Store, op, hash, request.GetProperty("document").GetProperty("identity").GetString());
        VerifyAll(app, request, cancellation, false);
        var doc = RequirePin(app, request.GetProperty("document"), request.GetProperty("process"), request.GetProperty("bridgeConfig"), false);
        RequireFile(LocalFile(doc.PathName, true), request.GetProperty("savedFile")); CheckStop(op, hash); cancellation.ThrowIfCancellationRequested();
        DocumentLifecycleRules.RequireLivePreview(request.GetProperty("createdAtUtc").GetDateTime().ToUniversalTime(), request.GetProperty("expiresAtUtc").GetDateTime().ToUniversalTime(), DateTime.UtcNow);
        if (!Store.Attempt(op, hash, "save")) return Response(op, hash, request);
        Store.Append(op, hash, "SAVE_STARTED", new { readIndex = 0 });
        DocumentLifecycleRules.RequireLivePreview(request.GetProperty("createdAtUtc").GetDateTime().ToUniversalTime(), request.GetProperty("expiresAtUtc").GetDateTime().ToUniversalTime(), DateTime.UtcNow);
        CheckStop(op, hash); cancellation.ThrowIfCancellationRequested();
        var clock = Stopwatch.StartNew(); var modified = doc.IsModified;
        if (modified)
        {
            DocumentLifecycleEvents.BeginSave();
            try { doc.Save(); }
            finally { DocumentLifecycleEvents.EndSave(); }
        }
        if (clock.Elapsed > TimeSpan.FromSeconds(120) || cancellation.IsCancellationRequested) throw new BridgeException("lifecycle_save_deadline", "Save returned after its observation deadline; saving may have happened.");
        CheckStop(op, hash);
        RequirePin(app, request.GetProperty("document"), request.GetProperty("process"), request.GetProperty("bridgeConfig"), true);
        if (doc.IsModified || modified && !DocumentLifecycleEvents.SavedSuccessfully) throw new BridgeException("lifecycle_save_unverified", "No matching successful save event and saved document state were observed.");
        var file = LocalFile(doc.PathName, true);
        Store.Append(op, hash, "SAVE_READBACK_PENDING", new { readIndex = 0, savedFile = file, saveAction = modified ? "save_performed" : "noop_already_saved" });
        return Response(op, hash, request);
    }
    private static object Verify(UIApplication app, string op, string hash, JsonElement request, int index, CancellationToken cancellation)
    {
        var state = Store.Latest(op, hash).Value; var phase = Stage(state);
        if (!leaseActive || activeOperation != op) throw new BridgeException("lifecycle_lease_missing", "The bound scope execution lease is not active.");
        var expectedIndex = (int)DocumentLifecycleRules.Integer(state.GetProperty("data"), "readIndex");
        var count = (int)DocumentLifecycleRules.Integer(request, "recipeCount", DocumentLifecycleRules.MaxRecipes);
        DocumentLifecycleRules.ScopeIndex(phase, expectedIndex, index, count);
        var reopened = phase == "OPEN_READBACK_PENDING"; var pin = reopened ? state.GetProperty("data").GetProperty("document") : request.GetProperty("document");
        var process = reopened ? ReadContinuation(op, hash, request).GetProperty("newProcess") : request.GetProperty("process");
        var doc = RequirePin(app, pin, process, request.GetProperty("bridgeConfig"), true);
        var recipe = request.GetProperty("registration").GetProperty("readRecipes")[index % count]; var result = Read(app, recipe, cancellation);
        var baseline = DocumentLifecycleStore.ReadJson(request.GetProperty("baselineSnapshotFile").GetString()!, request.GetProperty("baselineSnapshotSha256").GetString(), DocumentLifecycleRules.MaxSnapshotBytes);
        RequireEqual(baseline.GetProperty("values")[index % count], result, recipe.GetProperty("method").GetString()!, reopened);
        RequirePin(app, pin, process, request.GetProperty("bridgeConfig"), true); CheckStop(op, hash);
        var saved = state.GetProperty("data").GetProperty("savedFile"); RequireFile(LocalFile(doc.PathName, true), saved);
        var next = index + 1; var final = next == count * 2;
        var nextData = new { readIndex = next, savedFile = saved, document = pin, saveAction = state.GetProperty("data").TryGetProperty("saveAction", out var action) ? action.GetString() : null };
        cancellation.ThrowIfCancellationRequested();
        Store.Append(op, hash, final ? reopened ? "REOPEN_VERIFIED" : "SAVE_VERIFIED" : phase, nextData);
        if (final && reopened) { leaseActive = false; activeOperation = activeRequestHash = null; DocumentLifecycleEvents.Disarm(); }
        return Response(op, hash, request, new { phase, readIndex = index, method = recipe.GetProperty("method").GetString(), documentIdentity = RevitCommandRouter.Identity(doc), documentRevision = RevitCommandRouter.Revision(doc), result, matched = true });
    }
    private static object Exit(UIApplication app, string op, string hash, JsonElement request, CancellationToken cancellation)
    {
        var state = Store.Latest(op, hash).Value; DocumentLifecycleRules.RequireStage(Stage(state), "SAVE_VERIFIED");
        if (!leaseActive || activeOperation != op) throw new BridgeException("lifecycle_lease_missing", "The save/exit execution lease is not active.");
        RequireRequestFiles(request); var doc = RequirePin(app, request.GetProperty("document"), request.GetProperty("process"), request.GetProperty("bridgeConfig"), true);
        if (doc.IsModified) throw new BridgeException("lifecycle_unsaved_changes", "The test copy has pending changes.");
        RequireFile(LocalFile(doc.PathName, true), state.GetProperty("data").GetProperty("savedFile"));
        VerifyAll(app, request, cancellation, true); CheckStop(op, hash); cancellation.ThrowIfCancellationRequested();
        var command = RevitCommandId.LookupPostableCommandId(PostableCommand.ExitRevit);
        if (command is null || !app.CanPostCommand(command)) throw new BridgeException("lifecycle_exit_unavailable", "The normal Revit Exit command is unavailable.");
        RequirePin(app, request.GetProperty("document"), request.GetProperty("process"), request.GetProperty("bridgeConfig"), true);
        RequireFile(LocalFile(doc.PathName, true), state.GetProperty("data").GetProperty("savedFile")); CheckStop(op, hash); cancellation.ThrowIfCancellationRequested();
        if (!Store.Attempt(op, hash, "exit")) return Response(op, hash, request);
        Store.Append(op, hash, "EXIT_STARTED", new { savedFile = state.GetProperty("data").GetProperty("savedFile"), readIndex = countReads(request) });
        CheckStop(op, hash); cancellation.ThrowIfCancellationRequested();
        DocumentLifecycleEvents.BeginExit();
        try { app.PostCommand(command); exitPosted = true; }
        catch { DocumentLifecycleEvents.EndExit(); throw; }
        Store.Append(op, hash, "EXIT_POSTED", new { savedFile = state.GetProperty("data").GetProperty("savedFile"), readIndex = countReads(request), exitCommandPosted = true });
        return Response(op, hash, request);
    }
    private static object Open(UIApplication app, string op, string hash, JsonElement request, CancellationToken cancellation)
    {
        DocumentLifecycleRules.RequireStage(Stage(Store.Latest(op, hash).Value), "EXIT_POSTED");
        RequireRequestFiles(request); var continuation = ReadContinuation(op, hash, request);
        RequireEqual(continuation.GetProperty("newProcess"), ProcessPin(), "process"); RequireEqual(request.GetProperty("bridgeConfig"), ConfigPin(), "config");
        foreach (Document doc in app.Application.Documents) if (!doc.IsLinked) throw new BridgeException("lifecycle_open_document_present", "A primary document is already open in the new process.");
        RequireFile(LocalFile(request.GetProperty("document").GetProperty("path").GetString()!, true), continuation.GetProperty("savedFile"));
        if (HasQueuedDocumentCommands is null || HasPendingPlans is null || HasQueuedDocumentCommands() || HasPendingPlans()) throw new BridgeException("lifecycle_busy", "The new process queue cannot be verified empty.");
        activeOperation = op; activeRequestHash = hash; leaseActive = true; exitPosted = false;
        DocumentLifecycleEvents.Arm(Store, op, hash, null); CheckStop(op, hash); cancellation.ThrowIfCancellationRequested();
        if (!Store.Attempt(op, hash, "open")) return Response(op, hash, request);
        Store.Append(op, hash, "OPEN_STARTED", new { readIndex = 0 });
        CheckStop(op, hash); cancellation.ThrowIfCancellationRequested();
        var targetPath = request.GetProperty("document").GetProperty("path").GetString()!;
        DocumentLifecycleEvents.BeginOpen(targetPath);
        UIDocument opened;
        var clock = Stopwatch.StartNew();
        try { opened = app.OpenAndActivateDocument(targetPath); }
        finally { DocumentLifecycleEvents.EndOpen(); }
        if (clock.Elapsed > TimeSpan.FromSeconds(180) || cancellation.IsCancellationRequested) throw new BridgeException("lifecycle_open_deadline", "The fixed-file open returned after its observation deadline.");
        CheckStop(op, hash); var docPin = DocPin(Active(app, opened.Document.PathName));
        if (!DocumentLifecycleEvents.OpenedSuccessfully || docPin.GetProperty("isModified").GetBoolean() || docPin.GetProperty("revision").GetInt64() != 0 || docPin.GetProperty("identity").GetString() == request.GetProperty("document").GetProperty("identity").GetString()) throw new BridgeException("lifecycle_open_unverified", "The reopened native document event/state did not match a fresh saved session.");
        RequireFile(LocalFile(opened.Document.PathName, true), continuation.GetProperty("savedFile"));
        RequireEqual(continuation.GetProperty("newProcess"), ProcessPin(), "process"); RequireEqual(request.GetProperty("bridgeConfig"), ConfigPin(), "config");
        Store.Append(op, hash, "OPEN_READBACK_PENDING", new { readIndex = 0, savedFile = continuation.GetProperty("savedFile"), document = docPin });
        return Response(op, hash, request);
    }
    private static int countReads(JsonElement request) => (int)DocumentLifecycleRules.Integer(request, "recipeCount") * 2;
    private static string Stage(JsonElement state) => DocumentLifecycleRules.Text(state, "stage");
    private static void Bound(JsonElement value, string op, string hash)
    {
        if (DocumentLifecycleRules.Integer(value, "schemaVersion", 1) != 1 || DocumentLifecycleRules.Text(value, "operationId") != op || DocumentLifecycleRules.Hash(DocumentLifecycleRules.Text(value, "requestSha256")) != hash) throw new BridgeException("lifecycle_evidence_changed", "Lifecycle evidence belongs to another request.");
    }
    private static void Stop(string op, string hash, string stage, string reason)
    {
        if (activeOperation == op) DocumentLifecycleEvents.Stop(reason);
        try
        {
            var prior = Store.Latest(op, hash).Value;
            if (!DocumentLifecycleRules.Terminal(Stage(prior))) Store.Append(op, hash, stage, new { readIndex = prior.GetProperty("data").TryGetProperty("readIndex", out var n) ? n.GetInt32() : 0, reason });
        }
        finally
        {
            if (!exitPosted && activeOperation == op) { leaseActive = false; activeOperation = activeRequestHash = null; DocumentLifecycleEvents.Disarm(); }
        }
    }
    private static (string Stage, string Reason)? SupervisorStop(string op, string hash)
    {
        var path = Store.PathFor(op, "supervisor-stop");
        if (File.Exists(path))
        {
            var stop = DocumentLifecycleStore.ReadJson(path); DocumentLifecycleRules.Exact(stop, "schemaVersion", "operationId", "requestSha256", "status", "atUtc", "reason"); Bound(stop, op, hash);
            if (DocumentLifecycleRules.Text(stop, "status") is not ("SAVE_OUTCOME_UNKNOWN" or "OPEN_OUTCOME_UNKNOWN" or "STOPPED" or "CANCELLED")) throw new BridgeException("lifecycle_stop_invalid", "The supervisor stop status is not a terminal state.");
            return (DocumentLifecycleRules.Text(stop, "status"), DocumentLifecycleRules.Text(stop, "reason"));
        }
        return null;
    }
    private static void CheckStop(string op, string hash)
    {
        if (SupervisorStop(op, hash) is { } stop)
        {
            Stop(op, hash, stop.Stage, stop.Reason);
            throw new BridgeException("lifecycle_supervisor_stopped", "The supervisor stopped this operation; no further action is permitted.");
        }
        if (activeOperation == op && DocumentLifecycleEvents.StopReason is { } reason) throw new BridgeException("lifecycle_event_stop", reason);
    }
    private static object Response(string op, string hash, JsonElement request, object? scope = null)
    {
        var state = Store.Latest(op, hash); var events = Store.Latest(op, hash, "event");
        var index = state.Value.GetProperty("data").TryGetProperty("readIndex", out var n) ? n.GetInt32() : 0; var count = request.GetProperty("recipeCount").GetInt32();
        var value = Freeze(new { operationId = op, requestSha256 = hash, stage = Stage(state.Value), recipeCount = count, readIndex = index, readRound = index / count,
            leaseActive, exitPosted, modelWritesRequested = false, automaticRetry = false, allModelSideEffectsVerified = false,
            requestFile = Store.PathFor(op, "request"), request, latestState = state.Value, stateSha256 = state.Hash,
            eventCount = events.Value.ValueKind == JsonValueKind.Undefined ? 0 : events.Value.GetProperty("sequence").GetInt32(), eventTailSha256 = events.Hash.Length == 0 ? null : events.Hash,
            stopReason = SupervisorStop(op, hash)?.Reason ?? (state.Value.GetProperty("data").TryGetProperty("reason", out var reason) ? reason.GetString() : activeOperation == op ? DocumentLifecycleEvents.StopReason : null), scope });
        DocumentLifecycleRules.Budget(CommandResult.Success(value).Serialize()); return value;
    }
    private static JsonElement Read(UIApplication app, JsonElement recipe, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested(); var method = recipe.GetProperty("method").GetString()!; var p = recipe.GetProperty("params");
        object result = method switch
        {
            "revit.context.get" => RevitQueryService.Context(app), "revit.search" => RevitQueryService.Search(app, p), "revit.inspect" => RevitQueryService.Inspect(app, p),
            "revit.element.dependencies" => ElementDependencyService.Get(app, Freeze(new { documentIdentity = RevitCommandRouter.Identity(app.ActiveUIDocument!.Document), expectedRevision = RevitCommandRouter.Revision(app.ActiveUIDocument.Document), elementIds = p.GetProperty("elementIds") }), cancellation),
            _ => throw DocumentLifecycleRules.Invalid("Invalid fixed read recipe.")
        };
        return NativeReadSnapshot.Freeze(result);
    }
    private static void VerifyAll(UIApplication app, JsonElement request, CancellationToken cancellation, bool allowSaved)
    {
        var snapshot = DocumentLifecycleStore.ReadJson(request.GetProperty("baselineSnapshotFile").GetString()!, request.GetProperty("baselineSnapshotSha256").GetString(), DocumentLifecycleRules.MaxSnapshotBytes);
        var pin = request.GetProperty("document"); var process = request.GetProperty("process");
        var recipes = request.GetProperty("registration").GetProperty("readRecipes").EnumerateArray().ToArray(); var values = new JsonElement[recipes.Length];
        for (var i = 0; i < request.GetProperty("recipeCount").GetInt32(); i++)
        {
            var recipe = recipes[i];
            RequirePin(app, pin, process, request.GetProperty("bridgeConfig"), allowSaved);
            values[i] = Read(app, recipe, cancellation);
            RequireEqual(snapshot.GetProperty("values")[i], values[i], recipe.GetProperty("method").GetString()!);
            RequirePin(app, pin, process, request.GetProperty("bridgeConfig"), allowSaved);
        }
        CheckSearchCoverage(recipes, values);
    }
    private static void CheckSearchCoverage(JsonElement[] recipes, JsonElement[] values)
    {
        var groups = recipes.Select((recipe, index) => (recipe, index)).Where(row => row.recipe.GetProperty("method").GetString() == "revit.search")
            .GroupBy(row => row.recipe.GetProperty("params").GetProperty("category").GetString() + ":" + row.recipe.GetProperty("params").GetProperty("types").GetBoolean());
        foreach (var group in groups)
        {
            var offset = 0;
            foreach (var row in group.OrderBy(row => row.recipe.GetProperty("params").GetProperty("offset").GetInt32()))
            {
                var value = values[row.index]; var p = row.recipe.GetProperty("params");
                if (p.GetProperty("offset").GetInt32() != offset || value.GetProperty("offset").GetInt32() != offset || value.GetProperty("limit").GetInt32() != 500) throw new BridgeException("lifecycle_pagination_incomplete", "The fixed search recipe does not cover complete native membership.");
                offset += value.GetProperty("items").GetArrayLength();
                var final = row.index == group.OrderBy(r => r.recipe.GetProperty("params").GetProperty("offset").GetInt32()).Last().index;
                if (value.GetProperty("hasMore").GetBoolean() == final) throw new BridgeException("lifecycle_pagination_incomplete", "The fixed search recipe did not end at complete membership.");
            }
        }
    }
    private static void RequireEqual(JsonElement expected, JsonElement actual, string method, bool reopened = false)
    {
        if (DocumentLifecycleRules.Canonical(expected, method, reopened) != DocumentLifecycleRules.Canonical(actual, method, reopened)) throw new BridgeException("lifecycle_scope_changed", "Complete bound lifecycle evidence changed.");
    }
    private static JsonElement DocPin(Document doc) => Freeze(new { identity = RevitCommandRouter.Identity(doc), revision = RevitCommandRouter.Revision(doc), path = doc.PathName, isModified = doc.IsModified });
    private static Document Active(UIApplication app, string path)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open the registered local test copy.");
        if (!doc.IsValidObject || !string.Equals(System.IO.Path.GetFullPath(doc.PathName), System.IO.Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase) || doc.IsLinked || doc.IsFamilyDocument || doc.IsWorkshared || doc.IsModelInCloud || doc.IsDetached || doc.IsReadOnly || doc.IsReadOnlyFile || doc.IsModifiable || doc.IsInEditMode()) throw new BridgeException("lifecycle_document_ineligible", "The registered test document is not in an eligible stable local state.");
        foreach (Document open in app.Application.Documents) if (!open.IsLinked && !open.Equals(doc)) throw new BridgeException("lifecycle_other_document", "Another primary project or family document is open.");
        return doc;
    }
    private static Document RequirePin(UIApplication app, JsonElement pin, JsonElement process, JsonElement config, bool allowSaved)
    {
        var doc = Active(app, pin.GetProperty("path").GetString()!); var actual = DocPin(doc);
        if (allowSaved) { if (doc.IsModified) throw new BridgeException("lifecycle_unsaved_changes", "The fixed test copy has pending modifications."); actual = Freeze(new { identity = actual.GetProperty("identity").GetString(), revision = actual.GetProperty("revision").GetInt64(), path = actual.GetProperty("path").GetString(), isModified = pin.GetProperty("isModified").GetBoolean() }); }
        RequireEqual(pin, actual, "pin"); RequireEqual(process, ProcessPin(), "process"); RequireEqual(config, ConfigPin(), "config"); return doc;
    }
    private static void RequireRequestFiles(JsonElement request)
    {
        var registered = DocumentLifecycleStore.ReadJson(RegistrationPath, request.GetProperty("registrationSha256").GetString());
        var reg = request.GetProperty("registration"); DocumentLifecycleStore.ReadJson(reg.GetProperty("baselineEvidenceFile").GetString()!, reg.GetProperty("baselineEvidenceSha256").GetString(), DocumentLifecycleRules.MaxSnapshotBytes);
        RequireEqual(registered, reg, "registration");
        DocumentLifecycleStore.ReadJson(request.GetProperty("baselineSnapshotFile").GetString()!, request.GetProperty("baselineSnapshotSha256").GetString(), DocumentLifecycleRules.MaxSnapshotBytes);
    }
    private static void RequireFile(JsonElement actual, JsonElement expected) => RequireEqual(expected, actual, "file");
    private static JsonElement ConfigPin()
    {
        DocumentLifecycleStore.RequireNoAliases(RuntimeFiles.SettingsFile); var info = new FileInfo(RuntimeFiles.SettingsFile); var settings = RuntimeFiles.ReadSettings();
        return Freeze(new { path = info.FullName, sha256 = Hash(info.FullName), aclSddl = info.GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner | AccessControlSections.Group).GetSecurityDescriptorSddlForm(AccessControlSections.Access | AccessControlSections.Owner | AccessControlSections.Group), port = settings.Port });
    }
    private static JsonElement ProcessPin()
    {
        using var process = Process.GetCurrentProcess(); var exe = process.MainModule?.FileName ?? throw new BridgeException("lifecycle_process_unknown", "The Revit executable identity is unavailable.");
        var version = FileVersionInfo.GetVersionInfo(exe).FileVersion ?? "";
        if (!version.StartsWith("27.3.", StringComparison.Ordinal)) throw new BridgeException("lifecycle_version_unsupported", "Only Revit 2027.3 is eligible.");
        return Freeze(new { pid = process.Id, startTimeUtc = process.StartTime.ToUniversalTime().ToString("O", System.Globalization.CultureInfo.InvariantCulture), exePath = exe, exeSha256 = Hash(exe), version,
            moduleVersionId = typeof(App).Module.ModuleVersionId.ToString(), userSid = WindowsIdentity.GetCurrent().User?.Value ?? throw new BridgeException("lifecycle_user_unknown", "The interactive Windows user is unavailable."), sessionId = process.SessionId });
    }
    private static JsonElement ReadContinuation(string op, string hash, JsonElement request)
    {
        var continuation = DocumentLifecycleStore.ReadJson(Store.PathFor(op, "continuation"));
        DocumentLifecycleRules.Exact(continuation, "schemaVersion", "operationId", "requestSha256", "savedFile", "oldProcess", "newProcess", "exitEvidenceFile", "exitEvidenceSha256", "launchEvidenceFile", "launchEvidenceSha256"); Bound(continuation, op, hash);
        RequireEqual(request.GetProperty("process"), continuation.GetProperty("oldProcess"), "process");
        var oldPid = request.GetProperty("process").GetProperty("pid").GetInt32();
        try { using var old = Process.GetProcessById(oldPid); if (!old.HasExited) throw new BridgeException("lifecycle_old_process_alive", "The old Revit PID still exists; PID reuse is also rejected."); } catch (ArgumentException) { }
        var exitPath = Store.PathFor(op, "exit-observed"); var launchPath = Store.PathFor(op, "launch-observed");
        if (!string.Equals(DocumentLifecycleRules.Text(continuation, "exitEvidenceFile"), exitPath, StringComparison.OrdinalIgnoreCase) || !string.Equals(DocumentLifecycleRules.Text(continuation, "launchEvidenceFile"), launchPath, StringComparison.OrdinalIgnoreCase)) throw DocumentLifecycleRules.Invalid("Continuation evidence uses unexpected paths.");
        var exit = DocumentLifecycleStore.ReadJson(exitPath, continuation.GetProperty("exitEvidenceSha256").GetString());
        DocumentLifecycleRules.Exact(exit, "schemaVersion", "operationId", "requestSha256", "oldProcess", "exitCode", "portReleased", "eventClosureFile", "eventClosureSha256", "savedFile", "atUtc"); Bound(exit, op, hash);
        if (exit.GetProperty("exitCode").GetInt32() != 0 || exit.GetProperty("portReleased").ValueKind != JsonValueKind.True) throw new BridgeException("lifecycle_exit_unverified", "The old process exit/port result was not verified.");
        RequireEqual(request.GetProperty("process"), exit.GetProperty("oldProcess"), "process"); RequireFile(exit.GetProperty("savedFile"), continuation.GetProperty("savedFile"));
        var closure = DocumentLifecycleStore.ReadJson(DocumentLifecycleRules.Text(exit, "eventClosureFile"), DocumentLifecycleRules.Text(exit, "eventClosureSha256"));
        var events = Store.Latest(op, hash, "event");
        if (events.Value.ValueKind == JsonValueKind.Undefined || closure.GetProperty("kind").GetString() != "shutdown_closed" || closure.GetProperty("data").GetProperty("complete").ValueKind != JsonValueKind.True || closure.GetProperty("data").GetProperty("stopReason").ValueKind != JsonValueKind.Null || closure.GetProperty("sequence").GetInt32() > events.Value.GetProperty("sequence").GetInt32()) throw new BridgeException("lifecycle_exit_evidence_incomplete", "The original event chain was not closed completely.");
        var closurePath = Store.PathFor(op, $"event-{closure.GetProperty("sequence").GetInt32():D6}");
        if (!string.Equals(exit.GetProperty("eventClosureFile").GetString(), closurePath, StringComparison.OrdinalIgnoreCase)) throw DocumentLifecycleRules.Invalid("Unexpected event closure evidence path.");
        var launch = DocumentLifecycleStore.ReadJson(launchPath, continuation.GetProperty("launchEvidenceSha256").GetString());
        DocumentLifecycleRules.Exact(launch, "schemaVersion", "operationId", "requestSha256", "exitEvidenceSha256", "newProcess", "emptyDocumentLaunch", "atUtc"); Bound(launch, op, hash);
        if (launch.GetProperty("emptyDocumentLaunch").ValueKind != JsonValueKind.True || DocumentLifecycleRules.Hash(launch.GetProperty("exitEvidenceSha256").GetString()!) != DocumentLifecycleRules.Hash(continuation.GetProperty("exitEvidenceSha256").GetString()!)) throw new BridgeException("lifecycle_launch_unverified", "The launch record is not bound to the original verified exit.");
        RequireEqual(launch.GetProperty("newProcess"), continuation.GetProperty("newProcess"), "process");
        var current = ProcessPin(); RequireEqual(current, continuation.GetProperty("newProcess"), "process");
        foreach (var key in new[] { "exePath", "exeSha256", "version", "moduleVersionId", "userSid", "sessionId" }) if (DocumentLifecycleRules.Canonical(current.GetProperty(key), "value") != DocumentLifecycleRules.Canonical(request.GetProperty("process").GetProperty(key), "value")) throw new BridgeException("lifecycle_process_changed", "The reopened Revit process differs from the approved executable/plugin/user.");
        var state = Store.Latest(op, hash).Value;
        if (Stage(state) == "EXIT_POSTED") RequireFile(state.GetProperty("data").GetProperty("savedFile"), continuation.GetProperty("savedFile"));
        return continuation;
    }
    internal static JsonElement LocalFile(string path, bool rvt)
    {
        if (!System.IO.Path.IsPathFullyQualified(path) || path.StartsWith("\\", StringComparison.Ordinal) || rvt && !path.EndsWith(".rvt", StringComparison.OrdinalIgnoreCase)) throw DocumentLifecycleRules.Invalid("Only the exact registered local absolute RVT is eligible.");
        var full = System.IO.Path.GetFullPath(path); var drive = new DriveInfo(System.IO.Path.GetPathRoot(full)!);
        if (drive.DriveType != DriveType.Fixed) throw DocumentLifecycleRules.Invalid("The target must reside on a fixed local drive.");
        var cursor = new FileInfo(full) as FileSystemInfo;
        while (cursor is not null)
        {
            if ((cursor.Attributes & FileAttributes.ReparsePoint) != 0) throw DocumentLifecycleRules.Invalid("Reparse-point path aliases are not permitted.");
            cursor = cursor is FileInfo file ? file.Directory : (cursor as DirectoryInfo)?.Parent;
        }
        var info = new FileInfo(full); if (!info.Exists || (info.Attributes & FileAttributes.ReadOnly) != 0) throw DocumentLifecycleRules.Invalid("The registered target must be an existing writable file.");
        // Revit keeps the active RVT open while lifecycle evidence is read.
        // Share read/write/delete to permit a stable read-only hash; the
        // post-read Win32 identity, size, and last-write checks detect races.
        using var handle = File.OpenHandle(full, FileMode.Open, FileAccess.Read, DocumentLifecycleRules.ModelReadSharing);
        if (!GetFileInformationByHandle(handle, out var native)) throw new BridgeException("lifecycle_file_identity_unknown", "The native target file identity is unavailable.");
        RequireFinalPath(handle, full);
        using var stream = new FileStream(handle, FileAccess.Read);
        var bytes = stream.Length; var digest = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stream)).ToLowerInvariant();
        if (!GetFileInformationByHandle(handle, out var after) || native.VolumeSerialNumber != after.VolumeSerialNumber || native.FileIndexHigh != after.FileIndexHigh || native.FileIndexLow != after.FileIndexLow || native.FileSizeHigh != after.FileSizeHigh || native.FileSizeLow != after.FileSizeLow || native.LastWriteTime.dwHighDateTime != after.LastWriteTime.dwHighDateTime || native.LastWriteTime.dwLowDateTime != after.LastWriteTime.dwLowDateTime)
            throw new BridgeException("lifecycle_file_changed", "The bound disk file changed during identity/hash capture.");
        RequireFinalPath(handle, full);
        // Delete-sharing is necessary while Revit holds the file. A retained
        // handle may still name old bytes after same-path replacement, so bind
        // a fresh path handle to the same native file before returning evidence.
        DocumentLifecycleStore.RequireNoAliases(full);
        using var currentPathHandle = File.OpenHandle(full, FileMode.Open, FileAccess.Read, DocumentLifecycleRules.ModelReadSharing);
        RequireFinalPath(currentPathHandle, full);
        if (!GetFileInformationByHandle(currentPathHandle, out var current) || native.VolumeSerialNumber != current.VolumeSerialNumber || native.FileIndexHigh != current.FileIndexHigh || native.FileIndexLow != current.FileIndexLow || native.FileSizeHigh != current.FileSizeHigh || native.FileSizeLow != current.FileSizeLow || native.LastWriteTime.dwHighDateTime != current.LastWriteTime.dwHighDateTime || native.LastWriteTime.dwLowDateTime != current.LastWriteTime.dwLowDateTime || (current.FileAttributes & (uint)(FileAttributes.ReadOnly | FileAttributes.ReparsePoint)) != 0)
            throw new BridgeException("lifecycle_file_changed", "The fixed path was replaced or changed while disk evidence was captured.");
        return Freeze(new { path = full, bytes, sha256 = digest, fileIdentity = $"{native.VolumeSerialNumber:x8}:{native.FileIndexHigh:x8}{native.FileIndexLow:x8}" });
    }
    private static void RequireFinalPath(SafeFileHandle handle, string expected)
    {
        var result = new System.Text.StringBuilder(32768);
        var length = GetFinalPathNameByHandle(handle, result, (uint)result.Capacity, 0);
        if (length == 0 || length >= result.Capacity) throw new BridgeException("lifecycle_file_identity_unknown", "The complete final target path is unavailable.");
        var finalPath = result.ToString();
        if (finalPath.StartsWith(@"\\?\", StringComparison.Ordinal)) finalPath = finalPath[4..];
        if (!string.Equals(finalPath, expected, StringComparison.OrdinalIgnoreCase)) throw DocumentLifecycleRules.Invalid("The final target file path differs from registration.");
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation { public uint FileAttributes; public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime; public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, System.Text.StringBuilder path, uint length, uint flags);
}
