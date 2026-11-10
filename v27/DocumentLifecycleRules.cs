using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace RevitAutoV27;

internal static class DocumentLifecycleRules
{
    public const int MaxRecipes = 100, MaxRecords = 1024, MaxSnapshotBytes = 32 * 1024 * 1024, MaxRecordBytes = 8 * 1024 * 1024;
    public const FileShare ModelReadSharing = FileShare.ReadWrite | FileShare.Delete;
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.Never };
    public static readonly HashSet<string> ReadMethods = ["revit.context.get", "revit.search", "revit.inspect", "revit.element.dependencies"];
    public static bool Terminal(string stage) => stage is "STOPPED" or "FAILED" or "CANCELLED" or "SAVE_OUTCOME_UNKNOWN" or "OPEN_OUTCOME_UNKNOWN" or "REOPEN_VERIFIED";
    public static BridgeException Invalid(string message) => new("invalid_lifecycle_request", message);
    public static void Exact(JsonElement value, params string[] fields)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("An exact lifecycle object is required.");
        var allowed = fields.ToHashSet(StringComparer.Ordinal); var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name) || !seen.Add(property.Name)) throw Invalid($"Unknown or repeated lifecycle field '{property.Name}'.");
        if (seen.Count != allowed.Count) throw Invalid("All lifecycle fields are required.");
    }
    public static string Text(JsonElement value, string key, int max = 4096)
    {
        if (!value.TryGetProperty(key, out var field) || field.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(field.GetString()) || field.GetString()!.Length > max)
            throw Invalid($"'{key}' requires bounded nonempty text.");
        return field.GetString()!;
    }
    public static string OperationId(string text)
        => Regex.IsMatch(text, "^[a-f0-9]{32}$", RegexOptions.CultureInvariant) ? text : throw Invalid("operationId must be 32 lowercase hexadecimal characters.");
    public static string Hash(string text)
        => Regex.IsMatch(text, "^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant) ? text.ToLowerInvariant() : throw Invalid("A SHA-256 value requires exactly 64 hexadecimal characters.");
    public static long Integer(JsonElement value, string key, long max = 9007199254740991)
    {
        if (!value.TryGetProperty(key, out var field) || field.ValueKind != JsonValueKind.Number || !field.TryGetInt64(out var n) || n < 0 || n > max)
            throw Invalid($"'{key}' requires a nonnegative safe integer.");
        return n;
    }
    public static (string Id, string Hash, int? ReadIndex) Action(JsonElement value, bool scope = false)
    {
        Exact(value, scope ? ["operationId", "requestSha256", "readIndex"] : ["operationId", "requestSha256"]);
        return (OperationId(Text(value, "operationId", 32)), Hash(Text(value, "requestSha256", 64)), scope ? (int)Integer(value, "readIndex", 2 * MaxRecipes - 1) : null);
    }
    public static void Registration(JsonElement value)
    {
        Exact(value, "modelPath", "baselineEvidenceFile", "baselineEvidenceSha256", "readRecipes");
        Text(value, "modelPath"); Text(value, "baselineEvidenceFile"); Hash(Text(value, "baselineEvidenceSha256", 64));
        var recipes = value.GetProperty("readRecipes");
        if (recipes.ValueKind != JsonValueKind.Array || recipes.GetArrayLength() < 1 || recipes.GetArrayLength() > MaxRecipes) throw Invalid("readRecipes requires 1..100 fixed read recipes.");
        var contextCount = 0;
        foreach (var recipe in recipes.EnumerateArray())
        {
            Exact(recipe, "method", "params");
            var method = Text(recipe, "method", 100); var p = recipe.GetProperty("params");
            if (!ReadMethods.Contains(method)) throw Invalid("The read recipe is outside the fixed lifecycle allowlist.");
            switch (method)
            {
                case "revit.context.get": Exact(p); contextCount++; break;
                case "revit.search":
                    Exact(p, "category", "types", "limit", "offset"); Text(p, "category", 200);
                    if (p.GetProperty("types").ValueKind is not (JsonValueKind.True or JsonValueKind.False) || Integer(p, "limit", 500) != 500) throw Invalid("Search recipes require explicit types and limit=500.");
                    Integer(p, "offset", 100000); break;
                case "revit.inspect": Exact(p, "elementIds"); Ids(p.GetProperty("elementIds"), 100); break;
                case "revit.element.dependencies": Exact(p, "elementIds"); Ids(p.GetProperty("elementIds"), ElementDependencyRules.MaxRootElements); break;
            }
        }
        if (contextCount != 1) throw Invalid("Exactly one context recipe must bind the saved/reopened document evidence.");
    }
    public static long[] Ids(JsonElement value, int max)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() < 1 || value.GetArrayLength() > max) throw Invalid("A bounded nonempty ID list is required.");
        var ids = value.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out var id) && id > 0 && id <= 9007199254740991 ? id : throw Invalid("IDs must be positive safe integers.")).ToArray();
        if (ids.Distinct().Count() != ids.Length) throw Invalid("Repeated IDs are not permitted.");
        return ids;
    }
    public static void RequireStage(string actual, params string[] expected)
    {
        if (!expected.Contains(actual, StringComparer.Ordinal)) throw new BridgeException("lifecycle_stage_mismatch", $"Lifecycle stage is '{actual}'; the action is not allowed.");
    }
    public static void ScopeIndex(string stage, int expectedIndex, int actualIndex, int recipeCount)
    {
        RequireStage(stage, "SAVE_READBACK_PENDING", "OPEN_READBACK_PENDING");
        if (recipeCount < 1 || recipeCount > MaxRecipes || expectedIndex < 0 || actualIndex != expectedIndex || actualIndex >= recipeCount * 2)
            throw new BridgeException("lifecycle_scope_index", "Read indices must follow the fixed two-round recipe order.");
    }
    public static void RequireLivePreview(DateTime created, DateTime expires, DateTime now)
    {
        if (now < created || expires != created.AddMinutes(10) || now >= expires) throw new BridgeException("lifecycle_preview_expired", "The lifecycle preview expired or its clock could not be verified.");
    }
    public static void Budget(string text, int maximum = MaxRecordBytes)
    {
        if (Encoding.UTF8.GetByteCount(text) > maximum) throw new BridgeException("lifecycle_evidence_limit", "Complete lifecycle evidence exceeds its bounded budget; no truncation is permitted.");
    }
    public static string Canonical(JsonElement value, string method, bool reopened = false)
        => CanonicalAt(value, "", method, reopened);
    private static string CanonicalAt(JsonElement value, string path, string method, bool reopened)
    {
        using var buffer = new MemoryStream(); using var writer = new Utf8JsonWriter(buffer);
        Write(value, writer, path, method, reopened); writer.Flush(); return Encoding.UTF8.GetString(buffer.ToArray());
    }
    private static void Write(JsonElement value, Utf8JsonWriter writer, string path, string method, bool reopened)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
            {
                if (method == "revit.context.get" && (path == "document" && property.Name is "identity" or "revision" or "isModified" || reopened && path.Length == 0 && property.Name is "activeView" or "selectedElementIds")) continue;
                if (method == "revit.element.dependencies" && path.Length == 0 && property.Name is "documentIdentity" or "documentRevision") continue;
                writer.WritePropertyName(property.Name); Write(property.Value, writer, path.Length == 0 ? property.Name : path + "." + property.Name, method, reopened);
            }
            writer.WriteEndObject(); return;
        }
        if (value.ValueKind == JsonValueKind.Array)
        {
            var entries = value.EnumerateArray().ToArray();
            // Only exact native collection paths are unordered. Unknown arrays,
            // including similarly named fields inside geometry/projection, retain order.
            bool unordered = method switch
            {
                "revit.inspect" => path is "items" or "items[].parameters" or "items[].connectors" or "items[].connectors[].peers" or "items[].electrical.systemIds" or "items[].electrical.memberIds",
                "revit.context.get" => path is "familyTypes" or "elementTypes" or "selectedElementIds",
                "revit.search" or "revit.element.dependencies" => path == "items",
                _ => false
            };
            if (unordered) entries = entries.OrderBy(e => CanonicalAt(e, path + "[]", method, reopened), StringComparer.Ordinal).ToArray();
            writer.WriteStartArray(); foreach (var entry in entries) Write(entry, writer, path + "[]", method, reopened); writer.WriteEndArray(); return;
        }
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && number == 0) { writer.WriteNumberValue(0); return; }
        value.WriteTo(writer);
    }
}

// Pure event sequence state. A stop reason is permanent for this operation;
// only one matching save and one matching primary-document open can certify it.
internal sealed class DocumentLifecycleEventPolicy(string? targetIdentity)
{
    private string? identity = targetIdentity, openPath;
    private bool expectedSave, expectedExit, saving, saved, opened;
    public string? StopReason { get; private set; }
    public bool SavedSuccessfully => saved && StopReason is null;
    public bool OpenedSuccessfully => opened && StopReason is null;
    public void Stop(string reason) => StopReason ??= reason;
    public void BeginSave() => expectedSave = true;
    public void EndSave() => expectedSave = false;
    public void BeginOpen(string path) => openPath = Path.GetFullPath(path);
    public void EndOpen() => openPath = null;
    public void BeginExit() => expectedExit = true;
    public void EndExit() => expectedExit = false;
    public void Saving(string documentIdentity)
    {
        if (!expectedSave || identity is null || identity != documentIdentity || saving || saved) Stop("unexpected_document_save");
        else saving = true;
    }
    public void Saved(string documentIdentity, bool succeeded)
    {
        if (!expectedSave || !saving || saved || identity != documentIdentity || !succeeded) Stop("save_event_failed_or_changed");
        else saved = true;
    }
    public void Opened(string documentIdentity, string path, bool linked, bool succeeded)
    {
        if (!succeeded) { Stop("document_open_failed"); return; }
        if (openPath is null) { Stop("unexpected_document_open"); return; }
        if (linked) return;
        if (opened || !string.Equals(Path.GetFullPath(path), openPath, StringComparison.OrdinalIgnoreCase)) Stop("unexpected_document_open");
        else { opened = true; identity = documentIdentity; }
    }
    public void Closing(string documentIdentity, bool linked)
    {
        if (!expectedExit || !linked && identity != documentIdentity) Stop("unexpected_document_close");
    }
    public void ApplicationClosing() { if (!expectedExit) Stop("unexpected_application_close"); }
}
