using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    public static JsonElement Empty { get; } = JsonDocument.Parse("{}").RootElement.Clone();
    public static bool Has(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null;
    public static JsonElement Get(JsonElement e, string name) => Has(e, name) ? e.GetProperty(name) : default;
    public static string? String(JsonElement e, string name) => Get(e, name) is { ValueKind: JsonValueKind.String } v ? v.GetString() : null;
    public static string StringOr(JsonElement e, string name, string fallback) => String(e, name) ?? fallback;
    public static long? Int64(JsonElement e, string name) => Get(e, name).ValueKind == JsonValueKind.Number && Get(e, name).TryGetInt64(out var n) ? n : null;
    public static double? Double(JsonElement e, string name) => Get(e, name).ValueKind == JsonValueKind.Number && Get(e, name).TryGetDouble(out var n) && double.IsFinite(n) ? n : null;
    public static bool Bool(JsonElement e, string name) => Get(e, name).ValueKind == JsonValueKind.True;
    public static JsonElement ObjectOrEmpty(JsonElement e, string name) => Get(e, name).ValueKind == JsonValueKind.Object ? Get(e, name) : Empty;
    public static IEnumerable<JsonElement> Array(JsonElement e, string name) => Get(e, name).ValueKind == JsonValueKind.Array ? Get(e, name).EnumerateArray().Select(x => x.Clone()) : [];
    public static double InternalToMm(double value) => value * 304.8;
    public static double SquareMeters(double value) => value * 0.09290304;
}

internal sealed class BridgeException(string code, string message, object? details = null) : Exception(message)
{
    public string Code { get; } = code;
    public object? Details { get; } = details;
}
internal sealed record ApiError(string Code, string Message, object? Details = null);
internal sealed record CommandResult(bool Ok, object? Result, ApiError? Error)
{
    public static CommandResult Success(object? result = null) => new(true, result, null);
    public static CommandResult Failure(string code, string message, object? details = null) => new(false, null, new(code, message, details));
    public string Serialize()
    {
        try { return JsonSerializer.Serialize(new { protocol = "revit-auto-2027-v2", ok = Ok, result = Result, error = Error }, JsonDefaults.Options); }
        catch (Exception exception) when (exception is ArgumentException or JsonException or NotSupportedException)
        {
            // Return a valid envelope before the stream is disposed. The result/receipt
            // remains in native memory: a client must query its same plan ID, never retry writes.
            return JsonSerializer.Serialize(new { protocol="revit-auto-2027-v2", ok=false, error=new ApiError("response_serialization_failed", "The response could not be encoded as JSON. For a write, query the same planId; do not recreate or retry the write.", new { exceptionType=exception.GetType().Name }) }, JsonDefaults.Options);
        }
    }
}
internal sealed record BridgeSettings(int Port, string Token)
{
    public int PlanLifetimeMinutes { get; init; } = PlanLifetimePolicy.DefaultMinutes;
}
internal sealed record CommandEnvelope(string RequestId, string Method, JsonElement Params, long DeadlineUnixMs);
internal sealed class ModelPlan
{
    public string PlanId { get; } = Guid.NewGuid().ToString("N");
    public required string DocumentIdentity { get; init; }
    public required long DocumentRevision { get; init; }
    public required string Summary { get; init; }
    public string Source { get; init; } = "assistant";
    public required List<JsonElement> Operations { get; init; }
    public List<string> Warnings { get; } = [];
    public string Status { get; set; } = "pending";
    public DateTime ExpiresAtUtc { get; init; } = PlanLifetimePolicy.Expires(DateTime.UtcNow);
    public object? Receipt { get; set; }
    public object View() => new
    {
        planId = PlanId, documentIdentity = DocumentIdentity, documentRevision = DocumentRevision,
        source = Source, summary = Summary, operations = Operations,
        affectedCategories = Operations.Select(o => JsonDefaults.String(o, "category") ?? JsonDefaults.String(o, "operationType")).Distinct(),
        warnings = Warnings, requiresConfirmation = true, confirmation = "User approval in chat",
        confirmationMode = "chat", requiresRevitConfirmation = false,
        status = Status, expiresAtUtc = ExpiresAtUtc, receipt = Receipt
    };
}

internal static class ViewConfigurationRules
{
    public static readonly HashSet<string> Allowed = new(StringComparer.Ordinal) { "viewRange", "crop", "discipline", "lightingCategories", "displayStyle", "detailLevel", "partsVisibility" };
    public static HashSet<string> Settings(JsonElement op)
    {
        var values=JsonDefaults.Get(op,"settings");
        if(values.ValueKind!=JsonValueKind.Array || values.GetArrayLength()==0 || values.GetArrayLength()>Allowed.Count)
            throw new BridgeException("invalid_view_settings","Provide an explicit non-empty settings list.");
        var selected=new HashSet<string>(StringComparer.Ordinal);
        foreach(var value in values.EnumerateArray())
            if(value.ValueKind!=JsonValueKind.String || !Allowed.Contains(value.GetString()!) || !selected.Add(value.GetString()!))
                throw new BridgeException("invalid_view_settings","Unknown or duplicate view setting.");
        if(JsonDefaults.Has(op,"discipline") && (!selected.Contains("discipline") || JsonDefaults.String(op,"discipline") is not ("Architectural" or "Structural" or "Mechanical" or "Electrical" or "Plumbing" or "Coordination")))
            throw new BridgeException("invalid_view_settings","Explicit discipline requires the discipline setting and a valid native name.");
        if(JsonDefaults.Has(op,"viewportId") != JsonDefaults.Has(op,"paperPoint")) throw new BridgeException("invalid_view_settings","Viewport recentering requires viewportId and paperPoint together.");
        if(JsonDefaults.Has(op,"paperPoint")) { var point=JsonDefaults.Get(op,"paperPoint"); PlanRules.Point(point); if(JsonDefaults.Double(point,"zMm") is double z && z!=0)throw new BridgeException("invalid_view_settings","Paper points use XY; requested zMm must be zero."); }
        if(JsonDefaults.Has(op,"parameters")) throw new BridgeException("invalid_view_settings","Use a separate explicit set_parameter operation; configure_view never ignores a parameter map.");
        if (op.TryGetProperty("cropBounds", out _))
        {
            if (!selected.Contains("crop")) throw new BridgeException("invalid_crop_bounds", "cropBounds requires the explicit crop setting.");
            CropBounds(op);
        }
        return selected;
    }
    public static (double MinX, double MinY, double MaxX, double MaxY)? CropBounds(JsonElement op)
    {
        if (!op.TryGetProperty("cropBounds", out var bounds)) return null;
        ExactKeys(bounds, "min", "max");
        var min = JsonDefaults.Get(bounds, "min"); var max = JsonDefaults.Get(bounds, "max");
        ExactKeys(min, "xMm", "yMm"); ExactKeys(max, "xMm", "yMm");
        var x0 = PlanRules.Number(min, "xMm"); var y0 = PlanRules.Number(min, "yMm");
        var x1 = PlanRules.Number(max, "xMm"); var y1 = PlanRules.Number(max, "yMm");
        if (x1-x0 < 1 || y1-y0 < 1) throw new BridgeException("invalid_crop_bounds", "Crop rectangle must be ordered and at least 1 mm wide and high.");
        return (x0,y0,x1,y1);
    }
    private static void ExactKeys(JsonElement value, params string[] keys)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new BridgeException("invalid_crop_bounds", "cropBounds must contain only min/max project XY points.");
        var names = value.EnumerateObject().Select(p=>p.Name).ToArray();
        if (names.Length != keys.Length || names.Distinct(StringComparer.Ordinal).Count() != keys.Length || keys.Any(k=>!names.Contains(k,StringComparer.Ordinal)))
            throw new BridgeException("invalid_crop_bounds", "Crop points accept only xMm/yMm; Z, rotation and unknown fields are rejected.");
    }
}

internal static class PlanRules
{
    public const int MaxOperations = 1000;
    public static readonly HashSet<string> Supported = new(StringComparer.Ordinal)
    {
        "create_family_instance", "duplicate_type", "set_parameter", "delete_element", "load_family",
        "create_level", "create_grid", "create_wall", "create_floor", "create_opening", "create_room", "create_stair",
        "create_circuit", "create_wire", "create_view_plan", "create_sheet", "create_schedule",
        "create_panel_schedule", "configure_view", "place_viewport", "create_pipe", "create_duct", "connect_elements", "create_fitting", "create_tag", "create_dimension"
    };
    public static List<JsonElement> Validate(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Array) throw new BridgeException("invalid_plan", "operations must be an array.");
        var operations = input.EnumerateArray().Select(x => x.Clone()).ToList();
        if (operations.Count is < 1 or > MaxOperations) throw new BridgeException("invalid_plan", $"A plan needs 1..{MaxOperations} operations.");
        var known = new HashSet<string>(StringComparer.Ordinal);
        foreach (var op in operations)
        {
            var type = JsonDefaults.String(op, "operationType");
            if (type is null || !Supported.Contains(type)) throw new BridgeException("unsupported_operation", $"Unsupported operation '{type}'.");
            CheckReferences(op, known);
            var key = JsonDefaults.String(op, "id");
            if (key is not null && (key.Length > 80 || !known.Add(key) || string.IsNullOrWhiteSpace(key)))
                throw new BridgeException("invalid_operation_id", $"Duplicate or invalid operation id '{key}'.");
            switch (type)
            {
                case "load_family": FamilyLibraryRules.Operation(op); break;
                case "create_family_instance":
                    RequireAny(op, "symbolId", "family");
                    if (!JsonDefaults.Has(op, "symbolId")) Require(op, "type");
                    Point(JsonDefaults.Has(op, "point") ? JsonDefaults.Get(op, "point") : op);
                    if (JsonDefaults.Has(op, "placementMode") && (JsonDefaults.String(op, "placementMode") != "legacyPoint" || JsonDefaults.Has(op, "hostElementId")))
                        throw new BridgeException("invalid_placement", "legacyPoint is the only supported explicit placementMode and cannot be combined with a hostElementId.");
                    break;
                case "create_level": Number(op, "elevationMm"); Require(op, "name"); break;
                case "create_grid": case "create_wall": case "create_pipe": case "create_duct":
                    Point(JsonDefaults.Get(op, "start")); Point(JsonDefaults.Get(op, "end"));
                    if (type == "create_wall") Positive(op, "heightMm");
                    if (type == "create_pipe") { Require(op, "pipeTypeId"); Require(op, "systemTypeId"); Positive(op, "diameterMm"); }
                    if (type == "create_duct") { Require(op, "ductTypeId"); Require(op, "systemTypeId"); }
                    break;
                case "create_floor":
                    if (JsonDefaults.Array(op, "boundary").Count() < 3) throw new BridgeException("invalid_geometry", "Floor boundary needs 3+ points.");
                    foreach (var p in JsonDefaults.Array(op, "boundary")) Point(p); break;
                case "create_opening": OpeningRules.Validate(op); break;
                case "create_room": Point(op); break;
                case "create_stair": StairRules.Validate(op); break;
                case "delete_element": Require(op, "elementId"); break;
                case "set_parameter": Require(op, "elementId"); Require(op, "parameter"); Require(op, "value"); break;
                case "duplicate_type": Require(op, "sourceTypeId"); Require(op, "name"); break;
                case "create_circuit":
                    if (!JsonDefaults.Array(op, "elementIds").Any()) throw new BridgeException("invalid_circuit", "A circuit needs loads in elementIds.");
                    Require(op, "panelId"); break;
                case "create_wire": Require(op, "firstElementId"); Require(op, "secondElementId"); Require(op, "viewId"); Require(op, "wireTypeId"); break;
                case "create_sheet": Require(op, "number"); Require(op, "name"); break;
                case "create_schedule": Require(op, "category"); Require(op, "fields"); break;
                case "create_panel_schedule": Require(op, "panelId"); break;
                case "configure_view": Require(op,"viewId"); Require(op,"referenceViewId"); ViewConfigurationRules.Settings(op); break;
                case "create_tag": Require(op, "viewId"); Require(op, "elementId"); Point(op); break;
                case "create_dimension": Require(op, "viewId"); Require(op, "references"); Point(JsonDefaults.Get(op, "start")); Point(JsonDefaults.Get(op, "end")); break;
                case "place_viewport": Require(op, "sheetId"); Require(op, "viewId"); Point(op); break;
                case "connect_elements": case "create_fitting": Require(op, "firstElementId"); Require(op, "secondElementId"); ConnectorSelectionRules.ValidateSelection(op,"first"); ConnectorSelectionRules.ValidateSelection(op,"second"); break;
            }
        }
        ConnectionPortReservationRules.ValidatePlan(operations);
        return operations;
    }
    private static void CheckReferences(JsonElement op, HashSet<string> known)
    {
        foreach (var property in op.EnumerateObject())
        {
            // Built-in category IDs are negative constants, not element references. The load schema validates them.
            if (JsonDefaults.String(op, "operationType") == "load_family" && property.Name == "expectedCategoryId") continue;
            if (property.Name.EndsWith("ConnectorId", StringComparison.Ordinal))
            {
                if (property.Value.ValueKind != JsonValueKind.Number || !property.Value.TryGetInt32(out var port) || port < 0) throw new BridgeException("invalid_connector", "Connector ids must be nonnegative integers.");
            }
            else if (property.Name.EndsWith("Id", StringComparison.Ordinal)) CheckReference(property.Value, known);
            if (property.Name.EndsWith("Ids", StringComparison.Ordinal) && property.Value.ValueKind == JsonValueKind.Array)
                foreach (var v in property.Value.EnumerateArray()) CheckReference(v, known);
        }
        foreach (var dep in JsonDefaults.Array(op, "dependencies"))
            if (dep.ValueKind != JsonValueKind.String || !known.Contains(dep.GetString()!))
                throw new BridgeException("invalid_dependency", "dependencies must name earlier operation ids.");
    }
    private static void CheckReference(JsonElement v, HashSet<string> known)
    {
        if (v.ValueKind == JsonValueKind.Null) return;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) && n > 0) return;
        if (v.ValueKind == JsonValueKind.String && v.GetString() is { } s && s.StartsWith('@') && known.Contains(s[1..])) return;
        throw new BridgeException("invalid_reference", "Element ids must be positive integer ids or @references to earlier operations.");
    }
    public static void Require(JsonElement op, string name)
    {
        if (!JsonDefaults.Has(op, name) || (JsonDefaults.Get(op, name).ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(JsonDefaults.String(op, name))))
            throw new BridgeException("missing_field", $"{JsonDefaults.String(op, "operationType")}: {name} is required.");
    }
    private static void RequireAny(JsonElement op, params string[] names)
    {
        if (!names.Any(n => JsonDefaults.Has(op, n))) throw new BridgeException("missing_field", $"Specify {string.Join(" or ", names)}.");
    }
    public static double Number(JsonElement op, string name)
    {
        var number = JsonDefaults.Double(op, name);
        if (number is null || Math.Abs(number.Value) > 100_000_000) throw new BridgeException("invalid_number", $"{name} must be a finite number, in millimeters for geometry.");
        return number.Value;
    }
    private static void Positive(JsonElement op, string name)
    {
        if (Number(op, name) <= 0) throw new BridgeException("invalid_number", $"{name} must be positive.");
    }
    public static void Point(JsonElement p)
    {
        Number(p, "xMm"); Number(p, "yMm");
        if (JsonDefaults.Has(p, "zMm")) Number(p, "zMm");
    }
}
