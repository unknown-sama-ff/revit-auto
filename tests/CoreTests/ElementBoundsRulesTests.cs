using System.Text.Json;
using RevitAutoV27;

internal static class ElementBoundsRulesTests
{
    private const string Valid = """{"includeBounds":true,"documentIdentity":"session","expectedRevision":0,"elementIds":[10,20]}""";
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();
    private static void Reject(string value)
    {
        try { ElementBoundsRules.Parse(Json(value)); }
        catch (BridgeException error) when (error.Code == "invalid_element_bounds_request") { return; }
        throw new Exception("Expected invalid bounds request.");
    }
    private static void Equal(double expected, double actual)
    {
        if (Math.Abs(expected - actual) > 1e-10) throw new Exception($"Expected {expected}, got {actual}.");
    }
    public static void Run(Action<string, Action> test)
    {
        test("bounds opt-in preserves ordinary inspect and rejects a view without opt-in", () => {
            if (ElementBoundsRules.Parse(Json("""{"elementIds":[1]}""")).IncludeBounds ||
                ElementBoundsRules.Parse(Json("""{"includeBounds":false,"elementIds":[1]}""")).IncludeBounds) throw new Exception();
            Reject("""{"boundsViewId":1,"elementIds":[1]}""");
            Reject("""{"includeBounds":false,"boundsViewId":1,"elementIds":[1]}""");
            foreach (var flag in new[] { "null", "1", "\"true\"" }) Reject(Valid.Replace("true", flag));
        });
        test("bounds require both explicit correctly typed document pins", () => {
            foreach (var invalid in new[] {
                Valid.Replace("\"documentIdentity\":\"session\",", ""), Valid.Replace("\"expectedRevision\":0,", ""),
                Valid.Replace("\"session\"", "null"), Valid.Replace("\"session\"", "\" \""),
                Valid.Replace("\"session\"", JsonSerializer.Serialize(new string('x',201))),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":null"),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":-1"),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":0.5"),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":9007199254740992"),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":\"0\"")
            }) Reject(invalid);
            ElementBoundsRules.Parse(Json(Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":9007199254740991")));
        });
        test("bounds IDs and optional view are distinct positive safe native IDs within twenty", () => {
            foreach (var ids in new[] { "[]", "[10,10]", "[0]", "[-1]", "[1.2]", "[null]", "[\"10\"]", "[9007199254740992]", "null",
                "["+string.Join(',',Enumerable.Range(1,21))+"]" }) Reject(Valid.Replace("[10,20]", ids));
            foreach (var view in new[] { "0", "-1", "1.2", "null", "\"10\"", "9007199254740992" })
                Reject(Valid[..^1]+",\"boundsViewId\":"+view+"}");
            var input = ElementBoundsRules.Parse(Json(Valid.Replace("[10,20]", "["+string.Join(',',Enumerable.Range(1,20))+"]")[..^1]+",\"boundsViewId\":9007199254740991}"));
            if (input.ElementIds!.Length != 20 || input.BoundsViewId != ElementBoundsRules.MaxSafeInteger) throw new Exception();
        });
        test("bounds rejects duplicate conditional request fields for native clients", () => {
            Reject(Valid[..^1]+",\"includeBounds\":false}");
            Reject(Valid[..^1]+",\"elementIds\":[30]}");
            Reject(Valid[..^1]+",\"boundsViewId\":10,\"boundsViewId\":20}");
        });
        test("bounds transforms eight corners and takes rotated translated project extrema", () => {
            var count = 0; var c = Math.Sqrt(0.5);
            var box = ElementBoundsRules.FromCorners(new(-2,-1,0), new(2,1,3), p => {
                count++; return new(100+c*p.XMm-c*p.YMm,200+c*p.XMm+c*p.YMm,300+p.ZMm);
            }) ?? throw new Exception();
            if (count != 8) throw new Exception();
            Equal(100-3*c,box.Min.XMm); Equal(100+3*c,box.Max.XMm);
            Equal(200-3*c,box.Min.YMm); Equal(200+3*c,box.Max.YMm);
            Equal(300,box.Min.ZMm); Equal(303,box.Max.ZMm);
            Equal(100,box.Center.XMm); Equal(6*c,box.Size.XMm);
        });
        test("bounds center offset preserves native insertion origin displacement and full precision", () => {
            var offset = ElementBoundsRules.Offset(new(100.123456789,200,300),new(90,210,300)) ?? throw new Exception();
            Equal(10.123456789,offset.XMm); Equal(-10,offset.YMm); Equal(0,offset.ZMm);
            var json = JsonSerializer.Serialize(offset,JsonDefaults.Options);
            if (json.Contains("finite") || !json.Contains("123456789")) throw new Exception(json);
        });
        test("bounds permits flat boxes and never fabricates nonfinite or invalid bounds", () => {
            var flat = ElementBoundsRules.FromCorners(new(0,0,2),new(1,1,2),p=>p) ?? throw new Exception();
            Equal(0,flat.Size.ZMm);
            if (ElementBoundsRules.FromCorners(new(1,0,0),new(0,1,1),p=>throw new Exception("Must not transform invalid local bounds")) is not null ||
                ElementBoundsRules.FromCorners(new(double.NaN,0,0),new(1,1,1),p=>p) is not null ||
                ElementBoundsRules.FromCorners(new(0,0,0),new(1,1,1),p=>new(double.PositiveInfinity,0,0)) is not null ||
                ElementBoundsRules.FromCorners(new(-double.MaxValue,0,0),new(double.MaxValue,1,1),p=>p) is not null ||
                ElementBoundsRules.Offset(new(double.NaN,0,0),new(0,0,0)) is not null) throw new Exception();
        });
    }
}
