using System.Text.Json;
using RevitAutoV27;

internal static class StructuralElementRulesTests
{
    private const string Beam = """{"operationType":"create_structural_beam","symbolId":10,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":3000},"end":{"xMm":4000,"yMm":0,"zMm":4000},"rotationDegrees":30}""";
    private const string Footing = """{"operationType":"create_isolated_foundation","symbolId":11,"levelId":20,"point":{"xMm":-400,"yMm":200,"zMm":-700},"rotationDegrees":-90}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_structural_element") { return; }
        throw new Exception("Expected invalid_structural_element.");
    }
    private static JsonElement Set(string input, string field, string value)
    {
        var op = Json(input).EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());
        op[field] = Json(value); return JsonSerializer.SerializeToElement(op);
    }
    private static StructuralElementReadback BeamNative => new(100, "native-beam-identity", 10, 20, -10, "OST_StructuralFraming", "Beam", "CurveDrivenStructural", true,
        new(0,0,3000), new(4000,0,4000), null, Math.PI / 6);
    private static StructuralElementReadback FoundationNative => new(101, "native-footing-identity", 11, 20, -11, "OST_StructuralFoundation", "Footing", "OneLevelBased", true,
        null, null, new(-400,200,-700), -Math.PI / 2);
    private static void Require(string op, StructuralElementReadback value) => StructuralElementRules.Require(Json(op), value,
        op == Beam ? BeamNative.UniqueId : FoundationNative.UniqueId, op == Beam ? -10 : -11);

    public static void Run(Action<string, Action> test)
    {
        test("structural native inputs retain full absolute XYZ and explicit existing IDs", () =>
        {
            foreach (var input in new[] { Beam, Footing })
            {
                StructuralElementRules.Validate(Json(input));
                foreach (var key in new[] { "symbolId", "levelId", input == Beam ? "start" : "point" })
                {
                    var missing = Json(input).EnumerateObject().Where(p => p.Name != key).ToDictionary(p => p.Name, p => p.Value.Clone());
                    Reject(() => StructuralElementRules.Validate(JsonSerializer.SerializeToElement(missing)));
                }
                foreach (var id in new[] { "0", "-1", "1.5", "\"10\"", "\"@new\"", "9007199254740992", "null" })
                    foreach (var key in new[] { "symbolId", "levelId" }) Reject(() => StructuralElementRules.Validate(Set(input,key,id)));
            }
        });
        test("structural fields reject duplicate unknown nonfinite and incomplete points", () =>
        {
            foreach (var input in new[] { Beam, Footing })
            {
                foreach (var field in new[] { "\"symbolId\":10", "\"parameters\":{}", "\"hostColumnId\":1", "\"offsetMm\":0" })
                    Reject(() => StructuralElementRules.Validate(Json(input[..^1] + "," + field + "}")));
                var key = input == Beam ? "start" : "point";
                foreach (var point in new[] { "{}", "{\"xMm\":0,\"yMm\":0}", "{\"xMm\":0,\"yMm\":0,\"zMm\":\"0\"}",
                    "{\"xMm\":0,\"yMm\":0,\"zMm\":1e999}", "{\"xMm\":0,\"yMm\":0,\"zMm\":0,\"zMm\":0}",
                    "{\"xMm\":0,\"yMm\":0,\"zMm\":0,\"extra\":1}" })
                    Reject(() => StructuralElementRules.Validate(Set(input, key, point)));
                foreach (var angle in new[] { "361", "-361", "1e999", "\"30\"", "null" }) Reject(() => StructuralElementRules.Validate(Set(input,"rotationDegrees",angle)));
                StructuralElementRules.Validate(Set(input,"rotationDegrees","360"));
                StructuralElementRules.Validate(Set(input,"rotationDegrees","-360"));
            }
        });
        test("beam horizontal minimum permits sloping beams and rejects vertical overflow and submillimeter spans", () =>
        {
            foreach (var x in new[] { "0", "0.999", "1e308" })
                Reject(() => StructuralElementRules.Validate(Set(Beam,"end","{\"xMm\":" + x + ",\"yMm\":0,\"zMm\":4000}")));
            StructuralElementRules.Validate(Set(Beam,"end","{\"xMm\":1,\"yMm\":0,\"zMm\":4000}"));
            StructuralElementRules.Validate(Set(Beam,"disallowJoin","true"));
            StructuralElementRules.Validate(Set(Beam,"disallowJoin","false"));
            foreach (var bad in new[] { "1", "\"true\"", "null" })
                Reject(() => StructuralElementRules.Validate(Set(Beam,"disallowJoin",bad)));
            Reject(() => StructuralElementRules.Validate(Set(Footing,"disallowJoin","true")));
        });
        test("structural XYZ magnitude accepts exact bounds and rejects every overbound coordinate", () =>
        {
            foreach (var input in new[] { Beam, Footing })
                foreach (var field in new[] { "xMm", "yMm", "zMm" })
                    foreach (var value in new[] { 100000000d, -100000000d, 100000001d, -100000001d })
                    {
                        var coordinates = new Dictionary<string,double> { ["xMm"] = 0, ["yMm"] = 0, ["zMm"] = 0 };
                        coordinates[field] = value;
                        var op = Set(input, input == Beam ? "start" : "point", JsonSerializer.Serialize(coordinates));
                        if (Math.Abs(value) <= 100000000) StructuralElementRules.Validate(op);
                        else Reject(() => StructuralElementRules.Validate(op));
                    }
        });
        test("structural readback compares complete points endpoint reversal and periodic rotation", () =>
        {
            Require(Beam, BeamNative); Require(Footing, FoundationNative);
            Require(Beam, BeamNative with { Start = BeamNative.End, End = BeamNative.Start, RotationRadians = BeamNative.RotationRadians + 2 * Math.PI });
            Reject(() => Require(Beam, BeamNative with { End = new(4000,0,3000) }));
            Reject(() => Require(Beam, BeamNative with { Start = new(0.02,0,3000) }));
            Reject(() => Require(Footing, FoundationNative with { Point = new(-400,200,0) }));
            Reject(() => Require(Footing, FoundationNative with { Point = null }));
            Reject(() => Require(Beam, BeamNative with { RotationRadians = double.NaN }));
            Reject(() => Require(Beam, BeamNative with { RotationRadians = BeamNative.RotationRadians + 0.001 }));
            Reject(() => Require(Footing, FoundationNative with { Point = new(double.NaN,200,-700) }));
        });
        test("structural final readback rejects changed identity category type placement level and activation", () =>
        {
            foreach (var changed in new[] { BeamNative with { ElementId = 0 }, BeamNative with { UniqueId = "replacement" },
                BeamNative with { SymbolId = 12 }, BeamNative with { LevelId = 21 }, BeamNative with { CategoryId = -12 },
                BeamNative with { CategoryKind = "OST_StructuralFoundation" }, BeamNative with { StructuralType = "Brace" },
                BeamNative with { PlacementType = "CurveBased" }, BeamNative with { SymbolIsActive = false } }) Reject(() => Require(Beam,changed));
            Reject(() => Require(Footing, FoundationNative with { StructuralType = "NonStructural" }));
            Reject(() => Require(Footing, FoundationNative with { Start = new(0,0,0) }));
        });
        test("isolated foundation level offset computes explicit height offset and rejects nonfinite or overbound values", () =>
        {
            static void Approx(double actual, double expected)
            {
                if (!double.IsFinite(actual) || Math.Abs(actual - expected) > 1e-9)
                    throw new Exception($"Expected level offset {expected}, got {actual}.");
            }
            Approx(StructuralElementRules.LevelOffsetMm(0, 0), 0);
            Approx(StructuralElementRules.LevelOffsetMm(-700, 0), -700);
            Approx(StructuralElementRules.LevelOffsetMm(-5334, -5334), 0);
            Approx(StructuralElementRules.LevelOffsetMm(-5334, -5156.2), -177.8);
            Reject(() => StructuralElementRules.LevelOffsetMm(double.NaN, 0));
            Reject(() => StructuralElementRules.LevelOffsetMm(0, double.PositiveInfinity));
            Reject(() => StructuralElementRules.LevelOffsetMm(100000001, 0));
            Reject(() => StructuralElementRules.LevelOffsetMm(100000000, -100000000));
        });
    }
}
