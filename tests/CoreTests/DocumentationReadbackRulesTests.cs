using RevitAutoV27;

internal static class DocumentationReadbackRulesTests
{
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_documentation_readback") { return; }
        throw new Exception("Expected invalid_documentation_readback.");
    }

    public static void Run(Action<string, Action> test)
    {
        test("drawing placement readback preserves class owner source and paper XY", () =>
        {
            var expected = new DocumentationPlacementReadback(10, "Viewport", 20, 30, 420, 280, 0);
            DocumentationReadbackRules.RequirePlacement(expected, expected with { Zmm = 12 });
            Reject(() => DocumentationReadbackRules.RequirePlacement(expected, expected with { ClassName = "ScheduleSheetInstance" }));
            Reject(() => DocumentationReadbackRules.RequirePlacement(expected, expected with { SheetId = 21 }));
            Reject(() => DocumentationReadbackRules.RequirePlacement(expected, expected with { ViewId = 31 }));
            Reject(() => DocumentationReadbackRules.RequirePlacement(expected, expected with { Xmm = 422 }));
        });
        test("drawing placement readback allows one millimeter paper tolerance but rejects unknown values", () =>
        {
            var expected = new DocumentationPlacementReadback(10, "Viewport", 20, 30, 420, 280, 0);
            DocumentationReadbackRules.RequirePlacement(expected, expected with { Xmm = 420.7, Ymm = 279.3, Zmm = double.MaxValue });
            Reject(() => DocumentationReadbackRules.RequirePlacement(expected, expected with { Xmm = 421.01 }));
            Reject(() => DocumentationReadbackRules.RequirePlacement(expected, expected with { Ymm = double.NaN }));
            Reject(() => DocumentationReadbackRules.RequirePlacement(expected, expected with { Zmm = double.NaN }));
        });
        test("drawing placement receipts keep write and persistence gates independent", () =>
        {
            var evidence = DocumentationReadbackRules.Receipt(new DocumentationPlacementReadback(10, "Viewport", 20, 30, 420, 280, 0), true, false);
            if (!evidence.NativeReadbackVerified || evidence.PersistenceVerified || evidence.VisualVerified || evidence.SideEffectsVerified)
                throw new Exception("Documentation receipt promoted an unverified gate.");
        });
    }
}
