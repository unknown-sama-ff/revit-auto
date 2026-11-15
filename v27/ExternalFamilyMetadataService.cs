using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

// No model operations: source bytes are read-locked, Revit receives only an owned copy.
// Native OpenDocumentFile/Close are synchronous and cannot be forcibly cancelled here.
internal static class ExternalFamilyMetadataService
{
    private sealed class Entry(string fingerprint)
    {
        internal readonly string Fingerprint = fingerprint;
        internal readonly DateTime Created = DateTime.UtcNow;
        internal string State = "running";
        internal object? Report;
        internal bool HasCleanupFailure;
    }
    private sealed record Existing(Document Document, string Path, bool Modified, string Identity, long Revision);
    private static readonly Dictionary<string, Entry> Runs = new(StringComparer.Ordinal);
    // A failed close is not retried automatically or forgotten by a subsequent request.
    private static readonly List<Document> Unreleased = [];
    private static string Root => Path.Combine(RuntimeFiles.Root, "families");
    private static object Envelope(string id, Entry? entry) => new { schemaVersion = 1, requestId = id,
        state = entry?.State ?? "not-found", automaticRetry = false, report = entry?.Report };
    private static Dictionary<string, object?> Field(object? value, string? reason = null) =>
        new() { ["known"] = reason is null && value is not null, ["value"] = reason is null ? value : null,
            ["reason"] = reason ?? (value is null ? "native_value_unavailable" : null) };
    private static object Error(string code, string message) => new { code, message };
    private static object Error(Exception exception) => exception switch {
        BridgeException e => Error(e.Code, "External asset audit stopped: " + e.Code),
        OperationCanceledException => Error("external_family_cancelled", "Read cancelled; synchronous native calls were not forcibly interrupted."),
        Autodesk.Revit.Exceptions.OperationCanceledException => Error("external_family_native_cancelled", "Native opening was cancelled; it was not retried."),
        FileNotFoundException or DirectoryNotFoundException => Error("external_family_file_missing", "Registered audit catalog or source file is missing."),
        UnauthorizedAccessException => Error("external_family_file_inaccessible", "Registered source or task copy is inaccessible."),
        IOException => Error("external_family_file_unavailable", "Source, catalog, or task copy is locked or unavailable."),
        _ => Error("external_family_read_failed", "External asset read failed: " + exception.GetType().Name) };
    private static bool MayCaptureUnknown(Exception exception) => ExternalFamilyMetadataRules.MayCaptureUnknown(exception,
        static error => error is Autodesk.Revit.Exceptions.OperationCanceledException);
    private static Dictionary<string, object?>? EmptyMetadata(string? kind) => kind switch {
        "rfa" => new() { ["documentTitle"] = Field(null), ["ownerFamilyName"] = Field(null), ["category"] = Field(null),
            ["typeNames"] = Field(null), ["typeCount"] = Field(null) },
        "rte" => new() { ["documentTitle"] = Field(null), ["instanceCounts"] = Field(null), ["symbolScope"] = Field(null),
            ["symbols"] = Field(null), ["symbolCount"] = Field(null) },
        _ => null };
    private static Dictionary<string, object?> Asset(string key) => new() {
        ["assetKey"] = key, ["kind"] = null, ["status"] = "not-scanned", ["sourceSha256"] = null,
        ["sourceBytes"] = null, ["sourceBytesUnchanged"] = null, ["sourceFormat"] = Field(null),
        ["upgradedInMemory"] = null, ["openedInBackground"] = false, ["ownershipVerified"] = false,
        ["ownedDocumentClosed"] = null, ["copyDeleted"] = null, ["metadata"] = null,
        ["ownershipEvidence"] = new Dictionary<string, object?> { ["beforeOpenDocumentCount"] = null,
            ["newDocumentVerified"] = false, ["taskCopyPathVerified"] = false, ["ownedDocumentIdentity"] = null,
            ["closeAttempted"] = false, ["nativeCloseReturned"] = null, ["ownedDocumentPresentAfterClose"] = null },
        ["error"] = null, ["cleanupError"] = null };
    private static List<Document> OpenDocuments(UIApplication app) => app.Application.Documents.Cast<Document>().ToList();
    private static bool Same(Document a, Document b) => a.IsValidObject && b.IsValidObject && a.Equals(b);
    private static bool SamePath(string a, string b) => !string.IsNullOrEmpty(a) && !string.IsNullOrEmpty(b) &&
        string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
    private static bool IsActive(UIApplication app, Document doc) => app.ActiveUIDocument?.Document is { } active && Same(active, doc);
    private static long[] Selection(UIApplication app) => app.ActiveUIDocument!.Selection.GetElementIds().Select(id => id.Value).Order().ToArray();
    private static string Sha(Stream stream)
    {
        stream.Position = 0;
        var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        stream.Position = 0; return hash;
    }
    private static List<ExternalFamilyAsset> Catalog(string? expected, out string sha, out FileStream held)
    {
        var path = Path.Combine(Root, "audit-library.json");
        FamilyLibraryRules.EnsurePlainPath(path);
        held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            FamilyLibraryRules.EnsurePlainPath(path);
            if (held.Length <= 0 || held.Length > ExternalFamilyMetadataRules.MaxCatalogBytes)
                throw new BridgeException("external_family_catalog_budget", "Audit catalog exceeds its byte budget.");
            var bytes = new byte[(int)held.Length]; held.ReadExactly(bytes);
            sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            if (expected is not null && expected != sha)
                throw new BridgeException("external_family_catalog_changed", "Audit catalog differs from the reviewed hash.");
            var offset = bytes.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf ? 3 : 0;
            using var json = JsonDocument.Parse(bytes.AsMemory(offset));
            return ExternalFamilyMetadataRules.Catalog(json.RootElement);
        }
        catch { held.Dispose(); throw; }
    }
    public static object Get(UIApplication app, JsonElement request, CancellationToken cancellation)
    {
        var input = ExternalFamilyMetadataRules.Parse(request);
        if (input.Mode == "status") return Envelope(input.RequestId, Runs.GetValueOrDefault(input.RequestId));
        var fingerprint = ExternalFamilyMetadataRules.Fingerprint(input);
        if (Runs.TryGetValue(input.RequestId, out var prior))
        {
            if (prior.Fingerprint != fingerprint) throw new BridgeException("external_family_request_conflict", "requestId was already used for a different request.");
            return Envelope(input.RequestId, prior);
        }
        // Do not evict a running or cleanup-failed request; no model write retry is hidden here.
        foreach (var pair in Runs.Where(p => p.Value.State != "running" && !p.Value.HasCleanupFailure && DateTime.UtcNow - p.Value.Created > TimeSpan.FromMinutes(30)).ToArray())
            Runs.Remove(pair.Key);
        if (Runs.Count >= 16) throw new BridgeException("external_family_request_capacity", "Audit recovery history is full; no external document opened.");
        var entry = new Entry(fingerprint); Runs.Add(input.RequestId, entry);
        var results = input.AssetKeys.Select(Asset).ToList();
        var errors = new List<object>();
        string? catalogSha = null;
        bool activeUnchanged = false, existingUnchanged = false;
        List<Existing>? before = null;
        Document? project = null;
        string? identity = null, path = null;
        long revision = 0, viewId = -1;
        bool modified = false;
        long[] selection = [];
        var timer = Stopwatch.StartNew();
        void Check()
        {
            ExternalFamilyMetadataRules.ObserveCompletion(cancellation, timer.Elapsed);
            if (project is null || !project.IsValidObject || !IsActive(app, project) || project.PathName != path ||
                project.IsModified != modified || project.IsModifiable || RevitCommandRouter.Identity(project) != identity ||
                RevitCommandRouter.Revision(project) != revision || app.ActiveUIDocument!.ActiveView.Id.Value != viewId ||
                !Selection(app).SequenceEqual(selection))
                throw new BridgeException("external_family_active_state_changed", "The active project changed during external family auditing.");
            if (before is not null && before.Any(e => !e.Document.IsValidObject || e.Document.PathName != e.Path ||
                e.Document.IsModified != e.Modified || RevitCommandRouter.Identity(e.Document) != e.Identity || RevitCommandRouter.Revision(e.Document) != e.Revision))
                throw new BridgeException("external_family_active_state_changed", "An existing document changed during external family auditing.");
        }
        try
        {
            project = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open the reviewed project first.");
            if (!project.IsValidObject || project.IsFamilyDocument || project.IsModifiable || DocumentLifecycleService.LeaseActive ||
                DocumentLifecycleService.ExitPosted || DocumentLifecycleService.ShuttingDown || RevitCommandRouter.HasPendingPlans())
                throw new BridgeException("external_family_document_busy", "External audit cannot overlap a model plan or document lifecycle operation.");
            DocumentReadPinRules.Validate(request, RevitCommandRouter.Identity(project), RevitCommandRouter.Revision(project));
            identity = RevitCommandRouter.Identity(project); revision = RevitCommandRouter.Revision(project); path = project.PathName;
            modified = project.IsModified; viewId = app.ActiveUIDocument!.ActiveView.Id.Value; selection = Selection(app);
            before = OpenDocuments(app).Select(d => new Existing(d, d.PathName, d.IsModified, RevitCommandRouter.Identity(d), RevitCommandRouter.Revision(d))).ToList();
            Unreleased.RemoveAll(d => !d.IsValidObject);
            ExternalFamilyMetadataRules.RequireCleanupClear(Unreleased.Count, Runs.Values.Select(run => run.HasCleanupFailure));
            Check();
            var catalog = Catalog(input.ExpectedCatalogSha256, out var digest, out var catalogLock);
            catalogSha = digest;
            using (catalogLock)
            {
                var selected = input.AssetKeys.Select(key => catalog.SingleOrDefault(a => a.AssetKey == key)).ToArray();
                // Populate every resolvable kind before a missing key or an earlier asset stops the batch.
                for (var index = 0; index < selected.Length; index++)
                    if (selected[index] is { } asset)
                    { results[index]["kind"] = asset.Kind; results[index]["metadata"] = EmptyMetadata(asset.Kind); }
                if (selected.Any(asset => asset is null))
                    throw new BridgeException("external_family_not_registered", "An assetKey is not registered in the audit catalog.");
                long totalBytes = 0; int totalTypes = 0;
                for (var index = 0; index < selected.Length; index++)
                {
                    Check();
                    var stop = ReadOne(app, selected[index]!, results[index], before, input.RequestId, index, cancellation, Check, ref totalBytes, ref totalTypes);
                    if (stop) break;
                }
            }
        }
        catch (Exception exception) { errors.Add(Error(exception)); }
        // Final preservation checks run even after cancellation/read errors, without cancelling cleanup.
        try
        {
            activeUnchanged = project is not null && project.IsValidObject && IsActive(app, project) && project.PathName == path &&
                project.IsModified == modified && !project.IsModifiable && RevitCommandRouter.Identity(project) == identity &&
                RevitCommandRouter.Revision(project) == revision && app.ActiveUIDocument!.ActiveView.Id.Value == viewId && Selection(app).SequenceEqual(selection);
            var current = OpenDocuments(app);
            existingUnchanged = before is not null && current.Count == before.Count && before.All(e => e.Document.IsValidObject &&
                current.Any(d => Same(d, e.Document)) && e.Document.PathName == e.Path && e.Document.IsModified == e.Modified &&
                RevitCommandRouter.Identity(e.Document) == e.Identity && RevitCommandRouter.Revision(e.Document) == e.Revision);
        }
        catch (Exception exception) { errors.Add(Error("external_family_final_state_unknown", exception.GetType().Name)); }
        if (!activeUnchanged || !existingUnchanged) errors.Add(Error("external_family_state_not_preserved", "Active or existing document preservation was not verified."));
        var complete = errors.Count == 0 && results.All(a => Equals(a["status"], "complete")) && activeUnchanged && existingUnchanged;
        entry.Report = new { readOnly = true, planCreated = false, modelWritesRequested = false, familyLoaded = false,
            automaticSave = false, automaticRetry = false, externalReferenceIsolationVerified = false,
            documentIdentity = input.DocumentIdentity!, documentRevision = input.ExpectedRevision!.Value,
            catalogSha256 = catalogSha, activeProjectUnchanged = activeUnchanged, existingDocumentsUnchanged = existingUnchanged,
            complete, results, errors };
        if (JsonSerializer.SerializeToUtf8Bytes(entry.Report).Length > ExternalFamilyMetadataRules.MaxResultBytes - 1024)
        {
            foreach (var result in results) { result["status"] = "failed"; result["metadata"] = EmptyMetadata(result["kind"] as string); result["error"] ??= Error("external_family_output_budget", "Native report exceeded its byte budget."); }
            errors.Add(Error("external_family_output_budget", "Native report exceeded its byte budget; metadata was not certified."));
            entry.Report = new { readOnly = true, planCreated = false, modelWritesRequested = false, familyLoaded = false,
                automaticSave = false, automaticRetry = false, externalReferenceIsolationVerified = false,
                documentIdentity = input.DocumentIdentity!, documentRevision = input.ExpectedRevision!.Value,
                catalogSha256 = catalogSha, activeProjectUnchanged = activeUnchanged, existingDocumentsUnchanged = existingUnchanged,
                complete = false, results, errors };
            complete = false;
        }
        entry.State = complete ? "completed" : "failed";
        entry.HasCleanupFailure = results.Any(a => a["cleanupError"] is not null);
        return Envelope(input.RequestId, entry);
    }
    private static bool ReadOne(UIApplication app, ExternalFamilyAsset asset, Dictionary<string, object?> result,
        List<Existing> before, string requestId, int index, CancellationToken cancellation, Action check,
        ref long totalBytes, ref int totalTypes)
    {
        FileStream? source = null, stageLock = null; Document? opened = null; bool owned = false, stop = false;
        string? ownedSessionId = null;
        string? staged = null; bool stageCreated = false;
        var evidence = (Dictionary<string, object?>)result["ownershipEvidence"]!;
        result["status"] = "failed";
        try
        {
            check();
            var extension = "." + asset.Kind;
            var sourcePath = FamilyLibraryRules.Resolve(Root, asset.RelativePath, extension);
            if (before.Any(e => SamePath(e.Path, sourcePath))) throw new BridgeException("external_family_already_open", "The registered source is already an open document.");
            ExternalFamilyMetadataRules.AddFileBytes(totalBytes, new FileInfo(sourcePath).Length);
            source = FamilyLibraryRules.OpenVerified(Root, asset.RelativePath, asset.Sha256, extension);
            totalBytes = ExternalFamilyMetadataRules.AddFileBytes(totalBytes, source.Length);
            result["sourceSha256"] = asset.Sha256; result["sourceBytes"] = source.Length;
            var stageRoot = Path.Combine(RuntimeFiles.DirectoryPath, "external-family-audit", requestId,
                index.ToString(System.Globalization.CultureInfo.InvariantCulture));
            FamilyLibraryRules.EnsurePlainPath(stageRoot); Directory.CreateDirectory(stageRoot); FamilyLibraryRules.EnsurePlainPath(stageRoot);
            // Preserve the source basename: Revit document titles/owner metadata can
            // depend on the opened filename. The per-index directory supplies uniqueness.
            staged = Path.Combine(stageRoot, Path.GetFileName(sourcePath));
            using (var target = new FileStream(staged, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            {
                stageCreated = true; source.CopyTo(target); target.Flush(true);
                if (target.Length != source.Length || Sha(target) != asset.Sha256)
                    throw new BridgeException("external_family_copy_changed", "Task copy is not byte-identical to the registered source.");
            }
            FamilyLibraryRules.EnsurePlainPath(staged);
            stageLock = new FileStream(staged, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (Sha(stageLock) != asset.Sha256) throw new BridgeException("external_family_copy_changed", "Task copy changed before native read.");
            using (var info = BasicFileInfo.Extract(staged))
            {
                var format = info.Format; ExternalFamilyMetadataRules.NativeString(format);
                result["sourceFormat"] = Field(format);
                if (info.IsWorkshared || info.IsSavedInLaterVersion || !int.TryParse(format, out var year) ||
                    !int.TryParse(app.Application.VersionNumber, out var running))
                    throw new BridgeException("external_family_header_unsupported", "Asset version or worksharing header is unsupported or unknown.");
                result["upgradedInMemory"] = year < running;
            }
            if (asset.Kind == "rte")
            {
                int? storedReferences;
                try
                {
                    // Read only. A null record does not establish external-resource isolation.
                    using var transmission = TransmissionData.ReadTransmissionData(ModelPathUtils.ConvertUserVisiblePathToModelPath(staged));
                    storedReferences = transmission?.GetAllExternalFileReferenceIds().Count;
                }
                catch (Exception exception) when (MayCaptureUnknown(exception))
                { throw new BridgeException("external_template_reference_preflight_failed", "Stored external file references could not be read; template left closed."); }
                ExternalFamilyMetadataRules.RequireTemplateFileReferencePreflight(true, storedReferences);
            }
            check();
            // Snapshot immediately before native open, not only at batch start.
            var immediatelyBefore = OpenDocuments(app);
            evidence["beforeOpenDocumentCount"] = immediatelyBefore.Count;
            if (immediatelyBefore.Any(d => SamePath(d.PathName, staged) || SamePath(d.PathName, sourcePath)))
                throw new BridgeException("external_family_already_open", "Source or task copy is already open; it is not owned by this call.");
            opened = app.Application.OpenDocumentFile(staged);
            evidence["newDocumentVerified"] = opened is not null && opened.IsValidObject && !immediatelyBefore.Any(d => Same(d, opened));
            evidence["taskCopyPathVerified"] = opened is not null && opened.IsValidObject && SamePath(opened.PathName, staged);
            if (opened is null || !opened.IsValidObject || immediatelyBefore.Any(d => Same(d, opened)) ||
                !SamePath(opened.PathName, staged) || IsActive(app, opened) || opened.IsLinked)
            {
                stop = true;
                if (opened is not null && opened.IsValidObject && !immediatelyBefore.Any(d => Same(d, opened))) Unreleased.Add(opened);
                result["cleanupError"] = Error("external_family_ownership_unknown", "Native open did not yield a safely closable owned document.");
                throw new BridgeException("external_family_ownership_unknown", "Native open did not yield a newly owned background document.");
            }
            owned = true; Unreleased.Add(opened);
            ownedSessionId = RevitCommandRouter.Identity(opened);
            evidence["ownedDocumentIdentity"] = ownedSessionId;
            result["ownershipVerified"] = true; result["openedInBackground"] = true;
            check();
            if (opened.IsFamilyDocument != (asset.Kind == "rfa"))
                throw new BridgeException("external_family_document_type", "Registered asset did not open as its declared document kind.");
            var meta = (Dictionary<string, object?>)result["metadata"]!;
            void Read(string key, Func<object?> getter)
            {
                check();
                try { meta[key] = Field(getter()); }
                catch (Exception exception) when (MayCaptureUnknown(exception))
                { meta[key] = Field(null, exception is BridgeException b ? b.Code : exception.GetType().Name); }
            }
            Read("documentTitle", () => { var title = opened.Title; ExternalFamilyMetadataRules.NativeString(title); return title; });
            if (asset.Kind == "rte")
            {
                Read("instanceCounts", () => {
                    var counts = new List<object>();
                    foreach (var category in new[] { BuiltInCategory.OST_Walls, BuiltInCategory.OST_Windows, BuiltInCategory.OST_LightingFixtures })
                    {
                        check();
                        using var collector = new FilteredElementCollector(opened);
                        counts.Add(new { category = category.ToString(), count = collector.OfCategory(category).WhereElementIsNotElementType().GetElementCount() });
                    }
                    return counts;
                });
                var symbols = new List<(long Id, long CategoryId, string CategoryName, string FamilyName, string TypeName, string SourceId)>();
                try
                {
                    using var collector = new FilteredElementCollector(opened);
                    foreach (FamilySymbol symbol in collector.OfClass(typeof(FamilySymbol)))
                    {
                        check();
                        var category = symbol.Category;
                        if (category is null) continue;
                        var categoryName = category.Name;
                        ExternalFamilyMetadataRules.NativeString(categoryName);
                        if (!ExternalFamilyMetadataRules.TemplateCategoryMatches(categoryName)) continue;
                        ExternalFamilyMetadataRules.RequireRowCapacity(symbols.Count, totalTypes);
                        var familyName = symbol.FamilyName; var typeName = symbol.Name;
                        ExternalFamilyMetadataRules.NativeString(familyName); ExternalFamilyMetadataRules.NativeString(typeName);
                        var id = symbol.Id.Value;
                        symbols.Add((id, ExternalFamilyMetadataRules.CategoryId(category.Id.Value), categoryName, familyName, typeName, ExternalFamilyMetadataRules.SourceElementId(id)));
                    }
                    meta["symbols"] = Field(symbols.OrderBy(symbol => symbol.Id).Select(symbol => new {
                        category = new { id = symbol.CategoryId, name = symbol.CategoryName }, familyName = symbol.FamilyName,
                        typeName = symbol.TypeName, sourceElementId = symbol.SourceId }).ToArray());
                    meta["symbolCount"] = Field(symbols.Count);
                    meta["symbolScope"] = Field(ExternalFamilyMetadataRules.TemplateSymbolScope);
                }
                catch (Exception exception) when (MayCaptureUnknown(exception))
                {
                    var reason = exception is BridgeException b ? b.Code : exception.GetType().Name;
                    meta["symbols"] = Field(null, reason); meta["symbolCount"] = Field(null, reason); meta["symbolScope"] = Field(null, reason);
                }
                finally { totalTypes += symbols.Count; }
            }
            else
            {
                Read("ownerFamilyName", () => { var name = opened.OwnerFamily?.Name; ExternalFamilyMetadataRules.NativeString(name); return name; });
                Read("category", () => {
                    var category = opened.OwnerFamily?.FamilyCategory;
                    if (category is null) throw new BridgeException("external_family_category_unknown", "Native owner category is unavailable.");
                    var name = category.Name; ExternalFamilyMetadataRules.NativeString(name); return new { id = category.Id.Value, name };
                });
                var names = new List<string>();
                try
                {
                    using var manager = opened.FamilyManager;
                    using var types = manager.Types;
                    foreach (FamilyType type in types)
                    {
                        check();
                        ExternalFamilyMetadataRules.RequireRowCapacity(names.Count, totalTypes);
                        var name = type.Name; ExternalFamilyMetadataRules.NativeString(name); names.Add(name);
                    }
                    meta["typeNames"] = Field(names.Order(StringComparer.Ordinal).ToArray()); meta["typeCount"] = Field(names.Count);
                }
                catch (Exception exception) when (MayCaptureUnknown(exception))
                {
                    var reason = exception is BridgeException b ? b.Code : exception.GetType().Name;
                    meta["typeNames"] = Field(null, reason); meta["typeCount"] = Field(null, reason);
                }
                finally { totalTypes += names.Count; }
            }
            check();
            if (meta.Values.Cast<Dictionary<string, object?>>().Any(f => !Equals(f["known"], true)))
                throw new BridgeException("external_family_metadata_incomplete", "One or more native metadata fields remain unknown.");
            result["status"] = "complete";
        }
        catch (Exception exception)
        {
            result["error"] = Error(exception);
            if (exception is OperationCanceledException or Autodesk.Revit.Exceptions.OperationCanceledException || exception is BridgeException b && b.Code is "external_family_active_state_changed" or "external_family_time_budget") stop = true;
            // An exception from Open may have left a document behind without a returned owner.
            if (opened is null && staged is not null)
            {
                try { var unknown = OpenDocuments(app).Where(d => SamePath(d.PathName, staged)).ToArray(); if (unknown.Length != 0) { Unreleased.AddRange(unknown); stop = true; result["cleanupError"] = Error("external_family_ownership_unknown", "Task-path document exists without a verified returned owner; it was not closed."); } }
                catch { stop = true; result["cleanupError"] = Error("external_family_ownership_unknown", "Open document ownership could not be determined."); }
            }
        }
        finally
        {
            if (owned && opened is not null)
            {
                try
                {
                    if (!ExternalFamilyMetadataRules.MayClose(owned, opened.IsValidObject, IsActive(app, opened), opened.IsLinked))
                        throw new BridgeException("external_family_close_refused", "Task document is no longer a closable background document.");
                    evidence["closeAttempted"] = true;
                    var closed = opened.Close(false); evidence["nativeCloseReturned"] = closed;
                    var stillPresent = OpenDocuments(app).Any(d => RevitCommandRouter.Identity(d) == ownedSessionId);
                    evidence["ownedDocumentPresentAfterClose"] = stillPresent;
                    var released = closed && !opened.IsValidObject && !stillPresent;
                    result["ownedDocumentClosed"] = released;
                    if (!released) throw new BridgeException("external_family_close_failed", "Close(false) did not prove task document release.");
                    Unreleased.RemoveAll(d => ReferenceEquals(d, opened));
                }
                catch (Exception exception) { result["ownedDocumentClosed"] = false; result["cleanupError"] = Error(exception); stop = true; }
            }
            stageLock?.Dispose();
            if (source is not null)
            {
                try { result["sourceBytesUnchanged"] = Sha(source) == asset.Sha256; }
                catch { result["sourceBytesUnchanged"] = false; }
                source.Dispose();
                if (!Equals(result["sourceBytesUnchanged"], true)) { result["error"] ??= Error("external_family_source_changed", "Source bytes could not be verified unchanged."); stop = true; }
            }
            if (stageCreated && staged is not null && result["cleanupError"] is null && (!owned || Equals(result["ownedDocumentClosed"], true)))
            {
                try { FamilyLibraryRules.EnsurePlainPath(staged); File.Delete(staged); result["copyDeleted"] = !File.Exists(staged); if (!Equals(result["copyDeleted"], true)) throw new IOException("Task copy remains."); }
                catch { result["copyDeleted"] = false; result["cleanupError"] = Error("external_family_copy_cleanup_failed", "Task copy could not be removed after safe document release."); stop = true; }
            }
            if (result["error"] is not null || result["cleanupError"] is not null) result["status"] = "failed";
        }
        // Close(false), source hashing and copy removal are intentionally not
        // interrupted. Once they return, late cancellation/deadline still defeats
        // completion without replacing an earlier read or cleanup failure.
        try { check(); }
        catch (Exception exception)
        {
            result["error"] ??= Error(exception);
            result["status"] = "failed";
            stop = true;
        }
        return stop;
    }
}
