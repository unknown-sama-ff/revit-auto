using System.Text.Json;
using RevitAutoV27;

internal static class CadAndJoinUpgradeTests
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    public static void Run(Action<string, Action> test)
    {
        test("GeometryJoinRules validates join/unjoin/switch_order and rejects same or unknown targets", () =>
        {
            var g1 = GeometryJoinRules.Validate(Parse("""{"operationType":"join_geometry","firstElementId":10,"secondElementId":20}"""));
            if (g1.Action != "join" || !g1.IgnoreAlreadyJoined || g1.FirstId != 10 || g1.SecondId != 20)
                throw new Exception("Unexpected defaults for join_geometry.");

            var g2 = GeometryJoinRules.Validate(Parse("""{"operationType":"join_geometry","firstElementId":"@wall1","secondElementId":"@col1","action":"switch_order","ignoreAlreadyJoined":false}"""));
            if (g2.Action != "switch_order" || g2.IgnoreAlreadyJoined)
                throw new Exception("Unexpected explicit join_geometry fields.");

            foreach (var bad in new[]
            {
                """{"operationType":"join_geometry","firstElementId":10,"secondElementId":10}""",
                """{"operationType":"join_geometry","firstElementId":"@w1","secondElementId":"@w1"}""",
                """{"operationType":"join_geometry","firstElementId":10,"secondElementId":20,"action":"merge"}""",
                """{"operationType":"join_geometry","firstElementId":10,"secondElementId":20,"ignoreAlreadyJoined":"yes"}""",
                """{"operationType":"join_geometry","firstElementId":10,"secondElementId":20,"extra":1}"""
            })
            {
                try { GeometryJoinRules.Validate(Parse(bad)); throw new Exception("Expected rejection: " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_geometry_join") { }
            }
        });

        test("GeometryJoinRules readback enforces post-join state and cut order flip", () =>
        {
            GeometryJoinRules.Require(new(10, 20, "join", false, true, null, true, false));
            GeometryJoinRules.Require(new(10, 20, "unjoin", true, false, true, null, false));
            GeometryJoinRules.Require(new(10, 20, "switch_order", true, true, true, false, false));

            foreach (var bad in new[]
            {
                new GeometryJoinReadback(10, 20, "join", false, false, null, null, false),
                new GeometryJoinReadback(10, 20, "unjoin", true, true, true, true, false),
                new GeometryJoinReadback(10, 20, "switch_order", true, true, true, true, false)
            })
            {
                try { GeometryJoinRules.Require(bad); throw new Exception("Expected readback failure."); }
                catch (BridgeException ex) when (ex.Code == "invalid_geometry_join") { }
            }
        });

        test("PlanRules supports per-end wall and beam disallowJoin plus join_geometry references", () =>
        {
            var plan = Parse("""
            [
              {"operationType":"create_wall","id":"w1","wallTypeId":100,"levelId":1,"heightMm":3000,"start":{"xMm":0,"yMm":0},"end":{"xMm":6000,"yMm":0},"disallowJoinStart":true,"disallowJoinEnd":false,"joinTypeEnd":"miter"},
              {"operationType":"create_wall","id":"w2","wallTypeId":100,"levelId":1,"heightMm":3000,"start":{"xMm":6000,"yMm":0},"end":{"xMm":6000,"yMm":4000},"joinTypeStart":"miter"},
              {"operationType":"create_structural_beam","id":"b1","symbolId":50,"levelId":1,"start":{"xMm":0,"yMm":0,"zMm":3000},"end":{"xMm":6000,"yMm":0,"zMm":3000},"disallowJoinStart":true,"disallowJoinEnd":false},
              {"operationType":"join_geometry","firstElementId":"@w1","secondElementId":"@w2","action":"join"}
            ]
            """);
            var ops = PlanRules.Validate(plan);
            if (ops.Count != 4) throw new Exception("Expected 4 valid operations.");

            var (d0, d1) = GeometryJoinRules.ResolveEndDisallow(ops[0]);
            if (!d0 || d1) throw new Exception("Expected start disallowed and end allowed.");

            try
            {
                PlanRules.Validate(Parse("""[{"operationType":"create_wall","wallTypeId":100,"levelId":1,"heightMm":3000,"start":{"xMm":0,"yMm":0},"end":{"xMm":1000,"yMm":0},"joinTypeStart":"invalid"}]"""));
                throw new Exception("Expected invalid joinTypeStart rejection.");
            }
            catch (BridgeException ex) when (ex.Code == "invalid_operation") { }
        });

        test("WallTopologyOrderRules orders structural and join-enabled long walls before short stubs without breaking dependencies", () =>
        {
            var ops = PlanRules.Validate(Parse("""
            [
              {"operationType":"create_level","id":"L1","name":"1F","elevationMm":0},
              {"operationType":"create_wall","id":"stub","wallTypeId":1,"levelId":"@L1","heightMm":3000,"start":{"xMm":0,"yMm":0},"end":{"xMm":600,"yMm":0},"disallowJoin":true},
              {"operationType":"create_wall","id":"part","wallTypeId":1,"levelId":"@L1","heightMm":3000,"start":{"xMm":0,"yMm":0},"end":{"xMm":3000,"yMm":0},"structural":false},
              {"operationType":"create_wall","id":"core","wallTypeId":1,"levelId":"@L1","heightMm":3000,"start":{"xMm":0,"yMm":0},"end":{"xMm":9000,"yMm":0},"structural":true},
              {"operationType":"join_geometry","firstElementId":"@core","secondElementId":"@part"}
            ]
            """));
            var ordered = WallTopologyOrderRules.ReorderOperationsSafely(ops);
            var ids = ordered.Select(o => JsonDefaults.String(o, "id") ?? JsonDefaults.String(o, "operationType")).ToArray();
            if (ids[0] != "L1" || ids[1] != "core" || ids[2] != "part" || ids[3] != "stub" || ids[4] != "join_geometry")
                throw new Exception("Unexpected topological wall order: " + string.Join(", ", ids));
        });

        test("CadGeometryReadRules validates request parameters and Liang-Barsky crop intersection", () =>
        {
            var parsed = CadGeometryReadRules.Parse(Parse("""
            {
              "documentIdentity":"doc-1",
              "expectedRevision":2,
              "cadInstanceId":456,
              "layers":["WALL","WINDOW"],
              "cropBounds":{"min":{"xMm":0,"yMm":0},"max":{"xMm":10000,"yMm":8000}},
              "outputJsonlPath":"D:\\Desktop\\revitt\\work\\cad.jsonl"
            }
            """));
            if (parsed.CadInstanceId != 456 || parsed.Layers?.Length != 2 || parsed.CropBounds is null)
                throw new Exception("Failed to parse valid CAD geometry read input.");

            var box = new CadCropBoxMm(0, 0, 1000, 1000);
            if (!CadGeometryReadRules.SegmentIntersectsCrop(-500, 500, 1500, 500, box))
                throw new Exception("Line crossing crop box must intersect.");
            if (CadGeometryReadRules.SegmentIntersectsCrop(-500, 1500, 1500, 1500, box))
                throw new Exception("Line outside crop box must not intersect.");

            foreach (var bad in new[]
            {
                """{"documentIdentity":"doc-1","expectedRevision":0,"cadInstanceId":456,"cropBounds":{"min":{"xMm":0,"yMm":0},"max":{"xMm":10,"yMm":10}},"cropViewId":99}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"cadInstanceId":456,"outputJsonlPath":"D:\\Desktop\\..\\escape.jsonl"}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"cadInstanceId":456,"outputJsonlPath":"D:\\Desktop\\file.txt"}"""
            })
            {
                try { CadGeometryReadRules.Parse(Parse(bad)); throw new Exception("Expected rejection: " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_cad_geometry_request") { }
            }
        });

        test("IfcExportRules validates IFC export contract and blocks path traversal", () =>
        {
            var valid = IfcExportRules.Parse(Parse("""
            {
              "documentIdentity":"doc-1",
              "expectedRevision":5,
              "outputDirectory":"D:\\Desktop\\revitt\\exports",
              "fileName":"building_v1.ifc",
              "ifcVersion":"IFC4RV",
              "exportBaseQuantities":true,
              "spaceBoundaryLevel":2
            }
            """));
            if (valid.IfcVersion != "IFC4RV" || valid.SpaceBoundaryLevel != 2)
                throw new Exception("Unexpected IFC export parsed values.");

            foreach (var bad in new[]
            {
                """{"documentIdentity":"doc-1","expectedRevision":5,"outputDirectory":"D:\\exports","fileName":"bad.rvt"}""",
                """{"documentIdentity":"doc-1","expectedRevision":5,"outputDirectory":"D:\\exports","fileName":"..\\evil.ifc"}""",
                """{"documentIdentity":"doc-1","expectedRevision":5,"outputDirectory":"\\\\server\\share","fileName":"a.ifc"}""",
                """{"documentIdentity":"doc-1","expectedRevision":5,"outputDirectory":"D:\\exports","fileName":"a.ifc","ifcVersion":"IFC99"}"""
            })
            {
                try { IfcExportRules.Parse(Parse(bad)); throw new Exception("Expected IFC rejection: " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_ifc_export_request") { }
            }
        });

        test("GeometryJoinRules supports skipIfUnjoinable and multi-discipline ReorderBuildOperationsSafely orders Arch+Struct+MEP", () =>
        {
            var gSkip = GeometryJoinRules.Validate(Parse("""{"operationType":"join_geometry","firstElementId":"@b1","secondElementId":"@c1","skipIfUnjoinable":true}"""));
            if (!gSkip.SkipIfUnjoinable) throw new Exception("Expected skipIfUnjoinable=true.");
            GeometryJoinRules.Require(new(10, 20, "join", false, false, null, null, true, SkippedUnjoinable: true, SkippedReason: "no overlap"));

            var mixed = PlanRules.Validate(Parse("""
            [
              {"operationType":"create_structural_column","id":"c1","symbolId":50,"baseLevelId":1,"topLevelId":2,"baseOffsetMm":0,"topOffsetMm":0,"point":{"xMm":0,"yMm":0}},
              {"operationType":"create_isolated_foundation","id":"f1","symbolId":60,"levelId":1,"point":{"xMm":0,"yMm":0,"zMm":-500}},
              {"operationType":"create_structural_beam","id":"sec","symbolId":70,"levelId":2,"start":{"xMm":0,"yMm":3000,"zMm":3600},"end":{"xMm":3000,"yMm":3000,"zMm":3600},"topologyPriority":1200},
              {"operationType":"create_structural_beam","id":"pri","symbolId":70,"levelId":2,"start":{"xMm":0,"yMm":0,"zMm":3600},"end":{"xMm":6000,"yMm":0,"zMm":3600},"topologyPriority":2350},
              {"operationType":"join_geometry","id":"j1","firstElementId":"@pri","secondElementId":"@c1","skipIfUnjoinable":true},
              {"operationType":"create_wall","id":"w1","wallTypeId":10,"levelId":1,"heightMm":3600,"start":{"xMm":0,"yMm":0},"end":{"xMm":6000,"yMm":0},"structural":true},
              {"operationType":"create_cable_tray","id":"ct1","cableTrayTypeId":80,"levelId":1,"start":{"xMm":0,"yMm":0,"zMm":3000},"end":{"xMm":3000,"yMm":0,"zMm":3000},"widthMm":300,"heightMm":100},
              {"operationType":"create_cable_tray","id":"ct2","cableTrayTypeId":80,"levelId":1,"start":{"xMm":3000,"yMm":0,"zMm":3000},"end":{"xMm":3000,"yMm":2000,"zMm":3000},"widthMm":300,"heightMm":100},
              {"operationType":"create_fitting","id":"fit1","fittingType":"elbow","firstElementId":"@ct1","firstConnector":{"domain":"DomainCableTrayConduit","shape":"Rectangular","point":{"xMm":3000,"yMm":0,"zMm":3000},"toleranceMm":10},"secondElementId":"@ct2","secondConnector":{"domain":"DomainCableTrayConduit","shape":"Rectangular","point":{"xMm":3000,"yMm":0,"zMm":3000},"toleranceMm":10}}
            ]
            """));

            var ordered = WallTopologyOrderRules.ReorderBuildOperationsSafely(mixed);
            var ids = ordered.Select(o => JsonDefaults.String(o, "id")).ToArray();
            var idxF = Array.IndexOf(ids, "f1");
            var idxC = Array.IndexOf(ids, "c1");
            var idxW = Array.IndexOf(ids, "w1");
            var idxPri = Array.IndexOf(ids, "pri");
            var idxSec = Array.IndexOf(ids, "sec");
            var idxJ = Array.IndexOf(ids, "j1");
            var idxCt1 = Array.IndexOf(ids, "ct1");
            var idxFit = Array.IndexOf(ids, "fit1");
            if (!(idxF < idxC && idxC < idxW && idxW < idxPri && idxPri < idxSec && idxSec < idxJ && idxJ < idxCt1 && idxCt1 < idxFit))
                throw new Exception("Unexpected multi-discipline topological order: " + string.Join(", ", ids));
        });

        test("CableTray/Conduit fittings support DomainCableTrayConduit readback and post-fitting axis-preserved trimming", () =>
        {
            var e1 = new FittingEndpointBinding(10, "u10", 0, "DomainCableTrayConduit", "End");
            var e2 = new FittingEndpointBinding(11, "u11", 1, "DomainCableTrayConduit", "End");
            var e3 = new FittingEndpointBinding(12, "u12", 0, "DomainCableTrayConduit", "End");
            var binding = new FittingCreationBinding(90, "u90", 900, "OST_CableTrayFitting", "elbow", e1, e2);
            var readback = new FittingConnectionReadback(90, "u90", 900, "OST_CableTrayFitting",
                [new(0, "DomainCableTrayConduit", "End"), new(1, "DomainCableTrayConduit", "End")],
                new(e1, [new(0, true, true)]),
                new(e2, [new(1, true, true)]));
            FittingConnectionReadbackRules.Require(binding, readback);

            var teeBinding = new MultiportFittingCreationBinding(91, "u91", 901, "OST_ConduitFitting", "tee", [e1, e2, e3]);
            var teeReadback = new MultiportFittingConnectionReadback(91, "u91", 901, "OST_ConduitFitting",
                [new(0, "DomainCableTrayConduit", "End"), new(1, "DomainCableTrayConduit", "End"), new(2, "DomainCableTrayConduit", "End")],
                [new(e1, [new(0, true, true)]), new(e2, [new(1, true, true)]), new(e3, [new(2, true, true)])]);
            MultiportFittingReadbackRules.Require(teeBinding, teeReadback);

            var trayInput = new CableTrayInput(80, 1, new(0, 0, 3000), new(3000, 0, 3000), 300, 100);
            // Trimmed back by 200mm for elbow radius on original axis must pass when allowFittingTrim=true.
            ElectricalRunRules.RequireCableTray(trayInput, "u-ct", new(10, "u-ct", "create_cable_tray", 80, 1, new(0, 0, 3000), new(2800, 0, 3000), 2800, 300, 100, null, []), allowFittingTrim: true);
            // Displaced laterally off original axis must still fail even when allowFittingTrim=true.
            try
            {
                ElectricalRunRules.RequireCableTray(trayInput, "u-ct", new(10, "u-ct", "create_cable_tray", 80, 1, new(0, 50, 3000), new(2800, 50, 3000), 2800, 300, 100, null, []), allowFittingTrim: true);
                throw new Exception("Expected lateral drift rejection on trimmed cable tray.");
            }
            catch (BridgeException ex) when (ex.Code == "invalid_electrical_run") { }
        });

        test("ArchitecturalGeometryAuditRules detects structural beam-to-column and beam-to-beam endpoint gaps", () =>
        {
            var col = new AuditColumnGeometry(501, 0, 4000, 6000, 0, 300, 300);
            var col2 = new AuditColumnGeometry(502, 0, 4000, 0, 0, 300, 300);
            var col3 = new AuditColumnGeometry(503, 0, 4000, 0, 4000, 300, 300);
            var col4 = new AuditColumnGeometry(504, 0, 4000, 6000, 4000, 300, 300);
            var girderNorth = new AuditBeamGeometry(601, 0, 4000, 6000, 4000, 3600, "KL_300x600");
            var gappedBeamSouth = new AuditBeamGeometry(602, 0, 0, 5550, 0, 3600, "KL_300x600"); // 150mm clear gap to col 501 face (5700)
            var gappedSec = new AuditBeamGeometry(603, 3000, 0, 3000, 3800, 3600, "L_250x500"); // 200mm clear gap to north girder (4000)
            var slab = new AuditHorizontalSurface(701, "Floor", 2, 3450, 3600, -500, -500, 7000, 5000);

            var bad = ArchitecturalGeometryAuditRules.Analyze([], [slab], [col, col2, col3, col4], [], 0, 0, null, false, null, null, null, [girderNorth, gappedBeamSouth, gappedSec]);
            if (bad.ScannedBeamCount != 3 || bad.BeamEndpointGapTotalCount != 2 || !bad.HasIssues)
                throw new Exception($"Expected 2 structural beam endpoint gaps, got {bad.BeamEndpointGapTotalCount}.");

            var fixedBeamSouth = new AuditBeamGeometry(602, 0, 0, 6000, 0, 3600, "KL_300x600");
            var fixedSec = new AuditBeamGeometry(603, 3000, 0, 3000, 4000, 3600, "L_250x500");
            var clean = ArchitecturalGeometryAuditRules.Analyze([], [slab], [col, col2, col3, col4], [], 0, 0, null, false, null, null, null, [girderNorth, fixedBeamSouth, fixedSec]);
            if (clean.BeamEndpointGapTotalCount != 0 || clean.HasIssues)
                throw new Exception($"Expected 0 beam endpoint gaps after snapping, got {clean.BeamEndpointGapTotalCount}.");
        });
    }
}
