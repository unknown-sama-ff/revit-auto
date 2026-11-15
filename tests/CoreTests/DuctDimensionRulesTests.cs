using System.Text.Json;
using RevitAutoV27;

internal static class DuctDimensionRulesTests
{
    private static JsonElement Operations(string dimensions) => JsonDocument.Parse(
        "[{\"operationType\":\"create_duct\",\"ductTypeId\":1,\"systemTypeId\":2,\"levelId\":3," +
        "\"start\":{\"xMm\":0,\"yMm\":0,\"zMm\":1000},\"end\":{\"xMm\":1000,\"yMm\":0,\"zMm\":1000}" +
        (dimensions.Length == 0 ? "" : "," + dimensions) + "}]").RootElement.Clone();

    private static void Reject(string dimensions)
    {
        try { PlanRules.Validate(Operations(dimensions)); }
        catch (BridgeException error) when (error.Code is "invalid_number" or "invalid_duct_dimensions") { return; }
        throw new Exception($"Expected invalid duct dimensions: {dimensions}");
    }

    public static void Run(Action<string, Action> test)
    {
        test("duct dimensions allow positive diameter or complete paired cross-section without shape inference", () =>
        {
            foreach (var dimensions in new[] { "\"diameterMm\":100", "\"widthMm\":200,\"heightMm\":100",
                "\"widthMm\":200,\"heightMm\":200", "\"diameterMm\":0.000001", "\"diameterMm\":100000000",
                "\"widthMm\":100000000,\"heightMm\":100000000" })
                PlanRules.Validate(Operations(dimensions));
        });
        test("duct dimensions reject missing incomplete and mixed specifications", () =>
        {
            foreach (var dimensions in new[] { "", "\"widthMm\":100", "\"heightMm\":100",
                "\"diameterMm\":100,\"widthMm\":200", "\"diameterMm\":100,\"heightMm\":100",
                "\"diameterMm\":100,\"widthMm\":200,\"heightMm\":100" }) Reject(dimensions);
        });
        test("every supplied duct dimension requires a finite positive millimeter number", () =>
        {
            foreach (var field in new[] { "diameterMm", "widthMm", "heightMm" })
                foreach (var value in new[] { "null", "\"100\"", "\"NaN\"", "true", "{}", "[]", "0", "-1", "1e400", "-1e400", "100000001" })
                {
                    var companion = field == "widthMm" ? ",\"heightMm\":100" : field == "heightMm" ? ",\"widthMm\":200" : "";
                    Reject($"\"{field}\":{value}{companion}");
                }
        });
        test("invalid extra duct dimensions cannot hide behind a complete specification", () =>
        {
            foreach (var dimensions in new[] { "\"diameterMm\":100,\"widthMm\":null",
                "\"diameterMm\":100,\"heightMm\":null", "\"diameterMm\":null,\"widthMm\":200,\"heightMm\":100",
                "\"diameterMm\":100,\"widthMm\":-1,\"heightMm\":100" }) Reject(dimensions);
        });
    }
}
