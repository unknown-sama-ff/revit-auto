using System.Text.Json;
using RevitAutoV27;

internal static class DocumentVersionDiffRulesTests
{
    private const string Valid = """{"documentIdentity":"doc-a","expectedRevision":0,"baseVersionGuid":"954250cd-d791-45e4-8053-602edef74272"}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(string code, Action action)
    {
        try { action(); } catch (BridgeException error) when (error.Code == code) { return; }
        throw new Exception("Expected " + code);
    }

    internal static void Run(Action<string, Action> test)
    {
        test("document version diff requires exact identity revision and nonempty version GUID", () =>
        {
            var input = DocumentVersionDiffRules.Parse(Json(Valid));
            if (input.DocumentIdentity != "doc-a" || input.ExpectedRevision != 0 || input.BaseVersionGuid != Guid.Parse("954250cd-d791-45e4-8053-602edef74272")) throw new Exception("Pinned version request changed.");
            foreach (var invalid in new[] { "null", "[]", "{}", Valid.Replace("\"documentIdentity\":\"doc-a\",", ""),
                Valid.Replace("\"expectedRevision\":0,", ""), Valid.Replace("\"baseVersionGuid\":\"954250cd-d791-45e4-8053-602edef74272\"", "\"baseVersionGuid\":\"bad\""),
                Valid.Replace("\"baseVersionGuid\"", "\"extra\":true,\"baseVersionGuid\""),
                Valid.Replace("\"baseVersionGuid\":\"954250cd-d791-45e4-8053-602edef74272\"", "\"baseVersionGuid\":\"954250cd-d791-45e4-8053-602edef74272\",\"baseVersionGuid\":\"954250cd-d791-45e4-8053-602edef74272\"") })
                Reject("invalid_document_version_diff_request", () => DocumentVersionDiffRules.Parse(Json(invalid)));
        });

        test("document version diff sorts unique safe ids and distinguishes unavailable deletions", () =>
        {
            var sorted = DocumentVersionDiffRules.NormalizeIds([293247, 86962, 293247], DocumentVersionDiffRules.MaxIdsPerSet, "created");
            if (!sorted.SequenceEqual([86962L, 293247L])) throw new Exception("Version diff IDs must be sorted and unique.");
            Reject("document_version_diff_limit_exceeded", () => DocumentVersionDiffRules.NormalizeIds(Enumerable.Range(1, DocumentVersionDiffRules.MaxIdsPerSet + 1).Select(x => (long)x), DocumentVersionDiffRules.MaxIdsPerSet, "modified"));
            Reject("document_version_diff_invalid_native_evidence", () => DocumentVersionDiffRules.NormalizeIds([0L], DocumentVersionDiffRules.MaxIdsPerSet, "created"));
            var unavailable = DocumentVersionDiffRules.DeletedIds(false, [1L]);
            if (unavailable.Available || unavailable.Ids.Length != 0) throw new Exception("Unavailable deleted IDs must remain unavailable, not exposed as empty known evidence.");
            var available = DocumentVersionDiffRules.DeletedIds(true, [2L, 1L]);
            if (!available.Available || !available.Ids.SequenceEqual([1L, 2L])) throw new Exception("Available deleted IDs were not preserved.");
        });

        test("document version diff response budget rejects rather than truncates", () =>
        {
            DocumentVersionDiffRules.RequireResponseBudget(new string('a', DocumentVersionDiffRules.MaxResponseBytes - 2));
            Reject("document_version_diff_response_too_large", () => DocumentVersionDiffRules.RequireResponseBudget(new string('a', DocumentVersionDiffRules.MaxResponseBytes - 1)));
        });
    }
}
