using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal sealed record ElementDependencyInput(string DocumentIdentity, long ExpectedRevision, long[] ElementIds);
internal sealed record ElementDependencySetEvidence(
    bool Supported, bool Complete, long[] Ids,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? Count,
    bool Truncated = false, string? Reason = null)
{
    public static ElementDependencySetEvidence Unknown(string reason) => new(false, false, [], null, false, reason);
}
internal sealed record ElementFamilySymbolsEvidence(
    bool Applicable, bool Supported, bool Complete, long[] Ids,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? Count,
    bool Truncated = false, string? Reason = null)
{
    public static ElementFamilySymbolsEvidence From(bool applicable, ElementDependencySetEvidence evidence)
        => new(applicable, evidence.Supported, evidence.Complete, evidence.Ids, evidence.Count, evidence.Truncated, evidence.Reason);
}
internal sealed record ElementDependencySummary(
    long Id, string UniqueId, string Name, string ClassName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Category,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] long? CategoryId,
    long TypeId, long OwnerViewId, long LevelId);
internal sealed record ElementDependencyItem(
    long ElementId, bool Exists,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] ElementDependencySummary? Summary,
    ElementDependencySetEvidence Dependencies, ElementFamilySymbolsEvidence FamilySymbols);

// This query exposes raw native logical dependency IDs. A complete empty API
// result is evidence of that API's scope, never a guarantee of all side effects.
internal static class ElementDependencyRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const int MaxRootElements = 20, MaxIdsPerSet = 4096, MaxTotalIds = 16384;
    public const int MaxResponseBytes = 2 * 1024 * 1024;

    public static ElementDependencyInput Parse(JsonElement request)
    {
        BridgeException Invalid(string message) => new("invalid_element_dependencies_request", message);
        if (request.ValueKind != JsonValueKind.Object) throw Invalid("Element dependencies require an object.");
        var allowed = new HashSet<string>(["documentIdentity", "expectedRevision", "elementIds"], StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in request.EnumerateObject())
            if (!allowed.Contains(field.Name) || !seen.Add(field.Name))
                throw Invalid($"Unknown or duplicate element-dependencies field '{field.Name}'.");
        var identity = JsonDefaults.String(request, "documentIdentity");
        if (string.IsNullOrWhiteSpace(identity) || identity.Length > 200)
            throw Invalid("documentIdentity must be the current nonempty document session identity, at most 200 characters.");
        if (!request.TryGetProperty("expectedRevision", out var revisionValue) ||
            revisionValue.ValueKind != JsonValueKind.Number || !revisionValue.TryGetInt64(out var revision) ||
            revision < 0 || revision > MaxSafeInteger)
            throw Invalid("expectedRevision must be an explicit nonnegative safe integer.");
        if (!request.TryGetProperty("elementIds", out var rawIds) || rawIds.ValueKind != JsonValueKind.Array ||
            rawIds.GetArrayLength() < 1 || rawIds.GetArrayLength() > MaxRootElements)
            throw Invalid("elementIds must contain 1 to 20 unique positive safe native IDs.");
        var ids = rawIds.EnumerateArray().Select(value =>
            value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var id) && id > 0 && id <= MaxSafeInteger
                ? id : throw Invalid("elementIds must contain only positive safe integers.")).ToArray();
        if (ids.Distinct().Count() != ids.Length) throw Invalid("Repeated root element IDs are not allowed.");
        return new(identity, revision, ids);
    }

    public static ElementDependencySetEvidence ReadIds(Func<IEnumerable<long>?> read, Action check, ref int totalIds)
    {
        check();
        IEnumerator<long> iterator;
        try
        {
            var nativeIds = read() ?? throw new BridgeException("element_dependencies_invalid_native_evidence", "The native relationship API returned no collection; empty membership was not inferred.");
            iterator = nativeIds.GetEnumerator();
        }
        catch (NotSupportedException)
        {
            check();
            return ElementDependencySetEvidence.Unknown("native_api_not_supported");
        }
        using (iterator)
        {
            var ids = new HashSet<long>();
            while (true)
            {
                check();
                long id;
                try
                {
                    if (!iterator.MoveNext()) break;
                    id = iterator.Current;
                }
                catch (NotSupportedException)
                {
                    // Only the relationship API/enumerator can establish an
                    // unsupported capability. Document-pin failures propagate.
                    check();
                    return ElementDependencySetEvidence.Unknown("native_api_not_supported");
                }
                if (id <= 0 || id > MaxSafeInteger)
                    throw new BridgeException("element_dependencies_invalid_native_evidence", "The native relationship API returned an invalid or unsafe element ID.");
                ids.Add(id);
                if (ids.Count > MaxIdsPerSet || totalIds + ids.Count > MaxTotalIds)
                    throw new BridgeException("element_dependencies_limit_exceeded", "The complete native relationship evidence exceeds its ID budget. Narrow the explicit root IDs; evidence was not truncated.");
            }
            check();
            var ordered = ids.Order().ToArray();
            totalIds += ordered.Length;
            return new(true, true, ordered, ordered.Length);
        }
    }

    public static string RequireNativeText(string? text, string field, bool allowEmpty = false)
    {
        if (text is null || (!allowEmpty && string.IsNullOrEmpty(text)))
            throw new BridgeException("element_dependencies_invalid_native_evidence", $"The native summary field '{field}' is unavailable; no substitute value was inferred.");
        return text;
    }

    public static long RequireSignedSafeId(long id)
    {
        if (id < -MaxSafeInteger || id > MaxSafeInteger)
            throw new BridgeException("element_dependencies_invalid_native_evidence", "A native summary ID is outside the signed safe-integer range.");
        return id;
    }

    public static void RequireResponseBudget(string encodedEnvelope)
    {
        // Measure the full transport envelope and Windows newline, not merely
        // the result's character count. The snapshot is never truncated.
        if ((long)Encoding.UTF8.GetByteCount(encodedEnvelope) + 2 > MaxResponseBytes)
            throw new BridgeException("element_dependencies_response_too_large", "The complete native dependency response exceeds the 2 MiB wire budget. Narrow the explicit root IDs; no model change was requested.");
    }
}
