using RevitAutoV27;

internal static class ArchitecturalGeometryAuditRulesTests
{
    public static void Run(Action<string, Action> test)
    {
        test("geometry audit detects wall-to-floor and wall-to-roof vertical gaps and passes full-height walls", () =>
        {
            var gappedWall = new AuditWallGeometry(101, 1, 0, 3750, 200, 0, 0, 10000, 0);
            var fullWall = new AuditWallGeometry(102, 1, 0, 4050, 200, 0, 5000, 10000, 5000);
            var upperFloor = new AuditHorizontalSurface(201, "Floor", 2, 3900, 4050, -100, -100, 12000, 6000);
            var roofWallGap = new AuditWallGeometry(103, 2, 4050, 7800, 200, 0, 0, 10000, 0);
            var roofAbove = new AuditHorizontalSurface(202, "Roof", 3, 8100, 8400, -100, -100, 12000, 6000);

            var report = ArchitecturalGeometryAuditRules.Analyze(
                [gappedWall, fullWall, roofWallGap], [upperFloor, roofAbove], [], [], 10, 10);

            if (report.WallVerticalGapTotalCount != 2) throw new Exception($"Expected 2 vertical gaps, got {report.WallVerticalGapTotalCount}");
            if (!report.WallVerticalGaps.Any(g => g.WallId == 101 && g.TargetKind == "Floor" && Math.Abs(g.GapMm - 150) < 0.01))
                throw new Exception("Expected 150mm floor gap on wall 101.");
            if (!report.WallVerticalGaps.Any(g => g.WallId == 103 && g.TargetKind == "Roof" && Math.Abs(g.GapMm - 300) < 0.01))
                throw new Exception("Expected 300mm roof gap on wall 103.");
            if (report.WallVerticalGaps.Any(g => g.WallId == 102))
                throw new Exception("Full-height wall 102 should not be flagged.");
        });

        test("geometry audit flags stair railings protruding through exposed roofs but allows penthouse-covered stairs", () =>
        {
            var mainRoof = new AuditHorizontalSurface(301, "Roof", 9, 34200, 34500, 0, 0, 36000, 50400);
            var penthouseRoof = new AuditHorizontalSurface(302, "Roof", 10, 39050, 39350, 21600, 43200, 32400, 50400);

            // Exposed SW railing sticking 1100mm above main roof (no penthouse covering it)
            var swRailing = new AuditStairOrRailingGeometry(401, "OST_StairsRailing", 900, 2100, 30150, 3100, 5650, 35300);
            // NC stair railing reaching 35300mm INSIDE the penthouse (covered by penthouseRoof at 39350mm)
            var ncRailing = new AuditStairOrRailingGeometry(402, "OST_StairsRailing", 26900, 47850, 30150, 30450, 50050, 35300);

            var report = ArchitecturalGeometryAuditRules.Analyze([], [mainRoof, penthouseRoof], [], [swRailing, ncRailing], 5, 5);
            if (report.StairsOrRailingsExceedingRoofTotalCount != 1)
                throw new Exception($"Expected 1 roof protrusion, got {report.StairsOrRailingsExceedingRoofTotalCount}");
            if (report.StairsOrRailingsExceedingRoof[0].ElementId != 401)
                throw new Exception("Expected SW railing 401 to be flagged and NC penthouse railing 402 to pass.");
        });

        test("geometry audit detects wall endpoints stopping short of nearby columns and passes connected walls", () =>
        {
            var col = new AuditColumnGeometry(501, 0, 4050, 10800, 0, 350, 350); // face at X=10450..11150
            var gappedWall = new AuditWallGeometry(601, 1, 0, 4050, 200, 450, 0, 10350, 0); // 100mm gap to col face at 10450
            var connectedWall = new AuditWallGeometry(602, 1, 0, 4050, 200, 0, 0, 21600, 0); // passes straight through column

            var report = ArchitecturalGeometryAuditRules.Analyze([gappedWall, connectedWall], [], [col], [], 5, 5);
            if (report.WallColumnEndpointGapTotalCount != 1 || report.WallColumnEndpointGaps[0].WallId != 601 || Math.Abs(report.WallColumnEndpointGaps[0].GapMm - 100) > 0.01)
                throw new Exception("Expected single 100mm wall-column gap on wall 601.");
        });

        test("geometry audit flags multi-wall models with zero doors and reports clean model as issue-free", () =>
        {
            var walls = Enumerable.Range(1, 25).Select(i => new AuditWallGeometry(i, 1, 0, 4000, 200, i * 1000, 0, i * 1000, 3000)).ToArray();
            var zeroDoors = ArchitecturalGeometryAuditRules.Analyze(walls, [], [], [], 0, 10);
            if (!zeroDoors.HasIssues || !zeroDoors.OpeningWarnings.Contains("multi_wall_model_has_zero_doors"))
                throw new Exception("Expected multi_wall_model_has_zero_doors warning.");

            var clean = ArchitecturalGeometryAuditRules.Analyze(walls, [], [], [], 15, 20);
            if (clean.HasIssues) throw new Exception("Expected clean model to report HasIssues == false.");
        });
    }
}
