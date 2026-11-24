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

            var swRailing = new AuditStairOrRailingGeometry(401, "OST_StairsRailing", 900, 2100, 30150, 3100, 5650, 35300);
            var ncRailing = new AuditStairOrRailingGeometry(402, "OST_StairsRailing", 26900, 47850, 30150, 30450, 50050, 35300);

            var report = ArchitecturalGeometryAuditRules.Analyze([], [mainRoof, penthouseRoof], [], [swRailing, ncRailing], 5, 5);
            if (report.StairsOrRailingsExceedingRoofTotalCount != 1)
                throw new Exception($"Expected 1 roof protrusion, got {report.StairsOrRailingsExceedingRoofTotalCount}");
            if (report.StairsOrRailingsExceedingRoof[0].ElementId != 401)
                throw new Exception("Expected SW railing 401 to be flagged and NC penthouse railing 402 to pass.");
        });

        test("geometry audit detects wall endpoints stopping short of nearby columns and passes connected walls", () =>
        {
            var col = new AuditColumnGeometry(501, 0, 4050, 10800, 0, 350, 350);
            var gappedWall = new AuditWallGeometry(601, 1, 0, 4050, 200, 450, 0, 10350, 0);
            var connectedWall = new AuditWallGeometry(602, 1, 0, 4050, 200, 0, 0, 21600, 0);

            var report = ArchitecturalGeometryAuditRules.Analyze([gappedWall, connectedWall], [], [col], [], 5, 5);
            if (report.WallColumnEndpointGapTotalCount != 1 || report.WallColumnEndpointGaps[0].WallId != 601 || Math.Abs(report.WallColumnEndpointGaps[0].GapMm - 100) > 0.01)
                throw new Exception("Expected single 100mm wall-column gap on wall 601.");
        });

        test("geometry audit flags missing roof parapets, missing ground-floor exterior entrance doors, and missing site ground", () =>
        {
            var walls = new List<AuditWallGeometry>
            {
                new(1, 1, 0, 5100, 200, 0, 0, 64800, 0),
                new(2, 1, 0, 5100, 200, 64800, 0, 64800, 50400),
                new(3, 1, 0, 5100, 200, 64800, 50400, 0, 50400),
                new(4, 1, 0, 5100, 200, 0, 50400, 0, 0)
            };
            for (int i = 5; i <= 24; i++)
                walls.Add(new(i, 1, 0, 5100, 200, 10000 + i * 1000, 10000, 10000 + i * 1000, 20000));

            var roof = new AuditHorizontalSurface(701, "Roof", 2, 5100, 5433, 0, 0, 64800, 50400);
            var interiorOnlyDoor = new AuditDoorGeometry(801, 5, 0, 25000, 25000);

            var missingAll = ArchitecturalGeometryAuditRules.Analyze(walls, [roof], [], [], 1, 10, [interiorOnlyDoor], false);
            if (missingAll.RoofsMissingParapetsTotalCount != 1) throw new Exception("Expected missing parapet on roof 701.");
            if (!missingAll.EnvelopeAndSiteWarnings.Contains("ground_floor_missing_exterior_entrance_door"))
                throw new Exception("Expected ground_floor_missing_exterior_entrance_door warning.");
            if (!missingAll.EnvelopeAndSiteWarnings.Contains("missing_site_ground_or_terrain"))
                throw new Exception("Expected missing_site_ground_or_terrain warning.");

            // Now add parapet wall, recessed ground-floor main entrance door (2.5m inside east facade), and site ground slab.
            walls.Add(new(901, 2, 5100, 6300, 200, 0, 0, 64800, 0));
            var recessedMainDoor = new AuditDoorGeometry(802, 2, 0, 62300, 36600);
            var siteSlab = new AuditHorizontalSurface(702, "Floor", 0, -825, -600, -20000, -20000, 90000, 0);

            var complete = ArchitecturalGeometryAuditRules.Analyze(walls, [roof, siteSlab], [], [], 2, 10, [interiorOnlyDoor, recessedMainDoor], false);
            if (complete.RoofsMissingParapetsTotalCount != 0) throw new Exception("Parapet should clear RoofsMissingParapets.");
            if (complete.GroundFloorExteriorDoorCount != 1) throw new Exception("Recessed east entrance door should count as ground-floor exterior entrance door.");
            if (!complete.HasSiteGround) throw new Exception("Exterior site slab should set HasSiteGround == true.");
            if (complete.HasIssues) throw new Exception("Complete model should report HasIssues == false.");
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
