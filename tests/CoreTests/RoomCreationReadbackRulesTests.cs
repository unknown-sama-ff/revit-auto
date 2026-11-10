using System.Text.Json;
using RevitAutoV27;

internal static class RoomCreationReadbackRulesTests
{
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static readonly JsonElement Operation = Json("""{"operationType":"create_room","levelId":311,"xMm":1000,"yMm":2000,"zMm":9000,"name":"办公室","number":"A-101"}""");
    private static RoomPointReadback Point(double x, double y) => new(x, y, 4000);
    private static RoomBoundarySegmentReadback Segment(double ax, double ay, double bx, double by) =>
        new("Line", Point(ax, ay), Point((ax + bx) / 2, (ay + by) / 2), Point(bx, by), Math.Sqrt(Math.Pow(bx - ax, 2) + Math.Pow(by - ay, 2)));
    private static RoomBoundarySegmentReadback[][] Square() => [[Segment(0, 0, 4000, 0), Segment(4000, 0, 4000, 4000), Segment(4000, 4000, 0, 4000), Segment(0, 4000, 0, 0)]];
    private static RoomCreationReadback Valid() => new(311, "办公室", "A-101", Point(1000, 2000), 16, Square());
    private static JsonElement Resolved() => RoomCreationReadbackRules.Resolve(Operation, 311, 4000);
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_operation") { return; }
        throw new Exception("Expected invalid_operation.");
    }

    public static void Run(Action<string, Action> test)
    {
        test("room readback resolves the real level and discloses level-derived Z without changing input", () =>
        {
            var before = Operation.GetRawText();
            var resolved = RoomCreationReadbackRules.Resolve(Operation, 694, 4000);
            if (resolved.GetProperty("levelId").GetInt64() != 694 || resolved.GetProperty("zMm").GetDouble() != 4000 ||
                resolved.GetProperty("xMm").GetDouble() != 1000 || Operation.GetRawText() != before)
                throw new Exception("Room input was changed or native level elevation was ignored.");
            RoomCreationReadbackRules.Require(Resolved(), Valid());
            Reject(() => RoomCreationReadbackRules.Resolve(Operation, 0, 4000));
            Reject(() => RoomCreationReadbackRules.Resolve(Operation, 311, double.NaN));
        });
        test("room readback rejects changed names numbers levels and unknown text", () =>
        {
            var native = Valid();
            foreach (var changed in new[] { native with { LevelId = 694 }, native with { LevelId = 0 },
                native with { Name = "另一个房间" }, native with { Name = null }, native with { Number = "a-101" }, native with { Number = "A-101 " } })
                Reject(() => RoomCreationReadbackRules.Require(Resolved(), changed));
            var bom = Json(Operation.GetRawText().Replace("办公室", "\uFEFF办公室"));
            RoomCreationReadbackRules.Require(RoomCreationReadbackRules.Resolve(bom, 311, 4000), native with { Name = "\uFEFF办公室" });
        });
        test("room readback checks finite XYZ with a one millimeter three dimensional tolerance", () =>
        {
            var native = Valid();
            RoomCreationReadbackRules.Require(Resolved(), native with { Location = Point(1000.5, 2000) });
            foreach (var location in new[] { Point(1001.1, 2000), Point(1000.8, 2000.8), Point(double.NaN, 2000),
                native.Location with { Zmm = 3998 }, native.Location with { Zmm = double.PositiveInfinity } })
                Reject(() => RoomCreationReadbackRules.Require(Resolved(), native with { Location = location }));
        });
        test("room readback rejects zero negative and nonfinite native area", () =>
        {
            foreach (var area in new[] { 0, -1, double.NaN, double.PositiveInfinity })
                Reject(() => RoomCreationReadbackRules.Require(Resolved(), Valid() with { AreaM2 = area }));
        });
        test("room readback rejects missing empty disconnected and unbounded boundary evidence", () =>
        {
            foreach (var loops in new RoomBoundarySegmentReadback[][][] { null!, [], [[]],
                [[Segment(0, 0, 4000, 0), Segment(4000, 10, 0, 0)]], [null!] })
                Reject(() => RoomCreationReadbackRules.Require(Resolved(), Valid() with { BoundaryLoops = loops }));
            foreach (var segment in new[] { Segment(0, 0, 4000, 0) with { LengthMm = 0 },
                Segment(0, 0, 4000, 0) with { LengthMm = double.NaN },
                Segment(0, 0, 4000, 0) with { CurveType = "" },
                Segment(0, 0, 4000, 0) with { Mid = Point(double.PositiveInfinity, 0) } })
            {
                var loops = Square(); loops[0][0] = segment;
                Reject(() => RoomCreationReadbackRules.Require(Resolved(), Valid() with { BoundaryLoops = loops }));
            }
        });
        test("room readback preserves holes and curved boundary segments without flattening to a polygon", () =>
        {
            RoomCreationReadbackRules.Require(Resolved(), Valid() with { BoundaryLoops = [..Square(), ..Square()] });
            var circle = new RoomBoundarySegmentReadback("Arc", Point(0, 0), Point(2000, 0), Point(0, 0), Math.PI * 2000);
            RoomCreationReadbackRules.Require(Resolved(), Valid() with { BoundaryLoops = [[circle]] });
        });
        test("room boundary evidence budget rejects overflow instead of truncating", () =>
        {
            var circle = new RoomBoundarySegmentReadback("Arc", Point(0, 0), Point(2000, 0), Point(0, 0), Math.PI * 2000);
            var allowed = Enumerable.Range(0, RoomCreationReadbackRules.MaxBoundarySegments).Select(_ => circle).ToArray();
            RoomCreationReadbackRules.Require(Resolved(), Valid() with { BoundaryLoops = [allowed] });
            Reject(() => RoomCreationReadbackRules.Require(Resolved(), Valid() with { BoundaryLoops = [[..allowed, circle]] }));
        });
        test("room readback requires resolved IDs finite reviewed coordinates and explicit original identity", () =>
        {
            foreach (var input in new[] { Operation.GetRawText().Replace("311", "\"@level\""),
                Operation.GetRawText().Replace("\"name\":\"办公室\"", "\"name\":null"),
                Operation.GetRawText().Replace("\"xMm\":1000", "\"xMm\":1e999"),
                Operation.GetRawText().Replace("\"number\":\"A-101\"", "\"number\":\" \"") })
                Reject(() => RoomCreationReadbackRules.Require(Json(input), Valid()));
        });
    }
}
