using System.Text.Json;

namespace RevitAutoV27;

// Sheet placement movement accepts only explicitly reviewed existing IDs.
internal static class DrawingPlacementRules
{
    private static readonly HashSet<string> Allowed = new(StringComparer.Ordinal)
    {
        "operationType", "id", "dependencies", "placementId", "sheetId", "viewId", "xMm", "yMm", "zMm"
    };
    private static BridgeException Invalid(string message) => new("invalid_drawing_placement", message);
    public static long ExistingId(JsonElement op, string field)
    {
        var value = JsonDefaults.Int64(op, field);
        if (value is null || value <= 0 || value > 9007199254740991)
            throw Invalid(field + " must be an existing positive safe integer id.");
        return value.Value;
    }
    public static void Validate(JsonElement op)
    {
        if (op.ValueKind != JsonValueKind.Object || JsonDefaults.String(op, "operationType") != "move_drawing_placement")
            throw Invalid("Expected operationType move_drawing_placement.");
        var keys = op.EnumerateObject().Select(property => property.Name).ToArray();
        if (keys.Any(key => !Allowed.Contains(key)) || keys.Distinct(StringComparer.Ordinal).Count() != keys.Length)
            throw Invalid("Unknown or duplicate drawing placement field; only explicit IDs and paper XY are accepted.");
        if (op.TryGetProperty("id", out var operationId) &&
            (operationId.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(operationId.GetString()) || operationId.GetString()!.Length > 80))
            throw Invalid("Movement operation id must be a non-empty string of at most 80 characters.");
        if (op.TryGetProperty("dependencies", out var dependencies))
        {
            if (dependencies.ValueKind != JsonValueKind.Array || dependencies.GetArrayLength() > 1000 ||
                dependencies.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()) || value.GetString()!.Length > 80))
                throw Invalid("Movement dependencies must be an explicit bounded array of operation IDs.");
        }
        var ids = new[] { ExistingId(op, "placementId"), ExistingId(op, "sheetId"), ExistingId(op, "viewId") };
        if (ids.Distinct().Count() != ids.Length)
            throw Invalid("Placement, owner sheet and source view must be distinct existing elements.");
        PlanRules.Point(op);
        if (op.TryGetProperty("zMm", out var zValue) &&
            (zValue.ValueKind != JsonValueKind.Number || !zValue.TryGetDouble(out var z) || !double.IsFinite(z) || z != 0))
            throw Invalid("Drawing placement paper points require finite numeric zMm=0 when provided.");
    }
    public static void ValidatePlan(IEnumerable<JsonElement> operations)
    {
        var rows = operations.ToArray();
        var placements = new HashSet<long>();
        foreach (var op in rows.Where(op => JsonDefaults.String(op, "operationType") == "move_drawing_placement"))
            if (!placements.Add(ExistingId(op, "placementId")))
                throw Invalid("An existing placement may move only once in a reviewed plan.");
        foreach (var op in rows.Where(op => JsonDefaults.String(op, "operationType") == "configure_view"))
            if (JsonDefaults.Int64(op, "viewportId") is long viewportId && placements.Contains(viewportId))
                throw Invalid("The same placement cannot be recentered by configure_view and moved in one reviewed plan.");
    }
}
