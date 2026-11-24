namespace RevitAutoV27;

internal readonly record struct AuditWallGeometry(
    long ElementId, long BaseLevelId, double BaseZMm, double TopZMm, double ThicknessMm,
    double StartXMm, double StartYMm, double EndXMm, double EndYMm);

internal readonly record struct AuditHorizontalSurface(
    long ElementId, string Kind, long LevelId, double BaseZMm, double TopZMm,
    double MinXMm, double MinYMm, double MaxXMm, double MaxYMm);

internal readonly record struct AuditColumnGeometry(
    long ElementId, double BaseZMm, double TopZMm,
    double CenterXMm, double CenterYMm, double HalfWidthXMm, double HalfWidthYMm);

internal readonly record struct AuditStairOrRailingGeometry(
    long ElementId, string Category,
    double MinXMm, double MinYMm, double MinZMm,
    double MaxXMm, double MaxYMm, double MaxZMm);

internal readonly record struct WallVerticalGapFinding(
    long WallId, string TargetKind, long TargetElementId,
    double WallTopZMm, double TargetUndersideZMm, double GapMm);

internal readonly record struct StairExceedsRoofFinding(
    long ElementId, string Category, long RoofId,
    double ElementMaxZMm, double HighestRoofTopZMm, double ProtrusionMm);

internal readonly record struct WallColumnGapFinding(
    long WallId, string Endpoint, long ColumnId, double GapMm);

internal sealed record ArchitecturalGeometryAuditReport(
    int ScannedWallCount,
    int ScannedFloorCount,
    int ScannedRoofCount,
    int ScannedColumnCount,
    int ScannedStairCount,
    int ScannedRailingCount,
    int DoorCount,
    int WindowCount,
    WallVerticalGapFinding[] WallVerticalGaps,
    int WallVerticalGapTotalCount,
    StairExceedsRoofFinding[] StairsOrRailingsExceedingRoof,
    int StairsOrRailingsExceedingRoofTotalCount,
    WallColumnGapFinding[] WallColumnEndpointGaps,
    int WallColumnEndpointGapTotalCount,
    string[] OpeningWarnings,
    bool HasIssues);

// Pure geometric self-audit rules (zero Revit API dependencies; unit-tested in CoreTests).
internal static class ArchitecturalGeometryAuditRules
{
    public const double MinReportedVerticalGapMm = 10.0;
    public const double MaxReportedVerticalGapMm = 1000.0;
    public const double MinRoofProtrusionMm = 50.0;
    public const double MinWallColumnGapMm = 20.0;
    public const double MaxWallColumnGapMm = 500.0;
    public const int MaxFindingsPerKind = 100;

    public static ArchitecturalGeometryAuditReport Analyze(
        IReadOnlyList<AuditWallGeometry> walls,
        IReadOnlyList<AuditHorizontalSurface> floorsAndRoofs,
        IReadOnlyList<AuditColumnGeometry> columns,
        IReadOnlyList<AuditStairOrRailingGeometry> stairsAndRailings,
        int doorCount,
        int windowCount)
    {
        var roofs = floorsAndRoofs.Where(s => string.Equals(s.Kind, "Roof", StringComparison.OrdinalIgnoreCase)).ToArray();
        var floors = floorsAndRoofs.Where(s => string.Equals(s.Kind, "Floor", StringComparison.OrdinalIgnoreCase)).ToArray();

        // 1. Detect horizontal gaps between wall tops and overlapping upper roof/floor undersides.
        var verticalGaps = new List<WallVerticalGapFinding>();
        foreach (var wall in walls)
        {
            if (!FiniteWall(wall) || wall.TopZMm <= wall.BaseZMm) continue;
            var midX = (wall.StartXMm + wall.EndXMm) * 0.5;
            var midY = (wall.StartYMm + wall.EndYMm) * 0.5;

            // Find the lowest overlapping roof or floor directly above this wall's base.
            AuditHorizontalSurface? nearestAbove = null;
            double nearestUnderside = double.PositiveInfinity;

            foreach (var surface in floorsAndRoofs)
            {
                if (!PointInBox(midX, midY, surface, 250.0)) continue;
                var underside = string.Equals(surface.Kind, "Roof", StringComparison.OrdinalIgnoreCase)
                    ? surface.BaseZMm
                    : surface.BaseZMm;
                if (surface.TopZMm <= wall.BaseZMm + 500.0) continue;
                if (underside < wall.TopZMm - 50.0) continue; // wall already reaches/passes underside
                if (underside < nearestUnderside)
                {
                    nearestUnderside = underside;
                    nearestAbove = surface;
                }
            }

            if (nearestAbove is { } target)
            {
                var gap = nearestUnderside - wall.TopZMm;
                if (gap > MinReportedVerticalGapMm && gap <= MaxReportedVerticalGapMm)
                {
                    verticalGaps.Add(new WallVerticalGapFinding(
                        wall.ElementId, target.Kind, target.ElementId,
                        Math.Round(wall.TopZMm, 2), Math.Round(nearestUnderside, 2), Math.Round(gap, 2)));
                }
            }
        }

        // 2. Detect stairs or stair railings protruding above the highest roof covering their XY footprint.
        var roofProtrusions = new List<StairExceedsRoofFinding>();
        foreach (var item in stairsAndRailings)
        {
            if (!FiniteStair(item)) continue;
            var cx = (item.MinXMm + item.MaxXMm) * 0.5;
            var cy = (item.MinYMm + item.MaxYMm) * 0.5;
            AuditHorizontalSurface? highestCoveringRoof = null;
            foreach (var roof in roofs)
            {
                if (!PointInBox(cx, cy, roof, 100.0)) continue;
                if (highestCoveringRoof is null || roof.TopZMm > highestCoveringRoof.Value.TopZMm)
                    highestCoveringRoof = roof;
            }
            if (highestCoveringRoof is { } topRoof)
            {
                var protrusion = item.MaxZMm - topRoof.TopZMm;
                if (protrusion > MinRoofProtrusionMm)
                {
                    roofProtrusions.Add(new StairExceedsRoofFinding(
                        item.ElementId, item.Category, topRoof.ElementId,
                        Math.Round(item.MaxZMm, 2), Math.Round(topRoof.TopZMm, 2), Math.Round(protrusion, 2)));
                }
            }
        }

        // 3. Detect wall endpoints stopping short of nearby structural columns (unconnected wall-column gaps).
        var wallColumnGaps = new List<WallColumnGapFinding>();
        foreach (var wall in walls)
        {
            if (!FiniteWall(wall)) continue;
            var dx = wall.EndXMm - wall.StartXMm;
            var dy = wall.EndYMm - wall.StartYMm;
            var len = Math.Sqrt(dx * dx + dy * dy);
            if (len < 1.0) continue;
            var ux = dx / len;
            var uy = dy / len;

            CheckEndpointGap(wall, "start", wall.StartXMm, wall.StartYMm, -ux, -uy, columns, wallColumnGaps);
            CheckEndpointGap(wall, "end", wall.EndXMm, wall.EndYMm, ux, uy, columns, wallColumnGaps);
        }

        // 4. Opening / door completeness warnings.
        var openingWarnings = new List<string>();
        if (walls.Count >= 20 && doorCount == 0)
            openingWarnings.Add("multi_wall_model_has_zero_doors");
        else if (walls.Count >= 100 && doorCount < Math.Max(5, walls.Count / 40))
            openingWarnings.Add($"low_door_count_relative_to_walls (doors={doorCount}, walls={walls.Count})");

        var hasIssues = verticalGaps.Count > 0 || roofProtrusions.Count > 0 || wallColumnGaps.Count > 0 || openingWarnings.Count > 0;
        return new ArchitecturalGeometryAuditReport(
            walls.Count, floors.Length, roofs.Length, columns.Count,
            stairsAndRailings.Count(s => s.Category == "OST_Stairs"),
            stairsAndRailings.Count(s => s.Category == "OST_StairsRailing"),
            doorCount, windowCount,
            verticalGaps.Take(MaxFindingsPerKind).ToArray(), verticalGaps.Count,
            roofProtrusions.Take(MaxFindingsPerKind).ToArray(), roofProtrusions.Count,
            wallColumnGaps.Take(MaxFindingsPerKind).ToArray(), wallColumnGaps.Count,
            openingWarnings.ToArray(),
            hasIssues);
    }

    private static void CheckEndpointGap(
        AuditWallGeometry wall, string endpointName,
        double ex, double ey, double outUx, double outUy,
        IReadOnlyList<AuditColumnGeometry> columns,
        List<WallColumnGapFinding> findings)
    {
        double bestGap = double.PositiveInfinity;
        long bestColId = 0;

        foreach (var col in columns)
        {
            if (!FiniteColumn(col)) continue;
            if (col.TopZMm <= wall.BaseZMm + 50.0 || col.BaseZMm >= wall.TopZMm - 50.0) continue;

            // Project column center relative to wall endpoint along outward wall ray.
            var rx = col.CenterXMm - ex;
            var ry = col.CenterYMm - ey;
            var along = rx * outUx + ry * outUy;
            var perp = Math.Abs(-rx * outUy + ry * outUx);

            var colAlongHalf = Math.Abs(outUx) * col.HalfWidthXMm + Math.Abs(outUy) * col.HalfWidthYMm;
            var colPerpHalf = Math.Abs(outUy) * col.HalfWidthXMm + Math.Abs(outUx) * col.HalfWidthYMm;

            if (perp > colPerpHalf + wall.ThicknessMm * 0.5 + 50.0) continue;
            var gapToFace = along - colAlongHalf;
            if (gapToFace > MinWallColumnGapMm && gapToFace <= MaxWallColumnGapMm && gapToFace < bestGap)
            {
                bestGap = gapToFace;
                bestColId = col.ElementId;
            }
        }

        if (bestColId > 0)
            findings.Add(new WallColumnGapFinding(wall.ElementId, endpointName, bestColId, Math.Round(bestGap, 2)));
    }

    private static bool PointInBox(double x, double y, AuditHorizontalSurface box, double toleranceMm) =>
        x >= box.MinXMm - toleranceMm && x <= box.MaxXMm + toleranceMm &&
        y >= box.MinYMm - toleranceMm && y <= box.MaxYMm + toleranceMm;

    private static bool FiniteWall(AuditWallGeometry w) =>
        double.IsFinite(w.BaseZMm) && double.IsFinite(w.TopZMm) && double.IsFinite(w.ThicknessMm) &&
        double.IsFinite(w.StartXMm) && double.IsFinite(w.StartYMm) && double.IsFinite(w.EndXMm) && double.IsFinite(w.EndYMm);

    private static bool FiniteColumn(AuditColumnGeometry c) =>
        double.IsFinite(c.BaseZMm) && double.IsFinite(c.TopZMm) &&
        double.IsFinite(c.CenterXMm) && double.IsFinite(c.CenterYMm) &&
        double.IsFinite(c.HalfWidthXMm) && double.IsFinite(c.HalfWidthYMm);

    private static bool FiniteStair(AuditStairOrRailingGeometry s) =>
        double.IsFinite(s.MinXMm) && double.IsFinite(s.MinYMm) && double.IsFinite(s.MinZMm) &&
        double.IsFinite(s.MaxXMm) && double.IsFinite(s.MaxYMm) && double.IsFinite(s.MaxZMm);
}
