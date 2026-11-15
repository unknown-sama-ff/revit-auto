using System.Text.Json;
using RevitAutoV27;

internal static class ExternalFamilyMetadataRulesTests
{
    private const string Id = "11111111-1111-4111-8111-111111111111";
    private const string Valid = """{"requestId":"11111111-1111-4111-8111-111111111111","assetKeys":["switch"],"documentIdentity":"project","expectedRevision":0}""";
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();
    private static void Reject(Action action, string? code = null)
    {
        try { action(); }
        catch (BridgeException e) when (code is null || e.Code == code) { return; }
        throw new Exception("Expected bounded external family contract rejection.");
    }
    internal static void Run(Action<string, Action> test)
    {
        test("external family metadata requires strict pins and exact unique keys", () => {
            var parsed = ExternalFamilyMetadataRules.Parse(Json(Valid));
            if (parsed.Mode != "run" || parsed.RequestId != Id || parsed.AssetKeys.Single() != "switch" || parsed.ExpectedRevision != 0)
                throw new Exception("Request lost explicit identity or asset selection.");
            foreach (var extra in new[] { ",\"path\":\"a.rfa\"", ",\"save\":true", ",\"mode\":\"open\"", ",\"assetKeys\":[\"switch\"]" })
                Reject(() => ExternalFamilyMetadataRules.Parse(Json(Valid[..^1] + extra + "}")));
            foreach (var bad in new[] { "[]", "[\"x\",\"x\"]", "[\"../x\"]", "[\"x.rfa/a\"]", "[1]", "[\"1\",\"2\",\"3\",\"4\",\"5\"]" })
                Reject(() => ExternalFamilyMetadataRules.Parse(Json(Valid.Replace("[\"switch\"]", bad))));
        });
        test("external family metadata pins reject null wrong kind and unsafe revisions", () => {
            foreach (var bad in new[] { "null", "\"0\"", "true", "-1", "0.5", "9007199254740992" })
                Reject(() => ExternalFamilyMetadataRules.Parse(Json(Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":" + bad))));
            Reject(() => ExternalFamilyMetadataRules.Parse(Json(Valid.Replace("\"project\"", "\" \""))));
            Reject(() => ExternalFamilyMetadataRules.Parse(Json(Valid.Replace(Id, "not-a-request"))));
        });
        test("external family metadata status never accepts asset or document open input", () => {
            var status = "{\"mode\":\"status\",\"requestId\":\"" + Id + "\"}";
            if (ExternalFamilyMetadataRules.Parse(Json(status)).AssetKeys.Length != 0) throw new Exception("Status contains assets.");
            Reject(() => ExternalFamilyMetadataRules.Parse(Json(status[..^1] + ",\"assetKeys\":[\"x\"]}")));
            Reject(() => ExternalFamilyMetadataRules.Parse(Json(status[..^1] + ",\"documentIdentity\":\"x\"}")));
        });
        test("external family audit catalog is independent and rejects mismatched asset extensions", () => {
            var row = "\"assetKey\":\"switch\",\"relativePath\":\"switch.rfa\",\"sha256\":\"" + new string('a', 64) + "\",\"kind\":\"rfa\"";
            var catalog = "{\"schemaVersion\":1,\"assets\":[{" + row + "}]}";
            if (ExternalFamilyMetadataRules.Catalog(Json(catalog)).Single().AssetKey != "switch") throw new Exception("Catalog key lost.");
            Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("\"rfa\"", "\"rte\""))));
            Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("\"rfa\"", "\"rvt\""))), "external_family_kind_unsupported");
            Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("switch.rfa", "../switch.rfa"))));
            Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("switch.rfa", "C:/switch.rfa"))));
            Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("\"schemaVersion\":1", "\"schemaVersion\":\"1\""))));
            Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("[{" + row + "}]", "[{" + row + "},{" + row + "}]"))));
            Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("\"kind\":\"rfa\"", "\"kind\":\"rfa\",\"expectedFamilyName\":\"guessed\""))));
        });
        test("external family audit catalog supports bounded registered RFA and RTE together", () => {
            var hash = new string('a', 64);
            var catalog = "{\"schemaVersion\":1,\"assets\":[{\"assetKey\":\"family\",\"relativePath\":\"family.rfa\",\"sha256\":\"" + hash + "\",\"kind\":\"rfa\"},{\"assetKey\":\"template\",\"relativePath\":\"templates/sample.RTE\",\"sha256\":\"" + hash + "\",\"kind\":\"rte\"}]}";
            var assets = ExternalFamilyMetadataRules.Catalog(Json(catalog));
            if (assets.Count != 2 || assets[0].Kind != "rfa" || assets[1].Kind != "rte" || assets[1].RelativePath != "templates/sample.RTE")
                throw new Exception("Mixed audit asset kinds or exact paths changed.");
            foreach (var path in new[] { "../sample.RTE", "C:/sample.RTE", "//server/share/sample.RTE", "templates//sample.RTE", "templates/sample.RTE.", "sample.rfa" })
                Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("templates/sample.RTE", path))));
            Reject(() => ExternalFamilyMetadataRules.Catalog(Json(catalog.Replace("\"kind\":\"rte\"", "\"kind\":\"RTE\""))));
        });
        test("external template exact legacy category substrings keep empty and null out", () => {
            foreach (var category in new[] { "门", "卷帘门", "窗", "照明设备", "灯具", "电气设备", "图框", "结构柱", "非精确门分类" })
                if (!ExternalFamilyMetadataRules.TemplateCategoryMatches(category)) throw new Exception("Legacy substring match was narrowed: " + category);
            foreach (var category in new string?[] { null, "", "Doors", "照 明", "常规模型", "墙" })
                if (ExternalFamilyMetadataRules.TemplateCategoryMatches(category)) throw new Exception("Legacy substring match was expanded: " + category);
            if (ExternalFamilyMetadataRules.TemplateSymbolScope != "legacy-category-name-contains-v1") throw new Exception("Legacy scope identifier drifted.");
        });
        test("external template stored file references fail closed without asserting isolation", () => {
            ExternalFamilyMetadataRules.RequireTemplateFileReferencePreflight(true, null);
            ExternalFamilyMetadataRules.RequireTemplateFileReferencePreflight(true, 0);
            foreach (var count in new[] { 1, 10000, int.MaxValue })
                Reject(() => ExternalFamilyMetadataRules.RequireTemplateFileReferencePreflight(true, count), "external_template_references_present");
            Reject(() => ExternalFamilyMetadataRules.RequireTemplateFileReferencePreflight(false, null), "external_template_reference_preflight_failed");
            Reject(() => ExternalFamilyMetadataRules.RequireTemplateFileReferencePreflight(false, 0), "external_template_reference_preflight_failed");
            Reject(() => ExternalFamilyMetadataRules.RequireTemplateFileReferencePreflight(true, -1), "external_template_reference_preflight_failed");
        });
        test("external template ids preserve full positive Int64 as decimal strings", () => {
            foreach (var id in new[] { 1L, 9007199254740992L, long.MaxValue })
                if (ExternalFamilyMetadataRules.SourceElementId(id) != id.ToString(System.Globalization.CultureInfo.InvariantCulture))
                    throw new Exception("Template native id was rounded or reformatted.");
            Reject(() => ExternalFamilyMetadataRules.SourceElementId(0), "external_template_id_unknown");
            Reject(() => ExternalFamilyMetadataRules.SourceElementId(-1), "external_template_id_unknown");
            if (ExternalFamilyMetadataRules.CategoryId(-2000011) != -2000011) throw new Exception("Safe built-in category id changed.");
            foreach (var id in new[] { 0L, 1L, -9007199254740992L, long.MinValue }) Reject(() => ExternalFamilyMetadataRules.CategoryId(id), "external_family_category_unknown");
        });
        test("external RFA type and RTE symbol rows share exact finite capacities", () => {
            ExternalFamilyMetadataRules.RequireRowCapacity(1999, 0);
            ExternalFamilyMetadataRules.RequireRowCapacity(999, 4000);
            foreach (var pair in new[] { (File: 2000, Total: 0), (File: 0, Total: 5000), (File: 1000, Total: 4000), (File: -1, Total: 0), (File: 0, Total: -1), (File: 1, Total: int.MaxValue) })
                Reject(() => ExternalFamilyMetadataRules.RequireRowCapacity(pair.File, pair.Total), "external_family_type_budget");
        });
        test("external family file budgets cannot overflow or accept empty files", () => {
            var max = ExternalFamilyMetadataRules.MaxFileBytes;
            if (ExternalFamilyMetadataRules.AddFileBytes(max, max) != max * 2) throw new Exception("Exact total limit rejected.");
            foreach (var length in new[] { -1L, 0L, max + 1, long.MaxValue }) Reject(() => ExternalFamilyMetadataRules.AddFileBytes(0, length));
            Reject(() => ExternalFamilyMetadataRules.AddFileBytes(max * 2, 1));
            Reject(() => ExternalFamilyMetadataRules.AddFileBytes(-1, 1));
        });
        test("external family known empty native names stay known while null is rejected", () => {
            ExternalFamilyMetadataRules.NativeString("");
            ExternalFamilyMetadataRules.NativeString(new string('x', 300));
            Reject(() => ExternalFamilyMetadataRules.NativeString(null));
            Reject(() => ExternalFamilyMetadataRules.NativeString(new string('x', 301)));
        });
        test("external family ownership permits only valid new inactive nonlinked documents", () => {
            for (var mask = 0; mask < 16; mask++)
            {
                bool owned = (mask & 1) != 0, valid = (mask & 2) != 0, active = (mask & 4) != 0, linked = (mask & 8) != 0;
                if (ExternalFamilyMetadataRules.MayClose(owned, valid, active, linked) != (owned && valid && !active && !linked))
                    throw new Exception("Unsafe cleanup ownership accepted.");
            }
        });
        test("external family new UUID cannot bypass retained copy or document cleanup failure", () => {
            var runs = new Dictionary<string, bool> { [Id] = true, [Guid.NewGuid().ToString("D")] = false };
            Reject(() => ExternalFamilyMetadataRules.RequireCleanupClear(0, runs.Values), "external_family_cleanup_pending");
            if (!runs[Id]) throw new Exception("Prior cleanup failure was lost.");
            Reject(() => ExternalFamilyMetadataRules.RequireCleanupClear(1, [false]), "external_family_cleanup_pending");
            ExternalFamilyMetadataRules.RequireCleanupClear(0, [false, false]);
        });
        test("external family metadata and type capture let system and classified native cancellation escape", () => {
            var native = new InvalidOperationException("simulated native cancellation");
            foreach (var cancellation in new Exception[] { new OperationCanceledException(), native })
            foreach (var kind in new[] { "field", "types" })
            {
                int nextAssetOpened = 0, unknown = 0;
                Exception? observed = null;
                for (var asset = 0; asset < 2; asset++)
                {
                    try
                    {
                        try { if (asset == 0) throw cancellation; nextAssetOpened++; }
                        catch (Exception error) when (ExternalFamilyMetadataRules.MayCaptureUnknown(error, candidate => ReferenceEquals(candidate, native)))
                        { unknown++; }
                    }
                    catch (Exception error) { observed = error; break; }
                }
                if (!ReferenceEquals(observed, cancellation) || unknown != 0 || nextAssetOpened != 0)
                    throw new Exception(kind + " cancellation was converted to unknown or continued the batch.");
            }
            if (!ExternalFamilyMetadataRules.MayCaptureUnknown(new IOException(), _ => false))
                throw new Exception("Ordinary native read errors no longer allow explicit unknown metadata.");
            foreach (var code in new[] { "external_family_active_state_changed", "external_family_time_budget" })
                if (ExternalFamilyMetadataRules.MayCaptureUnknown(new BridgeException(code, "stop"), _ => false))
                    throw new Exception("A preservation or deadline failure was swallowed as unknown.");
        });
        test("external family observes deadline and cancellation after uninterruptible cleanup completes", () => {
            bool closed = false, sourceVerified = false, copyDeleted = false;
            var elapsed = TimeSpan.FromSeconds(44);
            ExternalFamilyMetadataRules.ObserveCompletion(CancellationToken.None, elapsed);
            try { /* simulated synchronous read */ }
            finally { closed = sourceVerified = copyDeleted = true; elapsed = TimeSpan.FromSeconds(46); }
            Reject(() => ExternalFamilyMetadataRules.ObserveCompletion(CancellationToken.None, elapsed), "external_family_time_budget");
            if (!closed || !sourceVerified || !copyDeleted) throw new Exception("Late deadline discarded cleanup evidence.");
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            try { ExternalFamilyMetadataRules.ObserveCompletion(cancelled.Token, TimeSpan.FromSeconds(44)); }
            catch (OperationCanceledException) { return; }
            throw new Exception("Cancellation occurring during cleanup was accepted as completion.");
        });
        test("external family replay fingerprint binds pins catalog and ordered exact assets", () => {
            var input = ExternalFamilyMetadataRules.Parse(Json(Valid));
            var hash = ExternalFamilyMetadataRules.Fingerprint(input);
            if (hash == ExternalFamilyMetadataRules.Fingerprint(input with { ExpectedRevision = 1 }) ||
                hash == ExternalFamilyMetadataRules.Fingerprint(input with { AssetKeys = ["other"] }) ||
                hash == ExternalFamilyMetadataRules.Fingerprint(input with { ExpectedCatalogSha256 = new string('b', 64) }))
                throw new Exception("Replay identity failed to bind the request.");
        });
        test("external family raw-file guard matches legacy loader hashes without fake metadata", () => {
            var root = Path.Combine(Path.GetTempPath(), "external-family-rules-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            try
            {
                var path = Path.Combine(root, "sample.rfa"); File.WriteAllText(path, "test-source-bytes");
                var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
                using (var stream = FamilyLibraryRules.OpenVerified(root, "sample.rfa", hash))
                {
                    if (!stream.CanRead || stream.CanWrite) throw new Exception("Source stream is not read-only.");
                    try { using var writer = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite); }
                    catch (IOException) { goto Locked; }
                    throw new Exception("Source write lock was not held.");
                    Locked:;
                }
                Reject(() => { using var ignored = FamilyLibraryRules.OpenVerified(root, "sample.rfa", new string('0', 64)); }, "family_asset_changed");
            }
            finally { Directory.Delete(root, true); }
        });
        test("external audit RTE guard shares hashes and lock while loader remains RFA only", () => {
            var root = Path.Combine(Path.GetTempPath(), "external-template-rules-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            try
            {
                var path = Path.Combine(root, "sample.rte"); File.WriteAllText(path, "template-test-source-bytes");
                var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
                Reject(() => FamilyLibraryRules.Relative("sample.rte"));
                Reject(() => FamilyLibraryRules.Resolve(root, "sample.rte"));
                Reject(() => { using var ignored = FamilyLibraryRules.OpenVerified(root, "sample.rte", hash); });
                Reject(() => FamilyLibraryRules.Relative("sample.rte", ".rvt"));
                using (var stream = FamilyLibraryRules.OpenVerified(root, "sample.rte", hash, ".rte"))
                {
                    if (!stream.CanRead || stream.CanWrite) throw new Exception("Template source is not read-only.");
                    try { using var writer = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite); }
                    catch (IOException) { goto LockedTemplate; }
                    throw new Exception("Template source write lock was not held.");
                    LockedTemplate:;
                }
                Reject(() => { using var ignored = FamilyLibraryRules.OpenVerified(root, "sample.rte", new string('0', 64), ".rte"); }, "family_asset_changed");
                Reject(() => { using var ignored = FamilyLibraryRules.OpenVerified(root, "missing.rte", hash, ".rte"); }, "family_asset_missing");
            }
            finally { Directory.Delete(root, true); }
        });
    }
}
