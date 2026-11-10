using System.Text.Json;

namespace RevitAutoV27;

internal sealed record SheetLayoutRequest(string DocumentIdentity, long ExpectedRevision, long SheetId);

internal static class SheetLayoutRules
{
    private const long MaxSafeInteger = 9007199254740991;
    private static readonly HashSet<string> Fields = ["documentIdentity", "expectedRevision", "sheetId"];

    public static SheetLayoutRequest Parse(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object) throw Invalid("Sheet layout parameters must be an object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in parameters.EnumerateObject())
            if (!Fields.Contains(property.Name) || !seen.Add(property.Name)) throw Invalid("Sheet layout parameters contain an unknown or duplicate field.");
        var identity = JsonDefaults.String(parameters, "documentIdentity");
        if (string.IsNullOrWhiteSpace(identity) || identity.Length > 200) throw Invalid("Specify the reviewed document identity.");
        var revision = JsonDefaults.Int64(parameters, "expectedRevision");
        if (revision is null or < 0 or > MaxSafeInteger) throw Invalid("Specify the reviewed nonnegative document revision.");
        var sheetId = JsonDefaults.Int64(parameters, "sheetId");
        if (sheetId is null or <= 0 or > MaxSafeInteger) throw Invalid("sheetId must be a positive safe integer.");
        return new(identity, revision.Value, sheetId.Value);
    }

    public static string AnnotationKind(string className) => className switch
    {
        "TextNote" => "text-note",
        "IndependentTag" => "independent-tag",
        _ => throw new BridgeException("sheet_layout_scope_unknown", "The native annotation class is not supported by sheet layout diagnostics.")
    };

    private static BridgeException Invalid(string message) => new("invalid_sheet_layout_request", message);
}
