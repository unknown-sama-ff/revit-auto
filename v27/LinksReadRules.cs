using System.Text.Json;

namespace RevitAutoV27;

internal sealed record LinksListInput(
    string DocumentIdentity,
    long ExpectedRevision,
    bool IncludeRevitLinks,
    bool IncludeCad,
    bool IncludeUnloaded,
    bool IncludeInstances,
    bool IncludeCadLinks,
    bool IncludeCadImports,
    int Offset,
    int Limit);

internal sealed record LinkElementsInput(
    string DocumentIdentity,
    long ExpectedRevision,
    long LinkInstanceId,
    string? Category,
    int Offset,
    int Limit,
    bool IncludeBounds);

internal static class LinksReadRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const int MaxListLimit = 200;
    public const int MaxElementsLimit = 200;
    public const int MaxOffset = 100000;

    internal static BridgeException Invalid(string message) => new("invalid_links_request", message);

    public static LinksListInput ParseList(JsonElement request)
    {
        CheckObject(request, [
            "documentIdentity", "expectedRevision",
            "includeRevitLinks", "includeCad", "includeUnloaded", "includeInstances",
            "includeCadLinks", "includeCadImports", "offset", "limit"
        ]);
        var identity = Identity(request);
        var revision = Revision(request);
        var includeRevitLinks = OptionalBool(request, "includeRevitLinks", true);
        var includeCad = OptionalBool(request, "includeCad", true);
        var includeUnloaded = OptionalBool(request, "includeUnloaded", true);
        var includeInstances = OptionalBool(request, "includeInstances", true);
        var includeCadLinks = OptionalBool(request, "includeCadLinks", true);
        var includeCadImports = OptionalBool(request, "includeCadImports", true);
        var offset = OptionalInt(request, "offset", 0, 0, MaxOffset);
        var limit = OptionalInt(request, "limit", 100, 1, MaxListLimit);

        if (!includeRevitLinks && !includeCad)
            throw Invalid("At least one of includeRevitLinks or includeCad must be true.");
        if (includeCad && !includeCadLinks && !includeCadImports)
            throw Invalid("When includeCad is true, at least one of includeCadLinks or includeCadImports must be true.");

        return new(identity, revision, includeRevitLinks, includeCad, includeUnloaded, includeInstances,
            includeCadLinks, includeCadImports, offset, limit);
    }

    public static LinkElementsInput ParseElements(JsonElement request)
    {
        CheckObject(request, [
            "documentIdentity", "expectedRevision", "linkInstanceId", "category", "offset", "limit", "includeBounds"
        ]);
        var identity = Identity(request);
        var revision = Revision(request);
        var linkInstanceId = RequiredPositiveId(request, "linkInstanceId");
        var category = OptionalCategory(request, "category");
        var offset = OptionalInt(request, "offset", 0, 0, MaxOffset);
        var limit = OptionalInt(request, "limit", 50, 1, MaxElementsLimit);
        var includeBounds = OptionalBool(request, "includeBounds", false);
        return new(identity, revision, linkInstanceId, category, offset, limit, includeBounds);
    }

    public static (IReadOnlyList<T> Items, bool HasMore) Paginate<T>(IReadOnlyList<T> all, int offset, int limit)
    {
        if (offset < 0 || limit < 1) throw Invalid("Invalid pagination bounds.");
        if (offset >= all.Count) return ([], false);
        var count = Math.Min(limit, all.Count - offset);
        var items = new T[count];
        for (var i = 0; i < count; i++) items[i] = all[offset + i];
        return (items, offset + count < all.Count);
    }

    // Transform all 8 bounding-box corners into host-document millimeter coordinates so rotated
    // links preserve a conservative axis-aligned bounding box rather than transforming Min/Max alone.
    public static ElementBoundsGeometry? TransformBoundsMm(
        ElementBoundsPoint localMinMm,
        ElementBoundsPoint localMaxMm,
        Func<ElementBoundsPoint, ElementBoundsPoint> toHostMm)
        => ElementBoundsRules.FromCorners(localMinMm, localMaxMm, toHostMm);

    private static void CheckObject(JsonElement request, string[] allowed)
    {
        if (request.ValueKind != JsonValueKind.Object)
            throw Invalid("Links request must be a JSON object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var prop in request.EnumerateObject())
        {
            if (!allowed.Contains(prop.Name, StringComparer.Ordinal) || !seen.Add(prop.Name))
                throw Invalid($"Unsupported or duplicate links field '{prop.Name}'.");
        }
    }

    private static string Identity(JsonElement request)
    {
        if (!request.TryGetProperty("documentIdentity", out var value) || value.ValueKind != JsonValueKind.String)
            throw Invalid("documentIdentity must be an explicit nonblank string.");
        var text = value.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > 200 || text.Trim() != text || text.Any(char.IsControl))
            throw Invalid("documentIdentity must be an explicit nonblank string up to 200 characters.");
        return text;
    }

    private static long Revision(JsonElement request)
    {
        if (!request.TryGetProperty("expectedRevision", out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt64(out var revision) || revision < 0 || revision > MaxSafeInteger)
            throw Invalid("expectedRevision must be an explicit nonnegative safe integer.");
        return revision;
    }

    private static long RequiredPositiveId(JsonElement request, string field)
    {
        if (!request.TryGetProperty(field, out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt64(out var id) || id <= 0 || id > MaxSafeInteger)
            throw Invalid($"{field} must be a positive safe native element ID.");
        return id;
    }

    private static bool OptionalBool(JsonElement request, string field, bool fallback)
    {
        if (!request.TryGetProperty(field, out var value)) return fallback;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw Invalid($"{field} must be a boolean.")
        };
    }

    private static int OptionalInt(JsonElement request, string field, int fallback, int min, int max)
    {
        if (!request.TryGetProperty(field, out var value)) return fallback;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number) || number < min || number > max)
            throw Invalid($"{field} must be an integer between {min} and {max}.");
        return number;
    }

    private static string? OptionalCategory(JsonElement request, string field)
    {
        if (!request.TryGetProperty(field, out var value)) return null;
        if (value.ValueKind != JsonValueKind.String)
            throw Invalid($"{field} must be a nonblank category name.");
        var text = value.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > 200 || text.Trim() != text || text.Any(char.IsControl))
            throw Invalid($"{field} must be a trimmed nonblank string up to 200 characters without control characters.");
        return text;
    }
}
