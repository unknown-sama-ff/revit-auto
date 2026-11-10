using System.Text.Json;

namespace RevitAutoV27;

internal readonly record struct ArchitectureEdgeReadback(double StartXmm, double StartYmm, double StartZmm, double EndXmm, double EndYmm, double EndZmm);
internal readonly record struct ArchitectureWallReadback(long TypeId, long LevelId, double HeightMm, double OffsetMm, bool Flipped, bool Structural, ArchitectureEdgeReadback Location);
internal readonly record struct ArchitectureFloorReadback(long TypeId, long LevelId, IReadOnlyList<ArchitectureEdgeReadback> Boundary, double OffsetMm = 0, bool Structural = false);
internal readonly record struct ArchitectureHostedReadback(long TypeId, long HostId, long LevelId, long CategoryId, ArchitecturePlacementReadback Placement);

internal static class ArchitecturePrimaryReadbackRules
{
    private static BridgeException Invalid(string message) => new("invalid_operation", message);
    private const double ToleranceMm = 0.01;

    public static void RequireWall(JsonElement op, ArchitectureWallReadback actual)
    {
        var start = Point(JsonDefaults.Get(op, "start"));
        var end = Point(JsonDefaults.Get(op, "end"));
        var expected = new ArchitectureWallReadback(
            JsonDefaults.Int64(op, "wallTypeId") ?? throw Invalid("Wall type readback requires wallTypeId."),
            JsonDefaults.Int64(op, "levelId") ?? throw Invalid("Wall level readback requires levelId."),
            PlanRules.Number(op, "heightMm"), JsonDefaults.Double(op, "offsetMm") ?? 0,
            JsonDefaults.Bool(op, "flip"), JsonDefaults.Bool(op, "structural"),
            new(start.X, start.Y, start.Z, end.X, end.Y, end.Z));
        RequireWall(expected, actual);
    }

    public static void RequireWall(ArchitectureWallReadback expected, ArchitectureWallReadback actual)
    {
        var direct = SameSegment(expected.Location, actual.Location);
        var reverse = SameSegment(expected.Location, Reverse(actual.Location));
        if (expected.TypeId <= 0 || expected.LevelId <= 0 || actual.TypeId != expected.TypeId || actual.LevelId != expected.LevelId ||
            !Close(actual.HeightMm, expected.HeightMm) || !Close(actual.OffsetMm, expected.OffsetMm) ||
            actual.Structural != expected.Structural ||
            !(direct && actual.Flipped == expected.Flipped || reverse && actual.Flipped != expected.Flipped))
            throw Invalid("Native wall type, level, height, offset, flags or location differs from the reviewed operation; roll back.");
    }

    public static void RequireFloor(JsonElement op, ArchitectureFloorReadback actual)
    {
        var expectedPoints = JsonDefaults.Array(op, "boundary").Select(Point).ToArray();
        // FloorLoop already accepts and removes an explicitly repeated closing point.
        if (expectedPoints.Length > 3 && expectedPoints[0] == expectedPoints[^1]) expectedPoints = expectedPoints[..^1];
        var expected = expectedPoints.Select((point, index) =>
        {
            var next = expectedPoints[(index + 1) % expectedPoints.Length];
            return new ArchitectureEdgeReadback(point.X, point.Y, point.Z, next.X, next.Y, next.Z);
        }).ToArray();
        var typeId = JsonDefaults.Int64(op, "floorTypeId") ?? throw Invalid("Floor type readback requires floorTypeId.");
        var levelId = JsonDefaults.Int64(op, "levelId") ?? throw Invalid("Floor level readback requires levelId.");
        RequireFloor(new ArchitectureFloorReadback(typeId, levelId, expected), actual);
    }

    public static void RequireFloor(ArchitectureFloorReadback expected, ArchitectureFloorReadback actual)
    {
        if (expected.TypeId <= 0 || expected.LevelId <= 0 || actual.TypeId != expected.TypeId || actual.LevelId != expected.LevelId ||
            !Close(expected.OffsetMm, actual.OffsetMm) || actual.Structural != expected.Structural || !SameBoundary(expected.Boundary, actual.Boundary))
            throw Invalid("Native floor type, level or ordered boundary differs from the reviewed operation; roll back.");
    }

    public static void RequireHosted(ArchitectureHostedReadback expected, ArchitectureHostedReadback actual)
    {
        if (expected.TypeId <= 0 || expected.HostId <= 0 || expected.LevelId <= 0 || expected.CategoryId >= 0 ||
            actual.TypeId != expected.TypeId || actual.HostId != expected.HostId || actual.LevelId != expected.LevelId || actual.CategoryId != expected.CategoryId)
            throw Invalid("Native door/window type, wall host, level or category differs from the reviewed placement; roll back.");
        ArchitecturePlacementReadbackRules.Require(expected.Placement, actual.Placement);
    }

    private static bool SameBoundary(IReadOnlyList<ArchitectureEdgeReadback> expected, IReadOnlyList<ArchitectureEdgeReadback> actual)
    {
        if (expected is null || actual is null || expected.Count != actual.Count || expected.Count < 3 ||
            expected.Any(edge => !Finite(edge)) || actual.Any(edge => !Finite(edge))) return false;
        for (var offset = 0; offset < actual.Count; offset++)
        {
            if (MatchesDirection(expected, actual, offset, false) || MatchesDirection(expected, actual, offset, true)) return true;
        }
        return false;
    }

    private static bool MatchesDirection(IReadOnlyList<ArchitectureEdgeReadback> expected, IReadOnlyList<ArchitectureEdgeReadback> actual, int offset, bool reverse)
    {
        for (var i = 0; i < expected.Count; i++)
        {
            var index = reverse ? (offset - i + actual.Count * 2) % actual.Count : (offset + i) % actual.Count;
            var edge = reverse ? Reverse(actual[index]) : actual[index];
            if (!SameSegment(expected[i], edge)) return false;
        }
        return true;
    }

    private static ArchitectureEdgeReadback Reverse(ArchitectureEdgeReadback edge) => new(edge.EndXmm, edge.EndYmm, edge.EndZmm, edge.StartXmm, edge.StartYmm, edge.StartZmm);
    private static bool SameSegment(ArchitectureEdgeReadback expected, ArchitectureEdgeReadback actual) =>
        Finite(actual) && ClosePoint(expected.StartXmm, expected.StartYmm, expected.StartZmm, actual.StartXmm, actual.StartYmm, actual.StartZmm) &&
        ClosePoint(expected.EndXmm, expected.EndYmm, expected.EndZmm, actual.EndXmm, actual.EndYmm, actual.EndZmm);
    private static bool ClosePoint(double ax, double ay, double az, double bx, double by, double bz)
    {
        var distance = Math.Sqrt(Math.Pow(ax - bx, 2) + Math.Pow(ay - by, 2) + Math.Pow(az - bz, 2));
        return double.IsFinite(distance) && distance <= ToleranceMm;
    }
    private static bool Close(double expected, double actual) => double.IsFinite(expected) && double.IsFinite(actual) && Math.Abs(expected - actual) <= ToleranceMm;
    private static bool Finite(ArchitectureEdgeReadback edge) => new[] { edge.StartXmm, edge.StartYmm, edge.StartZmm, edge.EndXmm, edge.EndYmm, edge.EndZmm }.All(double.IsFinite);
    private static (double X, double Y, double Z) Point(JsonElement point)
    {
        PlanRules.Point(point);
        return (PlanRules.Number(point, "xMm"), PlanRules.Number(point, "yMm"), JsonDefaults.Double(point, "zMm") ?? 0);
    }
}
