using System.Text.Json;

namespace RevitAutoV27;

internal sealed record LightingMovePoint(double XMm, double YMm, double ZMm);
internal sealed record LightingMoveTarget(long ElementId, long SymbolId, LightingMovePoint Point);
internal sealed record LightingMoveInput(LightingMoveTarget[] Targets, LightingMovePoint Translation, double ToleranceMm);
internal sealed record LightingMovePort(int ConnectorId, LightingMovePoint Origin, string[] PeerKeys);
internal sealed record LightingMoveState(long ElementId, string UniqueId, long SymbolId, long LevelId,
    LightingMovePoint Point, double RotationRadians, LightingMovePort[] Ports, string[] CircuitKeys);

internal static class LightingMoveRules
{
    internal const int MaxTargets = 20;
    private static BridgeException Invalid(string message) => new("invalid_lighting_move", message);
    private static void Fields(JsonElement value, params string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("Lighting move input must be an object.");
        var keys = value.EnumerateObject().Select(p => p.Name).ToArray();
        if (keys.Length != keys.Distinct(StringComparer.Ordinal).Count() || keys.Any(k => !allowed.Contains(k, StringComparer.Ordinal)))
            throw Invalid("Unknown or duplicate lighting move field.");
    }
    private static double Number(JsonElement value, string field, double limit = 100000000)
    {
        var n = JsonDefaults.Double(value, field);
        if (n is null || Math.Abs(n.Value) > limit) throw Invalid(field + " must be a bounded finite millimeter number.");
        return n.Value;
    }
    private static long Id(JsonElement value, string field)
    {
        var id = JsonDefaults.Int64(value, field);
        if (id is null || id <= 0 || id > 9007199254740991) throw Invalid(field + " must be an existing positive safe integer ID.");
        return id.Value;
    }
    private static LightingMovePoint Point(JsonElement value, double limit = 100000000)
    {
        Fields(value, "xMm", "yMm", "zMm");
        return new(Number(value, "xMm", limit), Number(value, "yMm", limit), Number(value, "zMm", limit));
    }
    public static LightingMoveInput Parse(JsonElement operation)
    {
        Fields(operation, "operationType", "id", "targets", "translation", "toleranceMm");
        if (JsonDefaults.String(operation, "operationType") != "move_lighting_fixtures") throw Invalid("Expected move_lighting_fixtures.");
        if (operation.TryGetProperty("id", out var key) && (key.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(key.GetString()) || key.GetString()!.Length > 80))
            throw Invalid("Invalid lighting move operation ID.");
        var values = JsonDefaults.Get(operation, "targets");
        if (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() is < 1 or > MaxTargets) throw Invalid("A lighting move requires 1..20 explicit targets.");
        var targets = values.EnumerateArray().Select(value => {
            Fields(value, "elementId", "symbolId", "point");
            return new LightingMoveTarget(Id(value, "elementId"), Id(value, "symbolId"), Point(JsonDefaults.Get(value, "point")));
        }).ToArray();
        if (targets.Select(t => t.ElementId).Distinct().Count() != targets.Length) throw Invalid("Lighting move targets must be distinct.");
        var tolerance = Number(operation, "toleranceMm", 1);
        if (tolerance <= 0) throw Invalid("toleranceMm must be positive and at most 1mm.");
        var translation = Point(JsonDefaults.Get(operation, "translation"), 10000);
        if (translation.ZMm != 0) throw Invalid("Only an explicit XY translation with zMm=0 is supported.");
        var distance = Math.Sqrt(translation.XMm * translation.XMm + translation.YMm * translation.YMm);
        if (distance > 10000) throw Invalid("XY translation length must not exceed 10000mm.");
        if (distance <= 2 * tolerance) throw Invalid("Translation must exceed twice the position tolerance; no-op moves are refused.");
        foreach (var t in targets) CheckPoint(new(t.Point.XMm + translation.XMm, t.Point.YMm + translation.YMm, t.Point.ZMm));
        return new(targets, translation, tolerance);
    }
    public static void ValidatePlan(IReadOnlyCollection<JsonElement> operations)
    {
        if (operations.Any(op => JsonDefaults.String(op, "operationType") == "move_lighting_fixtures") && operations.Count != 1)
            throw Invalid("A lighting move must be the only operation in the reviewed plan.");
    }
    public static void CheckPoint(LightingMovePoint point)
    {
        if (new[] { point.XMm, point.YMm, point.ZMm }.Any(v => !double.IsFinite(v) || Math.Abs(v) > 100000000))
            throw Invalid("Native lighting point is unavailable or outside the bounded coordinate range.");
    }
    public static void RequirePoint(LightingMovePoint actual, LightingMovePoint expected, double tolerance)
    {
        CheckPoint(actual); CheckPoint(expected);
        var d = Math.Sqrt(Math.Pow(actual.XMm - expected.XMm, 2) + Math.Pow(actual.YMm - expected.YMm, 2) + Math.Pow(actual.ZMm - expected.ZMm, 2));
        if (!double.IsFinite(d) || d > tolerance) throw Invalid("Native lighting placement does not match the reviewed point within tolerance; roll back.");
    }
    public static void Verify(LightingMoveState before, LightingMoveState after, LightingMoveInput input)
    {
        if (before.ElementId != after.ElementId || before.UniqueId != after.UniqueId || before.SymbolId != after.SymbolId || before.LevelId != after.LevelId)
            throw Invalid("Lighting instance identity, type or level changed; roll back.");
        RequirePoint(after.Point, new(before.Point.XMm + input.Translation.XMm, before.Point.YMm + input.Translation.YMm, before.Point.ZMm), input.ToleranceMm);
        if (!double.IsFinite(before.RotationRadians) || !double.IsFinite(after.RotationRadians) ||
            Math.Abs(Math.IEEERemainder(after.RotationRadians - before.RotationRadians, 2 * Math.PI)) > 1e-8)
            throw Invalid("Lighting rotation changed or became unknown; roll back.");
        if (!before.CircuitKeys.Order(StringComparer.Ordinal).SequenceEqual(after.CircuitKeys.Order(StringComparer.Ordinal), StringComparer.Ordinal))
            throw Invalid("Electrical circuit, panel or membership changed; roll back.");
        if (before.Ports.Length != after.Ports.Length || before.Ports.Select(p => p.ConnectorId).Distinct().Count() != before.Ports.Length || after.Ports.Select(p => p.ConnectorId).Distinct().Count() != after.Ports.Length)
            throw Invalid("Lighting connector set changed; roll back.");
        foreach (var port in before.Ports)
        {
            var current = after.Ports.SingleOrDefault(p => p.ConnectorId == port.ConnectorId) ?? throw Invalid("A lighting connector disappeared; roll back.");
            RequirePoint(current.Origin, new(port.Origin.XMm + input.Translation.XMm, port.Origin.YMm + input.Translation.YMm, port.Origin.ZMm), input.ToleranceMm);
            if (!port.PeerKeys.Order(StringComparer.Ordinal).SequenceEqual(current.PeerKeys.Order(StringComparer.Ordinal), StringComparer.Ordinal))
                throw Invalid("Native lighting connector peer relationships changed; roll back.");
        }
    }
}
