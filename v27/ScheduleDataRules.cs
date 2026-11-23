using System.Text.Json;

namespace RevitAutoV27;

internal sealed record ScheduleDataInput(
    string DocumentIdentity,
    long ExpectedRevision,
    long ScheduleId,
    int StartRow,
    int MaxRows,
    bool IncludeCellMeta);

internal sealed record ScheduleRowWindow(int AbsStart, int AbsEndExclusive, int ReturnedRows, bool HasMore);

internal static class ScheduleDataRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const int MaxStartRow = 1000000;
    public const int MaxRowsLimit = 200;

    internal static BridgeException Invalid(string message) => new("invalid_schedule_data_request", message);

    public static ScheduleDataInput Parse(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
            throw Invalid("Schedule data request must be a JSON object.");
        string[] allowed = ["documentIdentity", "expectedRevision", "scheduleId", "startRow", "maxRows", "includeCellMeta"];
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var prop in request.EnumerateObject())
        {
            if (!allowed.Contains(prop.Name, StringComparer.Ordinal) || !seen.Add(prop.Name))
                throw Invalid($"Unsupported or duplicate schedule data field '{prop.Name}'.");
        }

        var identity = Identity(request);
        var revision = Revision(request);
        var scheduleId = RequiredPositiveId(request, "scheduleId");
        var startRow = OptionalInt(request, "startRow", 0, 0, MaxStartRow);
        var maxRows = OptionalInt(request, "maxRows", 100, 1, MaxRowsLimit);
        var includeCellMeta = OptionalBool(request, "includeCellMeta", false);
        return new(identity, revision, scheduleId, startRow, maxRows, includeCellMeta);
    }

    public static ScheduleRowWindow ComputeWindow(int totalRows, int startRow, int maxRows)
    {
        if (totalRows < 0 || startRow < 0 || maxRows < 1)
            throw Invalid("Invalid schedule pagination bounds.");
        if (totalRows == 0 || startRow >= totalRows)
            return new(Math.Min(startRow, totalRows), Math.Min(startRow, totalRows), 0, false);
        var count = Math.Min(maxRows, totalRows - startRow);
        var endExclusive = startRow + count;
        return new(startRow, endExclusive, count, endExclusive < totalRows);
    }

    public static string ClassifyRow(IReadOnlyList<string?> cells, bool allTextCells, IReadOnlyList<string> columns)
    {
        if (cells.Any(cell => cell is null))
            return "partial";
        if (cells.All(string.IsNullOrWhiteSpace))
            return "blank";
        if (allTextCells && cells.Count == columns.Count && cells.SequenceEqual(columns))
            return "header";
        return allTextCells ? "text" : "data";
    }

    private static string Identity(JsonElement request)
    {
        if (!request.TryGetProperty("documentIdentity", out var value) || value.ValueKind != JsonValueKind.String)
            throw Invalid("documentIdentity must be an explicit nonblank string.");
        var text = value.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > 200 || text.Trim() != text || text.Any(char.IsControl))
            throw Invalid("documentIdentity must be an explicit nonblank string up to 200 characters.");
        return text;
    }

    private static long Revision(JsonElement request)
    {
        if (!request.TryGetProperty("expectedRevision", out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt64(out var revision) || revision < 0 || revision > MaxSafeInteger)
            throw Invalid("expectedRevision must be an explicit nonnegative safe integer.");
        return revision;
    }

    private static long RequiredPositiveId(JsonElement request, string field)
    {
        if (!request.TryGetProperty(field, out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt64(out var id) || id <= 0 || id > MaxSafeInteger)
            throw Invalid($"{field} must be an explicit positive safe native ViewSchedule ID.");
        return id;
    }

    private static int OptionalInt(JsonElement request, string field, int fallback, int min, int max)
    {
        if (!request.TryGetProperty(field, out var value)) return fallback;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number) || number < min || number > max)
            throw Invalid($"{field} must be an integer between {min} and {max}.");
        return number;
    }

    private static bool OptionalBool(JsonElement request, string field, bool fallback)
    {
        if (!request.TryGetProperty(field, out var value)) return fallback;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw Invalid($"{field} must be a boolean.")
        };
    }
}
