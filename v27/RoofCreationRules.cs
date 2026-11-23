using System.Text.Json;

namespace RevitAutoV27;

internal sealed record RoofInput(long RoofTypeId, long LevelId, CeilingPoint[] Boundary, double[] EdgeSlopes);
internal sealed record RoofEdge(CeilingPoint Start, CeilingPoint End, bool DefinesSlope, double? RiseOverRun);

internal static class RoofCreationRules
{
    internal static BridgeException Invalid(string message) => new("invalid_roof_creation", message);

    internal static RoofInput Validate(JsonElement operation)
    {
        if (JsonDefaults.String(operation, "operationType") != "create_footprint_roof")
            throw Invalid("Expected create_footprint_roof.");
        string[] allowed = ["operationType", "id", "dependencies", "roofTypeId", "levelId", "boundary", "edgeSlopes"];
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in operation.EnumerateObject())
            if (!allowed.Contains(item.Name, StringComparer.Ordinal) || !seen.Add(item.Name))
                throw Invalid($"Unsupported or duplicate footprint roof field: {item.Name}.");
        long type, level;
        CeilingPoint[] points;
        try
        {
            type = CeilingCreationRules.Id(operation, "roofTypeId");
            level = CeilingCreationRules.Id(operation, "levelId");
            points = CeilingCreationRules.Boundary(operation);
            CeilingCreationRules.ValidatePolygon(points);
        }
        catch (BridgeException error) when (error.Code == "invalid_ceiling_creation")
        {
            throw Invalid(error.Message.Replace("Ceiling", "Roof", StringComparison.Ordinal));
        }
        var slopes = JsonDefaults.Get(operation, "edgeSlopes");
        if (slopes.ValueKind != JsonValueKind.Array || slopes.GetArrayLength() != points.Length)
            throw Invalid("Supply one rise/run ratio from 0 through 12 per edge.");
        var ratios = slopes.EnumerateArray().Select(value =>
        {
            if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out double ratio) ||
                !double.IsFinite(ratio) || ratio < 0 || ratio > 12)
                throw Invalid("Every edge ratio must be finite and from 0 through 12. Zero disables slope.");
            return ratio;
        }).ToArray();
        return new(type, level, points, ratios);
    }

    internal static void ValidatePlan(IReadOnlyList<JsonElement> operations)
    {
        var sources = new HashSet<long>();
        foreach (var operation in operations.Where(op => JsonDefaults.String(op, "operationType") == "create_footprint_roof"))
        {
            var input = Validate(operation);
            sources.Add(input.RoofTypeId);
            sources.Add(input.LevelId);
        }
        foreach (var operation in operations.Where(op => JsonDefaults.String(op, "operationType") is "set_parameter" or "delete_element"))
            if (JsonDefaults.Int64(operation, "elementId") is long id && sources.Contains(id))
                throw Invalid("Change a roof source type or level in a separate plan.");
    }

    internal static void RequireFootprint(RoofInput input, IReadOnlyList<RoofEdge> edges, double baseElevationMm)
    {
        double tolerance = CeilingCreationRules.ToleranceMm;
        if (!double.IsFinite(baseElevationMm) || Math.Abs(baseElevationMm - input.Boundary[0].ZMm) > tolerance)
            throw Invalid("The native roof base level and offset do not produce the requested absolute elevation.");
        var ordered = MatchEdges(input.Boundary, edges.Select(edge => (edge.Start, edge.End)).ToArray());
        for (var i = 0; i < ordered.Length; i++)
        {
            double expected = input.EdgeSlopes[i];
            RoofEdge actual = edges[ordered[i]];
            if (actual.DefinesSlope != (expected > 0) ||
                (expected > 0 && (actual.RiseOverRun is not double ratio || !double.IsFinite(ratio) ||
                                  Math.Abs(ratio - expected) > Math.Max(expected * 1e-8, 1e-10))))
                throw Invalid("The native slope of a roof footprint edge differs from the requested rise/run ratio.");
        }
    }

    // Revit can reorder or reverse individual sketch curves. Match their actual XY endpoints.
    internal static int[] MatchEdges(CeilingPoint[] boundary, IReadOnlyList<(CeilingPoint Start, CeilingPoint End)> edges)
    {
        if (edges.Count != boundary.Length) throw Invalid("The native roof footprint has a different number of edges.");
        var result = new int[boundary.Length];
        var used = new HashSet<int>();
        for (var i = 0; i < boundary.Length; i++)
        {
            var start = boundary[i];
            var end = boundary[(i + 1) % boundary.Length];
            var matches = Enumerable.Range(0, edges.Count).Where(j =>
            {
                var (a, b) = edges[j];
                return (SameXy(a, start) && SameXy(b, end)) || (SameXy(a, end) && SameXy(b, start));
            }).ToArray();
            if (matches.Length != 1 || !used.Add(matches[0]))
                throw Invalid("A native roof edge cannot be matched uniquely to the reviewed footprint.");
            result[i] = matches[0];
        }
        return result;
    }

    private static bool SameXy(CeilingPoint a, CeilingPoint b) =>
        Math.Sqrt(Math.Pow(a.XMm - b.XMm, 2) + Math.Pow(a.YMm - b.YMm, 2)) <= CeilingCreationRules.ToleranceMm;
}
