using System.Text.Json;
using RevitAutoV27;

internal static class LightingMoveRulesTests
{
    private const string Valid = """{"operationType":"move_lighting_fixtures","targets":[{"elementId":100,"symbolId":200,"point":{"xMm":100,"yMm":200,"zMm":2800}}],"translation":{"xMm":-600,"yMm":150,"zMm":0},"toleranceMm":1}""";
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_lighting_move") { return; }
        throw new Exception("Expected invalid_lighting_move.");
    }
    private static LightingMoveState Before() => new(100, "native-unique", 200, -1, new(100,200,2800), 0,
        [new(1, new(700,50,2647.6), ["wire-10:port-0","self:electrical:end"])], ["circuit-20:panel-30:members-100-101"]);
    private static LightingMoveState After() => Before() with { Point = new(-500,350,2800),
        Ports = [new(1,new(100,200,2647.6), ["self:electrical:end","wire-10:port-0"])] };
    public static void Run(Action<string, Action> test)
    {
        test("lighting move parses an explicit bounded same-plan XY translation", () => {
            var input = LightingMoveRules.Parse(Json(Valid));
            if (input.Targets.Length != 1 || input.Targets[0].ElementId != 100 || input.Translation.XMm != -600 || input.ToleranceMm != 1) throw new Exception();
            _ = PlanRules.Validate(Json("[" + Valid + "]"));
        });
        test("lighting move rejects nonzero Z, missing Z, nonfinite/mistyped/excessive delta and no-op", () => {
            foreach (var value in new[] {
                Valid.Replace("\"zMm\":0", "\"zMm\":1"), Valid.Replace(",\"zMm\":0", ""),
                Valid.Replace("\"xMm\":-600", "\"xMm\":\"-600\""), Valid.Replace("\"xMm\":-600", "\"xMm\":10001"),
                Valid.Replace("\"xMm\":-600", "\"xMm\":1e999"),
                Valid.Replace("\"xMm\":-600", "\"xMm\":0").Replace("\"yMm\":150", "\"yMm\":0"),
                Valid.Replace("\"xMm\":-600", "\"xMm\":1").Replace("\"yMm\":150", "\"yMm\":0")
            }) Reject(() => LightingMoveRules.Parse(Json(value)));
        });
        test("lighting move rejects absent, null, empty, duplicated or unsafe targets", () => {
            var target = Json(Valid).GetProperty("targets")[0].GetRawText();
            foreach (var value in new[] {
                Valid.Replace("\"targets\":[" + target + "]", "\"targets\":null"),
                Valid.Replace("[" + target + "]", "[]"),
                Valid.Replace("[" + target + "]", "[" + target + "," + target + "]"),
                Valid.Replace("\"elementId\":100", "\"elementId\":0"),
                Valid.Replace("\"symbolId\":200", "\"symbolId\":9007199254740992"),
                Valid.Replace("\"elementId\":100", "\"elementId\":\"@old\""),
                Valid.Replace("\"targets\":[" + target + "]", "\"targets\":[" + string.Join(',',Enumerable.Range(1,21).Select(i => target.Replace("\"elementId\":100", "\"elementId\":"+i))) + "]")
            }) Reject(() => LightingMoveRules.Parse(Json(value)));
        });
        test("lighting move refuses unknown/duplicate top-level, point and target keys", () => {
            foreach (var value in new[] {
                Valid.Replace("\"toleranceMm\":1", "\"toleranceMm\":1,\"toleranceMm\":1"),
                Valid.Replace("\"toleranceMm\":1", "\"toleranceMm\":1,\"force\":true"),
                Valid.Replace("\"symbolId\":200", "\"symbolId\":200,\"hostElementId\":1"),
                Valid.Replace("\"xMm\":100", "\"xMm\":100,\"xMm\":100"),
                Valid.Replace("\"xMm\":100", "\"xMm\":null"),
                Valid.Replace("\"toleranceMm\":1", "\"toleranceMm\":0"),
                Valid.Replace("\"toleranceMm\":1", "\"toleranceMm\":1.1")
            }) Reject(() => LightingMoveRules.Parse(Json(value)));
        });
        test("lighting move cannot share a plan with other operations", () => {
            Reject(() => LightingMoveRules.ValidatePlan([Json(Valid),Json("""{"operationType":"set_parameter"}""")]));
            LightingMoveRules.ValidatePlan([Json(Valid)]);
        });
        test("lighting move bounds the vector length rather than each axis alone", () => {
            var atLimit = Valid.Replace("\"xMm\":-600", "\"xMm\":6000").Replace("\"yMm\":150", "\"yMm\":8000");
            LightingMoveRules.Parse(Json(atLimit));
            var diagonal = Valid.Replace("\"xMm\":-600", "\"xMm\":10000").Replace("\"yMm\":150", "\"yMm\":10000");
            Reject(() => LightingMoveRules.Parse(Json(diagonal)));
        });
        test("lighting move verifies native fixture and connector XYZ with unchanged height and peer sets", () => {
            LightingMoveRules.Verify(Before(),After(),LightingMoveRules.Parse(Json(Valid)));
            LightingMoveRules.Verify(Before(),After() with {RotationRadians=2*Math.PI},LightingMoveRules.Parse(Json(Valid)));
        });
        test("lighting move detects a missing/partial movement, Z drift and excessive connector drift", () => {
            var input=LightingMoveRules.Parse(Json(Valid));
            Reject(() => LightingMoveRules.Verify(Before(),Before(),input));
            Reject(() => LightingMoveRules.Verify(Before(),After() with { Point = new(-500,350,2802) },input));
            Reject(() => LightingMoveRules.Verify(Before(),After() with { Ports = [new(1,new(103,200,2647.6),Before().Ports[0].PeerKeys)] },input));
        });
        test("lighting move rejects changed native identity, type, level and rotation", () => {
            var input=LightingMoveRules.Parse(Json(Valid));
            foreach(var value in new[] {After() with {ElementId=101},After() with {UniqueId="replaced"},After() with {SymbolId=201},After() with {LevelId=311},After() with {RotationRadians=0.1},After() with {RotationRadians=double.NaN}})
                Reject(() => LightingMoveRules.Verify(Before(),value,input));
        });
        test("lighting move rejects connector loss/duplication/peer changes and circuit panel or membership change", () => {
            var input=LightingMoveRules.Parse(Json(Valid));
            foreach(var value in new[] {
                After() with {Ports=[]},
                After() with {Ports=[After().Ports[0],After().Ports[0]]},
                After() with {Ports=[After().Ports[0] with {PeerKeys=["different-wire"]}]},
                After() with {CircuitKeys=["circuit-20:panel-31:members-100-101"]}
            }) Reject(() => LightingMoveRules.Verify(Before(),value,input));
        });
        test("lighting move refuses unavailable and out-of-range native coordinates", () => {
            Reject(() => LightingMoveRules.CheckPoint(new(double.NaN,0,0)));
            Reject(() => LightingMoveRules.CheckPoint(new(0,double.PositiveInfinity,0)));
            Reject(() => LightingMoveRules.CheckPoint(new(0,0,100000001)));
            LightingMoveRules.RequirePoint(new(0.5,0,0),new(0,0,0),1);
        });
    }
}
