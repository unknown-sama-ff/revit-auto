using RevitAutoV27;
using System.Text.Json;

internal static class GridCreationReadbackRulesTests
{
    private const string Operation = """{"operationType":"create_grid","name":"AI-AX-1","start":{"xMm":0,"yMm":0},"end":{"xMm":3000,"yMm":0}}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static readonly GridCreationReadback Native = new("AI-AX-1", false, true, new(0, 0, 0, 3000, 0, 0));
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_grid") { return; }
        throw new Exception("Expected invalid_grid.");
    }

    public static void Run(Action<string, Action> test)
    {
        test("grid native readback accepts explicit name and reversed straight endpoints with default Z", () =>
        {
            var operation = Json(Operation);
            GridCreationReadbackRules.Require(operation, Native);
            GridCreationReadbackRules.Require(operation, Native with { Location = new(3000, 0, 0, 0, 0, 0) });
            if (operation.GetRawText() != Operation) throw new Exception("Reviewed operation changed.");
        });
        test("grid native readback preserves absolute nonzero plane and rejects normalized Z", () =>
        {
            var operation = Json(Operation.Replace("\"yMm\":0", "\"yMm\":0,\"zMm\":4200"));
            GridCreationReadbackRules.Require(operation, Native with { Location = new(0, 0, 4200, 3000, 0, 4200) });
            Reject(() => GridCreationReadbackRules.Require(operation, Native));
        });
        test("grid native readback rejects each name curve bound and coordinate drift", () =>
        {
            foreach (var actual in new[] { Native with { Name = "AI-AX-2" }, Native with { Name = "ai-ax-1" }, Native with { Name = null! },
                Native with { IsCurved = true }, Native with { IsBound = false },
                Native with { Location = Native.Location with { StartXmm = 0.1 } }, Native with { Location = Native.Location with { StartYmm = 0.1 } },
                Native with { Location = Native.Location with { StartZmm = 0.1 } }, Native with { Location = Native.Location with { EndXmm = 2999 } },
                Native with { Location = Native.Location with { EndYmm = 0.1 } }, Native with { Location = Native.Location with { EndZmm = 0.1 } } })
                Reject(() => GridCreationReadbackRules.Require(Json(Operation), actual));
        });
        test("grid native readback rejects nonfinite values in every endpoint coordinate", () =>
        {
            foreach (var value in new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity })
                foreach (var edge in new[] { Native.Location with { StartXmm = value }, Native.Location with { StartYmm = value }, Native.Location with { StartZmm = value },
                    Native.Location with { EndXmm = value }, Native.Location with { EndYmm = value }, Native.Location with { EndZmm = value } })
                    Reject(() => GridCreationReadbackRules.Require(Json(Operation), Native with { Location = edge }));
        });
        test("grid endpoint tolerance is a three dimensional distance rather than per axis tolerance", () =>
        {
            GridCreationReadbackRules.Require(Json(Operation), Native with { Location = Native.Location with { StartXmm = 0.01 } });
            Reject(() => GridCreationReadbackRules.Require(Json(Operation), Native with { Location = Native.Location with { StartXmm = 0.01001 } }));
            Reject(() => GridCreationReadbackRules.Require(Json(Operation), Native with { Location = Native.Location with { StartXmm = 0.009, StartYmm = 0.009 } }));
        });
        test("grid repeated readback compares against the original operation rather than the last native state", () =>
        {
            var operation = Json(Operation);
            GridCreationReadbackRules.Require(operation, Native);
            Reject(() => GridCreationReadbackRules.Require(operation, Native with { Name = "later-rename" }));
            Reject(() => GridCreationReadbackRules.Require(operation, Native with { Location = new(10, 0, 0, 3010, 0, 0) }));
            GridCreationReadbackRules.Require(operation, Native);
        });
    }
}
