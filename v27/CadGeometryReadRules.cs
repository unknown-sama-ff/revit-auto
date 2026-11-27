using System.Text.Json;

namespace RevitAutoV27;

internal readonly record struct CadCropBoxMm(double MinXMm, double MinYMm, double MaxXMm, double MaxYMm);

internal sealed record CadGeometryReadInput(
    string DocumentIdentity,
    long ExpectedRevision,
    long CadInstanceId,
    string[]? Layers,
    CadCropBoxMm? CropBounds,
    long? CropViewId,
    bool IncludeLines,
    bool IncludePolylines,
    bool IncludeArcs,
    int MaxPrimitives,
    int Offset,
    int Limit,
    string? OutputJsonlPath);

// Pure validation and 2D crop rules for reading linked/imported CAD ImportInstance geometry.
// Zero Revit API dependencies so CoreTests verifies all edge cases offline.
internal static class CadGeometryReadRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const int MaxLayerFilters = 200;
    public const int MaxPrimitivesCap = 100000;
    public const int MaxPageLimit = 2000;
    public const int MaxOffset = 100000;

    private static readonly string[] AllowedFields =
    [
        "documentIdentity", "expectedRevision", "cadInstanceId",
        "layers", "cropBounds", "cropViewId",
        "includeLines", "includePolylines", "includeArcs",
        "maxPrimitives", "offset", "limit", "outputJsonlPath"
    ];

    internal static BridgeException Invalid(string message) => new("invalid_cad_geometry_request", message);

    public static CadGeometryReadInput Parse(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
            throw Invalid("CAD geometry request must be a JSON object.");

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var prop in request.EnumerateObject())
        {
            if (!AllowedFields.Contains(prop.Name, StringComparer.Ordinal) || !seen.Add(prop.Name))
                throw Invalid($"Unsupported or duplicate CAD geometry field '{prop.Name}'.");
        }

        var identity = RequiredString(request, "documentIdentity", 200);
        var revision = RequiredNonNegativeLong(request, "expectedRevision");
        var cadInstanceId = RequiredPositiveLong(request, "cadInstanceId");
        var layers = OptionalLayers(request);
        var cropBounds = OptionalCropBounds(request);
        var cropViewId = OptionalPositiveLong(request, "cropViewId");
        if (cropBounds is not null && cropViewId is not null)
            throw Invalid("Specify either cropBounds or cropViewId, not both.");

        var includeLines = OptionalBool(request, "includeLines", true);
        var includePolylines = OptionalBool(request, "includePolylines", true);
        var includeArcs = OptionalBool(request, "includeArcs", true);
        if (!includeLines && !includePolylines && !includeArcs)
            throw Invalid("At least one of includeLines, includePolylines, or includeArcs must be true.");

        var maxPrimitives = OptionalInt(request, "maxPrimitives", 20000, 1, MaxPrimitivesCap);
        var offset = OptionalInt(request, "offset", 0, 0, MaxOffset);
        var limit = OptionalInt(request, "limit", 500, 1, MaxPageLimit);
        var outputJsonlPath = OptionalOutputJsonlPath(request);

        return new(identity, revision, cadInstanceId, layers, cropBounds, cropViewId,
            includeLines, includePolylines, includeArcs, maxPrimitives, offset, limit, outputJsonlPath);
    }

    // Exact 2D segment-vs-AABB intersection via Liang-Barsky clipping.
    public static bool SegmentIntersectsCrop(
        double x1, double y1, double x2, double y2,
        CadCropBoxMm box)
    {
        if (!double.IsFinite(x1) || !double.IsFinite(y1) || !double.IsFinite(x2) || !double.IsFinite(y2))
            return false;
        var minSegX = Math.Min(x1, x2);
        var maxSegX = Math.Max(x1, x2);
        var minSegY = Math.Min(y1, y2);
        var maxSegY = Math.Max(y1, y2);
        if (maxSegX < box.MinXMm || minSegX > box.MaxXMm || maxSegY < box.MinYMm || minSegY > box.MaxYMm)
            return false;

        double dx = x2 - x1, dy = y2 - y1;
        double t0 = 0.0, t1 = 1.0;
        double[] p = [-dx, dx, -dy, dy];
        double[] q = [x1 - box.MinXMm, box.MaxXMm - x1, y1 - box.MinYMm, box.MaxYMm - y1];
        for (int i = 0; i < 4; i++)
        {
            if (Math.Abs(p[i]) < 1e-12)
            {
                if (q[i] < 0) return false;
            }
            else
            {
                var t = q[i] / p[i];
                if (p[i] < 0)
                {
                    if (t > t1) return false;
                    if (t > t0) t0 = t;
                }
                else
                {
                    if (t < t0) return false;
                    if (t < t1) t1 = t;
                }
            }
        }
        return t0 <= t1;
    }

    public static bool BoxIntersectsCrop(double minX, double minY, double maxX, double maxY, CadCropBoxMm crop)
    {
        if (!double.IsFinite(minX) || !double.IsFinite(minY) || !double.IsFinite(maxX) || !double.IsFinite(maxY))
            return false;
        return maxX >= crop.MinXMm && minX <= crop.MaxXMm && maxY >= crop.MinYMm && minY <= crop.MaxYMm;
    }

    private static string RequiredString(JsonElement obj, string field, int maxLen)
    {
        if (!obj.TryGetProperty(field, out var el) || el.ValueKind != JsonValueKind.String)
            throw Invalid($"{field} must be an explicit nonblank string.");
        var text = el.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > maxLen || text.Trim() != text || text.Any(char.IsControl))
            throw Invalid($"{field} must be a trimmed nonblank string up to {maxLen} characters.");
        return text;
    }

    private static long RequiredNonNegativeLong(JsonElement obj, string field)
    {
        if (!obj.TryGetProperty(field, out var el) || el.ValueKind != JsonValueKind.Number ||
            !el.TryGetInt64(out var val) || val < 0 || val > MaxSafeInteger)
            throw Invalid($"{field} must be a nonnegative safe integer.");
        return val;
    }

    private static long RequiredPositiveLong(JsonElement obj, string field)
    {
        if (!obj.TryGetProperty(field, out var el) || el.ValueKind != JsonValueKind.Number ||
            !el.TryGetInt64(out var val) || val <= 0 || val > MaxSafeInteger)
            throw Invalid($"{field} must be a positive safe native element ID.");
        return val;
    }

    private static long? OptionalPositiveLong(JsonElement obj, string field)
    {
        if (!obj.TryGetProperty(field, out var el)) return null;
        if (el.ValueKind != JsonValueKind.Number || !el.TryGetInt64(out var val) || val <= 0 || val > MaxSafeInteger)
            throw Invalid($"{field} must be a positive safe native element ID.");
        return val;
    }

    private static string[]? OptionalLayers(JsonElement obj)
    {
        if (!obj.TryGetProperty("layers", out var el)) return null;
        if (el.ValueKind != JsonValueKind.Array)
            throw Invalid("layers must be an array of layer names.");
        var list = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in el.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
                throw Invalid("Each layer name must be a nonblank string.");
            var text = item.GetString();
            if (string.IsNullOrWhiteSpace(text) || text.Length > 256 || text.Any(char.IsControl))
                throw Invalid("Each layer name must be a nonblank string up to 256 characters.");
            if (seen.Add(text)) list.Add(text);
            if (list.Count > MaxLayerFilters)
                throw Invalid($"layers filter supports at most {MaxLayerFilters} layer names.");
        }
        return list.Count == 0 ? null : list.ToArray();
    }

    private static CadCropBoxMm? OptionalCropBounds(JsonElement obj)
    {
        if (!obj.TryGetProperty("cropBounds", out var el)) return null;
        if (el.ValueKind != JsonValueKind.Object)
            throw Invalid("cropBounds must be an object with min and max XY points.");
        var names = el.EnumerateObject().Select(p => p.Name).ToArray();
        if (names.Length != 2 || !names.Contains("min", StringComparer.Ordinal) || !names.Contains("max", StringComparer.Ordinal))
            throw Invalid("cropBounds accepts only min and max.");
        var (x0, y0) = ParseXY(el.GetProperty("min"), "cropBounds.min");
        var (x1, y1) = ParseXY(el.GetProperty("max"), "cropBounds.max");
        if (x1 - x0 < 1 || y1 - y0 < 1)
            throw Invalid("cropBounds must be ordered (max > min) and at least 1 mm wide and high.");
        return new(x0, y0, x1, y1);
    }

    private static (double X, double Y) ParseXY(JsonElement el, string label)
    {
        if (el.ValueKind != JsonValueKind.Object)
            throw Invalid($"{label} must be an object with xMm and yMm.");
        var names = el.EnumerateObject().Select(p => p.Name).ToArray();
        if (names.Length != 2 || !names.Contains("xMm", StringComparer.Ordinal) || !names.Contains("yMm", StringComparer.Ordinal))
            throw Invalid($"{label} accepts only xMm and yMm.");
        var x = FiniteNumber(el.GetProperty("xMm"), $"{label}.xMm");
        var y = FiniteNumber(el.GetProperty("yMm"), $"{label}.yMm");
        return (x, y);
    }

    private static double FiniteNumber(JsonElement el, string field)
    {
        if (el.ValueKind != JsonValueKind.Number || !el.TryGetDouble(out var v) || !double.IsFinite(v) || Math.Abs(v) > 1e8)
            throw Invalid($"{field} must be a bounded finite number in millimeters.");
        return v;
    }

    private static bool OptionalBool(JsonElement obj, string field, bool fallback)
    {
        if (!obj.TryGetProperty(field, out var el)) return fallback;
        return el.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw Invalid($"{field} must be a boolean.")
        };
    }

    private static int OptionalInt(JsonElement obj, string field, int fallback, int min, int max)
    {
        if (!obj.TryGetProperty(field, out var el)) return fallback;
        if (el.ValueKind != JsonValueKind.Number || !el.TryGetInt32(out var v) || v < min || v > max)
            throw Invalid($"{field} must be an integer between {min} and {max}.");
        return v;
    }

    private static string? OptionalOutputJsonlPath(JsonElement obj)
    {
        if (!obj.TryGetProperty("outputJsonlPath", out var el)) return null;
        if (el.ValueKind != JsonValueKind.String)
            throw Invalid("outputJsonlPath must be a local .jsonl file path string.");
        var raw = el.GetString()?.Trim();
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 1024 || raw.Any(char.IsControl))
            throw Invalid("outputJsonlPath must be a nonblank local file path up to 1024 characters.");
        if (raw.StartsWith(@"\\", StringComparison.Ordinal) || raw.StartsWith("//", StringComparison.Ordinal) ||
            raw.StartsWith("http:", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("https:", StringComparison.OrdinalIgnoreCase))
            throw Invalid("outputJsonlPath must be a local filesystem path, not a network share or URL.");
        if (!Path.IsPathRooted(raw) || !raw.EndsWith(".jsonl", StringComparison.OrdinalIgnoreCase))
            throw Invalid("outputJsonlPath must be an absolute local path ending with .jsonl.");
        var segments = raw.Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(s => s == ".."))
            throw Invalid("outputJsonlPath cannot contain parent traversal segments (..).");
        return raw;
    }
}
