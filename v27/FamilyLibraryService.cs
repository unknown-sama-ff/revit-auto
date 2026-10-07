using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class FamilyLibraryService
{
    private static string Root => Path.Combine(RuntimeFiles.Root, "families");
    private static List<FamilyAsset> ReadCatalog()
    {
        var path = Path.Combine(Root, "library.json");
        FamilyLibraryRules.EnsurePlainPath(path);
        if (!File.Exists(path)) throw new BridgeException("family_catalog_unavailable", "Register reviewed assets in local families/library.json first. Arbitrary RFA paths are not accepted.");
        if (new FileInfo(path).Length > 2 * 1024 * 1024) throw new BridgeException("invalid_family_library", "Local family manifest exceeds 2 MB.");
        using var json = JsonDocument.Parse(File.ReadAllText(path).TrimStart('\uFEFF'));
        return FamilyLibraryRules.Catalog(json.RootElement);
    }
    internal static object Catalog(UIApplication app, JsonElement parameters)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        var identity = RevitCommandRouter.Identity(doc);
        var revision = RevitCommandRouter.Revision(doc);
        if (JsonDefaults.String(parameters, "documentIdentity") is { } expected && expected != identity)
            throw new BridgeException("document_changed", "Read the current project before querying approved family assets.");
        if (JsonDefaults.Int64(parameters, "expectedRevision") is long r && r != revision)
            throw new BridgeException("document_revision_changed", "The project changed before querying approved family assets.");
        return new { documentIdentity = identity, documentRevision = revision, assets = ReadCatalog().Select(asset => new {
            familyKey = asset.FamilyKey, sha256 = asset.Sha256, expectedFamilyName = asset.ExpectedFamilyName,
            expectedCategoryId = asset.ExpectedCategoryId, requiredTypes = asset.RequiredTypes,
            byteVerification = "rechecked-before-preview-and-held-read-only-during-load" }).ToArray(),
            readOnly = true, filePathsExposed = false, note = "Local manifest is the asset whitelist; no RFA is loaded by this catalog read. Family metadata is verified after loading within the approved transaction." };
    }
    private static FamilyAsset Asset(FamilyLoadInput input)
    {
        var asset = ReadCatalog().SingleOrDefault(asset => asset.FamilyKey == input.FamilyKey)
            ?? throw new BridgeException("family_not_registered", "familyKey is not in the local approved catalog.");
        FamilyLibraryRules.Match(asset, input);
        return asset;
    }
    private static void RequireProjectDocument(Document doc)
    {
        if (!doc.IsValidObject) throw new BridgeException("no_active_document", "The active project is no longer valid.");
        if (doc.IsFamilyDocument) throw new BridgeException("invalid_document_type", "Family loading is supported only in project documents.");
        if (doc.IsReadOnly) throw new BridgeException("document_read_only", "The active project is read-only.");
    }
    private static Family? Existing(Document doc, string exactName)
    {
        var matches = new FilteredElementCollector(doc).OfClass(typeof(Family)).Cast<Family>().Where(f => f.Name == exactName).Take(2).ToArray();
        if (matches.Length > 1) throw new BridgeException("family_name_ambiguous", "Multiple exact family names exist; no family is selected.");
        return matches.SingleOrDefault();
    }
    private static bool Shared(Family family)
    {
        var parameter = family.get_Parameter(BuiltInParameter.FAMILY_SHARED);
        if (parameter is not { StorageType: StorageType.Integer, HasValue: true })
            throw new BridgeException("family_shared_state_unknown", "Native shared-family state is unavailable; do not assume ordinary family loading is safe.");
        return parameter.AsInteger() != 0;
    }
    private static void Verify(Document doc, Family family, FamilyLoadInput input)
    {
        if (family.Name != input.ExpectedFamilyName || family.FamilyCategory?.Id.Value != input.ExpectedCategoryId)
            throw new BridgeException("family_metadata_mismatch", "Native family name/category differs from the reviewed catalog; the whole transaction must roll back.");
        if (Shared(family)) throw new BridgeException("shared_family_not_supported", "Shared-family loading requires a separately reviewed strategy; this loader refuses it.");
        var types = family.GetFamilySymbolIds().Select(id => (doc.GetElement(id) as FamilySymbol)?.Name).ToHashSet(StringComparer.Ordinal);
        if (input.RequiredTypes.Any(type => !types.Contains(type)))
            throw new BridgeException("family_types_missing", "Native family lacks required reviewed type names; do not commit partial family loading.");
    }
    internal static object Validate(Document doc, JsonElement operation)
    {
        var input = FamilyLibraryRules.Operation(operation);
        var asset = Asset(input);
        using var file = FamilyLibraryRules.OpenVerified(Root, asset);
        var existing = Existing(doc, input.ExpectedFamilyName);
        if (existing is not null)
        {
            if (Shared(existing)) throw new BridgeException("shared_family_not_supported", "Existing shared family is not handled by ordinary loading.");
            if (input.ConflictPolicy == "reject") throw new BridgeException("family_already_loaded", "The exact family already exists. Explicitly review keep_existing or replace before a new preview.");
            if (input.ConflictPolicy == "keep_existing") Verify(doc, existing, input);
        }
        var typeIds = existing?.GetFamilySymbolIds().Select(id => id.Value).ToHashSet() ?? [];
        var affected = typeIds.Count == 0 ? [] : new FilteredElementCollector(doc).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
            .Where(instance => typeIds.Contains(instance.GetTypeId().Value)).Select(instance => instance.Id.Value).ToArray();
        return new { familyKey = input.FamilyKey, sha256 = input.Sha256, expectedFamilyName = input.ExpectedFamilyName,
            expectedCategoryId = input.ExpectedCategoryId, requiredTypes = input.RequiredTypes,
            conflictPolicy = input.ConflictPolicy, overwriteTypeParameters = input.OverwriteTypeParameters,
            existingFamilyId = existing?.Id.Value, affectedInstanceCount = input.ConflictPolicy == "replace" ? affected.Length : 0,
            affectedInstanceIds = input.ConflictPolicy == "replace" ? affected.Take(100).ToArray() : [],
            affectedInstanceIdsTruncated = input.ConflictPolicy == "replace" && affected.Length > 100,
            note = "Preview does not open/load the RFA or certify its native metadata. File bytes, name/category/types and shared conflicts are checked during approved execution." };
    }
    private sealed class LoadOptions(FamilyLoadInput input) : IFamilyLoadOptions
    {
        public bool SharedConflict { get; private set; }
        public bool OnFamilyFound(bool familyInUse, out bool overwriteParameterValues)
        {
            overwriteParameterValues = input.OverwriteTypeParameters;
            return input.ConflictPolicy == "replace";
        }
        public bool OnSharedFamilyFound(Family sharedFamily, bool familyInUse, out FamilySource source, out bool overwriteParameterValues)
        {
            source = FamilySource.Project; overwriteParameterValues = false; SharedConflict = true; return false;
        }
    }
    private static HashSet<long> AllFamilyElements(Document doc)
        => new FilteredElementCollector(doc).WhereElementIsElementType().OfClass(typeof(FamilySymbol)).Select(e => e.Id.Value)
            .Concat(new FilteredElementCollector(doc).OfClass(typeof(Family)).Select(e => e.Id.Value)).ToHashSet();
    internal static OperationReceipt Load(Document doc, JsonElement operation)
    {
        var input = FamilyLibraryRules.Operation(operation);
        var asset = Asset(input);
        using var file = FamilyLibraryRules.OpenVerified(Root, asset); // Windows sharing lock pins bytes until native loading finishes.
        var existing = Existing(doc, input.ExpectedFamilyName);
        if (existing is not null && input.ConflictPolicy == "reject") throw new BridgeException("family_already_loaded", "The exact family exists; load conflict strategy changed.");
        if (existing is not null && input.ConflictPolicy == "keep_existing")
        {
            Verify(doc, existing, input);
            return new([], []) { Evidence = NativeEvidence(doc, existing, input, "kept-existing", false) };
        }
        var before = AllFamilyElements(doc);
        var oldTypes = existing?.GetFamilySymbolIds().Select(id => id.Value).ToArray() ?? [];
        var options = new LoadOptions(input);
        var loaded = doc.LoadFamily(file.Name, options, out var family);
        if (options.SharedConflict) throw new BridgeException("shared_family_not_supported", "Native shared-family conflict was refused; the approved transaction must roll back.");
        if (!loaded) throw new BridgeException("family_load_failed", "Revit returned false: unchanged and failed loading cannot be distinguished safely. Use explicitly reviewed keep_existing to retain the native family.");
        if (family is null) throw new BridgeException("family_load_failed", "Revit did not return the reviewed family; no partial result may commit.");
        Verify(doc, family, input);
        var after = AllFamilyElements(doc);
        var changed = existing is not null && loaded ? oldTypes.Concat([existing.Id.Value]).Where(after.Contains).Distinct().ToList() : [];
        return new(after.Except(before).Order().ToList(), changed) {
            Evidence = NativeEvidence(doc, family, input, loaded ? existing is null ? "loaded-new" : "replaced-existing" : "unchanged-native-file", loaded) };
    }
    private static object NativeEvidence(Document doc, Family family, FamilyLoadInput input, string outcome, bool loaded)
        => new { familyKey = input.FamilyKey, sha256 = input.Sha256, familyId = family.Id.Value, familyName = family.Name,
            categoryId = family.FamilyCategory?.Id.Value, conflictPolicy = input.ConflictPolicy,
            overwriteTypeParameters = input.OverwriteTypeParameters, outcome, nativeLoadReturnedTrue = loaded,
            types = family.GetFamilySymbolIds().Select(id => new { id = id.Value, name = (doc.GetElement(id) as FamilySymbol)?.Name ?? $"<unavailable:{id.Value}>" }).OrderBy(t => t.id).ToArray(),
            note = "Native family/type evidence; no instances placed and no model saved." };
}

