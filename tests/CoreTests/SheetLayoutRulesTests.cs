using System.Text.Json;
using RevitAutoV27;

internal static class SheetLayoutRulesTests
{
    private const string Valid = """{"documentIdentity":"doc-a","expectedRevision":0,"sheetId":20}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_sheet_layout_request") { return; }
        throw new Exception("Expected invalid_sheet_layout_request.");
    }

    internal static void Run(Action<string, Action> test)
    {
        test("sheet layout request preserves explicit identity and zero revision", () =>
        {
            var request = SheetLayoutRules.Parse(Json(Valid));
            if (request.DocumentIdentity != "doc-a" || request.ExpectedRevision != 0 || request.SheetId != 20) throw new Exception("Reviewed sheet scope changed.");
            SheetLayoutRules.Parse(Json(Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":9007199254740991")));
        });
        test("sheet layout request rejects missing duplicate unknown and unsafe fields", () =>
        {
            foreach (var invalid in new[]
            {
                "null", "[]", "{}", Valid.Replace("\"documentIdentity\":\"doc-a\",", ""),
                Valid.Replace("\"expectedRevision\":0,", ""), Valid.Replace(",\"sheetId\":20", ""),
                Valid.Replace("\"sheetId\":20", "\"sheetId\":0"), Valid.Replace("\"sheetId\":20", "\"sheetId\":9007199254740992"),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":-1"),
                Valid.Replace("\"documentIdentity\":\"doc-a\"", "\"documentIdentity\":\" \""),
                Valid.Replace("\"sheetId\":20", "\"sheetId\":20,\"filePath\":\"x.rvt\""),
                Valid.Replace("\"sheetId\":20", "\"sheetId\":20,\"sheetId\":20"),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":0,\"expectedRevision\":0")
            }) Reject(() => SheetLayoutRules.Parse(Json(invalid)));
        });
        test("sheet layout annotation kinds accept only native text notes and independent tags", () =>
        {
            if (SheetLayoutRules.AnnotationKind("TextNote") != "text-note" || SheetLayoutRules.AnnotationKind("IndependentTag") != "independent-tag")
                throw new Exception("Supported annotation kinds changed.");
            try { SheetLayoutRules.AnnotationKind("Dimension"); }
            catch (BridgeException error) when (error.Code == "sheet_layout_scope_unknown") { return; }
            throw new Exception("Unsupported annotation kind was accepted.");
        });
    }
}
