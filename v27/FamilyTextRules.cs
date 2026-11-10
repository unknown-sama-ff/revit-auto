using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal sealed record FamilyTextInput(string DocumentIdentity, long ExpectedRevision, string FamilyName, int MaxNotes,
    string? FamilyDocumentTitle = null, long? AfterNoteId = null, long? BoundsViewId = null);
internal sealed record FamilyTextPage(long[] Ids, int SkippedCount, int RemainingCount,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] long? NextAfterNoteId);
internal sealed record FamilyTextPageEvidence(long AfterNoteId, int SkippedCount, int RemainingCount,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] long? NextAfterNoteId);
internal sealed record FamilyTextContent(bool Supported, bool Complete,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Value,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? OriginalLength,
    bool Truncated, string? Reason = null);
internal sealed record FamilyTextField(bool Supported,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] object? Value, string? Reason = null);
internal sealed record FamilyTextScopeEvidence(bool OwnerFamilyAvailable, string DocumentTitle,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? FamilyName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] long? CategoryId);

internal static class FamilyTextRules
{
    public const int DefaultNotes = 50, MaxNotes = 100, MaxTextCharacters = 2048, MaxTotalTextCharacters = 16384;
    public const int MaxResponseBytes = 512 * 1024;
    public const long TitleBlockCategoryId = -2000280;
    private static BridgeException Invalid(string message) => new("invalid_family_text_request", message);

    public static void RequireScope(FamilyTextInput input, FamilyTextScopeEvidence actual)
    {
        if (input.FamilyName.Length == 0 && string.IsNullOrWhiteSpace(input.FamilyDocumentTitle))
            throw Invalid("A known-empty owner name requires an explicit familyDocumentTitle.");
        if (!actual.OwnerFamilyAvailable || actual.FamilyName != input.FamilyName || actual.CategoryId != TitleBlockCategoryId ||
            (input.FamilyDocumentTitle is not null && actual.DocumentTitle != input.FamilyDocumentTitle))
            throw new BridgeException("family_text_scope_mismatch", "The active family name/category differs from the exact titleblock-family request.",
                new { requestedFamilyName = input.FamilyName, requestedFamilyDocumentTitle = input.FamilyDocumentTitle,
                    expectedCategoryId = TitleBlockCategoryId, actualFamilyScope = actual });
    }

    public static FamilyTextInput Parse(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object) throw Invalid("Family text query requires an object.");
        var allowed = new HashSet<string>(["documentIdentity", "expectedRevision", "familyName", "familyDocumentTitle", "maxNotes", "afterNoteId", "boundsViewId"], StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in request.EnumerateObject())
            if (!allowed.Contains(p.Name) || !seen.Add(p.Name)) throw Invalid("Unknown or duplicate family text query field.");
        var identity = JsonDefaults.String(request, "documentIdentity");
        var family = JsonDefaults.String(request, "familyName");
        if (string.IsNullOrWhiteSpace(identity) || identity.Length > 200 || family is null || family.Length > 200 ||
            (family.Length > 0 && string.IsNullOrWhiteSpace(family)))
            throw Invalid("Explicit session identity and exact familyName are required.");
        var title = JsonDefaults.String(request, "familyDocumentTitle");
        if ((request.TryGetProperty("familyDocumentTitle", out var rawTitle) &&
                (rawTitle.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(title) || title.Length > 200)) ||
            (family.Length == 0 && title is null))
            throw Invalid("A known-empty owner name requires an explicit nonblank familyDocumentTitle of at most 200 characters.");
        if (!request.TryGetProperty("expectedRevision", out var rawRevision) || !rawRevision.TryGetInt64Safe(out var revision) || revision < 0 || revision > 9007199254740991)
            throw Invalid("expectedRevision must be an explicit nonnegative safe integer.");
        var maximum = DefaultNotes;
        if (request.TryGetProperty("maxNotes", out var rawMax))
        {
            if (!rawMax.TryGetInt64Safe(out var value) || value < 1 || value > MaxNotes) throw Invalid("maxNotes must be 1..100.");
            maximum = (int)value;
        }
        long? OptionalId(string key, bool zeroAllowed)
        {
            if (!request.TryGetProperty(key, out var raw)) return null;
            if (!raw.TryGetInt64Safe(out var value) || value < (zeroAllowed ? 0 : 1) || value > 9007199254740991)
                throw Invalid(key + " must be an explicit safe integer ID" + (zeroAllowed ? " or zero for the first page." : "."));
            return value;
        }
        return new(identity, revision, family, maximum, title, OptionalId("afterNoteId", true), OptionalId("boundsViewId", false));
    }

    public static FamilyTextPage SelectPage(IEnumerable<long> noteIds, long afterNoteId, int maximum)
    {
        if (afterNoteId < 0 || afterNoteId > 9007199254740991 || maximum < 1 || maximum > MaxNotes)
            throw Invalid("Invalid page cursor or page size.");
        var all = noteIds.Order().ToArray();
        if (all.Any(id => id <= 0 || id > 9007199254740991) || all.Distinct().Count() != all.Length)
            throw new BridgeException("family_text_invalid_native_evidence", "Native note IDs are invalid or duplicated.");
        var index = afterNoteId == 0 ? -1 : Array.BinarySearch(all, afterNoteId);
        if (afterNoteId != 0 && index < 0)
            throw new BridgeException("invalid_family_text_cursor", "afterNoteId is not a TextNote in this pinned family document.");
        var skipped = index + 1;
        var ids = all.Skip(skipped).Take(maximum).ToArray();
        var remaining = all.Length - skipped - ids.Length;
        return new(ids, skipped, remaining, remaining > 0 ? ids[^1] : null);
    }

    private static bool TryGetInt64Safe(this JsonElement value, out long result)
    {
        result = 0;
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out result);
    }

    public static FamilyTextContent Text(string? value, ref int usedCharacters)
    {
        if (usedCharacters < 0 || usedCharacters > MaxTotalTextCharacters) throw new BridgeException("family_text_invalid_native_evidence", "Invalid accumulated text budget.");
        if (value is null) return new(false, false, null, null, false, "native_text_unavailable");
        var count = Math.Min(value.Length, Math.Min(MaxTextCharacters, MaxTotalTextCharacters - usedCharacters));
        if (count > 0 && count < value.Length && char.IsHighSurrogate(value[count - 1]) && char.IsLowSurrogate(value[count])) count--;
        usedCharacters += count;
        return new(true, count == value.Length, value[..count], value.Length, count < value.Length);
    }

    public static void RequireResponseBudget(string response)
    {
        if ((long)Encoding.UTF8.GetByteCount(response) + 2 > MaxResponseBytes)
            throw new BridgeException("family_text_response_too_large", "Family text response exceeds its 512 KiB budget; narrow maxNotes.");
    }
}
