using System.Text.Json;

namespace RevitAutoV27;

internal static class ArchitectureRules
{
    private static BridgeException ColumnInvalid(string message) => new("invalid_structural_column", message);
    private static BridgeException GridInvalid(string message) => new("invalid_grid", message);

    public static void StructuralColumn(JsonElement op)
    {
        string[] required = ["symbolId", "baseLevelId", "topLevelId", "baseOffsetMm", "topOffsetMm", "point"];
        Shape(op, ["operationType", "id", "dependencies", .. required, "rotationDegrees"], ColumnInvalid);
        foreach (var key in required) if (!JsonDefaults.Has(op, key)) throw ColumnInvalid($"Explicit {key} is required; no column type, level or height is inferred.");
        NativeId(op, "symbolId", allowCopiedType: true);
        foreach (var key in new[] { "baseLevelId", "topLevelId" }) NativeId(op, key);
        if (JsonDefaults.Int64(op, "baseLevelId") == JsonDefaults.Int64(op, "topLevelId")) throw ColumnInvalid("Column base and top levels must be different.");
        PlanRules.Number(op, "baseOffsetMm"); PlanRules.Number(op, "topOffsetMm");
        var point = JsonDefaults.Get(op, "point");
        Shape(point, ["xMm", "yMm"], ColumnInvalid);
        if (point.EnumerateObject().Count() != 2) throw ColumnInvalid("Column point requires only explicit xMm/yMm; Z comes from the reviewed base constraint.");
        PlanRules.Number(point, "xMm"); PlanRules.Number(point, "yMm");
        if (JsonDefaults.Has(op, "rotationDegrees") && Math.Abs(PlanRules.Number(op, "rotationDegrees")) > 360) throw ColumnInvalid("rotationDegrees must be in [-360,360].");
    }

    public static void RequireVerticalExtent(double baseElevationMm, double topElevationMm, double baseOffsetMm, double topOffsetMm)
    {
        if (new[] { baseElevationMm, topElevationMm, baseOffsetMm, topOffsetMm }.Any(value => !double.IsFinite(value)) ||
            topElevationMm <= baseElevationMm || topElevationMm + topOffsetMm - baseElevationMm - baseOffsetMm < 1)
            throw ColumnInvalid("The explicit top level must be above the base level and the reviewed offsets must leave at least 1 mm column height.");
    }

    public static double NativeOffset(bool hasValue, double valueMm)
    {
        if (!hasValue || !double.IsFinite(valueMm)) throw ColumnInvalid("Native column offset is unknown or non-finite; it cannot certify a zero offset.");
        return valueMm;
    }

    public static void Grid(JsonElement op)
    {
        Shape(op, ["operationType", "id", "dependencies", "name", "start", "end"], GridInvalid);
        var name = JsonDefaults.String(op, "name");
        if (string.IsNullOrWhiteSpace(name) || name != name.Trim() || name.Length > 200) throw GridInvalid("Grid name must be explicit, nonempty, and without surrounding whitespace.");
        var start = GridPoint(JsonDefaults.Get(op, "start")); var end = GridPoint(JsonDefaults.Get(op, "end"));
        if (Math.Abs(start.Z - end.Z) > 0.01) throw GridInvalid("Grid endpoints must share one horizontal plane within 0.01 mm.");
        if (Math.Sqrt(Math.Pow(start.X - end.X, 2) + Math.Pow(start.Y - end.Y, 2)) < 1) throw GridInvalid("Grid endpoints must be at least 1 mm apart.");
    }

    public static void ValidatePlan(IEnumerable<JsonElement> operations)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var op in operations.Where(op => JsonDefaults.String(op, "operationType") == "create_grid"))
            if (!names.Add(JsonDefaults.String(op, "name")!)) throw GridInvalid("Grid names must be unique within the reviewed plan.");
    }

    private static (double X, double Y, double Z) GridPoint(JsonElement point)
    {
        Shape(point, ["xMm", "yMm", "zMm"], GridInvalid);
        return (PlanRules.Number(point, "xMm"), PlanRules.Number(point, "yMm"), JsonDefaults.Has(point, "zMm") ? PlanRules.Number(point, "zMm") : 0);
    }

    private static void NativeId(JsonElement op, string key, bool allowCopiedType = false)
    {
        var value = JsonDefaults.Get(op, key);
        if (allowCopiedType && value.ValueKind == JsonValueKind.String && value.GetString() is { } reference && reference.StartsWith('@'))
        {
            var referenceId = reference[1..];
            if (!string.IsNullOrWhiteSpace(referenceId) && referenceId.Length <= 80 && referenceId == referenceId.Trim() && !referenceId.Any(char.IsControl)) return;
            throw ColumnInvalid("A column type reference must be an exact bounded operation ID; the complete plan must bind it to an earlier reviewed architecture copy.");
        }
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var id) || id <= 0 || id > 9007199254740991)
            throw ColumnInvalid(allowCopiedType ? "symbolId must be an existing positive safe native ID or an earlier reviewed architecture-copy reference." :
                $"{key} must be an existing positive safe native ID; newly created levels need a subsequent reviewed plan.");
    }

    private static void Shape(JsonElement value, string[] allowed, Func<string, BridgeException> invalid)
    {
        if (value.ValueKind != JsonValueKind.Object) throw invalid("Explicit object inputs are required.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) throw invalid($"Unsupported or duplicate architecture field '{property.Name}'.");
    }
}
