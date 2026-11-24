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

internal readonly record struct AuditDoorGeometry(
    long ElementId, long HostWallId, double BaseZMm, double XMm, double YMm);

internal readonly record struct WallVerticalGapFinding(
    long WallId, string TargetKind, long TargetElementId,
    double WallTopZMm, double TargetUndersideZMm, double GapMm);

internal readonly record struct StairExceedsRoofFinding(
    long ElementId, string Category, long RoofId,
    double ElementMaxZMm, double HighestRoofTopZMm, double ProtrusionMm);

internal readonly record struct WallColumnGapFinding(
    long WallId, string Endpoint, long ColumnId, double GapMm);

internal readonly record struct RoofMissingParapetFinding(
    long RoofId, double RoofBaseZMm);

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
    RoofMissingParapetFinding[] RoofsMissingParapets,
    int RoofsMissingParapetsTotalCount,
    int GroundFloorExteriorDoorCount,
    bool HasSiteGround,
    string[] OpeningWarnings,
    string[] EnvelopeAndSiteWarnings,
    bool HasIssues);

// Pure geometric self-audit rules (zero Revit API dependencies; unit-tested in CoreTests).
internal static class ArchitecturalGeometryAuditRules
{
    public const double MinReportedVerticalGapMm = 10.0;
    public const double MaxReportedVerticalGapMm = 1000.0;
    public const double MinRoofProtrusionMm = 50.0;
    public const double MinWallColumnGapMm = 20.0;
    public const double MaxWallColumnGapMm = 500.0;
    public const double MinUpperRoofParapetCheckZMm = 3000.0;
    public const double MaxParapetWallHeightMm = 2200.0;
    public const int MaxFindingsPerKind = 100;

    public static ArchitecturalGeometryAuditReport Analyze(
        IReadOnlyList<AuditWallGeometry> walls,
        IReadOnlyList<AuditHorizontalSurface> floorsAndRoofs,
        IReadOnlyList<AuditColumnGeometry> columns,
        IReadOnlyList<AuditStairOrRailingGeometry> stairsAndRailings,
        int doorCount,
        int windowCount,
        IReadOnlyList<AuditDoorGeometry>? doors = null,
        bool hasNativeTopography = false)
    {
        var roofs = floorsAndRoofs.Where(s => string.Equals(s.Kind, "Roof", StringComparison.OrdinalIgnoreCase)).ToArray();
        var floors = floorsAndRoofs.Where(s => string.Equals(s.Kind, "Floor", StringComparison.OrdinalIgnoreCase)).ToArray();

        // 1. Detect horizontal gaps between wall tops and overlapping upper roof/floor undersides.
        var verticalGaps = new List<WallVerticalGapFinding>();
        foreach (var wall in walls)
        {
            if (!FiniteWall(wall) || wall.TopZMm <= wall.BaseZMm) continue;
            // Skip low roof parapet walls (<= 2200mm) when checking story-to-story vertical wall gaps.
            if (wall.TopZMm - wall.BaseZMm <= MaxParapetWallHeightMm &&
                roofs.Any(r => Math.Abs(r.BaseZMm - wall.BaseZMm) <= 450.0 && PointInBox((wall.StartXMm + wall.EndXMm) * 0.5, (wall.StartYMm + wall.EndYMm) * 0.5, r, 350.0)))
                continue;

            var midX = (wall.StartXMm + wall.EndXMm) * 0.5;
            var midY = (wall.StartYMm + wall.EndYMm) * 0.5;

            AuditHorizontalSurface? nearestAbove = null;
            double nearestUnderside = double.PositiveInfinity;

            foreach (var surface in floorsAndRoofs)
            {
                if (!PointInBox(midX, midY, surface, 250.0)) continue;
                var underside = surface.BaseZMm;
                if (surface.TopZMm <= wall.BaseZMm + 500.0) continue;
                if (underside < wall.TopZMm - 50.0) continue;
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

        // 4. Detect upper flat/terrace roofs missing parapet walls along their roof level.
        var roofsMissingParapets = new List<RoofMissingParapetFinding>();
        foreach (var roof in roofs)
        {
            if (roof.BaseZMm < MinUpperRoofParapetCheckZMm) continue;
            var hasParapet = walls.Any(w =>
                FiniteWall(w) &&
                w.BaseZMm >= roof.BaseZMm - 200.0 && w.BaseZMm <= roof.BaseZMm + 450.0 &&
                w.TopZMm - w.BaseZMm >= 300.0 && w.TopZMm - w.BaseZMm <= MaxParapetWallHeightMm &&
                (PointInBox(w.StartXMm, w.StartYMm, roof, 350.0) || PointInBox(w.EndXMm, w.EndYMm, roof, 350.0)));
            if (!hasParapet)
                roofsMissingParapets.Add(new RoofMissingParapetFinding(roof.ElementId, Math.Round(roof.BaseZMm, 2)));
        }

        // 5. Check ground-floor exterior entrance doors (including recessed lobby entrances within 3500mm of outer bbox).
        var groundWalls = walls.Where(w => FiniteWall(w) && w.BaseZMm >= -500.0 && w.BaseZMm <= 1000.0 && (w.TopZMm - w.BaseZMm) > MaxParapetWallHeightMm).ToArray();
        int groundFloorExteriorDoorCount = 0;
        var envelopeAndSiteWarnings = new List<string>();
        if (groundWalls.Length >= 4)
        {
            var minX = groundWalls.Min(w => Math.Min(w.StartXMm, w.EndXMm));
            var maxX = groundWalls.Max(w => Math.Max(w.StartXMm, w.EndXMm));
            var minY = groundWalls.Min(w => Math.Min(w.StartYMm, w.EndYMm));
            var maxY = groundWalls.Max(w => Math.Max(w.StartYMm, w.EndYMm));

            if (doors is not null)
            {
                foreach (var d in doors)
                {
                    if (d.BaseZMm < -500.0 || d.BaseZMm > 1000.0) continue;
                    var nearOuterEdge =
                        Math.Abs(d.XMm - minX) <= 3500.0 || Math.Abs(d.XMm - maxX) <= 3500.0 ||
                        Math.Abs(d.YMm - minY) <= 3500.0 || Math.Abs(d.YMm - maxY) <= 3500.0;
                    if (nearOuterEdge) groundFloorExteriorDoorCount++;
                }
                if (walls.Count >= 20 && groundFloorExteriorDoorCount == 0)
                    envelopeAndSiteWarnings.Add("ground_floor_missing_exterior_entrance_door");
            }

            // 6. Check whether site terrain / exterior ground slabs exist outside the building footprint.
            var hasExteriorSiteSlab = floors.Any(f =>
                f.TopZMm <= 200.0 && f.BaseZMm >= -3000.0 &&
                (f.MinXMm < minX - 2000.0 || f.MaxXMm > maxX + 2000.0 || f.MinYMm < minY - 2000.0 || f.MaxYMm > maxY + 2000.0));
            var hasSiteGround = hasNativeTopography || hasExteriorSiteSlab;
            if (!hasSiteGround && walls.Count >= 20 && roofs.Length > 0)
                envelopeAndSiteWarnings.Add("missing_site_ground_or_terrain");

            return BuildReport(walls, floors, roofs, columns, stairsAndRailings, doorCount, windowCount,
                verticalGaps, roofProtrusions, wallColumnGaps, roofsMissingParapets,
                groundFloorExteriorDoorCount, hasSiteGround, envelopeAndSiteWarnings);
        }

        return BuildReport(walls, floors, roofs, columns, stairsAndRailings, doorCount, windowCount,
            verticalGaps, roofProtrusions, wallColumnGaps, roofsMissingParapets,
            groundFloorExteriorDoorCount, hasNativeTopography, envelopeAndSiteWarnings);
    }

    private static ArchitecturalGeometryAuditReport BuildReport(
        IReadOnlyList<AuditWallGeometry> walls,
        AuditHorizontalSurface[] floors,
        AuditHorizontalSurface[] roofs,
        IReadOnlyList<AuditColumnGeometry> columns,
        IReadOnlyList<AuditStairOrRailingGeometry> stairsAndRailings,
        int doorCount,
        int windowCount,
        List<WallVerticalGapFinding> verticalGaps,
        List<StairExceedsRoofFinding> roofProtrusions,
        List<WallColumnGapFinding> wallColumnGaps,
        List<RoofMissingParapetFinding> roofsMissingParapets,
        int groundFloorExteriorDoorCount,
        bool hasSiteGround,
        List<string> envelopeAndSiteWarnings)
    {
        var openingWarnings = new List<string>();
        if (walls.Count >= 20 && doorCount == 0)
            openingWarnings.Add("multi_wall_model_has_zero_doors");
        else if (walls.Count >= 100 && doorCount < Math.Max(5, walls.Count / 40))
            openingWarnings.Add($"low_door_count_relative_to_walls (doors={doorCount}, walls={walls.Count})");

        var hasIssues = verticalGaps.Count > 0 || roofProtrusions.Count > 0 || wallColumnGaps.Count > 0 ||
            roofsMissingParapets.Count > 0 || openingWarnings.Count > 0 || envelopeAndSiteWarnings.Count > 0;
        return new ArchitecturalGeometryAuditReport(
            walls.Count, floors.Length, roofs.Length, columns.Count,
            stairsAndRailings.Count(s => s.Category == "OST_Stairs"),
            stairsAndRailings.Count(s => s.Category == "OST_StairsRailing"),
            doorCount, windowCount,
            verticalGaps.Take(MaxFindingsPerKind).ToArray(), verticalGaps.Count,
            roofProtrusions.Take(MaxFindingsPerKind).ToArray(), roofProtrusions.Count,
            wallColumnGaps.Take(MaxFindingsPerKind).ToArray(), wallColumnGaps.Count,
            roofsMissingParapets.Take(MaxFindingsPerKind).ToArray(), roofsMissingParapets.Count,
            groundFloorExteriorDoorCount,
            hasSiteGround,
            openingWarnings.ToArray(),
            envelopeAndSiteWarnings.ToArray(),
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
