using System.Text.Json;
using RevitAutoV27;

internal static class ElementStorageSchemaRulesTests
{
    private const string Valid = """{"documentIdentity":"doc-a","expectedRevision":0,"elementIds":[86962,293247]}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(string code, Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == code) { return; }
        throw new Exception("Expected " + code);
    }

    internal static void Run(Action<string, Action> test)
    {
        test("storage schema audit request pins an explicit bounded element scope", () =>
        {
            var input = ElementStorageSchemaRules.Parse(Json(Valid));
            if (input.DocumentIdentity != "doc-a" || input.ExpectedRevision != 0 || !input.ElementIds.SequenceEqual([86962L, 293247L]))
                throw new Exception("The explicit pinned storage audit scope changed.");
            var twenty = JsonSerializer.Serialize(Enumerable.Range(1, ElementStorageSchemaRules.MaxRootElements).Select(id => (long)id));
            ElementStorageSchemaRules.Parse(Json(Valid.Replace("[86962,293247]", twenty)));
        });

        test("storage schema audit request rejects duplicate code or value-selection fields", () =>
        {
            foreach (var invalid in new[]
            {
                "null", "[]", "{}", Valid.Replace("\"documentIdentity\":\"doc-a\",", ""),
                Valid.Replace("\"expectedRevision\":0,", ""),
                Valid.Replace("\"documentIdentity\"", "\"documentIdentity\":\"doc-a\",\"documentIdentity\""),
                Valid.Replace("\"elementIds\":[86962,293247]", "\"elementIds\":[86962,293247],\"includeEntityValues\":true"),
                Valid.Replace("\"elementIds\":[86962,293247]", "\"elementIds\":[86962,293247],\"script\":\"x.csx\"")
            }) Reject("invalid_element_storage_schema_request", () => ElementStorageSchemaRules.Parse(Json(invalid)));
        });

        test("storage schema audit root scope rejects repeated unsafe and oversized IDs", () =>
        {
            foreach (var ids in new[] { "[]", "[86962,86962]", "[0]", "[-1]", "[1.5]", "[9007199254740992]", "[\"86962\"]",
                JsonSerializer.Serialize(Enumerable.Range(1, ElementStorageSchemaRules.MaxRootElements + 1)) })
                Reject("invalid_element_storage_schema_request", () => ElementStorageSchemaRules.Parse(Json(Valid.Replace("[86962,293247]", ids))));
        });

        test("storage schema GUID enumeration distinguishes a known empty element from unavailable evidence", () =>
        {
            var total = 0;
            var empty = ElementStorageSchemaRules.ReadSchemaGuids(() => Array.Empty<Guid>(), () => { }, ref total);
            var missingCollection = ElementStorageSchemaRules.ReadSchemaGuids(() => null, () => { }, ref total);
            var unsupported = ElementStorageSchemaRules.ReadSchemaGuids(() => throw new NotSupportedException(), () => { }, ref total);
            if (!empty.Supported || !empty.Complete || empty.Count != 0 || empty.Guids.Length != 0 ||
                missingCollection.Supported || missingCollection.Reason != "native_schema_guid_list_unavailable" ||
                unsupported.Supported || unsupported.Reason != "native_api_not_supported" || total != 0)
                throw new Exception("Unavailable schema metadata was mistaken for a known empty element.");
        });

        test("storage schema GUID enumeration sorts unique GUIDs and enforces per-element and total limits", () =>
        {
            var a = Guid.Parse("00000000-0000-0000-0000-000000000001");
            var b = Guid.Parse("00000000-0000-0000-0000-000000000002");
            var total = 0;
            var result = ElementStorageSchemaRules.ReadSchemaGuids(() => new[] { b, a, b }, () => { }, ref total);
            if (!result.Supported || !result.Complete || result.Count != 2 || total != 2 || !result.Guids.SequenceEqual([a, b]))
                throw new Exception("Attached schema GUIDs were not normalized deterministically.");
            var full = Enumerable.Range(1, ElementStorageSchemaRules.MaxSchemasPerElement)
                .Select(value => Guid.Parse("00000000-0000-0000-0000-" + value.ToString("D12"))).ToArray();
            total = 0;
            ElementStorageSchemaRules.ReadSchemaGuids(() => full, () => { }, ref total);
            Reject("element_storage_schema_limit_exceeded", () => ElementStorageSchemaRules.ReadSchemaGuids(() => full.Append(Guid.Parse("00000000-0000-0000-0000-000000000099")), () => { }, ref total));
            total = 0;
            for (var index = 0; index < ElementStorageSchemaRules.MaxTotalSchemas / ElementStorageSchemaRules.MaxSchemasPerElement; index++)
            {
                var offset = index * ElementStorageSchemaRules.MaxSchemasPerElement;
                var group = Enumerable.Range(offset + 1, ElementStorageSchemaRules.MaxSchemasPerElement)
                    .Select(value => Guid.Parse("00000000-0000-0000-0000-" + value.ToString("D12"))).ToArray();
                ElementStorageSchemaRules.ReadSchemaGuids(() => group, () => { }, ref total);
            }
            Reject("element_storage_schema_limit_exceeded", () => ElementStorageSchemaRules.ReadSchemaGuids(() => [Guid.Parse("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")], () => { }, ref total));
            if (total != ElementStorageSchemaRules.MaxTotalSchemas) throw new Exception("Partial schema metadata changed the completed result budget.");
        });

        test("storage schema enumeration cancellation and pin failures are never downgraded to unknown", () =>
        {
            var total = 0;
            var cancelled = new OperationCanceledException();
            try { ElementStorageSchemaRules.ReadSchemaGuids(() => throw new NotSupportedException(), () => throw cancelled, ref total); }
            catch (OperationCanceledException actual) when (ReferenceEquals(actual, cancelled)) { return; }
            throw new Exception("Cancellation was hidden as an unsupported schema API.");
        });

        test("storage schema response budget rejects rather than truncating metadata", () =>
        {
            ElementStorageSchemaRules.RequireResponseBudget(new string('a', ElementStorageSchemaRules.MaxResponseBytes - 2));
            Reject("element_storage_schema_response_too_large", () => ElementStorageSchemaRules.RequireResponseBudget(new string('a', ElementStorageSchemaRules.MaxResponseBytes - 1)));
            Reject("element_storage_schema_response_too_large", () => ElementStorageSchemaRules.RequireResponseBudget(new string('汉', ElementStorageSchemaRules.MaxResponseBytes / 3 + 1)));
        });
    }
}
