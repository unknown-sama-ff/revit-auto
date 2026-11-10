using System.Text.Json;
using RevitAutoV27;

internal static class ViewportLabelRulesTests
{
    private const string Valid = """{"operationType":"move_viewport_label","id":"label1","viewportId":10,"sheetId":20,"viewId":30,"labelOffsetXMm":15,"labelOffsetYMm":25}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_viewport_label") { return; }
        throw new Exception("Expected invalid_viewport_label.");
    }

    public static void Run(Action<string, Action> test)
    {
        test("viewport label movement preserves explicit existing viewport owner and source identifiers", () => {
            var op = Json(Valid);
            ViewportLabelRules.Validate(op);
            ViewportLabelRules.ValidatePlan([op]);
            if (ViewportLabelRules.ExistingId(op, "viewportId") != 10 ||
                ViewportLabelRules.ExistingId(op, "sheetId") != 20 ||
                ViewportLabelRules.ExistingId(op, "viewId") != 30) throw new Exception("Viewport label scope changed.");
            PlanRules.Validate(Json("[" + Valid + "]"));
        });

        test("viewport label offsets accept signed coordinate bounds and optional zero depth", () => {
            foreach (var coordinates in new[] {
                "\"labelOffsetXMm\":-100000000,\"labelOffsetYMm\":100000000",
                "\"labelOffsetXMm\":0,\"labelOffsetYMm\":0,\"labelOffsetZMm\":0",
                "\"labelOffsetXMm\":-0.125,\"labelOffsetYMm\":0.125,\"labelOffsetZMm\":-0"
            }) ViewportLabelRules.Validate(Json(Valid.Replace("\"labelOffsetXMm\":15,\"labelOffsetYMm\":25", coordinates)));
        });

        test("viewport label line length accepts native signed lengths and remains optional", () => {
            ViewportLabelRules.Validate(Json(Valid));
            foreach (var length in new[] { "-100000000", "-25.5", "0", "25.5", "100000000" })
                ViewportLabelRules.Validate(Json(Valid.Replace("}", ",\"labelLineLengthMm\":" + length + "}")));
        });

        test("viewport label identifiers must be distinct existing positive safe integers", () => {
            foreach (var field in new[] { "viewportId", "sheetId", "viewId" })
            {
                var original = field == "viewportId" ? "10" : field == "sheetId" ? "20" : "30";
                foreach (var bad in new[] { "0", "-1", "10.5", "9007199254740992", "null", "\"@created\"", "\"10\"" })
                    Reject(() => ViewportLabelRules.Validate(Json(Valid.Replace("\"" + field + "\":" + original, "\"" + field + "\":" + bad))));
            }
            foreach (var repeated in new[] {
                Valid.Replace("\"sheetId\":20", "\"sheetId\":10"),
                Valid.Replace("\"viewId\":30", "\"viewId\":10"),
                Valid.Replace("\"viewId\":30", "\"viewId\":20")
            }) Reject(() => ViewportLabelRules.Validate(Json(repeated)));
        });

        test("viewport label movement refuses missing unknown duplicate and ambiguous setters", () => {
            foreach (var invalid in new[] {
                Valid.Replace("\"viewportId\":10,", ""),
                Valid.Replace("\"labelOffsetXMm\":15,", ""),
                Valid.Replace(",\"labelOffsetYMm\":25", ""),
                Valid.Replace("}", ",\"xMm\":15}"),
                Valid.Replace("}", ",\"labelOffset\":{\"xMm\":15,\"yMm\":25,\"zMm\":0}}"),
                Valid.Replace("}", ",\"parameters\":{\"Comments\":\"hidden\"}}"),
                Valid.Replace("}", ",\"rotation\":\"None\"}"),
                Valid.Replace("}", ",\"viewportId\":11}"),
                Valid.Replace("}", ",\"labelOffsetXMm\":16}"),
                Valid.Replace("}", ",\"operationType\":\"move_viewport_label\"}"),
                Valid.Replace("move_viewport_label", "move_drawing_placement"),
                "null", "[]"
            }) Reject(() => ViewportLabelRules.Validate(Json(invalid)));
            Reject(() => ViewportLabelRules.Validate(Json(Valid.Replace("}", ",\"labelLineLengthMm\":25,\"labelLineLengthMm\":26}"))));
        });

        test("viewport label offsets require finite numeric bounded XY and exact optional zero Z", () => {
            foreach (var field in new[] { "labelOffsetXMm", "labelOffsetYMm" })
            {
                var original = field == "labelOffsetXMm" ? "15" : "25";
                foreach (var bad in new[] { "null", "\"15\"", "true", "1e308", "100000000.001", "-100000000.001" })
                    Reject(() => ViewportLabelRules.Validate(Json(Valid.Replace("\"" + field + "\":" + original, "\"" + field + "\":" + bad))));
            }
            foreach (var bad in new[] { "null", "\"0\"", "true", "1", "-0.01", "1e308" })
                Reject(() => ViewportLabelRules.Validate(Json(Valid.Replace("}", ",\"labelOffsetZMm\":" + bad + "}"))));
        });

        test("viewport label line length rejects non-finite malformed and out-of-bound optional values", () => {
            foreach (var bad in new[] { "null", "\"25\"", "false", "{}", "1e308", "100000000.001", "-100000000.001" })
                Reject(() => ViewportLabelRules.Validate(Json(Valid.Replace("}", ",\"labelLineLengthMm\":" + bad + "}"))));
        });

        test("viewport label metadata must remain explicit bounded identifiers and dependencies", () => {
            ViewportLabelRules.Validate(Json(Valid.Replace("}", ",\"dependencies\":[]}")));
            ViewportLabelRules.Validate(Json(Valid.Replace("\"id\":\"label1\",", "")));
            foreach (var metadata in new[] {
                "\"id\":null", "\"id\":1", "\"id\":\" \"", "\"id\":\"" + new string('a', 81) + "\""
            }) Reject(() => ViewportLabelRules.Validate(Json(Valid.Replace("\"id\":\"label1\"", metadata))));
            foreach (var dependencies in new[] { "null", "\"\"", "{}", "[null]", "[\"\"]", "[\" \" ]", "[\"" + new string('a', 81) + "\"]" })
                Reject(() => ViewportLabelRules.Validate(Json(Valid.Replace("}", ",\"dependencies\":" + dependencies + "}"))));
            var tooMany = JsonSerializer.Serialize(Enumerable.Repeat("before", 1001));
            Reject(() => ViewportLabelRules.Validate(Json(Valid.Replace("}", ",\"dependencies\":" + tooMany + "}"))));
        });

        test("viewport label native plans reject duplicate targets and every competing operation in either order", () => {
            var label = Json(Valid);
            foreach (var other in new[] {
                Valid.Replace("\"label1\"", "\"label2\"").Replace("\"viewportId\":10", "\"viewportId\":11"),
                """{"operationType":"move_drawing_placement","placementId":10,"sheetId":20,"viewId":30,"xMm":420,"yMm":280}""",
                """{"operationType":"configure_view","viewId":30,"referenceViewId":31,"settings":["crop"],"viewportId":10,"paperPoint":{"xMm":420,"yMm":280}}""",
                """{"operationType":"set_parameter","elementId":99,"parameter":"Comments","value":"Other write"}"""
            })
            {
                var op = Json(other);
                Reject(() => ViewportLabelRules.ValidatePlan([label, op]));
                Reject(() => ViewportLabelRules.ValidatePlan([op, label]));
                Reject(() => PlanRules.Validate(Json("[" + Valid + "," + other + "]")));
                Reject(() => PlanRules.Validate(Json("[" + other + "," + Valid + "]")));
            }
            Reject(() => ViewportLabelRules.ValidatePlan([label, label]));
            ViewportLabelRules.ValidatePlan([Json("""{"operationType":"set_parameter","elementId":99,"parameter":"Comments","value":"Other write"}""")]);
        });
    }
}
