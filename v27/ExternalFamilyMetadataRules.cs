using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RevitAutoV27;

internal sealed record ExternalFamilyAsset(string AssetKey, string RelativePath, string Sha256, string Kind);
internal sealed record ExternalFamilyMetadataInput(string Mode, string RequestId, string[] AssetKeys,
    string? DocumentIdentity, long? ExpectedRevision, string? ExpectedCatalogSha256);
internal sealed record TemplateFileReferenceSummary(int StoredCount, int InspectedCount, int UnknownKindCount, string[] Kinds);

// Pure, bounded contract; deliberately independent of Revit and the loading catalog.
internal static class ExternalFamilyMetadataRules
{
    internal const int MaxAssets = 4, MaxTypesPerFile = 2000, MaxTotalTypes = 5000, MaxStringLength = 300;
    internal const int MaxCatalogBytes = 2 * 1024 * 1024, MaxResultBytes = 1024 * 1024;
    internal const int MaxTemplateReferenceInspections = 256;
    // Exact ExternalFileReferenceType names in the installed 27.3 SDK; None is uninitialized.
    private static readonly string[] TemplateReferenceKinds = ["AssemblyCodeTable", "CADLink", "DWFMarkup", "Decal", "KeynoteTable", "Material", "RevitLink", "SystemsAnalysisReport"];
    // Built-in Revit lookup table references explicitly authorized for read-only RTE metadata inspection.
    internal static readonly string[] BuiltInTemplateTableKinds = ["AssemblyCodeTable", "KeynoteTable"];
    internal const long MaxFileBytes = 100L * 1024 * 1024, MaxTotalFileBytes = 200L * 1024 * 1024;
    internal const string TemplateSymbolScope = "legacy-category-name-contains-v1";
    private static readonly string[] TemplateCategoryWords = ["门", "窗", "照明", "灯具", "电气", "图框", "结构柱"];
    private const long SafeInteger = 9007199254740991;
    private static BridgeException Invalid(string message) => new("invalid_external_family_metadata_request", message);
    private static void Fields(JsonElement value, params string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("An object is required.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in value.EnumerateObject())
            if (!seen.Add(field.Name) || !allowed.Contains(field.Name, StringComparer.Ordinal))
                throw Invalid("Unknown or repeated field in external family metadata input.");
    }
    private static string Text(JsonElement value, string name, int max)
    {
        if (!value.TryGetProperty(name, out var item) || item.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(item.GetString()) || item.GetString()!.Length > max) throw Invalid("Missing or invalid " + name + ".");
        return item.GetString()!;
    }
    internal static void Key(string value)
    {
        if (!Regex.IsMatch(value, "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$", RegexOptions.CultureInvariant))
            throw Invalid("assetKey must be an exact registered key, not a path.");
    }
    internal static void Hash(string value)
    {
        if (!Regex.IsMatch(value, "^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant)) throw Invalid("A SHA-256 must have 64 hexadecimal characters.");
    }
    internal static ExternalFamilyMetadataInput Parse(JsonElement value)
    {
        Fields(value, "mode", "requestId", "assetKeys", "documentIdentity", "expectedRevision", "expectedCatalogSha256");
        var mode = value.TryGetProperty("mode", out _) ? Text(value, "mode", 10) : "run";
        if (mode is not ("run" or "status")) throw Invalid("mode must be run or status.");
        var id = Text(value, "requestId", 36);
        if (!Guid.TryParseExact(id, "D", out var guid)) throw Invalid("requestId must be a UUID in D format.");
        if (mode == "status")
        {
            Fields(value, "mode", "requestId");
            return new(mode, guid.ToString("D"), [], null, null, null);
        }
        var identity = Text(value, "documentIdentity", 200);
        if (!value.TryGetProperty("expectedRevision", out var revision) || revision.ValueKind != JsonValueKind.Number || !revision.TryGetInt64(out var r) || r < 0 || r > SafeInteger)
            throw Invalid("expectedRevision must be a nonnegative safe integer.");
        if (!value.TryGetProperty("assetKeys", out var keys) || keys.ValueKind != JsonValueKind.Array || keys.GetArrayLength() is < 1 or > MaxAssets)
            throw Invalid("Specify 1 to 4 unique exact assetKeys.");
        var parsed = new List<string>();
        foreach (var key in keys.EnumerateArray())
        {
            if (key.ValueKind != JsonValueKind.String) throw Invalid("assetKeys must be strings.");
            var name = key.GetString()!; Key(name); parsed.Add(name);
        }
        if (parsed.Distinct(StringComparer.Ordinal).Count() != parsed.Count) throw Invalid("Duplicate assetKeys are not allowed.");
        var hash = value.TryGetProperty("expectedCatalogSha256", out _) ? Text(value, "expectedCatalogSha256", 64) : null;
        if (hash is not null) Hash(hash);
        return new(mode, guid.ToString("D"), parsed.ToArray(), identity, r, hash?.ToLowerInvariant());
    }
    internal static List<ExternalFamilyAsset> Catalog(JsonElement value)
    {
        Fields(value, "schemaVersion", "assets");
        if (!value.TryGetProperty("schemaVersion", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var v) || v != 1 ||
            !value.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array || assets.GetArrayLength() > 1000)
            throw Invalid("Audit catalog requires schemaVersion=1 and at most 1000 assets.");
        var result = new List<ExternalFamilyAsset>();
        foreach (var item in assets.EnumerateArray())
        {
            Fields(item, "assetKey", "relativePath", "sha256", "kind");
            var kind = Text(item, "kind", 3);
            if (kind is not ("rfa" or "rte")) throw new BridgeException("external_family_kind_unsupported", "Only registered RFA and RTE metadata is supported.");
            var key = Text(item, "assetKey", 80); Key(key);
            var relative = Text(item, "relativePath", 500); FamilyLibraryRules.Relative(relative, "." + kind);
            var hash = Text(item, "sha256", 64); Hash(hash);
            result.Add(new(key, relative, hash.ToLowerInvariant(), kind));
        }
        if (result.Select(a => a.AssetKey).Distinct(StringComparer.Ordinal).Count() != result.Count)
            throw Invalid("Duplicate audit catalog keys are not allowed.");
        return result;
    }
    internal static long AddFileBytes(long total, long length)
    {
        if (length <= 0 || length > MaxFileBytes || total < 0 || total > MaxTotalFileBytes - length)
            throw new BridgeException("external_family_file_budget", "External asset file or total byte budget exceeded.");
        return total + length;
    }
    internal static void RequireRowCapacity(int fileRows, int totalRows)
    {
        if (fileRows < 0 || totalRows < 0 || fileRows >= MaxTypesPerFile || totalRows >= MaxTotalTypes - fileRows)
            throw new BridgeException("external_family_type_budget", "Native type or template symbol enumeration exceeds its finite evidence budget.");
    }
    internal static bool TemplateCategoryMatches(string? name) => name is not null && TemplateCategoryWords.Any(word => name.Contains(word, StringComparison.Ordinal));
    internal static string SourceElementId(long value)
    {
        if (value <= 0) throw new BridgeException("external_template_id_unknown", "Template symbol id is not a positive native Int64.");
        return value.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    internal static long CategoryId(long value)
    {
        if (value >= 0 || value < -SafeInteger) throw new BridgeException("external_family_category_unknown", "Native category id is not a safe built-in category id.");
        return value;
    }
    internal static bool IsOnlyAllowedBuiltInTables(TemplateFileReferenceSummary? summary, int storedReferenceCount) =>
        summary is not null &&
        storedReferenceCount > 0 &&
        summary.StoredCount == storedReferenceCount &&
        summary.InspectedCount == storedReferenceCount &&
        summary.UnknownKindCount == 0 &&
        summary.Kinds is not null &&
        summary.Kinds.Length > 0 &&
        summary.Kinds.All(kind => BuiltInTemplateTableKinds.Contains(kind, StringComparer.Ordinal));

    // A null transmission record is absence of stored file-reference data, not proof of isolation.
    // Only fully inspected built-in lookup tables (AssemblyCodeTable, KeynoteTable) are permitted;
    // any external link, unknown kind, or omitted reference still fails closed.
    internal static void RequireTemplateFileReferencePreflight(bool readSucceeded, int? storedReferenceCount,
        TemplateFileReferenceSummary? summary = null)
    {
        if (!readSucceeded || storedReferenceCount is < 0)
            throw new BridgeException("external_template_reference_preflight_failed", "Stored external file references could not be read; template left closed.");
        if (storedReferenceCount is > 0 && !IsOnlyAllowedBuiltInTables(summary, storedReferenceCount.Value))
            throw new BridgeException("external_template_references_present", "Template has stored external file references; template left closed.",
                summary?.StoredCount == storedReferenceCount ? summary : null);
    }
    internal static TemplateFileReferenceSummary InspectTemplateReferences<T>(ICollection<T> ids, Func<T, string?> readKind, Action check)
    {
        int count = ids.Count, inspected = 0, unknown = 0;
        if (count < 0) throw new InvalidOperationException("Stored reference count is invalid.");
        var kinds = new HashSet<string>(StringComparer.Ordinal);
        using var iterator = ids.GetEnumerator();
        while (inspected < Math.Min(count, MaxTemplateReferenceInspections))
        {
            check();
            if (!iterator.MoveNext()) throw new InvalidOperationException("Stored reference enumeration ended before its reported count.");
            var kind = readKind(iterator.Current);
            inspected++;
            if (kind is not null && TemplateReferenceKinds.Contains(kind, StringComparer.Ordinal)) kinds.Add(kind);
            else unknown++;
        }
        check();
        return new(count, inspected, unknown, kinds.Order(StringComparer.Ordinal).ToArray());
    }
    internal static string AuditErrorMessage(BridgeException error)
    {
        // Never expose arbitrary exception messages/Details. Only this typed, revalidated
        // count/enum summary is allowed through the existing error.message field.
        if (error.Code == "external_template_references_present" && error.Details is TemplateFileReferenceSummary s &&
            s.StoredCount > 0 && s.InspectedCount >= 0 && s.InspectedCount <= Math.Min(s.StoredCount, MaxTemplateReferenceInspections) &&
            s.UnknownKindCount >= 0 && s.UnknownKindCount <= s.InspectedCount && s.Kinds is not null &&
            s.Kinds.Length <= Math.Min(TemplateReferenceKinds.Length, s.InspectedCount - s.UnknownKindCount) &&
            s.Kinds.Distinct(StringComparer.Ordinal).Count() == s.Kinds.Length &&
            s.Kinds.All(kind => TemplateReferenceKinds.Contains(kind, StringComparer.Ordinal)))
        {
            return FormattableString.Invariant($"Template closed; refs={s.StoredCount}; checked={s.InspectedCount}; omitted={s.StoredCount - s.InspectedCount}; unknown={s.UnknownKindCount}; kinds={string.Join(',', s.Kinds.Order(StringComparer.Ordinal))}");
        }
        return "External asset audit stopped: " + error.Code;
    }
    internal static void NativeString(string? value)
    {
        // Empty is known data (notably OwnerFamily.Name); null is unknown.
        if (value is null || value.Length > MaxStringLength)
            throw new BridgeException("external_family_metadata_unknown", "Native string is unavailable or exceeds the evidence budget.");
    }
    internal static bool MayClose(bool newlyOwned, bool valid, bool active, bool linked) => newlyOwned && valid && !active && !linked;
    internal static void RequireCleanupClear(int unreleasedDocuments, IEnumerable<bool> retainedCleanupFailures)
    {
        if (unreleasedDocuments != 0 || retainedCleanupFailures.Any(failed => failed))
            throw new BridgeException("external_family_cleanup_pending", "A prior external asset audit has unresolved cleanup; no additional asset opened.");
    }
    internal static bool MayCaptureUnknown(Exception exception, Func<Exception, bool> isNativeCancellation) =>
        exception is not OperationCanceledException && !isNativeCancellation(exception) &&
        exception is not BridgeException { Code: "external_family_active_state_changed" or "external_family_time_budget" };
    internal static void ObserveCompletion(CancellationToken cancellation, TimeSpan elapsed)
    {
        cancellation.ThrowIfCancellationRequested();
        if (elapsed > TimeSpan.FromSeconds(45))
            throw new BridgeException("external_family_time_budget", "Cooperative audit time budget exceeded after native call returned.");
    }
    internal static string Fingerprint(ExternalFamilyMetadataInput input) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(input))).ToLowerInvariant();
}
