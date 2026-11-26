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

        test("geometry audit flags template H-steel families misused for concrete columns/beams and passes true concrete or genuine steel members", () =>
        {
            var mismatchedMembers = new AuditStructuralMemberFamily[]
            {
                new(1001, "OST_StructuralColumns", "UC-普通柱-柱", "KZ_700x700"),
                new(1002, "OST_StructuralFraming", "热轧H型钢", "KL_350x750"),
                new(1003, "OST_StructuralFraming", "热轧H型钢", "JL_500x1050"),
                new(1004, "OST_StructuralFraming", "M_W-Wide Flange", "L_200x400")
            };
            var bad = ArchitecturalGeometryAuditRules.Analyze([], [], [], [], 0, 0, null, false, mismatchedMembers);
            if (bad.StructuralFamilyMismatchTotalCount != 4 || !bad.HasIssues || bad.StructuralFamilyWarnings.Length == 0)
                throw new Exception($"Expected 4 structural family mismatches, got {bad.StructuralFamilyMismatchTotalCount}.");

            var validMembers = new AuditStructuralMemberFamily[]
            {
                new(2001, "OST_StructuralColumns", "混凝土-矩形-柱", "KZ_700x700_混凝土"),
                new(2002, "OST_StructuralFraming", "混凝土-矩形梁", "KL_350x750_混凝土"),
                new(2003, "OST_StructuralFraming", "热轧H型钢", "HM300x200x8x12"),
                new(2004, "OST_StructuralColumns", "UC-普通柱-柱", "GJ_H400x400"),
                new(2005, "OST_StructuralColumns", "UC-普通柱-柱", "TC6013_Crane_Mast")
            };
            var good = ArchitecturalGeometryAuditRules.Analyze([], [], [], [], 0, 0, null, false, validMembers);
            if (good.StructuralFamilyMismatchTotalCount != 0 || good.HasIssues)
                throw new Exception($"Expected 0 structural family mismatches for valid concrete/steel members, got {good.StructuralFamilyMismatchTotalCount}.");
        });

        test("geometry audit flags floating alcove door-host walls and opening collisions with columns/perpendicular walls", () =>
        {
            // Reproduce recessed door alcove missing both 1000mm side return walls + a door colliding with a perpendicular wall
            var floatingAlcoveWall = new AuditWallGeometry(3001, 1, 0, 4050, 200, 52050, 43950, 55950, 43950);
            var corridorLeft = new AuditWallGeometry(3002, 1, 0, 4050, 200, 36050, 42950, 51950, 42950);
            var corridorRight = new AuditWallGeometry(3003, 1, 0, 4050, 200, 56050, 42950, 65050, 42950);
            var collidingPerp = new AuditWallGeometry(3004, 1, 0, 4050, 200, 53200, 43950, 53200, 50400);
            var door1 = new AuditOpeningGeometry(4001, "OST_Doors", 3001, 0, 53000, 43950, 1100);
            var door2 = new AuditOpeningGeometry(4002, "OST_Doors", 3001, 0, 55000, 43950, 1100);

            var broken = ArchitecturalGeometryAuditRules.Analyze(
                [floatingAlcoveWall, corridorLeft, corridorRight, collidingPerp], [], [], [], 2, 0, null, false, null, [door1, door2]);
            if (broken.FloatingHostedWallTotalCount != 1)
                throw new Exception($"Expected 1 floating hosted wall, got {broken.FloatingHostedWallTotalCount}.");
            if (broken.OpeningCollisionTotalCount != 1 || broken.OpeningCollisions[0].Reason != "opening_overlaps_perpendicular_wall")
                throw new Exception($"Expected 1 perpendicular-wall opening collision, got {broken.OpeningCollisionTotalCount}.");

            // Now add both 1000mm return walls and move the perpendicular partition wall to clean center X=54100
            var returnLeft = new AuditWallGeometry(3005, 1, 0, 4050, 200, 51950, 42950, 51950, 43950);
            var returnRight = new AuditWallGeometry(3006, 1, 0, 4050, 200, 56050, 42950, 56050, 43950);
            var cleanPerp = new AuditWallGeometry(3007, 1, 0, 4050, 200, 54100, 43950, 54100, 50400);
            var fixedAlcove = new AuditWallGeometry(3001, 1, 0, 4050, 200, 51950, 43950, 56050, 43950);

            var clean = ArchitecturalGeometryAuditRules.Analyze(
                [fixedAlcove, corridorLeft, corridorRight, returnLeft, returnRight, cleanPerp], [], [], [], 2, 0, null, false, null, [door1, door2]);
            if (clean.FloatingHostedWallTotalCount != 0 || clean.OpeningCollisionTotalCount != 0 || clean.HasIssues)
                throw new Exception($"Expected clean closed alcove, got float={clean.FloatingHostedWallTotalCount}, collisions={clean.OpeningCollisionTotalCount}.");
        });

        test("geometry audit flags isolated short wall stubs, double-wall corridor boxes, and undersized stairs", () =>
        {
            var floatingStub = new AuditWallGeometry(5001, 1, 0, 4050, 200, 32000, 40350, 32900, 40350);
            var hangingColStub = new AuditWallGeometry(5002, 1, 0, 4050, 200, 20500, 33600, 21200, 33600);
            var col = new AuditColumnGeometry(5099, 0, 4050, 21600, 33600, 350, 350);
            var corridorMain = new AuditWallGeometry(5003, 1, 0, 4050, 200, 10800, 8000, 10800, 25000);
            var corridorRecess = new AuditWallGeometry(5004, 1, 0, 4050, 200, 11550, 12000, 11550, 18000);
            var doorOnRecess = new AuditOpeningGeometry(5050, "OST_Doors", 5004, 0, 11550, 15000, 1100);
            var toyStair = new AuditStairRunMetric(6001, 6002, 1000, 250);

            var bad = ArchitecturalGeometryAuditRules.Analyze(
                [floatingStub, hangingColStub, corridorMain, corridorRecess], [], [col], [], 1, 0, null, false, null, [doorOnRecess], [toyStair]);
            if (bad.IsolatedShortWallStubTotalCount != 2)
                throw new Exception($"Expected 2 isolated short wall stubs, got {bad.IsolatedShortWallStubTotalCount}.");
            if (bad.CloseParallelOverlappingWallTotalCount != 1)
                throw new Exception($"Expected 1 close parallel double-wall box, got {bad.CloseParallelOverlappingWallTotalCount}.");
            if (bad.UndersizedStairTotalCount != 1)
                throw new Exception($"Expected 1 undersized stair run, got {bad.UndersizedStairTotalCount}.");

            var properStair = new AuditStairRunMetric(6001, 6002, 1830, 280);
            var clean = ArchitecturalGeometryAuditRules.Analyze([], [], [], [], 0, 0, null, false, null, null, [properStair]);
            if (clean.UndersizedStairTotalCount != 0 || clean.HasIssues)
                throw new Exception("Expected CAD-width 1830mm stair run to pass cleanly.");
        });

        test("geometry audit flags disconnected wall-to-wall Z-jog endpoint gaps (80..380mm) and passes closed corners", () =>
        {
            var topCorridor = new AuditWallGeometry(7001, 1, 0, 4050, 200, 2000, 37700, 8050, 37700);
            var doorJamb = new AuditWallGeometry(7002, 1, 0, 4050, 200, 6950, 35300, 6950, 37700);
            var shaftWest = new AuditWallGeometry(7003, 1, 0, 4050, 200, 7250, 31800, 7250, 35400);
            var shaftEast = new AuditWallGeometry(7004, 1, 0, 4050, 200, 7950, 24700, 7950, 35400);
            var shortCap = new AuditWallGeometry(7005, 1, 0, 4050, 200, 7350, 35300, 7850, 35300);

            var bad = ArchitecturalGeometryAuditRules.Analyze([topCorridor, doorJamb, shaftWest, shaftEast, shortCap], [], [], [], 1, 0);
            if (bad.WallToWallEndpointGapTotalCount != 1 || bad.WallToWallEndpointGaps[0].WallId != 7002 || bad.WallToWallEndpointGaps[0].ClearGapMm != 200.0)
                throw new Exception($"Expected 1 wall-to-wall gap (200mm on wall 7002), got count={bad.WallToWallEndpointGapTotalCount}.");

            // Connect the cap continuously from X=6950 to X=7950
            var fullCap = new AuditWallGeometry(7005, 1, 0, 4050, 200, 6950, 35300, 7950, 35300);
            var clean = ArchitecturalGeometryAuditRules.Analyze([topCorridor, doorJamb, shaftWest, shaftEast, fullCap], [], [], [], 1, 0);
            if (clean.WallToWallEndpointGapTotalCount != 0 || clean.HasIssues)
                throw new Exception($"Expected 0 wall-to-wall gaps after closing Z-jog, got {clean.WallToWallEndpointGapTotalCount}.");
        });

        test("geometry audit detects uncovered structural beams, uncapped rooftop enclosures, and interior partition walls exposed on roofs/perimeters", () =>
        {
            var podiumRoof = new AuditHorizontalSurface(8001, "Roof", 3, 9900, 10233, 0, 0, 30000, 20000);
            var mainParapet = new AuditWallGeometry(8002, 3, 9900, 11100, 200, 0, 0, 30000, 0, "Generic - 200mm");
            var coveredBeam = new AuditBeamGeometry(8101, 2000, 10000, 8000, 10000, 9900, "Concrete_350x750");
            var exposedBeam = new AuditBeamGeometry(8102, 2000, 24000, 8000, 24000, 9900, "Concrete_350x750");

            // Uncapped rooftop exhaust shaft using interior partition wall type
            var shaftWalls = new AuditWallGeometry[]
            {
                new(8201, 3, 9900, 11900, 100, 10000, 10000, 11000, 10000, "Interior - Partition 100mm"),
                new(8202, 3, 9900, 11900, 100, 11000, 10000, 11000, 12000, "Interior - Partition 100mm"),
                new(8203, 3, 9900, 11900, 100, 11000, 12000, 10000, 12000, "Interior - Partition 100mm"),
                new(8204, 3, 9900, 11900, 100, 10000, 12000, 10000, 10000, "Interior - Partition 100mm")
            };

            var bad = ArchitecturalGeometryAuditRules.Analyze(
                [mainParapet, .. shaftWalls], [podiumRoof], [], [], 2, 2,
                null, true, null, null, null, [coveredBeam, exposedBeam]);
            if (bad.UncoveredStructuralBeamTotalCount != 1 || bad.UncoveredStructuralBeams[0].BeamId != 8102)
                throw new Exception($"Expected 1 uncovered beam (8102), got {bad.UncoveredStructuralBeamTotalCount}.");
            if (bad.UncappedRooftopEnclosureTotalCount != 1)
                throw new Exception($"Expected 1 uncapped rooftop enclosure, got {bad.UncappedRooftopEnclosureTotalCount}.");
            if (bad.ExteriorInteriorPartitionWallTotalCount != 4)
                throw new Exception($"Expected 4 exposed interior partition walls on rooftop, got {bad.ExteriorInteriorPartitionWallTotalCount}.");

            // Fix: extend roof over beam 8102, cap shaft at 11900, replace shaft walls with exterior/generic 200mm walls
            var extendedRoof = new AuditHorizontalSurface(8001, "Roof", 3, 9900, 10233, 0, 0, 30000, 26000);
            var shaftCap = new AuditHorizontalSurface(8009, "Floor", 3, 11750, 11900, 9900, 9900, 11100, 12100);
            var fixedShaftWalls = shaftWalls.Select(w => w with { ThicknessMm = 200, TypeName = "Generic - 200mm" }).ToArray();
            var clean = ArchitecturalGeometryAuditRules.Analyze(
                [mainParapet, .. fixedShaftWalls], [extendedRoof, shaftCap], [], [], 2, 2,
                null, true, null, null, null, [coveredBeam, exposedBeam]);
            if (clean.UncoveredStructuralBeamTotalCount != 0 ||
                clean.UncappedRooftopEnclosureTotalCount != 0 ||
                clean.ExteriorInteriorPartitionWallTotalCount != 0 ||
                clean.HasIssues)
            {
                throw new Exception($"Expected 0 blind-spot issues after fixes, got beams={clean.UncoveredStructuralBeamTotalCount}, uncapped={clean.UncappedRooftopEnclosureTotalCount}, extInt={clean.ExteriorInteriorPartitionWallTotalCount}.");
            }
        });
    }
}
