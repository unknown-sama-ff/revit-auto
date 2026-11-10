using System.Text.Json;
using RevitAutoV27;

internal static class ArchitectureRulesTests
{
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private const string Column = """{"operationType":"create_structural_column","symbolId":10,"baseLevelId":20,"topLevelId":30,"baseOffsetMm":100,"topOffsetMm":-200,"point":{"xMm":3000,"yMm":4000}}""";
    private const string Grid = """{"operationType":"create_grid","name":"AX-1","start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":3000,"yMm":0,"zMm":0}}""";
    private static void Throws(string code, Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == code) { return; }
        throw new Exception("Expected " + code);
    }

    public static void Run(Action<string, Action> test)
    {
        test("structural column requires explicit native type levels offsets and XY", () =>
        {
            PlanRules.Validate(Json("[" + Column + "]"));
            foreach (var field in new[] { "symbolId", "baseLevelId", "topLevelId", "baseOffsetMm", "topOffsetMm", "point" })
            {
                var op = Json(Column).EnumerateObject().Where(property => property.Name != field).ToDictionary(property => property.Name, property => property.Value.Clone());
                Throws("invalid_structural_column", () => ArchitectureRules.StructuralColumn(JsonSerializer.SerializeToElement(op)));
            }
        });
        test("structural column permits copied type syntax but rejects deferred levels and undeclared geometry mutation", () =>
        {
            ArchitectureRules.StructuralColumn(Json(Column.Replace("\"symbolId\":10", "\"symbolId\":\"@created\"")));
            foreach (var reference in new[] { "@", "@ created", "@created ", "@created\n", "@" + new string('x', 81) })
                Throws("invalid_structural_column", () => ArchitectureRules.StructuralColumn(Json(Column.Replace("\"symbolId\":10", "\"symbolId\":" + JsonSerializer.Serialize(reference)))));
            foreach (var field in new[] { "baseLevelId", "topLevelId" })
            {
                var op = Json(Column).EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone());
                op[field] = Json("\"@created\"");
                Throws("invalid_structural_column", () => ArchitectureRules.StructuralColumn(JsonSerializer.SerializeToElement(op)));
            }
            foreach (var extra in new[] { "\"heightMm\":4000", "\"parameters\":{}", "\"baseOffsetMm\":200" })
                Throws("invalid_structural_column", () => ArchitectureRules.StructuralColumn(Json(Column[..^1] + "," + extra + "}")));
            Throws("invalid_structural_column", () => ArchitectureRules.StructuralColumn(Json(Column.Replace("\"yMm\":4000", "\"yMm\":4000,\"zMm\":0"))));
        });
        test("column vertical extent rejects reversed levels and offset-collapsed height", () =>
        {
            ArchitectureRules.RequireVerticalExtent(0, 4000, 100, -200);
            Throws("invalid_structural_column", () => ArchitectureRules.RequireVerticalExtent(4000, 0, 0, 0));
            Throws("invalid_structural_column", () => ArchitectureRules.RequireVerticalExtent(0, 4000, 3000, -1000));
            Throws("invalid_structural_column", () => ArchitectureRules.RequireVerticalExtent(0, 4000, double.NaN, 0));
        });
        test("native column offsets preserve known zero and refuse missing or nonfinite evidence", () =>
        {
            if (ArchitectureRules.NativeOffset(true, 0) != 0 || ArchitectureRules.NativeOffset(true, -200) != -200) throw new Exception();
            Throws("invalid_structural_column", () => ArchitectureRules.NativeOffset(false, 0));
            foreach (var value in new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity })
                Throws("invalid_structural_column", () => ArchitectureRules.NativeOffset(true, value));
        });
        test("named horizontal grids validate but unnamed tilted degenerate and hidden fields fail", () =>
        {
            PlanRules.Validate(Json("[" + Grid + "]"));
            Throws("invalid_grid", () => ArchitectureRules.Grid(Json(Grid.Replace("\"name\":\"AX-1\",", ""))));
            Throws("invalid_grid", () => ArchitectureRules.Grid(Json(Grid.Replace("\"xMm\":3000,\"yMm\":0,\"zMm\":0", "\"xMm\":3000,\"yMm\":0,\"zMm\":1"))));
            Throws("invalid_grid", () => ArchitectureRules.Grid(Json(Grid.Replace("\"xMm\":3000", "\"xMm\":0.5"))));
            Throws("invalid_grid", () => ArchitectureRules.Grid(Json(Grid[..^1] + ",\"parameters\":{}}")));
            Throws("invalid_grid", () => ArchitectureRules.Grid(Json(Grid[..^1] + ",\"name\":\"AX-2\"}")));
            Throws("invalid_grid", () => PlanRules.Validate(Json("[" + Grid + "," + Grid + "]")));
        });
    }
}
