using System.Text.Json;
using RevitAutoV27;

internal static class FamilyTextRulesTests
{
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();
    private const string Valid = """{"documentIdentity":"family-session","expectedRevision":0,"familyName":"THS-A1"}""";
    internal static void Run(Action<string, Action> test)
    {
        test("family text pages preserve all 110 notes across shuffled native order", () =>
        {
            var ids = Enumerable.Range(1, 110).Reverse().Select(i => (long)i).ToArray();
            var first = FamilyTextRules.SelectPage(ids, 0, 100);
            var last = FamilyTextRules.SelectPage(ids, first.NextAfterNoteId!.Value, 100);
            if (!first.Ids.Concat(last.Ids).SequenceEqual(ids.Order()) || first.SkippedCount != 0 || first.RemainingCount != 10 ||
                last.SkippedCount != 100 || last.RemainingCount != 0 || last.NextAfterNoteId is not null)
                throw new Exception("Pagination lost, repeated or miscounted a note.");
            var exhausted = FamilyTextRules.SelectPage(ids, 110, 100);
            if (exhausted.Ids.Length != 0 || exhausted.SkippedCount != 110 || exhausted.NextAfterNoteId is not null)
                throw new Exception("Last-note cursor was not exhausted.");
            try { FamilyTextRules.SelectPage(ids, 111, 100); }
            catch (BridgeException e) when (e.Code == "invalid_family_text_cursor") { return; }
            throw new Exception("A missing cursor was accepted.");
        });
        test("family text paging and explicit view inputs reject null unsafe and noninteger IDs", () =>
        {
            var parsed = FamilyTextRules.Parse(Json(Valid[..^1] + ",\"afterNoteId\":0,\"boundsViewId\":2}"));
            if (parsed.AfterNoteId != 0 || parsed.BoundsViewId != 2) throw new Exception("Explicit query selectors lost.");
            foreach (var field in new[] { "afterNoteId", "boundsViewId" })
            foreach (var invalid in new[] { "null", "\"2\"", "-1", "1.5", "9007199254740992", "true" }.Concat(field == "boundsViewId" ? ["0"] : Array.Empty<string>()))
            {
                try { FamilyTextRules.Parse(Json(Valid[..^1] + ",\"" + field + "\":" + invalid + "}")); }
                catch (BridgeException e) when (e.Code == "invalid_family_text_request") { continue; }
                throw new Exception("Invalid explicit selector accepted.");
            }
        });
        test("family text page rejects corrupt native IDs and preserves a known-null end cursor", () =>
        {
            foreach (var ids in new long[][] { [1, 1], [0], [-1], [9007199254740992] })
            {
                try { FamilyTextRules.SelectPage(ids, 0, 1); }
                catch (BridgeException e) when (e.Code == "family_text_invalid_native_evidence") { continue; }
                throw new Exception("Invalid native IDs accepted.");
            }
            var wire = JsonSerializer.SerializeToElement(new FamilyTextPageEvidence(0, 0, 0, null), JsonDefaults.Options);
            if (wire.GetProperty("nextAfterNoteId").ValueKind != JsonValueKind.Null) throw new Exception("End cursor disappeared.");
        });
        test("family text query requires exact family identity and bounded note count", () =>
        {
            var parsed = FamilyTextRules.Parse(Json(Valid));
            if (parsed.ExpectedRevision != 0 || parsed.FamilyName != "THS-A1" || parsed.MaxNotes != 50) throw new Exception("Wrong family text defaults.");
            FamilyTextRules.Parse(Json(Valid[..^1] + ",\"maxNotes\":100}"));
        });
        test("family text query rejects missing unsafe duplicate or executable fields", () =>
        {
            foreach (var value in new[] { "null", "[]", "{}", Valid.Replace("\"expectedRevision\":0,", ""),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":-1"),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":\"0\""),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":9007199254740992"),
                Valid.Replace("\"familyName\":\"THS-A1\"", "\"familyName\":\" \""),
                Valid[..^1] + ",\"maxNotes\":0}", Valid[..^1] + ",\"maxNotes\":101}",
                Valid[..^1] + ",\"maxNotes\":1.5}", Valid[..^1] + ",\"path\":\"x.rfa\"}",
                Valid[..^1] + ",\"code\":\"anything\"}", Valid[..^1] + ",\"documentIdentity\":\"other\"}" })
            {
                try { FamilyTextRules.Parse(Json(value)); }
                catch (BridgeException e) when (e.Code == "invalid_family_text_request") { continue; }
                throw new Exception("Unsafe family text request accepted: " + value);
            }
        });
        test("family text scope uses exact owner metadata rather than document title", () =>
        {
            var input = FamilyTextRules.Parse(Json(Valid));
            FamilyTextRules.RequireScope(input, new(true, "Different document title.rfa", "THS-A1", FamilyTextRules.TitleBlockCategoryId));
            foreach (var actual in new FamilyTextScopeEvidence[] {
                new(true, "THS-A1", "Different native family name", FamilyTextRules.TitleBlockCategoryId),
                new(true, "THS-A1", "THS-A1", -2000150),
                new(true, "THS-A1", "THS-A1", null), new(false, "THS-A1", null, null) })
            {
                try { FamilyTextRules.RequireScope(input, actual); }
                catch (BridgeException e) when (e.Code == "family_text_scope_mismatch")
                {
                    var details = JsonSerializer.SerializeToElement(e.Details, JsonDefaults.Options);
                    var observed = details.GetProperty("actualFamilyScope");
                    if (details.GetProperty("requestedFamilyName").GetString() != input.FamilyName ||
                        observed.GetProperty("documentTitle").GetString() != actual.DocumentTitle ||
                        !observed.TryGetProperty("familyName", out _) || !observed.TryGetProperty("categoryId", out _))
                        throw new Exception("Native scope evidence was lost.");
                    continue;
                }
                throw new Exception("Wrong owner or category was accepted.");
            }
        });
        test("family text query distinguishes unknown text from known empty text", () =>
        {
            var count = 0;
            var empty = FamilyTextRules.Text("", ref count); var unknown = FamilyTextRules.Text(null, ref count);
            if (!empty.Supported || !empty.Complete || empty.Value != "" || empty.OriginalLength != 0 ||
                unknown.Supported || unknown.Value is not null || unknown.Complete) throw new Exception("Unknown and empty text conflated.");
        });
        test("family text known-empty owner requires a real explicit document title", () =>
        {
            var empty = Valid.Replace("\"THS-A1\"", "\"\"");
            foreach (var invalid in new[] { empty, empty[..^1] + ",\"familyDocumentTitle\":null}",
                empty[..^1] + ",\"familyDocumentTitle\":\" \"}", empty[..^1] + ",\"familyDocumentTitle\":1}" })
            {
                try { FamilyTextRules.Parse(Json(invalid)); }
                catch (BridgeException e) when (e.Code == "invalid_family_text_request") { continue; }
                throw new Exception("Known-empty owner accepted without a real title pin.");
            }
            var parsed = FamilyTextRules.Parse(Json(empty[..^1] + ",\"familyDocumentTitle\":\"THS-A1.rfa\"}"));
            if (parsed.FamilyName != "" || parsed.FamilyDocumentTitle != "THS-A1.rfa")
                throw new Exception("The actual owner name was replaced or normalized.");
        });
        test("family text known-empty scope keeps owner category and title exact", () =>
        {
            var input = new FamilyTextInput("session", 0, "", 50, "THS-A1.rfa");
            FamilyTextRules.RequireScope(input, new(true, "THS-A1.rfa", "", FamilyTextRules.TitleBlockCategoryId));
            foreach (var actual in new FamilyTextScopeEvidence[] {
                new(true, "other.rfa", "", FamilyTextRules.TitleBlockCategoryId),
                new(true, "THS-A1.rfa", null, FamilyTextRules.TitleBlockCategoryId),
                new(true, "THS-A1.rfa", "THS-A1", FamilyTextRules.TitleBlockCategoryId),
                new(false, "THS-A1.rfa", "", FamilyTextRules.TitleBlockCategoryId),
                new(true, "THS-A1.rfa", "", -2000150) })
            {
                try { FamilyTextRules.RequireScope(input, actual); }
                catch (BridgeException e) when (e.Code == "family_text_scope_mismatch") { continue; }
                throw new Exception("Known-empty scope escaped its exact native pins.");
            }
        });
        test("family text unknown fields retain explicit null on the native wire", () =>
        {
            var result = JsonSerializer.SerializeToElement(new FamilyTextField(false, null, "unavailable"), JsonDefaults.Options);
            if (!result.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Null)
                throw new Exception("Unknown field value disappeared during serialization.");
        });
        test("family text preserves Chinese and does not split surrogate pairs", () =>
        {
            var count = 0;
            var text = new string('中', FamilyTextRules.MaxTextCharacters - 1) + "😀尾";
            var result = FamilyTextRules.Text(text, ref count);
            if (!result.Truncated || result.Complete || result.Value!.Length != FamilyTextRules.MaxTextCharacters - 1 ||
                count != result.Value.Length || result.OriginalLength != text.Length) throw new Exception("Broken Unicode text bound.");
        });
        test("family text shares a hard total character budget across notes", () =>
        {
            var count = FamilyTextRules.MaxTotalTextCharacters - 1;
            var result = FamilyTextRules.Text("中文", ref count);
            var exhausted = FamilyTextRules.Text("still present", ref count);
            if (result.Value != "中" || !result.Truncated || count != FamilyTextRules.MaxTotalTextCharacters ||
                exhausted.Value != "" || !exhausted.Truncated || exhausted.Complete) throw new Exception("Total text budget not preserved.");
        });
        test("family text response budget counts UTF8 bytes", () =>
        {
            FamilyTextRules.RequireResponseBudget("{}");
            try { FamilyTextRules.RequireResponseBudget(new string('中', FamilyTextRules.MaxResponseBytes / 3 + 1)); }
            catch (BridgeException e) when (e.Code == "family_text_response_too_large") { return; }
            throw new Exception("UTF8 response budget was not enforced.");
        });
    }
}
