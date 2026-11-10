using RevitAutoV27;
using System.Text.Json;

internal static class AnnotationInputRulesTests
{
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(string text, params string[] acceptedCodes)
    {
        if (acceptedCodes.Length == 0) acceptedCodes = ["invalid_annotation_input"];
        try { PlanRules.Validate(Json("[" + text + "]")); }
        catch (BridgeException e) when (acceptedCodes.Contains(e.Code)) { return; }
        throw new Exception("Expected annotation input or existing ID-contract rejection.");
    }
    public static void Run(Action<string, Action> test)
    {
        const string tag = """{"operationType":"create_tag","elementId":1,"viewId":2,"xMm":0,"yMm":0""";
        const string dimension = """{"operationType":"create_dimension","viewId":2,"start":{"xMm":0,"yMm":0},"end":{"xMm":100,"yMm":0}""";
        test("annotation tag rejects ignored fields and case mismatches", () =>
        {
            foreach (var field in new[] { "\"hasLeader\":true", "\"tagtypeid\":3", "\"viewid\":2", "\"code\":\"never run\"" })
                Reject(tag + "," + field + "}");
        });
        test("annotation optional type IDs cannot silently use defaults on null", () =>
        {
            foreach (var value in new[] { "null", "true", "{}", "[]", "\"\"", "\"@\"" })
            {
                Reject(tag + ",\"tagTypeId\":" + value + "}", "invalid_reference", "invalid_annotation_input");
                Reject(dimension + ",\"references\":[\"a\",\"b\"],\"dimensionTypeId\":" + value + "}", "invalid_reference", "invalid_annotation_input");
            }
        });
        test("annotation tag preserves valid fields and explicit leader false", () =>
        {
            PlanRules.Validate(Json("[" + tag + ",\"tagTypeId\":3,\"leader\":false,\"mark\":\"T\",\"parameters\":{\"Comments\":\"ok\"}}]"));
        });
        test("dimension rejects missing scalar object and empty references", () =>
        {
            Reject(dimension + "}");
            foreach (var value in new[] { "null", "\"not-an-array\"", "{}", "[]", "[\"a\"]", "[\"a\",null]", "[1,2]", "[\"\",\"b\"]", "[\" \",\"b\"]" })
                Reject(dimension + ",\"references\":" + value + "}");
        });
        test("dimension rejects identical stable references without normalizing distinct values", () =>
        {
            Reject(dimension + ",\"references\":[\"a\",\"a\"]}");
            PlanRules.Validate(Json("[" + dimension + ",\"references\":[\"a\",\"A\"]}]"));
        });
        test("dimension annotation input bounds reference count and string size before native parsing", () =>
        {
            string Operation(string[] refs) => dimension + ",\"references\":" + JsonSerializer.Serialize(refs) + "}";
            var refs = Enumerable.Range(1,128).Select(i=>"ref-"+i).ToArray();
            PlanRules.Validate(Json("["+Operation(refs)+"]"));
            Reject(Operation(refs.Concat(["ref-129"]).ToArray()));
            PlanRules.Validate(Json("["+Operation([new string('x',4096),"b"])+"]"));
            Reject(Operation([new string('x',4097),"b"]));
        });
        test("dimension rejects undocumented fields while allowing parameter and mark maps", () =>
        {
            Reject(dimension + ",\"references\":[\"a\",\"b\"],\"dimensionStyle\":3}");
            PlanRules.Validate(Json("[" + dimension + ",\"references\":[\"a\",\"b\"],\"dimensionTypeId\":3,\"mark\":\"D\",\"parameters\":{}}]"));
        });
        test("annotation unknown-field diagnostics never expose supplied values", () =>
        {
            const string secret = "never-echo-this-value";
            try { PlanRules.Validate(Json("[" + tag + ",\"ignored\":\"" + secret + "\"}]")); }
            catch (BridgeException e) when (e.Code == "invalid_annotation_input")
            { if (e.Message.Contains(secret)) throw new Exception("Argument value leaked."); return; }
            throw new Exception("Expected rejection.");
        });
    }
}
