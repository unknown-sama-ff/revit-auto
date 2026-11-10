using System.Text.Json;
using RevitAutoV27;

internal static class ArchitectureTypeCopyRulesTests
{
    private const string Valid = """{"operationType":"duplicate_architecture_type","id":"columnType","dependencies":["checked"],"sourceTypeId":10,"name":"Reviewed 500×500","category":"OST_StructuralColumns","dimensions":[{"parameterId":-1001,"name":"b","valueMm":500},{"parameterId":2002,"name":"h","valueMm":500}]}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_architecture_type_copy") { return; }
        throw new Exception("Expected invalid_architecture_type_copy.");
    }
    private static void RejectPlan(string code, params string[] operations)
    {
        try { PlanRules.Validate(Json("[" + string.Join(",", operations) + "]")); }
        catch (BridgeException error) when (error.Code == code) { return; }
        throw new Exception("Expected " + code);
    }
    private static void AcceptPlan(params string[] operations) => PlanRules.Validate(Json("[" + string.Join(",", operations) + "]"));
    private static string Copy(string category = "OST_StructuralColumns", string id = "columnType", long sourceId = 10, string name = "Reviewed 500×500") =>
        Valid.Replace("\"OST_StructuralColumns\"", JsonSerializer.Serialize(category)).Replace("\"columnType\"", JsonSerializer.Serialize(id))
            .Replace("\"sourceTypeId\":10", "\"sourceTypeId\":" + sourceId).Replace("\"Reviewed 500×500\"", JsonSerializer.Serialize(name)).Replace("\"dependencies\":[\"checked\"],", "");
    private const string Column = """{"operationType":"create_structural_column","symbolId":"@columnType","baseLevelId":20,"topLevelId":30,"baseOffsetMm":0,"topOffsetMm":0,"point":{"xMm":1000,"yMm":2000}}""";
    private static string Placement(string? category = "OST_Doors", string symbolId = "\"@columnType\"") =>
        "{\"operationType\":\"create_family_instance\",\"symbolId\":" + symbolId + (category is null ? "" : ",\"category\":" + JsonSerializer.Serialize(category)) +
        ",\"hostElementId\":50,\"levelId\":20,\"point\":{\"xMm\":1000,\"yMm\":0,\"zMm\":0}}";
    private static string Replace(string field, string value)
    {
        var op = Json(Valid).EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone());
        op[field] = Json(value);
        return JsonSerializer.Serialize(op);
    }
    public static void Run(Action<string, Action> test)
    {
        test("architecture copy preserves explicit source signed parameter IDs exact selectors and millimeters", () =>
        {
            var result = ArchitectureTypeCopyRules.Validate(Json(Valid));
            if (result.SourceTypeId != 10 || result.Name != "Reviewed 500×500" || result.Category != "OST_StructuralColumns" ||
                result.Dimensions.Length != 2 || result.Dimensions[0] != new ArchitectureTypeDimension(-1001, "b", 500) ||
                result.Dimensions[1] != new ArchitectureTypeDimension(2002, "h", 500)) throw new Exception("Exact input identity changed.");
            foreach (var category in new[] { "OST_Doors", "OST_Windows" })
                ArchitectureTypeCopyRules.Validate(Json(Replace("category", JsonSerializer.Serialize(category))));
        });
        test("architecture copy requires every reviewed field without defaults", () =>
        {
            foreach (var missing in new[] { "operationType", "sourceTypeId", "name", "category", "dimensions" })
            {
                var op = Json(Valid).EnumerateObject().Where(property => property.Name != missing).ToDictionary(property => property.Name, property => property.Value.Clone());
                Reject(() => ArchitectureTypeCopyRules.Validate(JsonSerializer.SerializeToElement(op)));
            }
            foreach (var missing in new[] { "parameterId", "name", "valueMm" })
            {
                var dimensions = JsonDefaults.Get(Json(Valid), "dimensions").EnumerateArray().Select(value => value.Clone()).ToArray();
                var first = dimensions[0].EnumerateObject().Where(property => property.Name != missing).ToDictionary(property => property.Name, property => property.Value.Clone());
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Replace("dimensions", JsonSerializer.Serialize(new object[] { first, dimensions[1] })))));
            }
        });
        test("architecture copy rejects deferred unsafe noninteger or nonpositive native source IDs", () =>
        {
            foreach (var value in new[] { "0", "-1", "9007199254740992", "10.5", "null", "true", "\"10\"", "\"@source\"", "{}" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Replace("sourceTypeId", value))));
            ArchitectureTypeCopyRules.Validate(Json(Replace("sourceTypeId", "9007199254740991")));
        });
        test("architecture copy parameter IDs are signed nonzero safe integers", () =>
        {
            foreach (var value in new[] { "0", "9007199254740992", "-9007199254740992", "-1.5", "null", "\"-1001\"", "\"@dimension\"" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"parameterId\":-1001", "\"parameterId\":" + value))));
            ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"parameterId\":-1001", "\"parameterId\":-9007199254740991")));
        });
        test("architecture copy rejects unknown categories wrong operation paths and hidden parameter maps", () =>
        {
            foreach (var category in new[] { "OST_Walls", "OST_Columns", "Doors", "ost_doors", "", " OST_Doors" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Replace("category", JsonSerializer.Serialize(category)))));
            Reject(() => ArchitectureTypeCopyRules.Validate(Json(Replace("operationType", "\"duplicate_type\""))));
            foreach (var extra in new[] { "\"parameters\":{}", "\"path\":\"family.rfa\"", "\"widthMm\":500", "\"heightMm\":500", "\"activate\":true", "\"sourceTypeId\":20" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Valid[..^1] + "," + extra + "}")));
        });
        test("architecture copy requires exactly two dimensions and rejects duplicate selectors", () =>
        {
            foreach (var value in new[] { "null", "{}", "[]", "[{\"parameterId\":1,\"name\":\"Width\",\"valueMm\":500}]", "[{}, {}, {}]" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Replace("dimensions", value))));
            Reject(() => ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"parameterId\":2002", "\"parameterId\":-1001"))));
            Reject(() => ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"name\":\"h\"", "\"name\":\"b\""))));
        });
        test("architecture copy dimensions reject unknown duplicate schema fields and unsafe numeric values", () =>
        {
            foreach (var value in new[] { "0", "-1", "100000000.01", "1e309", "null", "true", "\"500\"", "{}" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"valueMm\":500", "\"valueMm\":" + value))));
            ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"valueMm\":500", "\"valueMm\":100000000")));
            foreach (var extra in new[] { "\"unit\":\"mm\"", "\"valueMm\":600", "\"name\":\"Height\"", "\"parameterId\":99" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"name\":\"b\",\"valueMm\":500}", "\"name\":\"b\",\"valueMm\":500," + extra + "}"))));
        });
        test("architecture copy keeps exact native parameter names instead of normalization or aliases", () =>
        {
            var result = ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"name\":\"b\"", "\"name\":\"截面 宽度\"")));
            if (result.Dimensions[0].Name != "截面 宽度") throw new Exception("Native parameter name changed.");
            foreach (var value in new[] { "null", "10", "\"\"", "\" \"", "\" 宽度 \"", "\"Width\\n\"" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"name\":\"b\"", "\"name\":" + value))));
            Reject(() => ArchitectureTypeCopyRules.Validate(Json(Valid.Replace("\"name\":\"b\"", "\"name\":\"" + new string('x', 201) + "\""))));
        });
        test("architecture copy target names are exact trimmed bounded Revit names", () =>
        {
            foreach (var name in new[] { "", " ", " Leading", "Trailing ", "D:\\types", "a/b", "a:b", "invalid?", "invalid[", "invalid;", "invalid`", "invalid~", "line\nbreak", new string('x', 201) })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Replace("name", JsonSerializer.Serialize(name)))));
            ArchitectureTypeCopyRules.Validate(Json(Replace("name", JsonSerializer.Serialize(new string('x', 200)))));
        });
        test("architecture copy metadata rejects null untrimmed duplicate or self dependencies", () =>
        {
            foreach (var value in new[] { "null", "1", "\"\"", "\" copy \"" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Replace("id", value))));
            foreach (var value in new[] { "null", "{}", "[null]", "[1]", "[\"\"]", "[\" checked\"]", "[\"checked\",\"checked\"]", "[\"columnType\"]" })
                Reject(() => ArchitectureTypeCopyRules.Validate(Json(Replace("dependencies", value))));
            var minimal = Json(Valid).EnumerateObject().Where(property => property.Name is not ("id" or "dependencies")).ToDictionary(property => property.Name, property => property.Value.Clone());
            ArchitectureTypeCopyRules.Validate(JsonSerializer.SerializeToElement(minimal));
        });
        test("architecture copy readback allows tolerance and rejects nonfinite missing or changed dimensions", () =>
        {
            ArchitectureTypeCopyRules.RequireReadback(500, 500);
            ArchitectureTypeCopyRules.RequireReadback(500, 500.009);
            ArchitectureTypeCopyRules.RequireReadback(500, 499.991);
            foreach (var actual in new[] { 500.011, 499.989, 0, -1, double.NaN, double.PositiveInfinity, double.NegativeInfinity })
                Reject(() => ArchitectureTypeCopyRules.RequireReadback(500, actual));
            foreach (var expected in new[] { 0, -1, 100000001, double.NaN, double.PositiveInfinity })
                Reject(() => ArchitectureTypeCopyRules.RequireReadback(expected, 500));
        });
        test("architecture plan accepts dedicated native dimensions before matching column door and window placements", () =>
        {
            AcceptPlan(Copy(), Column);
            foreach (var category in new[] { "OST_Doors", "OST_Windows" }) AcceptPlan(Copy(category), Placement(category));
            AcceptPlan(Copy(), Copy(id: "secondType", name: "Reviewed 600"));
            AcceptPlan(Copy(), Copy(id: "secondType", sourceId: 11)); // Native preflight checks family membership.
        });
        test("architecture plan refuses forward unresolved dependencies and duplicate source target pairs", () =>
        {
            RejectPlan("invalid_reference", Column, Copy());
            RejectPlan("invalid_dependency", Valid);
            RejectPlan("invalid_reference", Copy().Replace("\"sourceTypeId\":10", "\"sourceTypeId\":\"@columnType\""));
            RejectPlan("architecture_type_copy_conflict", Copy(), Copy(id: "secondType"));
            AcceptPlan("""{"operationType":"create_level","id":"checked","name":"Checked","elevationMm":0}""", Valid);
        });
        test("architecture plan protects source and copied types from changes on either side of copy", () =>
        {
            var mutations = new[]
            {
                """{"operationType":"set_parameter","elementId":10,"parameter":"b","value":{"value":600,"unit":"mm"}}""",
                """{"operationType":"delete_element","elementId":10}""",
                """{"operationType":"duplicate_type","sourceTypeId":10,"name":"Other"}"""
            };
            foreach (var mutation in mutations)
            {
                RejectPlan("architecture_type_copy_conflict", mutation, Copy());
                RejectPlan("architecture_type_copy_conflict", Copy(), mutation);
                RejectPlan("architecture_type_copy_conflict", Copy(), mutation.Replace(":10", ":\"@columnType\""));
            }
            AcceptPlan(Copy(), mutations[0].Replace(":10", ":999"));
        });
        test("architecture plan rejects source type placement and family loading regardless of order", () =>
        {
            var load = """{"operationType":"load_family","familyKey":"reviewed-family","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","catalogSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","expectedFamilyName":"Reviewed","expectedCategoryId":-2000023,"requiredTypes":["Standard"],"conflictPolicy":"reject","overwriteTypeParameters":false}""";
            foreach (var placement in new[] { Placement(symbolId: "10"), Column.Replace("\"@columnType\"", "10"), load })
            {
                RejectPlan("architecture_type_copy_conflict", placement, Copy());
                RejectPlan("architecture_type_copy_conflict", Copy(), placement);
            }
        });
        test("architecture plan binds each copied type to an explicit matching placement category", () =>
        {
            RejectPlan("architecture_type_reference_mismatch", Copy("OST_Doors"), Column);
            foreach (var category in new string?[] { "OST_Doors", "OST_Windows", "OST_StructuralColumns", null, "OST_LightingFixtures" })
                RejectPlan("architecture_type_reference_mismatch", Copy(), Placement(category));
            RejectPlan("architecture_type_reference_mismatch", Copy("OST_Windows"), Placement());
            var generic = """{"operationType":"duplicate_type","id":"columnType","sourceTypeId":10,"name":"Generic"}""";
            RejectPlan("architecture_type_reference_mismatch", generic, Column);
            RejectPlan("architecture_type_reference_mismatch", generic, Placement());
            RejectPlan("architecture_type_reference_mismatch", """{"operationType":"create_level","id":"columnType","name":"L","elevationMm":0}""", Column);
        });
        test("architecture plan cannot borrow copied types as hosts views or instance arrays", () =>
        {
            foreach (var op in new[]
            {
                Placement().Replace("\"hostElementId\":50", "\"hostElementId\":\"@columnType\""),
                """{"operationType":"create_panel_schedule","panelId":"@columnType"}""",
                """{"operationType":"create_circuit","elementIds":["@columnType"],"panelId":99}""",
                """{"operationType":"create_tag","viewId":50,"elementId":"@columnType","xMm":0,"yMm":0}"""
            }) RejectPlan("architecture_type_reference_mismatch", Copy("OST_Doors"), op);
        });
        test("architecture plan keeps generic lighting and independent existing architecture placement compatible", () =>
        {
            AcceptPlan("""{"operationType":"duplicate_type","id":"columnType","sourceTypeId":10,"name":"Lighting copy"}""", Placement(null));
            AcceptPlan(Placement(symbolId: "40"));
            AcceptPlan(Column.Replace("\"@columnType\"", "40"));
            AcceptPlan(Copy(), Column.Replace("\"@columnType\"", "40"));
        });
        test("native resolved family names cannot place a copy source before or after copying", () =>
        {
            var alias = Json("""{"operationType":"create_family_instance","family":"Wall Door","type":"Existing 900","hostElementId":50,"levelId":20,"point":{"xMm":1000,"yMm":0,"zMm":0}}""");
            long Resolve(JsonElement op) => JsonDefaults.String(op, "family") == "Wall Door" && JsonDefaults.String(op, "type") == "Existing 900" ? 10 : 40;
            foreach (var operations in new[] { new[] { Json(Copy("OST_Doors")), alias }, new[] { alias, Json(Copy("OST_Doors")) } })
            {
                try { ArchitectureTypeCopyRules.ValidateResolvedPlacementTypes(operations, Resolve); }
                catch (BridgeException error) when (error.Code == "architecture_type_copy_conflict") { continue; }
                throw new Exception("Native family/type alias bypassed source invariance.");
            }
            ArchitectureTypeCopyRules.ValidateResolvedPlacementTypes([Json(Copy("OST_Doors")), Json(alias.GetRawText().Replace("Existing 900", "Independent 800"))], Resolve);
        });
        test("resolved placement guard preserves dedicated references and existing types outside copy scope", () =>
        {
            var calls = 0;
            long Resolve(JsonElement _) { calls++; return 40; }
            ArchitectureTypeCopyRules.ValidateResolvedPlacementTypes([Json(Copy()), Json(Column)], Resolve);
            if (calls != 0) throw new Exception("A preview source surrogate was mistaken for a materialized dedicated copy.");
            ArchitectureTypeCopyRules.ValidateResolvedPlacementTypes([Json(Copy()), Json(Column.Replace("\"@columnType\"", "40"))], Resolve);
            if (calls != 1) throw new Exception("Existing placement was not resolved.");
            ArchitectureTypeCopyRules.ValidateResolvedPlacementTypes([Json(Placement(symbolId: "10"))], _ => throw new Exception("Standalone placement was unexpectedly guarded."));
            foreach (var unresolved in new long[] { 0, -1, 9007199254740992 })
            {
                try { ArchitectureTypeCopyRules.ValidateResolvedPlacementTypes([Json(Copy()), Json(Column.Replace("\"@columnType\"", "40"))], _ => unresolved); }
                catch (BridgeException error) when (error.Code == "architecture_type_copy_conflict") { continue; }
                throw new Exception("Unresolved or unsafe native placement evidence was accepted.");
            }
        });
    }
}
