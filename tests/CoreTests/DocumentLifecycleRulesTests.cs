using System.Text.Json;
using RevitAutoV27;

internal static class DocumentLifecycleRulesTests
{
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();
    private static void Reject(string code, Action action)
    {
        try { action(); } catch (BridgeException error) when (error.Code == code) { return; }
        throw new Exception("Expected " + code);
    }
    internal static void Run(Action<string, Action> test)
    {
        var op = new string('a', 32); var hash = new string('b', 64);
        test("lifecycle action requires exact stable operation identity and immutable request digest", () =>
        {
            var valid = JsonSerializer.Serialize(new { operationId = op, requestSha256 = hash });
            var parsed = DocumentLifecycleRules.Action(Json(valid));
            if (parsed.Id != op || parsed.Hash != hash || parsed.ReadIndex is not null) throw new Exception("Lifecycle identity was changed.");
            foreach (var bad in new[] { "{}", "null", valid.Replace("\"operationId\":", "\"path\":\"x.rvt\",\"operationId\":"), valid.Replace(op, op.ToUpperInvariant()), valid.Replace(hash, "bad"), valid.Replace("\"operationId\":", "\"operationId\":\"" + op + "\",\"operationId\":") })
                Reject("invalid_lifecycle_request", () => DocumentLifecycleRules.Action(Json(bad)));
            DocumentLifecycleRules.Action(Json(JsonSerializer.Serialize(new { operationId = op, requestSha256 = hash, readIndex = 199 })), true);
            Reject("invalid_lifecycle_request", () => DocumentLifecycleRules.Action(Json(JsonSerializer.Serialize(new { operationId = op, requestSha256 = hash, readIndex = 200 })), true));
        });
        test("lifecycle registration recipes have bounded exact method and parameter scopes", () =>
        {
            var valid = JsonSerializer.Serialize(new { modelPath = "D:\\test.rvt", baselineEvidenceFile = "D:\\runtime\\evidence.json", baselineEvidenceSha256 = hash, readRecipes = new[] { new { method = "revit.context.get", @params = new { } } } });
            DocumentLifecycleRules.Registration(Json(valid));
            foreach (var bad in new[] { valid.Replace("revit.context.get", "revit.plan.confirm"), valid.Replace("\"params\":{}", "\"params\":{\"code\":\"ignored\"}"), valid.Replace("\"readRecipes\":", "\"exePath\":\"other.exe\",\"readRecipes\":") })
                Reject("invalid_lifecycle_request", () => DocumentLifecycleRules.Registration(Json(bad)));
            Reject("invalid_lifecycle_request", () => DocumentLifecycleRules.Ids(Json("[1,1]"), 100));
            Reject("invalid_lifecycle_request", () => DocumentLifecycleRules.Ids(Json("[9007199254740992]"), 100));
        });
        test("lifecycle dependency recipes bind only fixed roots and inject the live session separately", () =>
        {
            var valid = JsonSerializer.Serialize(new { modelPath = "D:\\test.rvt", baselineEvidenceFile = "D:\\runtime\\evidence.json", baselineEvidenceSha256 = hash,
                readRecipes = new object[] { new { method = "revit.context.get", @params = new { } }, new { method = "revit.element.dependencies", @params = new { elementIds = new[] { 1, 2 } } } } });
            DocumentLifecycleRules.Registration(Json(valid));
            foreach (var fields in new[] { "\"documentIdentity\":\"old-session\",", "\"expectedRevision\":0,", "\"method\":\"revit.plan.confirm\"," })
                Reject("invalid_lifecycle_request", () => DocumentLifecycleRules.Registration(Json(valid.Replace("\"elementIds\":[1,2]", fields + "\"elementIds\":[1,2]"))));
            Reject("invalid_lifecycle_request", () => DocumentLifecycleRules.Registration(Json(valid.Replace("[1,2]", "[" + string.Join(',', Enumerable.Range(1, 21)) + "]"))));
        });
        test("lifecycle preview expires before actions and rejects clock rollback", () =>
        {
            var created = new DateTime(2026, 10, 10, 0, 0, 0, DateTimeKind.Utc); var expires = created.AddMinutes(10);
            DocumentLifecycleRules.RequireLivePreview(created, expires, created.AddMinutes(9));
            Reject("lifecycle_preview_expired", () => DocumentLifecycleRules.RequireLivePreview(created, expires, expires));
            Reject("lifecycle_preview_expired", () => DocumentLifecycleRules.RequireLivePreview(created, expires, created.AddTicks(-1)));
            Reject("lifecycle_preview_expired", () => DocumentLifecycleRules.RequireLivePreview(created, expires.AddMinutes(1), created));
        });
        test("lifecycle canonical comparison preserves full schema and ordered geometry", () =>
        {
            var first = Json("""{"items":[{"summary":{"id":2},"parameters":[{"id":2,"v":1},{"id":1,"v":-0.0}],"geometry":{"points":[{"x":1},{"x":2}]},"projection":{"plane":"xy"}}]}""");
            var reordered = Json("""{"items":[{"projection":{"plane":"xy"},"geometry":{"points":[{"x":1},{"x":2}]},"parameters":[{"v":0,"id":1},{"v":1,"id":2}],"summary":{"id":2}}]}""");
            var canonical = DocumentLifecycleRules.Canonical(first, "revit.inspect");
            if (canonical != DocumentLifecycleRules.Canonical(reordered, "revit.inspect")) throw new Exception("Only approved unordered reads and negative zero should normalize.");
            foreach (var changed in new[] { first.GetRawText().Replace("{\"x\":1},{\"x\":2}", "{\"x\":2},{\"x\":1}"), first.GetRawText().Replace("\"plane\":\"xy\"", "\"plane\":\"xz\""), first.GetRawText().Replace("\"projection\":", "\"newSchema\":true,\"projection\":") })
                if (canonical == DocumentLifecycleRules.Canonical(Json(changed), "revit.inspect")) throw new Exception("Geometry or full schema was discarded.");
        });
        test("lifecycle pin equality never normalizes native session identity revision or saved state", () =>
        {
            var pin = Json("""{"identity":"doc-a","revision":0,"path":"D:/test.rvt","isModified":false}""");
            var canonical = DocumentLifecycleRules.Canonical(pin, "pin");
            foreach (var changed in new[] { pin.GetRawText().Replace("doc-a", "doc-b"), pin.GetRawText().Replace("\"revision\":0", "\"revision\":1"), pin.GetRawText().Replace("false", "true") })
                if (canonical == DocumentLifecycleRules.Canonical(Json(changed), "pin")) throw new Exception("State pin was relaxed.");
        });
        test("lifecycle comparison does not normalize similarly named unknown schema arrays", () =>
        {
            foreach (var path in new[] { "parameters", "connectors", "peers", "systemIds", "memberIds", "selectedElementIds", "circuitIds" })
            {
                var first = Json(JsonSerializer.Serialize(new { items = new[] { new { summary = new { id = 1 }, geometry = new Dictionary<string, object> { [path] = new[] { 1, 2 } } } } }));
                var swapped = Json(first.GetRawText().Replace("[1,2]", "[2,1]"));
                if (DocumentLifecycleRules.Canonical(first, "revit.inspect") == DocumentLifecycleRules.Canonical(swapped, "revit.inspect")) throw new Exception("An unknown ordered geometry field was sorted.");
            }
            var original = Json("""{"familyTypes":[{"id":2},{"id":1}],"elementTypes":[{"id":4},{"id":3}]}""");
            var reorder = Json("""{"familyTypes":[{"id":1},{"id":2}],"elementTypes":[{"id":3},{"id":4}]}""");
            if (DocumentLifecycleRules.Canonical(original, "revit.context.get") != DocumentLifecycleRules.Canonical(reorder, "revit.context.get")) throw new Exception("Context type membership enumeration must compare as a set with duplicates retained.");
        });
        test("lifecycle unknown and stopped outcomes cannot become continuable stages", () =>
        {
            foreach (var stage in new[] { "STOPPED", "FAILED", "CANCELLED", "SAVE_OUTCOME_UNKNOWN", "OPEN_OUTCOME_UNKNOWN" })
            { if (!DocumentLifecycleRules.Terminal(stage)) throw new Exception("Uncertain lifecycle outcome permits continuation."); Reject("lifecycle_stage_mismatch", () => DocumentLifecycleRules.RequireStage(stage, "SAVE_VERIFIED")); }
        });
        test("lifecycle scope read indices reject replays gaps and wrong stages before execution", () =>
        {
            DocumentLifecycleRules.ScopeIndex("SAVE_READBACK_PENDING", 1, 1, 2);
            DocumentLifecycleRules.ScopeIndex("OPEN_READBACK_PENDING", 3, 3, 2);
            foreach (var index in new[] { 0, 2, 4 }) Reject("lifecycle_scope_index", () => DocumentLifecycleRules.ScopeIndex("SAVE_READBACK_PENDING", 1, index, 2));
            Reject("lifecycle_stage_mismatch", () => DocumentLifecycleRules.ScopeIndex("SAVE_VERIFIED", 4, 4, 2));
            Reject("lifecycle_scope_index", () => DocumentLifecycleRules.ScopeIndex("SAVE_READBACK_PENDING", 0, 0, 0));
        });
        test("lifecycle nested unordered reads cannot change outer item ordering", () =>
        {
            var first = Json("""{"items":[{"summary":{"id":1},"parameters":[{"id":2},{"id":1}]},{"summary":{"id":2},"parameters":[{"id":3},{"id":1}]}]}""");
            var reordered = Json("""{"items":[{"summary":{"id":2},"parameters":[{"id":1},{"id":3}]},{"summary":{"id":1},"parameters":[{"id":1},{"id":2}]}]}""");
            if (DocumentLifecycleRules.Canonical(first, "revit.inspect") != DocumentLifecycleRules.Canonical(reordered, "revit.inspect")) throw new Exception("Outer sorting used unnormalized nested reads.");
        });
        test("lifecycle event policy accepts only the expected one-time save sequence", () =>
        {
            var policy = new DocumentLifecycleEventPolicy("doc-a"); policy.BeginSave(); policy.Saving("doc-a"); policy.Saved("doc-a", true); policy.EndSave();
            if (!policy.SavedSuccessfully || policy.StopReason is not null) throw new Exception("A matching successful save was rejected.");
            policy.BeginSave(); policy.Saving("doc-a");
            if (policy.StopReason != "unexpected_document_save" || policy.SavedSuccessfully) throw new Exception("A second native save was accepted.");
            foreach (var sequence in new Action<DocumentLifecycleEventPolicy>[] { p => p.Saving("doc-a"), p => { p.BeginSave(); p.Saving("doc-b"); }, p => { p.BeginSave(); p.Saved("doc-a", true); }, p => { p.BeginSave(); p.Saving("doc-a"); p.Saved("doc-a", false); } })
            { var stopped = new DocumentLifecycleEventPolicy("doc-a"); sequence(stopped); if (stopped.StopReason is null || stopped.SavedSuccessfully) throw new Exception("An unmatched/cancelled save was certified."); }
        });
        test("lifecycle event policy pins primary open and normal exit while stopping interference", () =>
        {
            var policy = new DocumentLifecycleEventPolicy(null); policy.BeginOpen("D:/test.rvt"); policy.Opened("link", "D:/link.rvt", true, true); policy.Opened("doc-new", "D:/test.rvt", false, true); policy.EndOpen();
            if (!policy.OpenedSuccessfully) throw new Exception("A matching primary open was rejected.");
            policy.BeginExit(); policy.Closing("doc-new", false); policy.Closing("link", true); policy.ApplicationClosing();
            if (policy.StopReason is not null) throw new Exception("Normal fixed document exit was rejected.");
            foreach (var sequence in new Action<DocumentLifecycleEventPolicy>[] { p => p.Opened("doc", "D:/test.rvt", false, true), p => { p.BeginOpen("D:/test.rvt"); p.Opened("doc", "D:/wrong.rvt", false, true); }, p => { p.BeginOpen("D:/test.rvt"); p.Opened("doc", "D:/test.rvt", false, false); }, p => p.Closing("doc", false), p => { p.BeginExit(); p.Closing("other", false); }, p => p.ApplicationClosing() })
            { var stopped = new DocumentLifecycleEventPolicy("doc"); sequence(stopped); if (stopped.StopReason is null) throw new Exception("Unexpected native event was accepted."); }
        });
        test("lifecycle event stops permanently revoke save and open certification", () =>
        {
            foreach (var reason in new[] { "dialog_shown", "native_document_changed", "event_log_incomplete", "event_capture_incomplete" })
            {
                var policy = new DocumentLifecycleEventPolicy("doc"); policy.Stop(reason); policy.Stop("later"); policy.BeginSave(); policy.Saving("doc"); policy.Saved("doc", true); policy.BeginOpen("D:/test.rvt"); policy.Opened("new", "D:/test.rvt", false, true);
                if (policy.StopReason != reason || policy.SavedSuccessfully || policy.OpenedSuccessfully) throw new Exception("A stopped sequence regained successful certification.");
            }
        });
        test("lifecycle store exposes immutable fully flushed records and rejects duplicate attempts", () =>
        {
            var dir = Path.Combine(Path.GetTempPath(), "lifecycle-tests-" + Guid.NewGuid().ToString("N")); var store = new DocumentLifecycleStore(dir);
            var request = store.Create(store.PathFor(op, "request"), new { marker = "approved" });
            var requestHash = request.Hash;
            if (!store.Attempt(op, requestHash, "save") || store.Attempt(op, requestHash, "save")) throw new Exception("One-time save evidence was repeated.");
            if (!store.AttemptRecorded(op, requestHash, "save") || store.AttemptRecorded(op, requestHash, "exit")) throw new Exception("Recorded attempt evidence was not validated.");
            Reject("lifecycle_attempt_conflict", () => store.Attempt(op, new string('c', 64), "save"));
            var one = store.Append(op, requestHash, "PREVIEW_READY", new { readIndex = 0 }); var two = store.Append(op, requestHash, "SAVE_STARTED", new { readIndex = 0 });
            var latest = store.Latest(op, requestHash);
            if (latest.Hash != two.Hash || latest.Value.GetProperty("previousSha256").GetString() != one.Hash || latest.Value.GetProperty("sequence").GetInt32() != 2) throw new Exception("Lifecycle state chain changed.");
            var reread = DocumentLifecycleStore.ReadJson(request.Path, requestHash); if (reread.GetProperty("marker").GetString() != "approved") throw new Exception("Immutable request digest failed.");
            File.Delete(store.PathFor(op, "state-000002"));
            Reject("lifecycle_evidence_changed", () => store.Latest(op, requestHash));
            Directory.Delete(dir, true);
        });
        test("lifecycle store refuses broken chain and never overwrites persisted evidence", () =>
        {
            var dir = Path.Combine(Path.GetTempPath(), "lifecycle-tests-" + Guid.NewGuid().ToString("N")); var store = new DocumentLifecycleStore(dir);
            store.Create(store.PathFor(op, "request"), new { exact = true });
            var overwriteRejected = false;
            try { store.Create(store.PathFor(op, "request"), new { exact = false }); } catch (IOException) { overwriteRejected = true; }
            if (!overwriteRejected || !DocumentLifecycleStore.ReadJson(store.PathFor(op, "request")).GetProperty("exact").GetBoolean()) throw new Exception("Persisted lifecycle evidence was overwritten.");
            store.Create(store.PathFor(op, "state-000002"), new { schemaVersion = 1, operationId = op, requestSha256 = hash, sequence = 2, previousSha256 = hash, stage = "SAVE_VERIFIED", atUtc = DateTime.UtcNow, data = new { } });
            Reject("lifecycle_evidence_changed", () => store.Latest(op, hash));
            Directory.Delete(dir, true);
        });
        test("lifecycle store detects rewriting an observed prefix even when a valid chain is extended", () =>
        {
            var dir = Path.Combine(Path.GetTempPath(), "lifecycle-tests-" + Guid.NewGuid().ToString("N")); var store = new DocumentLifecycleStore(dir);
            store.Create(store.PathFor(op, "request"), new { approved = true });
            store.Append(op, hash, "PREVIEW_READY", new { readIndex = 0 }); store.Latest(op, hash);
            var prefixPath = store.PathFor(op, "state-000001");
            File.WriteAllText(prefixPath, JsonSerializer.Serialize(new { schemaVersion = 1, operationId = op, requestSha256 = hash, sequence = 1, previousSha256 = (string?)null, stage = "SAVE_STARTED", atUtc = DateTime.UtcNow, data = new { readIndex = 0 } }, DocumentLifecycleRules.Json));
            var replacementHash = DocumentLifecycleStore.ShaFile(prefixPath);
            store.Create(store.PathFor(op, "state-000002"), new { schemaVersion = 1, operationId = op, requestSha256 = hash, sequence = 2, previousSha256 = replacementHash, stage = "SAVE_VERIFIED", atUtc = DateTime.UtcNow, data = new { readIndex = 2 } });
            Reject("lifecycle_evidence_changed", () => store.Latest(op, hash));
            Directory.Delete(dir, true);
        });
        test("lifecycle stored reads enforce the byte bound before parsing and preserve the bound raw digest", () =>
        {
            var dir = Path.Combine(Path.GetTempPath(), "lifecycle-tests-" + Guid.NewGuid().ToString("N")); var store = new DocumentLifecycleStore(dir);
            var file = store.Create(store.PathFor(op, "request"), new { payload = new string('x', 100) });
            Reject("lifecycle_evidence_limit", () => DocumentLifecycleStore.ReadJson(file.Path, file.Hash, 32));
            Reject("lifecycle_evidence_changed", () => DocumentLifecycleStore.ReadJson(file.Path, new string('c', 64)));
            Directory.Delete(dir, true);
        });
        test("lifecycle model hash read shares an active Revit-style writer without acquiring write access", () =>
        {
            var path = Path.Combine(Path.GetTempPath(), "lifecycle-locked-rvt-" + Guid.NewGuid().ToString("N") + ".rvt");
            var bytes = System.Text.Encoding.UTF8.GetBytes("existing saved RVT fixture"); File.WriteAllBytes(path, bytes);
            using (var nativeLock = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete))
            {
                using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read, DocumentLifecycleRules.ModelReadSharing);
                using var stream = new FileStream(handle, FileAccess.Read);
                var digest = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stream)).ToLowerInvariant();
                if (stream.CanWrite || stream.Length != bytes.Length || digest != DocumentLifecycleStore.Sha(bytes)) throw new Exception("The read-only hash could not read stable bytes while the native writer remained open.");
            }
            if (!File.ReadAllBytes(path).SequenceEqual(bytes)) throw new Exception("Hash evidence altered disk bytes.");
            File.Delete(path);
        });
    }
}
