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

internal readonly record struct AuditStructuralMemberFamily(
    long ElementId, string Category, string FamilyName, string TypeName);

internal readonly record struct StructuralFamilyMismatchFinding(
    long ElementId, string Category, string FamilyName, string TypeName, string Reason);

internal readonly record struct AuditOpeningGeometry(
    long ElementId, string Category, long HostWallId, double BaseZMm, double XMm, double YMm, double WidthMm);

internal readonly record struct FloatingHostedWallFinding(
    long WallId, int HostedOpeningCount, double LengthMm);

internal readonly record struct OpeningCollisionFinding(
    long OpeningId, string Category, long HostWallId, long ConflictElementId, string Reason, double OverlapMm);

internal readonly record struct AuditStairRunMetric(
    long StairId, long RunId, double RunWidthMm, double TreadDepthMm);

internal readonly record struct IsolatedShortWallStubFinding(
    long WallId, double LengthMm, bool StartConnected, bool EndConnected);

internal readonly record struct CloseParallelWallFinding(
    long WallIdA, long WallIdB, double SpacingMm, double OverlapMm);

internal readonly record struct UndersizedStairFinding(
    long StairId, long RunId, double RunWidthMm, double TreadDepthMm, string Reason);

internal readonly record struct WallToWallEndpointGapFinding(
    long WallId, string Endpoint, long NearestWallId, double ClearGapMm);

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
    StructuralFamilyMismatchFinding[] StructuralFamilyMismatches,
    int StructuralFamilyMismatchTotalCount,
    string[] StructuralFamilyWarnings,
    FloatingHostedWallFinding[] FloatingHostedWalls,
    int FloatingHostedWallTotalCount,
    OpeningCollisionFinding[] OpeningCollisions,
    int OpeningCollisionTotalCount,
    IsolatedShortWallStubFinding[] IsolatedShortWallStubs,
    int IsolatedShortWallStubTotalCount,
    CloseParallelWallFinding[] CloseParallelOverlappingWalls,
    int CloseParallelOverlappingWallTotalCount,
    UndersizedStairFinding[] UndersizedStairs,
    int UndersizedStairTotalCount,
    WallToWallEndpointGapFinding[] WallToWallEndpointGaps,
    int WallToWallEndpointGapTotalCount,
    bool HasIssues);

// Pure geometric self-audit rules (zero Revit API dependencies; unit-tested in CoreTests).
internal static class ArchitecturalGeometryAuditRules
{
    public const double MinReportedVerticalGapMm = 10.0;
    public const double MaxReportedVerticalGapMm = 1000.0;
    public const double MinRoofProtrusionMm = 50.0;
    public const double MinWallColumnGapMm = 20.0;
    public const double MaxWallColumnGapMm = 500.0;
    public const double MinWallToWallClearGapMm = 80.0;
    public const double MaxWallToWallClearGapMm = 380.0;
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
        bool hasNativeTopography = false,
        IReadOnlyList<AuditStructuralMemberFamily>? structuralMembers = null,
        IReadOnlyList<AuditOpeningGeometry>? openings = null,
        IReadOnlyList<AuditStairRunMetric>? stairRuns = null)
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
                groundFloorExteriorDoorCount, hasSiteGround, envelopeAndSiteWarnings, structuralMembers, openings, stairRuns);
        }

        return BuildReport(walls, floors, roofs, columns, stairsAndRailings, doorCount, windowCount,
            verticalGaps, roofProtrusions, wallColumnGaps, roofsMissingParapets,
            groundFloorExteriorDoorCount, hasNativeTopography, envelopeAndSiteWarnings, structuralMembers, openings, stairRuns);
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
        List<string> envelopeAndSiteWarnings,
        IReadOnlyList<AuditStructuralMemberFamily>? structuralMembers,
        IReadOnlyList<AuditOpeningGeometry>? openings,
        IReadOnlyList<AuditStairRunMetric>? stairRuns)
    {
        var openingWarnings = new List<string>();
        if (walls.Count >= 20 && doorCount == 0)
            openingWarnings.Add("multi_wall_model_has_zero_doors");
        else if (walls.Count >= 100 && doorCount < Math.Max(5, walls.Count / 40))
            openingWarnings.Add($"low_door_count_relative_to_walls (doors={doorCount}, walls={walls.Count})");

        var (structuralFamilyMismatches, structuralFamilyWarnings) = CheckStructuralFamilyMismatches(structuralMembers);
        var (floatingHostedWalls, openingCollisions) = CheckHostedOpeningAlignment(walls, columns, openings);
        var (isolatedShortStubs, closeParallelWalls) = CheckWallStubsAndDoubleBoxes(walls, columns, openings);
        var wallToWallGaps = CheckWallToWallEndpointGaps(walls, columns);
        var undersizedStairs = CheckStairRunMetrics(stairRuns);

        if (floatingHostedWalls.Count > 0)
            openingWarnings.Add($"floating_hosted_walls_disconnected_at_both_ends (count={floatingHostedWalls.Count})");
        if (openingCollisions.Count > 0)
            openingWarnings.Add($"opening_geometry_collisions_or_overhangs (count={openingCollisions.Count})");
        if (isolatedShortStubs.Count > 0)
            envelopeAndSiteWarnings.Add($"isolated_short_wall_stubs (count={isolatedShortStubs.Count})");
        if (closeParallelWalls.Count > 0)
            envelopeAndSiteWarnings.Add($"close_parallel_double_wall_boxes (count={closeParallelWalls.Count})");
        if (wallToWallGaps.Count > 0)
            envelopeAndSiteWarnings.Add($"wall_to_wall_endpoint_gaps (count={wallToWallGaps.Count})");
        if (undersizedStairs.Count > 0)
            envelopeAndSiteWarnings.Add($"undersized_stair_runs_below_1050mm (count={undersizedStairs.Count})");

        var hasIssues = verticalGaps.Count > 0 || roofProtrusions.Count > 0 || wallColumnGaps.Count > 0 ||
            roofsMissingParapets.Count > 0 || openingWarnings.Count > 0 || envelopeAndSiteWarnings.Count > 0 ||
            structuralFamilyMismatches.Count > 0 || floatingHostedWalls.Count > 0 || openingCollisions.Count > 0 ||
            isolatedShortStubs.Count > 0 || closeParallelWalls.Count > 0 || wallToWallGaps.Count > 0 || undersizedStairs.Count > 0;
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
            structuralFamilyMismatches.Take(MaxFindingsPerKind).ToArray(),
            structuralFamilyMismatches.Count,
            structuralFamilyWarnings.ToArray(),
            floatingHostedWalls.Take(MaxFindingsPerKind).ToArray(),
            floatingHostedWalls.Count,
            openingCollisions.Take(MaxFindingsPerKind).ToArray(),
            openingCollisions.Count,
            isolatedShortStubs.Take(MaxFindingsPerKind).ToArray(),
            isolatedShortStubs.Count,
            closeParallelWalls.Take(MaxFindingsPerKind).ToArray(),
            closeParallelWalls.Count,
            undersizedStairs.Take(MaxFindingsPerKind).ToArray(),
            undersizedStairs.Count,
            wallToWallGaps.Take(MaxFindingsPerKind).ToArray(),
            wallToWallGaps.Count,
            hasIssues);
    }

    private static List<WallToWallEndpointGapFinding> CheckWallToWallEndpointGaps(
        IReadOnlyList<AuditWallGeometry> walls,
        IReadOnlyList<AuditColumnGeometry> columns)
    {
        var findings = new List<WallToWallEndpointGapFinding>();
        if (walls.Count < 2) return findings;
        var fullWalls = walls.Where(w => FiniteWall(w) && (w.TopZMm - w.BaseZMm) > MaxParapetWallHeightMm).ToArray();
        foreach (var w in fullWalls)
        {
            var len = Math.Sqrt((w.EndXMm - w.StartXMm) * (w.EndXMm - w.StartXMm) + (w.EndYMm - w.StartYMm) * (w.EndYMm - w.StartYMm));
            if (len < 200.0) continue;
            foreach (var (endpoint, px, py) in new[] { ("start", w.StartXMm, w.StartYMm), ("end", w.EndXMm, w.EndYMm) })
            {
                var insideColumn = columns.Any(c =>
                    FiniteColumn(c) &&
                    c.TopZMm > w.BaseZMm + 50.0 && c.BaseZMm < w.TopZMm - 50.0 &&
                    Math.Abs(px - c.CenterXMm) <= c.HalfWidthXMm + 150.0 &&
                    Math.Abs(py - c.CenterYMm) <= c.HalfWidthYMm + 150.0);
                if (insideColumn) continue;

                var minClear = double.PositiveInfinity;
                long nearestWallId = -1;
                foreach (var ow in fullWalls)
                {
                    if (ow.ElementId == w.ElementId) continue;
                    if (ow.TopZMm <= w.BaseZMm + 50.0 || ow.BaseZMm >= w.TopZMm - 50.0) continue;
                    var dist = PointToSegmentDistMm(px, py, ow.StartXMm, ow.StartYMm, ow.EndXMm, ow.EndYMm);
                    var halfOther = (double.IsFinite(ow.ThicknessMm) && ow.ThicknessMm > 0 ? ow.ThicknessMm : 200.0) / 2.0;
                    var clear = Math.Max(0.0, dist - halfOther);
                    if (clear < minClear)
                    {
                        minClear = clear;
                        nearestWallId = ow.ElementId;
                    }
                }
                if (nearestWallId > 0 && minClear >= MinWallToWallClearGapMm && minClear <= MaxWallToWallClearGapMm)
                    findings.Add(new WallToWallEndpointGapFinding(w.ElementId, endpoint, nearestWallId, Math.Round(minClear, 1)));
            }
        }
        return findings;
    }

    private static (List<IsolatedShortWallStubFinding> Stubs, List<CloseParallelWallFinding> DoubleWalls) CheckWallStubsAndDoubleBoxes(
        IReadOnlyList<AuditWallGeometry> walls,
        IReadOnlyList<AuditColumnGeometry> columns,
        IReadOnlyList<AuditOpeningGeometry>? openings)
    {
        var stubs = new List<IsolatedShortWallStubFinding>();
        var doubleWalls = new List<CloseParallelWallFinding>();
        if (walls.Count == 0) return (stubs, doubleWalls);

        var hostedWallIds = openings is null
            ? new HashSet<long>()
            : openings.Where(o => o.HostWallId > 0).Select(o => o.HostWallId).ToHashSet();

        var fullWalls = walls.Where(w => FiniteWall(w) && (w.TopZMm - w.BaseZMm) > MaxParapetWallHeightMm).ToArray();

        bool EndpointConnected(AuditWallGeometry target, double px, double py)
        {
            foreach (var ow in fullWalls)
            {
                if (ow.ElementId == target.ElementId) continue;
                if (ow.TopZMm <= target.BaseZMm + 50.0 || ow.BaseZMm >= target.TopZMm - 50.0) continue;
                if (PointToSegmentDistMm(px, py, ow.StartXMm, ow.StartYMm, ow.EndXMm, ow.EndYMm) <= 260.0) return true;
            }
            foreach (var c in columns)
            {
                if (!FiniteColumn(c)) continue;
                if (c.TopZMm <= target.BaseZMm + 50.0 || c.BaseZMm >= target.TopZMm - 50.0) continue;
                if (Math.Abs(px - c.CenterXMm) <= c.HalfWidthXMm + 150.0 && Math.Abs(py - c.CenterYMm) <= c.HalfWidthYMm + 150.0) return true;
            }
            return false;
        }

        // 1. Flag isolated short wall stubs (curtain-wall jamb ticks or column-hanging stubs <= 1200mm with free ends).
        foreach (var w in fullWalls)
        {
            var len = Math.Sqrt((w.EndXMm - w.StartXMm) * (w.EndXMm - w.StartXMm) + (w.EndYMm - w.StartYMm) * (w.EndYMm - w.StartYMm));
            if (len > 1200.0 || len < 1.0) continue;
            var sc = EndpointConnected(w, w.StartXMm, w.StartYMm);
            var ec = EndpointConnected(w, w.EndXMm, w.EndYMm);
            if ((!sc && !ec) || ((!sc || !ec) && len <= 850.0 && !hostedWallIds.Contains(w.ElementId)))
                stubs.Add(new IsolatedShortWallStubFinding(w.ElementId, Math.Round(len, 1), sc, ec));
        }

        // 2. Flag close parallel overlapping full-height walls (220..900mm apart, overlap >= 1000mm) forming accidental double-wall corridor boxes.
        for (int i = 0; i < fullWalls.Length; i++)
        {
            var a = fullWalls[i];
            var adx = a.EndXMm - a.StartXMm; var ady = a.EndYMm - a.StartYMm;
            var alen = Math.Sqrt(adx * adx + ady * ady);
            if (alen < 1000.0) continue;
            var ux = adx / alen; var uy = ady / alen;
            for (int j = i + 1; j < fullWalls.Length; j++)
            {
                var b = fullWalls[j];
                if (b.TopZMm <= a.BaseZMm + 50.0 || b.BaseZMm >= a.TopZMm - 50.0) continue;
                var bdx = b.EndXMm - b.StartXMm; var bdy = b.EndYMm - b.StartYMm;
                var blen = Math.Sqrt(bdx * bdx + bdy * bdy);
                if (blen < 1000.0) continue;
                if (Math.Abs((bdx / blen) * ux + (bdy / blen) * uy) < 0.995) continue;
                var perp = Math.Abs((b.StartXMm - a.StartXMm) * (-uy) + (b.StartYMm - a.StartYMm) * ux);
                if (perp < 220.0 || perp > 900.0) continue;
                var b0 = (b.StartXMm - a.StartXMm) * ux + (b.StartYMm - a.StartYMm) * uy;
                var b1 = (b.EndXMm - a.StartXMm) * ux + (b.EndYMm - a.StartYMm) * uy;
                var ov = Math.Min(alen, Math.Max(b0, b1)) - Math.Max(0.0, Math.Min(b0, b1));
                if (ov >= 1000.0 && (hostedWallIds.Contains(a.ElementId) || hostedWallIds.Contains(b.ElementId)))
                    doubleWalls.Add(new CloseParallelWallFinding(a.ElementId, b.ElementId, Math.Round(perp, 1), Math.Round(ov, 1)));
            }
        }
        return (stubs, doubleWalls);
    }

    private static List<UndersizedStairFinding> CheckStairRunMetrics(IReadOnlyList<AuditStairRunMetric>? stairRuns)
    {
        var findings = new List<UndersizedStairFinding>();
        if (stairRuns is null || stairRuns.Count == 0) return findings;
        foreach (var r in stairRuns)
        {
            if (!double.IsFinite(r.RunWidthMm) || r.RunWidthMm <= 0) continue;
            if (r.RunWidthMm < 1050.0)
                findings.Add(new UndersizedStairFinding(r.StairId, r.RunId, Math.Round(r.RunWidthMm, 1), Math.Round(r.TreadDepthMm, 1), "stair_run_width_below_1050mm_verify_against_cad"));
        }
        return findings;
    }

    private static (List<FloatingHostedWallFinding> FloatingWalls, List<OpeningCollisionFinding> Collisions) CheckHostedOpeningAlignment(
        IReadOnlyList<AuditWallGeometry> walls,
        IReadOnlyList<AuditColumnGeometry> columns,
        IReadOnlyList<AuditOpeningGeometry>? openings)
    {
        var floatingWalls = new List<FloatingHostedWallFinding>();
        var collisions = new List<OpeningCollisionFinding>();
        if (openings is null || openings.Count == 0 || walls.Count == 0) return (floatingWalls, collisions);

        var wallById = walls.Where(FiniteWall).ToDictionary(w => w.ElementId);
        var byHost = openings.Where(o => o.HostWallId > 0 && double.IsFinite(o.XMm) && double.IsFinite(o.YMm) && double.IsFinite(o.WidthMm) && o.WidthMm > 0)
            .GroupBy(o => o.HostWallId);

        foreach (var group in byHost)
        {
            if (!wallById.TryGetValue(group.Key, out var host)) continue;
            var dx = host.EndXMm - host.StartXMm;
            var dy = host.EndYMm - host.StartYMm;
            var len = Math.Sqrt(dx * dx + dy * dy);
            if (len < 1.0) continue;
            var ux = dx / len;
            var uy = dy / len;

            // 1. Check whether BOTH endpoints of this hosted wall float disconnected in mid-air.
            bool IsConnected(double px, double py)
            {
                foreach (var ow in walls)
                {
                    if (ow.ElementId == host.ElementId || !FiniteWall(ow)) continue;
                    if (ow.TopZMm <= host.BaseZMm + 50.0 || ow.BaseZMm >= host.TopZMm - 50.0) continue;
                    if (PointToSegmentDistMm(px, py, ow.StartXMm, ow.StartYMm, ow.EndXMm, ow.EndYMm) <= 260.0) return true;
                }
                foreach (var c in columns)
                {
                    if (!FiniteColumn(c)) continue;
                    if (c.TopZMm <= host.BaseZMm + 50.0 || c.BaseZMm >= host.TopZMm - 50.0) continue;
                    if (Math.Abs(px - c.CenterXMm) <= c.HalfWidthXMm + 150.0 && Math.Abs(py - c.CenterYMm) <= c.HalfWidthYMm + 150.0) return true;
                }
                return false;
            }
            if (!IsConnected(host.StartXMm, host.StartYMm) && !IsConnected(host.EndXMm, host.EndYMm))
                floatingWalls.Add(new FloatingHostedWallFinding(host.ElementId, group.Count(), Math.Round(len, 1)));

            // 2. Check each opening on this host wall for overhang, column overlap, or perpendicular wall collision.
            foreach (var op in group)
            {
                var pos = (op.XMm - host.StartXMm) * ux + (op.YMm - host.StartYMm) * uy;
                var lo = pos - op.WidthMm * 0.5;
                var hi = pos + op.WidthMm * 0.5;
                if (lo < -50.0 || hi > len + 50.0)
                {
                    var over = Math.Max(-lo, hi - len);
                    collisions.Add(new OpeningCollisionFinding(op.ElementId, op.Category, host.ElementId, host.ElementId, "opening_exceeds_host_wall_end", Math.Round(over, 1)));
                }
                foreach (var col in columns)
                {
                    if (!FiniteColumn(col)) continue;
                    if (col.TopZMm <= host.BaseZMm + 50.0 || col.BaseZMm >= host.TopZMm - 50.0) continue;
                    var perp = Math.Abs((col.CenterXMm - host.StartXMm) * (-uy) + (col.CenterYMm - host.StartYMm) * ux);
                    var colPerpHalf = Math.Abs(uy) * col.HalfWidthXMm + Math.Abs(ux) * col.HalfWidthYMm;
                    if (perp > colPerpHalf + host.ThicknessMm * 0.5 + 20.0) continue;
                    var colAlong = (col.CenterXMm - host.StartXMm) * ux + (col.CenterYMm - host.StartYMm) * uy;
                    var colAlongHalf = Math.Abs(ux) * col.HalfWidthXMm + Math.Abs(uy) * col.HalfWidthYMm;
                    var overlap = Math.Min(hi, colAlong + colAlongHalf) - Math.Max(lo, colAlong - colAlongHalf);
                    if (overlap > 50.0)
                        collisions.Add(new OpeningCollisionFinding(op.ElementId, op.Category, host.ElementId, col.ElementId, "opening_overlaps_column", Math.Round(overlap, 1)));
                }
                foreach (var ow in walls)
                {
                    if (ow.ElementId == host.ElementId || !FiniteWall(ow)) continue;
                    if (ow.TopZMm <= host.BaseZMm + 50.0 || ow.BaseZMm >= host.TopZMm - 50.0) continue;
                    var odx = ow.EndXMm - ow.StartXMm;
                    var ody = ow.EndYMm - ow.StartYMm;
                    var olen = Math.Sqrt(odx * odx + ody * ody);
                    if (olen < 1.0) continue;
                    if (Math.Abs((odx / olen) * ux + (ody / olen) * uy) > 0.3) continue; // perpendicular walls only
                    foreach (var (epx, epy) in new[] { (ow.StartXMm, ow.StartYMm), (ow.EndXMm, ow.EndYMm) })
                    {
                        var perp = Math.Abs((epx - host.StartXMm) * (-uy) + (epy - host.StartYMm) * ux);
                        if (perp <= host.ThicknessMm * 0.5 + 150.0)
                        {
                            var along = (epx - host.StartXMm) * ux + (epy - host.StartYMm) * uy;
                            if (along > lo + 40.0 && along < hi - 40.0)
                            {
                                var pen = Math.Min(along - lo, hi - along);
                                collisions.Add(new OpeningCollisionFinding(op.ElementId, op.Category, host.ElementId, ow.ElementId, "opening_overlaps_perpendicular_wall", Math.Round(pen, 1)));
                                break;
                            }
                        }
                    }
                }
            }
        }
        return (floatingWalls, collisions);
    }

    private static double PointToSegmentDistMm(double px, double py, double ax, double ay, double bx, double by)
    {
        var dx = bx - ax; var dy = by - ay;
        var len2 = dx * dx + dy * dy;
        if (len2 < 1e-9) return Math.Sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
        var t = Math.Max(0.0, Math.Min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2));
        var cx = ax + t * dx; var cy = ay + t * dy;
        return Math.Sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    }

    private static readonly string[] SteelTemplateFamilyMarkers =
    [
        "UC-", "UB-", "热轧H型钢", "H型钢", "Wide Flange", "W-Wide", "I-Beam",
        "Universal Column", "Universal Beam", "M_W-Wide", "H-Section"
    ];

    private static readonly string[] ExplicitSteelTypeMarkers =
    [
        "STEEL", "钢", "GJ", "GL", "GZ_STEEL", "HM", "HN", "HW", "TC", "SC", "CRANE", "SHED", "MAST", "塔吊", "钢柱", "钢梁"
    ];

    private static readonly string[] ConcreteMemberTypePrefixes =
    [
        "KZ", "GZ", "TZ", "XZ", "Z_", "KL", "WKL", "JKL", "JL", "LL", "DL", "QL", "L_", "RC_", "CONCRETE", "混凝土", "砼"
    ];

    private static (List<StructuralFamilyMismatchFinding> Findings, List<string> Warnings) CheckStructuralFamilyMismatches(
        IReadOnlyList<AuditStructuralMemberFamily>? members)
    {
        var findings = new List<StructuralFamilyMismatchFinding>();
        var warnings = new List<string>();
        if (members is null || members.Count == 0) return (findings, warnings);

        foreach (var member in members)
        {
            var family = (member.FamilyName ?? string.Empty).Trim();
            var typeName = (member.TypeName ?? string.Empty).Trim();
            if (family.Length == 0 || typeName.Length == 0) continue;

            var isSteelTemplateFamily = SteelTemplateFamilyMarkers.Any(m =>
                family.Contains(m, StringComparison.OrdinalIgnoreCase));
            if (!isSteelTemplateFamily) continue;

            var upperType = typeName.ToUpperInvariant();
            if (ExplicitSteelTypeMarkers.Any(m => upperType.Contains(m, StringComparison.OrdinalIgnoreCase)))
                continue;

            var looksLikeConcreteMember = ConcreteMemberTypePrefixes.Any(p =>
                upperType.StartsWith(p, StringComparison.OrdinalIgnoreCase) ||
                upperType.Contains("混凝土", StringComparison.OrdinalIgnoreCase) ||
                upperType.Contains("CONCRETE", StringComparison.OrdinalIgnoreCase) ||
                upperType.Contains("砼", StringComparison.OrdinalIgnoreCase));

            if (looksLikeConcreteMember)
            {
                findings.Add(new StructuralFamilyMismatchFinding(
                    member.ElementId, member.Category, family, typeName,
                    "steel_template_family_used_for_concrete_member"));
            }
        }

        if (findings.Count > 0)
        {
            var grouped = findings
                .GroupBy(f => $"{f.Category}:{f.FamilyName}")
                .Select(g => $"{g.Key} (count={g.Count()})")
                .ToArray();
            warnings.Add($"steel_template_family_mismatch_on_concrete_members: {string.Join(", ", grouped)} — load true rectangular concrete families (e.g. 混凝土-矩形-柱 / 混凝土-矩形梁) matching CAD drawings instead of Revit template default steel families.");
        }

        return (findings, warnings);
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
