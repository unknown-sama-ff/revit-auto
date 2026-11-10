using System.Text.Json;

namespace RevitAutoV27;

internal static class DocumentReadPinRulesTests
{
    public static void Run(Action<string, Action> test)
    {
        static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();
        static void Throws(string code, Action action)
        {
            try { action(); }
            catch (BridgeException error) when (error.Code == code) { return; }
            throw new Exception("Expected " + code);
        }

        test("read pin remains optional for legacy callers", () => DocumentReadPinRules.Validate(Json("{}"), "doc-a", 0));
        test("matching read identity and revision are accepted including revision zero", () => DocumentReadPinRules.Validate(Json("""{"documentIdentity":"doc-a","expectedRevision":0}"""), "doc-a", 0));
        test("stale read identity is rejected", () => Throws("document_changed", () => DocumentReadPinRules.Validate(Json("""{"documentIdentity":"old-session"}"""), "doc-a", 0)));
        test("stale read revision is rejected", () => Throws("document_revision_changed", () => DocumentReadPinRules.Validate(Json("""{"expectedRevision":1}"""), "doc-a", 0)));
        test("malformed optional read pins are rejected", () =>
        {
            foreach (var value in new[] { "null", "\"\"", "\" \"", "1", "{}" })
                Throws("invalid_document_read_pin", () => DocumentReadPinRules.Validate(Json("{\"documentIdentity\":" + value + "}"), "doc-a", 0));
            foreach (var value in new[] { "null", "9007199254740992", "-1", "0.5", "\"0\"", "{}" })
                Throws("invalid_document_read_pin", () => DocumentReadPinRules.Validate(Json("{\"expectedRevision\":" + value + "}"), "doc-a", 0));
        });
    }
}
