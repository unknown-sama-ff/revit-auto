using System.Text.Json;

namespace RevitAutoV27;

internal sealed record ViewExportRequest(string DocumentIdentity, long ExpectedRevision, long[] ViewIds, int PixelSize, int ResolutionDpi);

internal static class ViewExportRules
{
    internal const int MaxViews = 20;
    private const long MaxSafeInteger = 9007199254740991;
    private static readonly HashSet<string> Fields = ["documentIdentity", "expectedRevision", "viewIds", "pixelSize", "resolutionDpi"];

    public static ViewExportRequest Parse(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object) throw Invalid("Export parameters must be an object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in parameters.EnumerateObject())
            if (!Fields.Contains(property.Name) || !seen.Add(property.Name)) throw Invalid("Export parameters contain an unknown or duplicate field.");
        var identity = JsonDefaults.String(parameters, "documentIdentity");
        if (string.IsNullOrWhiteSpace(identity) || identity.Length > 200) throw Invalid("Specify the reviewed document identity.");
        var revision = JsonDefaults.Int64(parameters, "expectedRevision");
        if (revision is null or < 0 or > MaxSafeInteger) throw Invalid("Specify the reviewed nonnegative document revision.");
        var ids = JsonDefaults.Get(parameters, "viewIds");
        if (ids.ValueKind != JsonValueKind.Array || ids.GetArrayLength() is < 1 or > MaxViews) throw Invalid("Select 1..20 existing views or sheets.");
        var selected = new List<long>();
        foreach (var value in ids.EnumerateArray())
        {
            if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var id) || id is <= 0 or > MaxSafeInteger || selected.Contains(id))
                throw Invalid("View IDs must be unique positive safe integers.");
            selected.Add(id);
        }
        var pixelSize = OptionalInteger(parameters, "pixelSize", 4096);
        if (pixelSize is < 600 or > 8192) throw Invalid("pixelSize must be an integer in 600..8192.");
        var resolution = OptionalInteger(parameters, "resolutionDpi", 300);
        if (resolution is not (72 or 150 or 300 or 600)) throw Invalid("resolutionDpi must be 72, 150, 300 or 600.");
        return new(identity, revision.Value, selected.ToArray(), pixelSize, resolution);
    }

    public static void AssertState(ViewExportRequest request, string identity, long revision)
    {
        if (request.DocumentIdentity != identity) throw new BridgeException("document_changed", "The active project differs from the reviewed image export.");
        if (request.ExpectedRevision != revision) throw new BridgeException("document_revision_changed", "The project changed since the reviewed image export.", new { expectedRevision = request.ExpectedRevision, currentRevision = revision });
    }

    public static void AssertUnchanged(bool modifiedBefore, bool modifiedAfter, string pathBefore, string pathAfter)
    {
        if (modifiedBefore != modifiedAfter || pathBefore != pathAfter)
            throw new BridgeException("export_state_changed", "The document path or saved state changed during image export.");
    }

    private static int OptionalInteger(JsonElement parameters, string field, int fallback)
    {
        if (!parameters.TryGetProperty(field, out var value)) return fallback;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number)) throw Invalid(field + " must be an integer.");
        return number;
    }
    private static BridgeException Invalid(string message) => new("invalid_image_export", message);
}
