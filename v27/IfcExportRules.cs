using System.Text.Json;

namespace RevitAutoV27;

internal sealed record IfcExportInput(
    string DocumentIdentity,
    long ExpectedRevision,
    string OutputDirectory,
    string FileName,
    string IfcVersion,
    bool ExportBaseQuantities,
    int SpaceBoundaryLevel,
    long? FilterViewId);

// Pure validation rules for controlled non-mutating IFC delivery export.
internal static class IfcExportRules
{
    public const long MaxSafeInteger = 9007199254740991;
    private static readonly string[] AllowedFields =
    [
        "documentIdentity", "expectedRevision",
        "outputDirectory", "fileName", "ifcVersion",
        "exportBaseQuantities", "spaceBoundaryLevel", "filterViewId"
    ];
    private static readonly string[] AllowedVersions = ["IFC2x3CV2", "IFC4", "IFC4RV", "IFC4DTV"];

    internal static BridgeException Invalid(string message) => new("invalid_ifc_export_request", message);

    public static IfcExportInput Parse(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
            throw Invalid("IFC export request must be a JSON object.");

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var prop in request.EnumerateObject())
        {
            if (!AllowedFields.Contains(prop.Name, StringComparer.Ordinal) || !seen.Add(prop.Name))
                throw Invalid($"Unsupported or duplicate IFC export field '{prop.Name}'.");
        }

        var identity = RequiredString(request, "documentIdentity", 200);
        var revision = RequiredNonNegativeLong(request, "expectedRevision");
        var outputDirectory = RequiredLocalDirectory(request, "outputDirectory");
        var fileName = RequiredIfcFileName(request, "fileName");

        var ifcVersion = "IFC4";
        if (request.TryGetProperty("ifcVersion", out var verEl))
        {
            if (verEl.ValueKind != JsonValueKind.String || verEl.GetString() is not { } v ||
                !AllowedVersions.Contains(v, StringComparer.Ordinal))
                throw Invalid("ifcVersion must be IFC2x3CV2, IFC4, IFC4RV, or IFC4DTV.");
            ifcVersion = v;
        }

        var exportBaseQuantities = true;
        if (request.TryGetProperty("exportBaseQuantities", out var qtyEl))
        {
            exportBaseQuantities = qtyEl.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => throw Invalid("exportBaseQuantities must be a boolean.")
            };
        }

        var spaceBoundaryLevel = 1;
        if (request.TryGetProperty("spaceBoundaryLevel", out var sbEl))
        {
            if (sbEl.ValueKind != JsonValueKind.Number || !sbEl.TryGetInt32(out var sb) || sb is < 0 or > 2)
                throw Invalid("spaceBoundaryLevel must be 0, 1, or 2.");
            spaceBoundaryLevel = sb;
        }

        long? filterViewId = null;
        if (request.TryGetProperty("filterViewId", out var viewEl))
        {
            if (viewEl.ValueKind != JsonValueKind.Number || !viewEl.TryGetInt64(out var vid) || vid <= 0 || vid > MaxSafeInteger)
                throw Invalid("filterViewId must be a positive safe native View ID.");
            filterViewId = vid;
        }

        return new(identity, revision, outputDirectory, fileName, ifcVersion, exportBaseQuantities, spaceBoundaryLevel, filterViewId);
    }

    private static string RequiredString(JsonElement obj, string field, int maxLen)
    {
        if (!obj.TryGetProperty(field, out var el) || el.ValueKind != JsonValueKind.String)
            throw Invalid($"{field} must be an explicit nonblank string.");
        var text = el.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > maxLen || text.Trim() != text || text.Any(char.IsControl))
            throw Invalid($"{field} must be a trimmed nonblank string up to {maxLen} characters.");
        return text;
    }

    private static long RequiredNonNegativeLong(JsonElement obj, string field)
    {
        if (!obj.TryGetProperty(field, out var el) || el.ValueKind != JsonValueKind.Number ||
            !el.TryGetInt64(out var val) || val < 0 || val > MaxSafeInteger)
            throw Invalid($"{field} must be a nonnegative safe integer.");
        return val;
    }

    private static string RequiredLocalDirectory(JsonElement obj, string field)
    {
        var raw = RequiredString(obj, field, 1024);
        if (raw.StartsWith(@"\\", StringComparison.Ordinal) || raw.StartsWith("//", StringComparison.Ordinal) ||
            raw.StartsWith("http:", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("https:", StringComparison.OrdinalIgnoreCase))
            throw Invalid($"{field} must be a local filesystem path, not a network share or URL.");
        if (!Path.IsPathRooted(raw))
            throw Invalid($"{field} must be an absolute local directory path.");
        if (raw.Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries).Any(s => s == ".."))
            throw Invalid($"{field} cannot contain parent traversal segments (..).");
        return raw;
    }

    private static string RequiredIfcFileName(JsonElement obj, string field)
    {
        var raw = RequiredString(obj, field, 200);
        if (raw.IndexOfAny(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) >= 0 || raw.Contains("..", StringComparison.Ordinal))
            throw Invalid($"{field} must be a single safe filename without path separators.");
        if (!raw.EndsWith(".ifc", StringComparison.OrdinalIgnoreCase))
            throw Invalid($"{field} must end with .ifc.");
        return raw;
    }
}
