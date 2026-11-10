using System.Text;
using System.Text.Json;

namespace RevitAutoV27;

internal sealed record DocumentVersionDiffInput(string DocumentIdentity, long ExpectedRevision, Guid BaseVersionGuid);
internal sealed record DocumentVersionIdSet(bool Available, long[] Ids);

internal static class DocumentVersionDiffRules
{
    private const long MaxSafeInteger = 9007199254740991;
    public const int MaxIdsPerSet = 20000, MaxResponseBytes = 2 * 1024 * 1024;

    public static DocumentVersionDiffInput Parse(JsonElement request)
    {
        BridgeException Invalid(string message) => new("invalid_document_version_diff_request", message);
        if (request.ValueKind != JsonValueKind.Object) throw Invalid("Document version diff requires an object.");
        var allowed = new HashSet<string>(["documentIdentity", "expectedRevision", "baseVersionGuid"], StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in request.EnumerateObject())
            if (!allowed.Contains(property.Name) || !seen.Add(property.Name)) throw Invalid($"Unknown or duplicate document version diff field '{property.Name}'.");
        var identity = JsonDefaults.String(request, "documentIdentity");
        if (string.IsNullOrWhiteSpace(identity) || identity.Length > 200) throw Invalid("documentIdentity must be explicit and nonblank.");
        if (!request.TryGetProperty("expectedRevision", out var revisionValue) || revisionValue.ValueKind != JsonValueKind.Number ||
            !revisionValue.TryGetInt64(out var revision) || revision < 0 || revision > MaxSafeInteger)
            throw Invalid("expectedRevision must be an explicit nonnegative safe integer.");
        if (!request.TryGetProperty("baseVersionGuid", out var guidValue) || guidValue.ValueKind != JsonValueKind.String ||
            !Guid.TryParseExact(guidValue.GetString(), "D", out var baseVersionGuid) || baseVersionGuid == Guid.Empty)
            throw Invalid("baseVersionGuid must be an explicit nonempty GUID in D format.");
        return new(identity, revision, baseVersionGuid);
    }

    public static long[] NormalizeIds(IEnumerable<long>? ids, int limit, string kind)
    {
        if (ids is null) throw new BridgeException("document_version_diff_invalid_native_evidence", $"Native {kind} IDs are unavailable; an empty list was not inferred.");
        var values = new SortedSet<long>();
        foreach (var id in ids)
        {
            if (id <= 0 || id > MaxSafeInteger) throw new BridgeException("document_version_diff_invalid_native_evidence", $"Native {kind} ID is outside the positive safe-integer range.");
            values.Add(id);
            if (values.Count > limit) throw new BridgeException("document_version_diff_limit_exceeded", $"Complete {kind} ID set exceeds the bounded response limit; narrow the version range.");
        }
        return values.ToArray();
    }

    public static DocumentVersionIdSet DeletedIds(bool available, IEnumerable<long>? ids)
        => available ? new(true, NormalizeIds(ids, MaxIdsPerSet, "deleted")) : new(false, []);

    public static void RequireResponseBudget(string encodedEnvelope)
    {
        if ((long)Encoding.UTF8.GetByteCount(encodedEnvelope) + 2 > MaxResponseBytes)
            throw new BridgeException("document_version_diff_response_too_large", "The complete document version difference exceeds the 2 MiB response budget; evidence was not truncated.");
    }
}
