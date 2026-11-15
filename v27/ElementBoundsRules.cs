using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal sealed record ElementBoundsInput(bool IncludeBounds, long? BoundsViewId = null, long[]? ElementIds = null);
internal sealed record ElementBoundsPoint(double XMm, double YMm, double ZMm)
{
    [JsonIgnore]
    public bool Finite => double.IsFinite(XMm) && double.IsFinite(YMm) && double.IsFinite(ZMm);
}
internal sealed record ElementBoundsGeometry(ElementBoundsPoint Min, ElementBoundsPoint Max,
    ElementBoundsPoint Center, ElementBoundsPoint Size);

internal static class ElementBoundsRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const int MaxElements = 20;
    private static BridgeException Invalid(string message) => new("invalid_element_bounds_request", message);

    // Ordinary inspect keeps its existing ID contract and does not read native bounds.
    public static ElementBoundsInput Parse(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object) throw Invalid("Inspect requires an object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in request.EnumerateObject())
            if (!seen.Add(field.Name) && field.Name is "includeBounds" or "boundsViewId" or "documentIdentity" or "expectedRevision" or "elementIds")
                throw Invalid($"Duplicate inspect field '{field.Name}'.");
        var include = false;
        if (request.TryGetProperty("includeBounds", out var flag))
        {
            if (flag.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Invalid("includeBounds must be boolean.");
            include = flag.GetBoolean();
        }
        if (!include)
        {
            if (request.TryGetProperty("boundsViewId", out _)) throw Invalid("boundsViewId requires includeBounds=true.");
            return new(false);
        }
        if (!request.TryGetProperty("documentIdentity", out var identity) || identity.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(identity.GetString()) || identity.GetString()!.Length > 200)
            throw Invalid("Bounds require explicit current documentIdentity and expectedRevision.");
        if (!request.TryGetProperty("expectedRevision", out var revision) || revision.ValueKind != JsonValueKind.Number ||
            !revision.TryGetInt64(out var value) || value < 0 || value > MaxSafeInteger)
            throw Invalid("Bounds require explicit nonnegative safe expectedRevision.");
        if (!request.TryGetProperty("elementIds", out var ids) || ids.ValueKind != JsonValueKind.Array ||
            ids.GetArrayLength() < 1 || ids.GetArrayLength() > MaxElements)
            throw Invalid("Bounds require 1..20 distinct positive safe elementIds.");
        var parsed = ids.EnumerateArray().Select(id => PositiveId(id, "elementIds")).ToArray();
        if (parsed.Distinct().Count() != parsed.Length) throw Invalid("Bounds require distinct elementIds.");
        long? view = request.TryGetProperty("boundsViewId", out var viewId) ? PositiveId(viewId, "boundsViewId") : null;
        return new(true, view, parsed);
    }

    private static long PositiveId(JsonElement value, string field)
        => value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var id) && id > 0 && id <= MaxSafeInteger
            ? id : throw Invalid($"{field} requires positive safe native IDs.");

    // The delegate must transform a local corner into project millimeters. Adapted
    // selectively from CollisionCheckService.Box; never transform Min/Max alone.
    public static ElementBoundsGeometry? FromCorners(ElementBoundsPoint min, ElementBoundsPoint max,
        Func<ElementBoundsPoint, ElementBoundsPoint> toProjectMm)
    {
        if (!min.Finite || !max.Finite || min.XMm > max.XMm || min.YMm > max.YMm || min.ZMm > max.ZMm) return null;
        var corners = new List<ElementBoundsPoint>(8);
        foreach (var x in new[] { min.XMm, max.XMm })
            foreach (var y in new[] { min.YMm, max.YMm })
                foreach (var z in new[] { min.ZMm, max.ZMm })
                {
                    var point = toProjectMm(new(x, y, z));
                    if (!point.Finite) return null;
                    corners.Add(point);
                }
        var low = new ElementBoundsPoint(corners.Min(p => p.XMm), corners.Min(p => p.YMm), corners.Min(p => p.ZMm));
        var high = new ElementBoundsPoint(corners.Max(p => p.XMm), corners.Max(p => p.YMm), corners.Max(p => p.ZMm));
        var center = new ElementBoundsPoint(low.XMm / 2 + high.XMm / 2, low.YMm / 2 + high.YMm / 2, low.ZMm / 2 + high.ZMm / 2);
        var size = new ElementBoundsPoint(high.XMm - low.XMm, high.YMm - low.YMm, high.ZMm - low.ZMm);
        return center.Finite && size.Finite ? new(low, high, center, size) : null;
    }

    public static ElementBoundsPoint? Offset(ElementBoundsPoint center, ElementBoundsPoint insertion)
    {
        if (!center.Finite || !insertion.Finite) return null;
        var offset = new ElementBoundsPoint(center.XMm - insertion.XMm, center.YMm - insertion.YMm, center.ZMm - insertion.ZMm);
        return offset.Finite ? offset : null;
    }
}
