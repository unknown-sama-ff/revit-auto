using System.Text.Json;
using RevitAutoV27;

internal static class RoofCreationRulesTests
{
    private const string Roof = """
        {"operationType":"create_footprint_roof","roofTypeId":41,"levelId":12,"boundary":[
         {"xMm":0,"yMm":0,"zMm":4600},{"xMm":4000,"yMm":0,"zMm":4600},
         {"xMm":4000,"yMm":3000,"zMm":4600},{"xMm":0,"yMm":3000,"zMm":4600}],"edgeSlopes":[0.5,0,0.25,0]}
        """;

    internal static void Run(Action<string, Action> test)
    {
        test("roof slopes must be assigned to each explicit footprint edge", () =>
        {
            Reject(() => PlanRules.Validate(Json("[" + Roof.Replace("0.5,0,0.25,0", "0.5,0") + "]")));
            Reject(() => PlanRules.Validate(Json("[" + Roof.Replace("0.5,0,0.25,0", "0.5,0,-1,0") + "]")));
            Reject(() => PlanRules.Validate(Json("[" + Roof + ",{\"operationType\":\"delete_element\",\"elementId\":12}]")));
        });
        test("roof readback associates native slope with the actual edge despite reversed and reordered curves", () =>
        {
            var input = RoofCreationRules.Validate(Json(Roof));
            var p = input.Boundary;
            RoofEdge[] edges = [new(p[3], p[2], true, 0.25), new(p[3], p[0], false, null),
                new(p[1], p[0], true, 0.5), new(p[2], p[1], false, null)];
            RoofCreationRules.RequireFootprint(input, edges, 4600);
            Reject(() => RoofCreationRules.RequireFootprint(input, edges, 4000));
            edges[0] = edges[0] with { RiseOverRun = 0.5 };
            Reject(() => RoofCreationRules.RequireFootprint(input, edges, 4600));
        });
    }

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_roof_creation") { return; }
        throw new Exception("The roof contract accepted a geometry or source mismatch.");
    }
}
