using System.Text.Json;

namespace RevitAutoV27;

internal readonly record struct GridCreationReadback(string Name, bool IsCurved, bool IsBound, ArchitectureEdgeReadback Location);

internal static class GridCreationReadbackRules
{
    private const double ToleranceMm = 0.01;
    private static BridgeException Invalid() => new("invalid_grid", "Native grid name or bounded straight endpoints differ from the reviewed operation; roll back the entire plan.");

    internal static void Require(JsonElement operation, GridCreationReadback actual)
    {
        ArchitectureRules.Grid(operation);
        var start = JsonDefaults.Get(operation, "start");
        var end = JsonDefaults.Get(operation, "end");
        var expected = new ArchitectureEdgeReadback(PlanRules.Number(start, "xMm"), PlanRules.Number(start, "yMm"), JsonDefaults.Double(start, "zMm") ?? 0,
            PlanRules.Number(end, "xMm"), PlanRules.Number(end, "yMm"), JsonDefaults.Double(end, "zMm") ?? 0);
        var edge = actual.Location;
        if (!string.Equals(actual.Name, JsonDefaults.String(operation, "name"), StringComparison.Ordinal) || actual.IsCurved || !actual.IsBound ||
            !(Same(expected, edge) || Same(expected, new(edge.EndXmm, edge.EndYmm, edge.EndZmm, edge.StartXmm, edge.StartYmm, edge.StartZmm))))
            throw Invalid();
    }

    private static bool Same(ArchitectureEdgeReadback expected, ArchitectureEdgeReadback actual) =>
        Close(expected.StartXmm, expected.StartYmm, expected.StartZmm, actual.StartXmm, actual.StartYmm, actual.StartZmm) &&
        Close(expected.EndXmm, expected.EndYmm, expected.EndZmm, actual.EndXmm, actual.EndYmm, actual.EndZmm);

    private static bool Close(double x, double y, double z, double actualX, double actualY, double actualZ) =>
        double.IsFinite(actualX) && double.IsFinite(actualY) && double.IsFinite(actualZ) &&
        Math.Sqrt(Math.Pow(actualX - x, 2) + Math.Pow(actualY - y, 2) + Math.Pow(actualZ - z, 2)) <= ToleranceMm;
}
