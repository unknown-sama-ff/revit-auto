using System.Text.Json;

namespace RevitAutoV27;

internal sealed record StructuralPointReadback(double XMm, double YMm, double ZMm);
internal sealed record StructuralElementReadback(long ElementId, string UniqueId, long SymbolId, long LevelId,
    long CategoryId, string CategoryKind, string StructuralType, string PlacementType, bool SymbolIsActive,
    StructuralPointReadback? Start, StructuralPointReadback? End, StructuralPointReadback? Point, double RotationRadians);

// Pure validation and comparison; no Revit API references, inference, or deferred IDs.
internal static class StructuralElementRules
{
    internal const double PositionToleranceMm = 0.01;
    internal const double RotationToleranceRadians = 1e-6;
    internal static BridgeException Invalid(string message) => new("invalid_structural_element", message);
    public static bool IsBeam(JsonElement op) => JsonDefaults.String(op, "operationType") == "create_structural_beam";

    public static void Validate(JsonElement op)
    {
        if (op.ValueKind != JsonValueKind.Object) throw Invalid("An explicit structural operation object is required.");
        var kind = JsonDefaults.String(op, "operationType");
        if (kind is not ("create_structural_beam" or "create_isolated_foundation")) throw Invalid("Unsupported structural operationType.");
        var beam = IsBeam(op);
        Shape(op, beam ? ["operationType", "id", "dependencies", "symbolId", "levelId", "start", "end", "rotationDegrees", "disallowJoin", "disallowJoinStart", "disallowJoinEnd", "topologyPriority"] :
            ["operationType", "id", "dependencies", "symbolId", "levelId", "point", "rotationDegrees"]);
        Id(op, "symbolId"); Id(op, "levelId");
        if (beam)
        {
            var start = Point(op, "start"); var end = Point(op, "end");
            var dx = end.XMm - start.XMm; var dy = end.YMm - start.YMm; var dz = end.ZMm - start.ZMm;
            var projection = Math.Sqrt(dx * dx + dy * dy);
            if (!double.IsFinite(projection) || !double.IsFinite(dz) || !double.IsFinite(dx * dx + dy * dy + dz * dz) || projection < 1)
                throw Invalid("Beam endpoints require a finite horizontal projection of at least 1 mm; vertical beams are unsupported.");
            foreach (var joinField in new[] { "disallowJoin", "disallowJoinStart", "disallowJoinEnd" })
                if (op.TryGetProperty(joinField, out var dj) && dj.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    throw Invalid($"{joinField} must be a boolean.");
            if (op.TryGetProperty("topologyPriority", out _)) Number(op, "topologyPriority");
        }
        else Point(op, "point");
        if (op.TryGetProperty("rotationDegrees", out _) && Math.Abs(Number(op, "rotationDegrees")) > 360)
            throw Invalid("rotationDegrees must be a finite number in [-360,360].");
    }

    internal static long Id(JsonElement op, string field)
    {
        var value = JsonDefaults.Get(op, field);
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var id) || id <= 0 || id > 9007199254740991)
            throw Invalid($"{field} must be an explicit existing positive safe native ID; deferred references are unsupported.");
        return id;
    }
    internal static double Number(JsonElement value, string field)
    {
        var item = JsonDefaults.Get(value, field);
        if (item.ValueKind != JsonValueKind.Number || !item.TryGetDouble(out var number) || !double.IsFinite(number) || Math.Abs(number) > 1e8)
            throw Invalid($"{field} requires an explicit finite JSON number with absolute value at most 100000000.");
        return number;
    }
    internal static double Rotation(JsonElement op) => op.TryGetProperty("rotationDegrees", out _) ? Number(op, "rotationDegrees") * Math.PI / 180 : 0;
    internal static double LevelOffsetMm(double absoluteZMm, double levelProjectElevationMm)
    {
        if (!double.IsFinite(absoluteZMm) || !double.IsFinite(levelProjectElevationMm) ||
            Math.Abs(absoluteZMm) > 1e8 || Math.Abs(levelProjectElevationMm) > 1e8)
            throw Invalid("Structural Z and level elevation must be finite bounded numbers in millimeters.");
        var offsetMm = absoluteZMm - levelProjectElevationMm;
        if (!double.IsFinite(offsetMm) || Math.Abs(offsetMm) > 1e8)
            throw Invalid("Structural level height offset exceeds the finite millimeter bound.");
        return offsetMm;
    }

    internal static StructuralPointReadback Point(JsonElement op, string field)
    {
        var point = JsonDefaults.Get(op, field); Shape(point, ["xMm", "yMm", "zMm"]);
        return new(Number(point, "xMm"), Number(point, "yMm"), Number(point, "zMm"));
    }
    private static void Shape(JsonElement value, string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("Explicit structural object inputs are required.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name))
                throw Invalid($"Unsupported or duplicate structural field '{property.Name}'.");
    }

    // Only endpoint order may reverse. Z and cross-section rotation remain fully checked.
    public static void Require(JsonElement op, StructuralElementReadback actual, string expectedUniqueId, long expectedCategoryId)
    {
        Validate(op);
        var beam = IsBeam(op);
        if (actual.ElementId <= 0 || string.IsNullOrWhiteSpace(expectedUniqueId) || actual.UniqueId != expectedUniqueId ||
            actual.SymbolId != Id(op, "symbolId") || actual.LevelId != Id(op, "levelId") || expectedCategoryId >= 0 || actual.CategoryId != expectedCategoryId ||
            actual.CategoryKind != (beam ? "OST_StructuralFraming" : "OST_StructuralFoundation") ||
            actual.StructuralType != (beam ? "Beam" : "Footing") ||
            actual.PlacementType != (beam ? "CurveDrivenStructural" : "OneLevelBased") || !actual.SymbolIsActive ||
            !double.IsFinite(actual.RotationRadians) ||
            Math.Abs(Math.Atan2(Math.Sin(actual.RotationRadians - Rotation(op)), Math.Cos(actual.RotationRadians - Rotation(op)))) > RotationToleranceRadians)
            throw Invalid("Native structural identity, category, type, placement, level, activation or rotation differs from the reviewed input.");
        if (beam)
        {
            var start = Point(op, "start"); var end = Point(op, "end");
            if (actual.Point is not null || !((Matches(start, actual.Start) && Matches(end, actual.End)) ||
                (Matches(start, actual.End) && Matches(end, actual.Start))))
            {
                var actualStart = actual.Start is null ? "null" : $"({actual.Start.XMm:F2},{actual.Start.YMm:F2},{actual.Start.ZMm:F2})";
                var actualEnd = actual.End is null ? "null" : $"({actual.End.XMm:F2},{actual.End.YMm:F2},{actual.End.ZMm:F2})";
                throw Invalid($"Native beam complete XYZ endpoints differ from the reviewed input; only endpoint order may reverse. Expected ({start.XMm:F2},{start.YMm:F2},{start.ZMm:F2})->({end.XMm:F2},{end.YMm:F2},{end.ZMm:F2}) mm, actual {actualStart}->{actualEnd} mm.");
            }
        }
        else if (actual.Start is not null || actual.End is not null || !Matches(Point(op, "point"), actual.Point))
        {
            var expected = Point(op, "point");
            var actualPoint = actual.Point is null ? "null" : $"({actual.Point.XMm:F3}, {actual.Point.YMm:F3}, {actual.Point.ZMm:F3})";
            throw Invalid($"Native isolated foundation complete XYZ point differs from the reviewed input: expected ({expected.XMm:F3}, {expected.YMm:F3}, {expected.ZMm:F3}) mm, actual {actualPoint} mm.");
        }
    }
    private static bool Matches(StructuralPointReadback expected, StructuralPointReadback? actual) => actual is not null &&
        double.IsFinite(actual.XMm) && double.IsFinite(actual.YMm) && double.IsFinite(actual.ZMm) &&
        Math.Sqrt(Math.Pow(expected.XMm - actual.XMm, 2) + Math.Pow(expected.YMm - actual.YMm, 2) + Math.Pow(expected.ZMm - actual.ZMm, 2)) <= PositionToleranceMm;
}
