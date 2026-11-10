using System.Text.Json;

namespace RevitAutoV27;

internal static class ViewportLabelRules
{
    internal sealed record Input(long ViewportId, long SheetId, long ViewId, double OffsetXMm, double OffsetYMm, double? LineLengthMm);
    private static readonly HashSet<string> Allowed = new(StringComparer.Ordinal)
    {
        "operationType", "id", "dependencies", "viewportId", "sheetId", "viewId",
        "labelOffsetXMm", "labelOffsetYMm", "labelOffsetZMm", "labelLineLengthMm"
    };

    private static BridgeException Invalid(string message) => new("invalid_viewport_label", message);
    private static double Bounded(JsonElement op, string field)
    {
        var value = JsonDefaults.Double(op, field);
        if (value is null || Math.Abs(value.Value) > 100000000) throw Invalid(field + " must be a finite millimeter value within +/-100000000.");
        return value.Value;
    }

    public static long ExistingId(JsonElement op, string field)
    {
        var value = JsonDefaults.Int64(op, field);
        if (value is null || value <= 0 || value > 9007199254740991)
            throw Invalid(field + " must be an existing positive safe integer id.");
        return value.Value;
    }

    public static void Validate(JsonElement op)
    {
        if (op.ValueKind != JsonValueKind.Object || JsonDefaults.String(op, "operationType") != "move_viewport_label")
            throw Invalid("Expected operationType move_viewport_label.");
        var keys = op.EnumerateObject().Select(property => property.Name).ToArray();
        if (keys.Any(key => !Allowed.Contains(key)) || keys.Distinct(StringComparer.Ordinal).Count() != keys.Length)
            throw Invalid("Unknown or duplicate viewport label field.");
        var ids = new[] { ExistingId(op, "viewportId"), ExistingId(op, "sheetId"), ExistingId(op, "viewId") };
        if (ids.Distinct().Count() != ids.Length) throw Invalid("Viewport, owner sheet and source view must be distinct existing elements.");
        _ = Bounded(op, "labelOffsetXMm");
        _ = Bounded(op, "labelOffsetYMm");
        if (op.TryGetProperty("labelOffsetZMm", out var zValue) &&
            (zValue.ValueKind != JsonValueKind.Number || !zValue.TryGetDouble(out var z) || !double.IsFinite(z) || z != 0))
            throw Invalid("labelOffsetZMm must be zero when provided.");
        if (op.TryGetProperty("labelLineLengthMm", out _)) _ = Bounded(op, "labelLineLengthMm");
        if (op.TryGetProperty("id", out var operationId) &&
            (operationId.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(operationId.GetString()) || operationId.GetString()!.Length > 80))
            throw Invalid("Viewport label operation id must be a non-empty string of at most 80 characters.");
        if (op.TryGetProperty("dependencies", out var dependencies) &&
            (dependencies.ValueKind != JsonValueKind.Array || dependencies.GetArrayLength() > 1000 ||
             dependencies.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()) || value.GetString()!.Length > 80)))
            throw Invalid("Viewport label dependencies must be an explicit bounded array of operation IDs.");
    }

    public static Input Parse(JsonElement op)
    {
        Validate(op);
        return new(
            ExistingId(op, "viewportId"),
            ExistingId(op, "sheetId"),
            ExistingId(op, "viewId"),
            JsonDefaults.Double(op, "labelOffsetXMm")!.Value,
            JsonDefaults.Double(op, "labelOffsetYMm")!.Value,
            JsonDefaults.Has(op, "labelLineLengthMm") ? JsonDefaults.Double(op, "labelLineLengthMm") : null);
    }

    public static void ValidatePlan(IEnumerable<JsonElement> operations)
    {
        var rows = operations.ToArray();
        var targets = new HashSet<long>();
        foreach (var op in rows.Where(op => JsonDefaults.String(op, "operationType") == "move_viewport_label"))
        {
            Validate(op);
            if (!targets.Add(ExistingId(op, "viewportId"))) throw Invalid("A viewport label may move only once per reviewed plan.");
            if (rows.Length != 1) throw Invalid("Viewport label changes must be the only operation in a reviewed plan.");
        }
    }
}
