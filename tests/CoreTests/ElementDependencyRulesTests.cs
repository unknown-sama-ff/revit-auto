using System.Text.Json;
using RevitAutoV27;

internal static class ElementDependencyRulesTests
{
    private const string Valid = """{"documentIdentity":"doc-a","expectedRevision":0,"elementIds":[19,12]}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(string code, Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == code) { return; }
        throw new Exception("Expected " + code);
    }
    private static ElementDependencySetEvidence Read(IEnumerable<long>? ids, ref int total)
        => ElementDependencyRules.ReadIds(() => ids, () => { }, ref total);

    internal static void Run(Action<string, Action> test)
    {
        test("dependency request preserves explicit revision zero and native ID order", () =>
        {
            var input = ElementDependencyRules.Parse(Json(Valid));
            if (input.DocumentIdentity != "doc-a" || input.ExpectedRevision != 0 || !input.ElementIds.SequenceEqual([19L, 12L]))
                throw new Exception("Explicit query scope was changed.");
            ElementDependencyRules.Parse(Json(Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":9007199254740991")));
            var roots = JsonSerializer.Serialize(Enumerable.Range(1, 20).Select(id => (long)id));
            ElementDependencyRules.Parse(Json(Valid.Replace("[19,12]", roots)));
        });
        test("dependency query refuses missing unknown duplicate and code-bearing fields", () =>
        {
            foreach (var invalid in new[]
            {
                "null", "[]", "{}", Valid.Replace("\"documentIdentity\":\"doc-a\",", ""),
                Valid.Replace("\"expectedRevision\":0,", ""), Valid.Replace(",\"elementIds\":[19,12]", ""),
                Valid.Replace("\"documentIdentity\"", "\"DocumentIdentity\""),
                Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":0,\"expectedRevision\":0"),
                Valid.Replace("\"elementIds\":[19,12]", "\"elementIds\":[19,12],\"elementIds\":[19,12]"),
                Valid.Replace("\"documentIdentity\":\"doc-a\"", "\"documentIdentity\":\"doc-a\",\"documentIdentity\":\"doc-a\""),
                Valid.Replace("[19,12]", "[19,12],\"code\":\"ignored\""),
                Valid.Replace("[19,12]", "[19,12],\"filePath\":\"ignored.csx\""),
                Valid.Replace("[19,12]", "[19,12],\"automaticSave\":false")
            }) Reject("invalid_element_dependencies_request", () => ElementDependencyRules.Parse(Json(invalid)));
        });
        test("dependency request rejects unsafe revisions identities and repeated or unbounded root IDs", () =>
        {
            foreach (var value in new[] { "null", "-1", "0.5", "9007199254740992", "1e100", "\"0\"", "true", "{}" })
                Reject("invalid_element_dependencies_request", () => ElementDependencyRules.Parse(Json(Valid.Replace("\"expectedRevision\":0", "\"expectedRevision\":" + value))));
            foreach (var value in new[] { "null", "\"\"", "\" \"", "10", "true", JsonSerializer.Serialize(new string('x', 201)) })
                Reject("invalid_element_dependencies_request", () => ElementDependencyRules.Parse(Json(Valid.Replace("\"doc-a\"", value))));
            foreach (var value in new[] { "null", "{}", "[]", "[19,19]", "[0]", "[-1]", "[0.5]", "[9007199254740992]", "[\"12\"]", "[true]", "[null]", JsonSerializer.Serialize(Enumerable.Range(1, 21)) })
                Reject("invalid_element_dependencies_request", () => ElementDependencyRules.Parse(Json(Valid.Replace("[19,12]", value))));
        });
        test("dependency native lists normalize ordering and duplicates while preserving raw self IDs", () =>
        {
            var total = 0;
            var result = Read([19, 12, 19, 12, ElementDependencyRules.MaxSafeInteger], ref total);
            if (!result.Supported || !result.Complete || result.Truncated || result.Count != 3 || total != 3 ||
                !result.Ids.SequenceEqual([12, 19, ElementDependencyRules.MaxSafeInteger]) || result.Reason is not null)
                throw new Exception("Raw native membership changed or was mislabeled.");
        });
        test("dependency known empty evidence differs from unsupported missing and nonfamily unknown", () =>
        {
            var total = 0;
            var empty = Read([], ref total);
            var unsupported = ElementDependencyRules.ReadIds(() => throw new NotSupportedException(), () => { }, ref total);
            if (!empty.Supported || !empty.Complete || empty.Count != 0 || empty.Ids.Length != 0 ||
                unsupported.Supported || unsupported.Complete || unsupported.Count is not null || unsupported.Ids.Length != 0 ||
                unsupported.Reason != "native_api_not_supported" || unsupported.Truncated || total != 0)
                throw new Exception("Unavailable native membership was inferred as empty.");
            var missing = ElementDependencySetEvidence.Unknown("element_not_found");
            var row = new ElementDependencyItem(123, false, null, missing, ElementFamilySymbolsEvidence.From(false, missing));
            var frozen = NativeReadSnapshot.Freeze(row);
            if (frozen.GetProperty("summary").ValueKind != JsonValueKind.Null ||
                frozen.GetProperty("dependencies").GetProperty("count").ValueKind != JsonValueKind.Null ||
                frozen.GetProperty("familySymbols").GetProperty("count").ValueKind != JsonValueKind.Null ||
                frozen.GetProperty("familySymbols").GetProperty("reason").GetString() != "element_not_found")
                throw new Exception("Global omit-null settings erased explicit unknown evidence.");
            var notFamily = ElementFamilySymbolsEvidence.From(false, ElementDependencySetEvidence.Unknown("not_family"));
            if (notFamily.Applicable || notFamily.Supported || notFamily.Complete || notFamily.Count is not null || notFamily.Reason != "not_family")
                throw new Exception("Nonfamily evidence became known membership.");
        });
        test("dependency native evidence rejects invalid IDs and unavailable collections without consuming budget", () =>
        {
            var total = 7;
            foreach (var id in new long[] { 0, -1, ElementDependencyRules.MaxSafeInteger + 1, long.MaxValue })
                Reject("element_dependencies_invalid_native_evidence", () => Read([12, id], ref total));
            Reject("element_dependencies_invalid_native_evidence", () => Read(null, ref total));
            if (total != 7) throw new Exception("Partial failed evidence consumed the completed-response budget.");
        });
        test("dependency per-list and aggregate limits fail closed without partial evidence", () =>
        {
            var total = 0;
            var full = Enumerable.Range(1, ElementDependencyRules.MaxIdsPerSet).Select(id => (long)id).ToArray();
            for (var index = 0; index < 4; index++) Read(full, ref total);
            if (total != ElementDependencyRules.MaxTotalIds) throw new Exception("Exact full native evidence budget rejected.");
            Reject("element_dependencies_limit_exceeded", () => Read([1], ref total));
            if (total != ElementDependencyRules.MaxTotalIds) throw new Exception("Oversized aggregate changed completed budget.");
            total = 0;
            Reject("element_dependencies_limit_exceeded", () => Read(full.Concat([ElementDependencyRules.MaxIdsPerSet + 1L]), ref total));
            if (total != 0) throw new Exception("Oversized list was partially emitted.");
        });
        test("dependency query preserves unknown native failures and cancellation", () =>
        {
            var total = 0;
            foreach (var failure in new Exception[] { new InvalidOperationException("invalid native object"), new IOException("read failed"), new OperationCanceledException() })
            {
                try { ElementDependencyRules.ReadIds(() => throw failure, () => { }, ref total); }
                catch (Exception actual) when (ReferenceEquals(actual, failure)) { continue; }
                throw new Exception("Native failure was hidden or replaced.");
            }
            IEnumerable<long> PartialFailure(Exception failure) { yield return 12; throw failure; }
            var enumerationFailure = new OperationCanceledException();
            var cancellationObserved = false;
            try { Read(PartialFailure(enumerationFailure), ref total); }
            catch (OperationCanceledException actual) when (ReferenceEquals(actual, enumerationFailure)) { cancellationObserved = true; }
            if (!cancellationObserved || total != 0) throw new Exception("Cancelled native enumeration was hidden or consumed completed budget.");
            var unavailable = Read(PartialFailure(new NotSupportedException()), ref total);
            if (unavailable.Supported || unavailable.Count is not null || unavailable.Ids.Length != 0)
                throw new Exception("Partially unavailable enumeration claimed complete IDs.");
            var checks = 0;
            try { ElementDependencyRules.ReadIds(() => new long[] { 12 }, () => { if (++checks == 2) throw new NotSupportedException("pin check failed"); }, ref total); }
            catch (NotSupportedException actual) when (actual.Message == "pin check failed") { return; }
            throw new Exception("Document-pin failure was mislabeled as API unsupported.");
        });
        test("dependency cancellation prevents native reads and overrides unsupported fallback", () =>
        {
            var total = 0;
            var reads = 0;
            var cancelled = new OperationCanceledException();
            try { ElementDependencyRules.ReadIds(() => { reads++; return new long[] { 12 }; }, () => throw cancelled, ref total); }
            catch (OperationCanceledException actual) when (ReferenceEquals(actual, cancelled)) { }
            if (reads != 0 || total != 0) throw new Exception("Cancelled query still entered the native relationship API.");
            var checks = 0;
            var observed = false;
            try { ElementDependencyRules.ReadIds(() => throw new NotSupportedException(), () => { if (++checks == 2) throw cancelled; }, ref total); }
            catch (OperationCanceledException actual) when (ReferenceEquals(actual, cancelled)) { observed = true; }
            if (!observed || total != 0) throw new Exception("Unsupported fallback hid a cancelled query.");
        });
        test("dependency wire budget includes UTF8 and exact Windows newline without truncation", () =>
        {
            ElementDependencyRules.RequireResponseBudget(new string('a', ElementDependencyRules.MaxResponseBytes - 2));
            Reject("element_dependencies_response_too_large", () => ElementDependencyRules.RequireResponseBudget(new string('a', ElementDependencyRules.MaxResponseBytes - 1)));
            Reject("element_dependencies_response_too_large", () => ElementDependencyRules.RequireResponseBudget(new string('汉', ElementDependencyRules.MaxResponseBytes / 3 + 1)));
        });
        test("dependency summary preserves raw signed sentinel IDs and explicit null category data", () =>
        {
            ElementDependencyRules.RequireSignedSafeId(-1);
            ElementDependencyRules.RequireSignedSafeId(-ElementDependencyRules.MaxSafeInteger);
            Reject("element_dependencies_invalid_native_evidence", () => ElementDependencyRules.RequireSignedSafeId(-ElementDependencyRules.MaxSafeInteger - 1));
            Reject("element_dependencies_invalid_native_evidence", () => ElementDependencyRules.RequireSignedSafeId(ElementDependencyRules.MaxSafeInteger + 1));
            ElementDependencyRules.RequireNativeText("", "name", allowEmpty: true);
            Reject("element_dependencies_invalid_native_evidence", () => ElementDependencyRules.RequireNativeText(null, "name", allowEmpty: true));
            Reject("element_dependencies_invalid_native_evidence", () => ElementDependencyRules.RequireNativeText("", "uniqueId"));
            var frozen = NativeReadSnapshot.Freeze(new ElementDependencySummary(123, "uid", "", "Element", null, null, -1, -1, -1));
            if (frozen.GetProperty("category").ValueKind != JsonValueKind.Null || frozen.GetProperty("categoryId").ValueKind != JsonValueKind.Null || frozen.GetProperty("typeId").GetInt64() != -1)
                throw new Exception("Unknown category or raw sentinel was guessed.");
        });
    }
}
