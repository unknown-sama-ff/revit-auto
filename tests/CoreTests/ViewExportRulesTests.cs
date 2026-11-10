using System.Text.Json;
using RevitAutoV27;

internal static class ViewExportRulesTests
{
    private const string Valid = """{"documentIdentity":"document-a","expectedRevision":2,"viewIds":[10,20]}""";
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();
    private static void Throws(string code, Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == code) { return; }
        throw new Exception("Expected " + code);
    }
    public static void Run(Action<string, Action> test)
    {
        test("batch export retains exact selected view order and high-resolution defaults", () =>
        {
            var parsed = ViewExportRules.Parse(Json(Valid));
            if (parsed.DocumentIdentity != "document-a" || parsed.ExpectedRevision != 2 || !parsed.ViewIds.SequenceEqual(new long[] { 10, 20 }) || parsed.PixelSize != 4096 || parsed.ResolutionDpi != 300)
                throw new Exception("Batch export changed the selected scope or default resolution.");
        });
        test("batch export rejects unknown duplicate null and malformed fields", () =>
        {
            foreach (var invalid in new[] {
                Valid.Replace("[10,20]", "[]"), Valid.Replace("[10,20]", "[10,10]"), Valid.Replace("[10,20]", "[0]"),
                Valid.Replace("[10,20]", "[9007199254740992]"), Valid.Replace("[10,20]", "[10.5]"),
                Valid.Replace("[10,20]", "[\"10\"]"), Valid.Replace("[10,20]", "null"),
                Valid.Replace("\"expectedRevision\":2", "\"expectedRevision\":-1"),
                Valid.Replace("\"expectedRevision\":2", "\"expectedRevision\":9007199254740992"),
                Valid.Replace("\"expectedRevision\":2,", ""), Valid.Replace("document-a", " "),
                Valid.Replace("}", ",\"outputPath\":\"arbitrary\"}"),
                Valid.Replace("}", ",\"pixelSize\":4096,\"pixelSize\":8192}"),
                Valid.Replace("}", ",\"pixelSize\":null}"), Valid.Replace("}", ",\"pixelSize\":599}"),
                Valid.Replace("}", ",\"pixelSize\":8193}"), Valid.Replace("}", ",\"resolutionDpi\":96}"),
                Valid.Replace("[10,20]", "[" + string.Join(",", Enumerable.Range(1,21)) + "]")
            }) Throws("invalid_image_export", () => ViewExportRules.Parse(Json(invalid)));
        });
        test("batch export preserves supported explicit pixel and DPI choices", () =>
        {
            foreach (var dpi in new[] {72,150,300,600})
            {
                var parsed = ViewExportRules.Parse(Json(Valid.Replace("}", ",\"pixelSize\":8192,\"resolutionDpi\":" + dpi + "}")));
                if (parsed.PixelSize != 8192 || parsed.ResolutionDpi != dpi) throw new Exception();
            }
        });
        test("batch export fails on session revision path and saved-state changes", () =>
        {
            var request = ViewExportRules.Parse(Json(Valid));
            ViewExportRules.AssertState(request,"document-a",2);
            Throws("document_changed",()=>ViewExportRules.AssertState(request,"document-b",2));
            Throws("document_revision_changed",()=>ViewExportRules.AssertState(request,"document-a",3));
            ViewExportRules.AssertUnchanged(true,true,"a.rvt","a.rvt");
            Throws("export_state_changed",()=>ViewExportRules.AssertUnchanged(false,true,"a.rvt","a.rvt"));
            Throws("export_state_changed",()=>ViewExportRules.AssertUnchanged(false,false,"a.rvt","b.rvt"));
        });
    }
}
