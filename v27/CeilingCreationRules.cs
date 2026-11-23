using System.Text.Json;

namespace RevitAutoV27;

internal readonly record struct CeilingPoint(double XMm, double YMm, double ZMm);
internal readonly record struct CeilingBoundaryEdge(CeilingPoint Start, CeilingPoint End);
internal sealed record CeilingCreationReadback(long ElementId, long TypeId, long LevelId, long SketchId,
    long SketchOwnerId, double HeightOffsetMm, IReadOnlyList<CeilingBoundaryEdge> Boundary);

// Pure input/readback rules; the service supplies actual native Sketch curves.
internal static class CeilingCreationRules
{
    public static void ValidatePlan(IReadOnlyList<JsonElement> operations)
    {
        var sources=new HashSet<long>();
        foreach(var op in operations.Where(op=>JsonDefaults.String(op,"operationType")=="create_ceiling"))
        {
            Validate(op);sources.Add(Id(op,"ceilingTypeId"));sources.Add(Id(op,"levelId"));
        }
        if(sources.Count==0)return;
        foreach(var op in operations)
        {
            var kind=JsonDefaults.String(op,"operationType");
            if(kind=="load_family"||kind is "set_parameter" or "delete_element"&&JsonDefaults.Int64(op,"elementId") is long id&&sources.Contains(id))
                throw Invalid("Ceiling source type/level changes and family loading require a separate reviewed plan.");
        }
    }
    internal const double ToleranceMm = 0.01;
    internal static BridgeException Invalid(string message) => new("invalid_ceiling_creation", message);
    public static void Validate(JsonElement op)
    {
        Shape(op, ["operationType", "id", "dependencies", "ceilingTypeId", "levelId", "boundary"]);
        if (JsonDefaults.String(op, "operationType") != "create_ceiling") throw Invalid("Specify operationType create_ceiling.");
        Id(op, "ceilingTypeId"); Id(op, "levelId");
        if (op.TryGetProperty("id", out var id)) MetadataId(id);
        if (op.TryGetProperty("dependencies", out var dependencies))
        {
            if (dependencies.ValueKind != JsonValueKind.Array || dependencies.GetArrayLength() > 1000) throw Invalid("dependencies must be a bounded array of explicit operation IDs.");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in dependencies.EnumerateArray())
            {
                var name = MetadataId(item);
                if (!seen.Add(name) || id.ValueKind == JsonValueKind.String && name == id.GetString()) throw Invalid("Dependencies must be distinct and cannot reference the operation itself.");
            }
        }
        ValidatePolygon(Boundary(op));
    }
    internal static long Id(JsonElement op, string field)
    {
        var value = JsonDefaults.Get(op, field);
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var id) || id <= 0 || id > 9007199254740991)
            throw Invalid($"{field} must be an existing positive safe native ID; deferred/new types and levels need a subsequent reviewed plan.");
        return id;
    }
    internal static CeilingPoint[] Boundary(JsonElement op)
    {
        var boundary = JsonDefaults.Get(op, "boundary");
        if (boundary.ValueKind != JsonValueKind.Array || boundary.GetArrayLength() is < 3 or > 128)
            throw Invalid("Ceiling boundary requires 3..128 full XYZ vertices in one loop, without a repeated closing point.");
        return boundary.EnumerateArray().Select(point =>
        {
            Shape(point, ["xMm", "yMm", "zMm"]);
            return new CeilingPoint(Number(point, "xMm"), Number(point, "yMm"), Number(point, "zMm"));
        }).ToArray();
    }
    internal static double HeightOffsetMm(double profileZMm, double levelProjectElevationMm)
    {
        var result = profileZMm - levelProjectElevationMm;
        if (!double.IsFinite(profileZMm) || !double.IsFinite(levelProjectElevationMm) || !double.IsFinite(result))
            throw Invalid("Absolute profile Z and native level ProjectElevation must be finite; no zero height offset is inferred.");
        return result;
    }
    internal static double SignedAreaMm2(IReadOnlyList<CeilingPoint> points)
    {
        if (points.Count < 3) return 0;
        // Translate before cross products to retain precision for large project coordinates.
        var origin = points[0]; double twice = 0;
        for (var i = 0; i < points.Count; i++)
        {
            var a = points[i]; var b = points[(i + 1) % points.Count];
            twice += (a.XMm - origin.XMm) * (b.YMm - origin.YMm) - (b.XMm - origin.XMm) * (a.YMm - origin.YMm);
        }
        return twice / 2;
    }
    internal static void ValidatePolygon(IReadOnlyList<CeilingPoint> points)
    {
        if (points is null || points.Count is < 3 or > 128 || points.Any(point => !Finite(point))) throw Invalid("A bounded finite 3..128 vertex ceiling polygon is required.");
        if (points.Any(point => Math.Abs(point.ZMm - points[0].ZMm) > ToleranceMm)) throw Invalid("Ceiling boundary must be horizontal within 0.01 mm; point Z is absolute, not level relative.");
        for (var i = 0; i < points.Count; i++)
        {
            var j = (i + 1) % points.Count;
            if (Distance(points[i], points[j]) < 1) throw Invalid("Ceiling edges must be at least 1 mm; duplicate and repeated closing vertices are forbidden.");
            if (Math.Abs(Orient(points[(i + points.Count - 1) % points.Count], points[i], points[j])) < 1e-8)
                throw Invalid("Ceiling polygon contains a redundant collinear vertex or a degenerate turn.");
            for (var k = i + 1; k < points.Count; k++)
            {
                var l = (k + 1) % points.Count;
                if (k == j || l == i) continue;
                if (Intersects(points[i], points[j], points[k], points[l])) throw Invalid("Ceiling polygon intersects or touches itself.");
            }
        }
        if (!double.IsFinite(SignedAreaMm2(points)) || Math.Abs(SignedAreaMm2(points)) < 1) throw Invalid("Ceiling profile area must be at least 1 mm².");
    }
    internal static void RequireNative(CeilingCreationReadback actual)
    {
        if (actual.ElementId <= 0 || actual.TypeId <= 0 || actual.LevelId <= 0 || actual.SketchId <= 0 ||
            actual.SketchOwnerId != actual.ElementId || !double.IsFinite(actual.HeightOffsetMm) ||
            actual.Boundary is null || actual.Boundary.Count is < 3 or > 128)
            throw Invalid("Native ceiling type, level, offset or owned complete single-loop sketch evidence is missing.");
        var vertices = actual.Boundary.Select(edge => edge.Start).ToArray();
        ValidatePolygon(vertices);
        for (var i = 0; i < actual.Boundary.Count; i++)
            if (!Finite(actual.Boundary[i].End) || Distance(actual.Boundary[i].End, vertices[(i + 1) % vertices.Length]) > ToleranceMm)
                throw Invalid("Native ceiling sketch is disconnected or contains non-finite endpoints.");
    }
    internal static void Require(JsonElement op, double reviewedLevelProjectElevationMm, long expectedElementId, CeilingCreationReadback actual)
    {
        Validate(op); RequireNative(actual);
        var points = Boundary(op);
        if (actual.ElementId != expectedElementId || actual.TypeId != Id(op, "ceilingTypeId") || actual.LevelId != Id(op, "levelId") ||
            Math.Abs(actual.HeightOffsetMm - HeightOffsetMm(points[0].ZMm, reviewedLevelProjectElevationMm)) > ToleranceMm || actual.Boundary.Count != points.Length)
            throw Invalid("Native ceiling identity, type, level, explicit height offset or segment count differs from the reviewed operation; roll back.");
        var expectedAbsolute = points.Select((point, i) => new CeilingBoundaryEdge(point, points[(i + 1) % points.Length])).ToArray();
        var levelPoints = points.Select(point => point with { ZMm = reviewedLevelProjectElevationMm }).ToArray();
        var expectedOnLevelPlane = levelPoints.Select((point, i) => new CeilingBoundaryEdge(point, levelPoints[(i + 1) % levelPoints.Length])).ToArray();
        var matched = Enumerable.Range(0, points.Length).Any(offset =>
            Match(expectedAbsolute, actual.Boundary, offset, false) || Match(expectedAbsolute, actual.Boundary, offset, true) ||
            Match(expectedOnLevelPlane, actual.Boundary, offset, false) || Match(expectedOnLevelPlane, actual.Boundary, offset, true));
        var actualArea = SignedAreaMm2(actual.Boundary.Select(edge => edge.Start).ToArray());
        var areaTolerance = expectedAbsolute.Sum(edge => Distance(edge.Start, edge.End)) * ToleranceMm + 1e-6;
        if (!matched || Math.Abs(Math.Abs(actualArea) - Math.Abs(SignedAreaMm2(points))) > areaTolerance)
            throw Invalid("Actual native ceiling sketch XYZ boundary or signed area differs from the reviewed absolute profile (cyclic rotation/reversal only); roll back.");
    }
    private static bool Match(IReadOnlyList<CeilingBoundaryEdge> expected, IReadOnlyList<CeilingBoundaryEdge> actual, int offset, bool reverse)
    {
        for (var i = 0; i < expected.Count; i++)
        {
            var edge = actual[reverse ? (offset - i + actual.Count * 2) % actual.Count : (offset + i) % actual.Count];
            if (reverse) edge = new(edge.End, edge.Start);
            if (Distance(expected[i].Start, edge.Start) > ToleranceMm || Distance(expected[i].End, edge.End) > ToleranceMm) return false;
        }
        return true;
    }
    private static void Shape(JsonElement value, string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("Ceiling input requires an explicit object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in value.EnumerateObject()) if (!allowed.Contains(item.Name, StringComparer.Ordinal) || !seen.Add(item.Name)) throw Invalid($"Unsupported or duplicate ceiling field '{item.Name}'.");
    }
    private static double Number(JsonElement value, string field)
    {
        var number = JsonDefaults.Get(value, field);
        if (number.ValueKind != JsonValueKind.Number || !number.TryGetDouble(out var result) || !double.IsFinite(result) || Math.Abs(result) > 1e8)
            throw Invalid($"{field} must be an explicit finite number with absolute value at most 100000000 mm.");
        return result;
    }
    private static string MetadataId(JsonElement value)
    {
        var text = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        if (text is null || text.Length is < 1 or > 80 || text.Trim() != text || text.Any(char.IsControl)) throw Invalid("Operation/dependency IDs must be exact nonblank strings of at most 80 characters without controls.");
        return text;
    }
    private static bool Finite(CeilingPoint point) => new[] { point.XMm, point.YMm, point.ZMm }.All(value => double.IsFinite(value) && Math.Abs(value) <= 1e8);
    private static double Distance(CeilingPoint a, CeilingPoint b) => Math.Sqrt(Math.Pow(a.XMm - b.XMm, 2) + Math.Pow(a.YMm - b.YMm, 2) + Math.Pow(a.ZMm - b.ZMm, 2));
    private static double Orient(CeilingPoint a, CeilingPoint b, CeilingPoint c) => (b.XMm - a.XMm) * (c.YMm - a.YMm) - (b.YMm - a.YMm) * (c.XMm - a.XMm);
    private static bool On(CeilingPoint a, CeilingPoint b, CeilingPoint p) => Math.Abs(Orient(a, b, p)) < 1e-8 && p.XMm >= Math.Min(a.XMm, b.XMm) - 1e-8 && p.XMm <= Math.Max(a.XMm, b.XMm) + 1e-8 && p.YMm >= Math.Min(a.YMm, b.YMm) - 1e-8 && p.YMm <= Math.Max(a.YMm, b.YMm) + 1e-8;
    private static bool Intersects(CeilingPoint a, CeilingPoint b, CeilingPoint c, CeilingPoint d) =>
        Orient(a, b, c) * Orient(a, b, d) < 0 && Orient(c, d, a) * Orient(c, d, b) < 0 || On(a, b, c) || On(a, b, d) || On(c, d, a) || On(c, d, b);
}
