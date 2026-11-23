using System.Text.Json;
using RevitAutoV27;

internal static class MaterialCreationRulesTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("material plan rejects partial graphics and collisions with another operation", () =>
        {
            Reject("""[{"operationType":"create_material","name":"M","color":{"red":0,"green":0}}]""");
            Reject("""[{"operationType":"create_material","name":"M"},{"operationType":"duplicate_material","name":"m","sourceMaterialId":5}]""");
            Reject("""[{"operationType":"duplicate_material","name":"M","sourceMaterialId":5},{"operationType":"delete_element","elementId":5}]""");
        });
        test("material readback matches explicit graphics and source rather than names alone", () =>
        {
            var input = MaterialCreationRules.Validate(Json("""{"operationType":"create_material","name":"M","color":{"red":4,"green":5,"blue":6},"transparency":40}"""));
            var graphics = new MaterialGraphics("Concrete", "", new(4, 5, 6), 40, 0, 0, false);
            MaterialCreationRules.Require(input, "M", graphics, null);
            try { MaterialCreationRules.Require(input, "M", graphics with { Transparency = 41 }, null); }
            catch (BridgeException) { return; }
            throw new Exception("Native graphics mismatch was accepted.");
        });
        test("assignment resolves a material reference and rejects a reference to another native class", () =>
        {
            const string assignment = """{"operationType":"assign_material","elementId":42,"parameter":"BIP:STRUCTURAL_MATERIAL_PARAM","materialId":"@reviewed"}""";
            var creation = """{"operationType":"create_material","id":"reviewed","name":"Example material"}""";
            PlanRules.Validate(Json("[" + creation + "," + assignment + "]"));
            Reject("""[{"operationType":"create_level","id":"reviewed","name":"Level","elevationMm":10},""" + assignment + "]");
            Reject("[" + creation + "," + assignment + "," + assignment + "]");
        });
    }

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(string text)
    {
        try { PlanRules.Validate(Json(text)); }
        catch (BridgeException error) when (error.Code == "invalid_material_creation") { return; }
        throw new Exception("Invalid material plan was accepted.");
    }
}
