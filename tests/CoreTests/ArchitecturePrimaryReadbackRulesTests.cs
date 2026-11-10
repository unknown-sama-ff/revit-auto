using RevitAutoV27;
using System.Text.Json;

internal static class ArchitecturePrimaryReadbackRulesTests
{
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_operation") { return; }
        throw new Exception("Expected invalid_operation.");
    }

    public static void Run(Action<string, Action> test)
    {
        test("wall readback compares type level geometry height offset and flags", () =>
        {
            var op = Json("""{"operationType":"create_wall","wallTypeId":10,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":3000,"yMm":0,"zMm":0},"heightMm":3000,"offsetMm":100,"flip":false,"structural":true}""");
            var native = new ArchitectureWallReadback(10, 20, 3000, 100, false, true, new(0, 0, 0, 3000, 0, 0));
            ArchitecturePrimaryReadbackRules.RequireWall(op, native);
            Reject(() => ArchitecturePrimaryReadbackRules.RequireWall(op, native with { TypeId = 11 }));
            Reject(() => ArchitecturePrimaryReadbackRules.RequireWall(op, native with { HeightMm = 2990 }));
            Reject(() => ArchitecturePrimaryReadbackRules.RequireWall(op, native with { Structural = false }));
            Reject(() => ArchitecturePrimaryReadbackRules.RequireWall(op, native with { Location = native.Location with { EndXmm = 3001 } }));
        });
        test("wall readback rejects nonfinite evidence and reversed line with the wrong physical side", () =>
        {
            var op = Json("""{"operationType":"create_wall","wallTypeId":10,"levelId":20,"start":{"xMm":0,"yMm":0},"end":{"xMm":3000,"yMm":0},"heightMm":3000}""");
            ArchitecturePrimaryReadbackRules.RequireWall(op, new(10, 20, 3000, 0, true, false, new(3000, 0, 0, 0, 0, 0)));
            Reject(() => ArchitecturePrimaryReadbackRules.RequireWall(op, new(10, 20, 3000, 0, false, false, new(3000, 0, 0, 0, 0, 0))));
            Reject(() => ArchitecturePrimaryReadbackRules.RequireWall(op, new(10, 20, 3000, 0, false, false, new(double.NaN, 0, 0, 0, 0, 0))));
        });
        test("floor readback compares cyclic boundary edges and rejects topology drift", () =>
        {
            var op = Json("""{"operationType":"create_floor","floorTypeId":30,"levelId":20,"boundary":[{"xMm":0,"yMm":0,"zMm":0},{"xMm":1000,"yMm":0,"zMm":0},{"xMm":1000,"yMm":800,"zMm":0},{"xMm":0,"yMm":800,"zMm":0}]}""");
            var native = new ArchitectureFloorReadback(30, 20, [new(1000,0,0,1000,800,0),new(1000,800,0,0,800,0),new(0,800,0,0,0,0),new(0,0,0,1000,0,0)]);
            ArchitecturePrimaryReadbackRules.RequireFloor(op, native);
            Reject(() => ArchitecturePrimaryReadbackRules.RequireFloor(op, native with { Boundary = native.Boundary.Take(3).ToArray() }));
            Reject(() => ArchitecturePrimaryReadbackRules.RequireFloor(op, native with { Boundary = [native.Boundary[0], native.Boundary[1], new(1000,800,0,0,0,1), native.Boundary[3]] }));
        });
        test("floor readback preserves accepted explicit closing point and rejects missing native boundary", () =>
        {
            var op = Json("""{"operationType":"create_floor","floorTypeId":30,"levelId":20,"boundary":[{"xMm":0,"yMm":0},{"xMm":1000,"yMm":0},{"xMm":1000,"yMm":800},{"xMm":0,"yMm":0}]}""");
            ArchitecturePrimaryReadbackRules.RequireFloor(op, new(30, 20, [new(0,0,0,1000,0,0),new(1000,0,0,1000,800,0),new(1000,800,0,0,0,0)]));
            Reject(() => ArchitecturePrimaryReadbackRules.RequireFloor(op, new(30, 20, null!)));
        });
        test("primary wall readback rejects every independent constraint drift and unknown IDs", () =>
        {
            var expected = new ArchitectureWallReadback(10,20,3000,100,false,true,new(0,0,4100,3000,0,4100));
            ArchitecturePrimaryReadbackRules.RequireWall(expected, expected);
            foreach (var actual in new[] { expected with { TypeId = 0 }, expected with { LevelId = 21 }, expected with { OffsetMm = 101 },
                expected with { Flipped = true }, expected with { HeightMm = double.NaN }, expected with { Location = expected.Location with { StartZmm = 4101 } } })
                Reject(() => ArchitecturePrimaryReadbackRules.RequireWall(expected, actual));
            Reject(() => ArchitecturePrimaryReadbackRules.RequireWall(expected with { TypeId = 0 }, expected with { TypeId = 0 }));
        });
        test("primary floor readback allows cyclic start and full reversal without sorting edges", () =>
        {
            ArchitectureEdgeReadback[] edges = [new(0,0,4000,1000,0,4000),new(1000,0,4000,1000,800,4000),new(1000,800,4000,0,800,4000),new(0,800,4000,0,0,4000)];
            var expected = new ArchitectureFloorReadback(30,20,edges);
            var reversed = edges.Reverse().Select(e => new ArchitectureEdgeReadback(e.EndXmm,e.EndYmm,e.EndZmm,e.StartXmm,e.StartYmm,e.StartZmm)).ToArray();
            ArchitecturePrimaryReadbackRules.RequireFloor(expected, expected with { Boundary = reversed });
            foreach (var actual in new[] { expected with { TypeId = 0 }, expected with { LevelId = 21 }, expected with { OffsetMm = 1 }, expected with { Structural = true },
                expected with { Boundary = [edges[0],edges[2],edges[1],edges[3]] }, expected with { Boundary = [edges[0] with { StartZmm = double.NaN },..edges.Skip(1)] } })
                Reject(() => ArchitecturePrimaryReadbackRules.RequireFloor(expected, actual));
        });
        test("hosted door window readback verifies resolved identity full XYZ and relative native rotation", () =>
        {
            var expected = new ArchitectureHostedReadback(10,50,20,-2000014,new(1000,2000,900,Math.PI));
            ArchitecturePrimaryReadbackRules.RequireHosted(expected, expected with { Placement = expected.Placement with { RotationRadians = -Math.PI } });
            foreach (var actual in new[] { expected with { TypeId = 11 }, expected with { HostId = 51 }, expected with { LevelId = 21 }, expected with { CategoryId = -2000016 },
                expected with { Placement = expected.Placement with { Zmm = 1200 } }, expected with { Placement = expected.Placement with { RotationRadians = Math.PI/2 } },
                expected with { Placement = expected.Placement with { Xmm = double.NaN } } })
                Reject(() => ArchitecturePrimaryReadbackRules.RequireHosted(expected, actual));
        });
    }
}
