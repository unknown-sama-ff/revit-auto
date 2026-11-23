using System.Text.Json;
using RevitAutoV27;

internal static class CeilingCreationRulesTests
{
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static JsonElement Operation() => Json("""{"operationType":"create_ceiling","id":"ceiling1","dependencies":[],"ceilingTypeId":10,"levelId":20,"boundary":[{"xMm":0,"yMm":0,"zMm":6500},{"xMm":4000,"yMm":0,"zMm":6500},{"xMm":4000,"yMm":3000,"zMm":6500},{"xMm":0,"yMm":3000,"zMm":6500}]}""");
    private static CeilingPoint Point(double x, double y, double z = 6500) => new(x, y, z);
    private static CeilingCreationReadback Native()
    {
        var p = CeilingCreationRules.Boundary(Operation());
        return new(101, 10, 20, 102, 101, 2500, p.Select((point, i) => new CeilingBoundaryEdge(point, p[(i + 1) % p.Length])).ToArray());
    }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_ceiling_creation") { return; }
        throw new Exception("Expected invalid_ceiling_creation.");
    }
    private static void Require(CeilingCreationReadback actual) => CeilingCreationRules.Require(Operation(), 4000, 101, actual);
    public static void Run(Action<string, Action> test)
    {
        test("ceiling uses absolute profile Z minus native level ProjectElevation without changing the operation", () =>
        {
            var op = Operation(); var original = op.GetRawText();
            CeilingCreationRules.Validate(op); Require(Native());
            if (CeilingCreationRules.HeightOffsetMm(6500, 4000) != 2500 || CeilingCreationRules.HeightOffsetMm(-500, 4000) != -4500 ||
                CeilingCreationRules.HeightOffsetMm(4000, 4000) != 0 || CeilingCreationRules.SignedAreaMm2(CeilingCreationRules.Boundary(op)) != 12000000 || op.GetRawText() != original)
                throw new Exception("Absolute ceiling profile/offset resolution changed or input was mutated.");
            Reject(() => CeilingCreationRules.HeightOffsetMm(double.NaN, 4000));
            Reject(() => CeilingCreationRules.HeightOffsetMm(6500, double.PositiveInfinity));
        });
        test("ceiling requires exact existing safe type and level IDs with strict fields", () =>
        {
            foreach (var field in new[] { "ceilingTypeId", "levelId" }) foreach (var value in new[] { "0", "-1", "1.5", "null", "\"@new\"", "9007199254740992" })
                Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace($"\"{field}\":{(field == "levelId" ? 20 : 10)}", $"\"{field}\":{value}"))));
            foreach (var field in new[] { "offsetMm", "holes", "curves", "typeName", "level" })
                Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace("\"dependencies\":[]", $"\"{field}\":0"))));
            Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace("\"ceilingTypeId\":10", "\"ceilingTypeId\":10,\"ceilingTypeId\":10"))));
            Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace("create_ceiling", "create_roof"))));
        });
        test("ceiling rejects missing Z nonfinite oversized or ambiguous point coordinates", () =>
        {
            foreach (var value in new[] { "null", "1e999", "100000001", "\"6500\"" })
                Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace("\"zMm\":6500", $"\"zMm\":{value}"))));
            Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace(",\"zMm\":6500", ""))));
            Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace("\"zMm\":6500", "\"zMm\":6500,\"zMm\":6500"))));
            Reject(() => CeilingCreationRules.ValidatePolygon([Point(0, 0), Point(4000, 0, 6500.011), Point(0, 3000)]));
        });
        test("ceiling polygon rejects self intersections touching duplicate closure collinearity and degeneracy", () =>
        {
            foreach (var points in new CeilingPoint[][] { [], [Point(0, 0), Point(1, 0)],
                [Point(0, 0), Point(4000, 3000), Point(4000, 0), Point(0, 3000)],
                [Point(0, 0), Point(4000, 0), Point(4000, 3000), Point(0, 3000), Point(0, 0)],
                [Point(0, 0), Point(2000, 0), Point(4000, 0), Point(4000, 3000), Point(0, 3000)],
                [Point(0, 0), Point(0.5, 0), Point(100, 100)], [Point(0, 0), Point(10, 0), Point(20, 0)],
                [Point(0, 0), Point(4000, 0), Point(4000, 4000), Point(2000, 0), Point(0, 4000)],
                Enumerable.Range(0, 129).Select(i => Point(i, i)).ToArray() })
                Reject(() => CeilingCreationRules.ValidatePolygon(points));
            CeilingCreationRules.ValidatePolygon([Point(0, 0), Point(4000, 0), Point(4000, 4000), Point(2000, 2000), Point(0, 4000)]);
            CeilingCreationRules.ValidatePolygon([Point(99990000, 99990000), Point(99994000, 99990000), Point(99994000, 99993000), Point(99990000, 99993000)]);
        });
        test("ceiling native readback permits cyclic rotation and complete reversal only", () =>
        {
            var native = Native(); var edges = native.Boundary.ToArray();
            Require(native with { Boundary = [..edges.Skip(2), ..edges.Take(2)] });
            Require(native with { Boundary = edges.Reverse().Select(edge => new CeilingBoundaryEdge(edge.End, edge.Start)).ToArray() });
            Reject(() => Require(native with { Boundary = [edges[0], edges[2], edges[1], edges[3]] }));
            Reject(() => Require(native with { Boundary = [..edges, edges[0]] }));
        });
        test("ceiling native readback accepts Revit level-plane sketch with matching HeightOffsetMm and rejects drifted sketch Z", () =>
        {
            var native = Native();
            CeilingBoundaryEdge OnLevel(CeilingBoundaryEdge e, double zMm) => new(e.Start with { ZMm = zMm }, e.End with { ZMm = zMm });
            Require(native with { Boundary = native.Boundary.Select(e => OnLevel(e, 4000)).ToArray() });
            Reject(() => Require(native with { Boundary = native.Boundary.Select(e => OnLevel(e, 4000.1)).ToArray() }));
        });
        test("ceiling native readback rejects changed identity type level offset and sketch ownership", () =>
        {
            var native = Native();
            foreach (var changed in new[] { native with { ElementId = 111, SketchOwnerId = 111 }, native with { TypeId = 11 },
                native with { LevelId = 21 }, native with { HeightOffsetMm = 2500.1 }, native with { HeightOffsetMm = double.NaN },
                native with { SketchId = 0 }, native with { SketchOwnerId = 999 }, native with { Boundary = null! } }) Reject(() => Require(changed));
            Reject(() => CeilingCreationRules.Require(Operation(), 4100, 101, native));
        });
        test("ceiling native readback uses all raw XYZ endpoints and fails unknown or shifted geometry", () =>
        {
            var native = Native();
            foreach (var delta in new[] { new CeilingPoint(0, 0, 0.1), new CeilingPoint(0.1, 0, 0), new CeilingPoint(0, 0.1, 0) })
            {
                CeilingPoint Shift(CeilingPoint p) => new(p.XMm + delta.XMm, p.YMm + delta.YMm, p.ZMm + delta.ZMm);
                Reject(() => Require(native with { Boundary = native.Boundary.Select(edge => new CeilingBoundaryEdge(Shift(edge.Start), Shift(edge.End))).ToArray() }));
            }
            var changed = native.Boundary.ToArray(); changed[0] = changed[0] with { End = new(double.PositiveInfinity, 0, 6500) };
            Reject(() => Require(native with { Boundary = changed }));
            changed = native.Boundary.ToArray(); changed[0] = changed[0] with { End = Point(3999, 0) };
            Reject(() => Require(native with { Boundary = changed }));
        });
        test("ceiling metadata rejects duplicate dependency self reference and malformed IDs", () =>
        {
            foreach (var dependencies in new[] { "null", "[\"ceiling1\"]", "[\"a\",\"a\"]", "[2]", "[\"\"]" })
                Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace("\"dependencies\":[]", $"\"dependencies\":{dependencies}"))));
            Reject(() => CeilingCreationRules.Validate(Json(Operation().GetRawText().Replace("\"id\":\"ceiling1\"", "\"id\":\" padded\""))));
        });
    }
}
