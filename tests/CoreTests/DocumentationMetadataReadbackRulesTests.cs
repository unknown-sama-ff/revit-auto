using RevitAutoV27;

internal static class DocumentationMetadataReadbackRulesTests
{
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_documentation_readback") { return; }
        throw new Exception("Expected invalid_documentation_readback.");
    }
    public static void Run(Action<string, Action> test)
    {
        test("documentation metadata readback compares exact target class parameter and value", () =>
        {
            var expected = new DocumentationMetadataReadback(10, "ViewSheet", "BIP:SHEET_NUMBER", "E101", "E101");
            DocumentationMetadataReadbackRules.Require(expected, expected);
            Reject(() => DocumentationMetadataReadbackRules.Require(expected, expected with { ActualValue = "E102" }));
            Reject(() => DocumentationMetadataReadbackRules.Require(expected, expected with { ElementClass = "ViewPlan" }));
            Reject(() => DocumentationMetadataReadbackRules.Require(expected, expected with { Parameter = "BIP:SHEET_NAME" }));
        });
        test("documentation scale readback preserves integer semantics and rejects wrong types", () =>
        {
            var expected = new DocumentationMetadataReadback(20, "ViewPlan", "BIP:VIEW_SCALE_PULLDOWN_METRIC", 100, 100);
            DocumentationMetadataReadbackRules.Require(expected, expected);
            Reject(() => DocumentationMetadataReadbackRules.Require(expected, expected with { ActualValue = 50 }));
            Reject(() => DocumentationMetadataReadbackRules.Require(expected, expected with { ActualValue = "100" }));
            Reject(() => DocumentationMetadataReadbackRules.Require(expected, expected with { ActualValue = null }));
        });
    }
}
