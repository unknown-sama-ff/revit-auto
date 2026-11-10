using System.Text.Json;

namespace RevitAutoV27;

internal sealed record ArchitectureTypeDimension(long ParameterId, string Name, double ValueMm);
internal sealed record ArchitectureTypeCopyInput(long SourceTypeId, string Name, string Category, ArchitectureTypeDimension[] Dimensions);

internal static class ArchitectureTypeCopyRules
{
    public const double ReadbackToleranceMm = 0.01;
    public const long MaxSafeInteger = 9007199254740991;
    private static BridgeException Invalid(string message) => new("invalid_architecture_type_copy", message);

    public static ArchitectureTypeCopyInput Validate(JsonElement op)
    {
        Shape(op, ["operationType", "id", "dependencies", "sourceTypeId", "name", "category", "dimensions"]);
        if (JsonDefaults.String(op, "operationType") != "duplicate_architecture_type")
            throw Invalid("Expected operationType duplicate_architecture_type.");
        var source = Integer(JsonDefaults.Get(op, "sourceTypeId"), "sourceTypeId", positive: true);
        var name = Text(JsonDefaults.Get(op, "name"), "name", trimmed: true);
        if (name.IndexOfAny("\\/:{}[]|;<>?`~".ToCharArray()) >= 0)
            throw Invalid("Type name cannot be a path or contain prohibited Revit name characters.");
        var category = JsonDefaults.String(op, "category");
        if (category is not ("OST_StructuralColumns" or "OST_Doors" or "OST_Windows"))
            throw Invalid("An explicit OST_StructuralColumns, OST_Doors or OST_Windows category is required.");
        if (op.TryGetProperty("id", out var metadataId)) _ = Text(metadataId, "id", trimmed: true, maxLength: 80);
        if (op.TryGetProperty("dependencies", out var values))
        {
            if (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > 1000)
                throw Invalid("dependencies must be a bounded array of explicit operation IDs.");
            var dependencies = new HashSet<string>(StringComparer.Ordinal);
            foreach (var value in values.EnumerateArray())
                if (!dependencies.Add(Text(value, "dependency", trimmed: true, maxLength: 80))) throw Invalid("Duplicate dependency IDs are not allowed.");
            if (JsonDefaults.String(op, "id") is { } id && dependencies.Contains(id))
                throw Invalid("A type copy cannot depend on itself.");
        }
        var dimensions = JsonDefaults.Get(op, "dimensions");
        if (dimensions.ValueKind != JsonValueKind.Array || dimensions.GetArrayLength() != 2)
            throw Invalid("Exactly two explicit native dimension parameters are required; no width or height is inferred.");
        var ids = new HashSet<long>(); var names = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<ArchitectureTypeDimension>();
        foreach (var dimension in dimensions.EnumerateArray())
        {
            Shape(dimension, ["parameterId", "name", "valueMm"]);
            var parameterId = Integer(JsonDefaults.Get(dimension, "parameterId"), "parameterId", positive: false);
            var parameterName = Text(JsonDefaults.Get(dimension, "name"), "dimension name", trimmed: true);
            var value = JsonDefaults.Get(dimension, "valueMm");
            if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var mm) || !double.IsFinite(mm) || mm <= 0 || mm > 100_000_000)
                throw Invalid("valueMm must be an explicit positive finite millimeter value no greater than 100000000.");
            if (!ids.Add(parameterId) || !names.Add(parameterName))
                throw Invalid("Dimension parameter IDs and exact names must both be distinct.");
            result.Add(new(parameterId, parameterName, mm));
        }
        return new(source, name, category, result.ToArray());
    }

    public static void RequireReadback(double expectedMm, double actualMm)
    {
        if (!double.IsFinite(expectedMm) || expectedMm <= 0 || expectedMm > 100_000_000 ||
            !double.IsFinite(actualMm) || actualMm <= 0 || Math.Abs(actualMm - expectedMm) > ReadbackToleranceMm)
            throw Invalid("Native dimension readback differs from the reviewed value by more than 0.01 mm; roll back the entire plan.");
    }

    public static void ValidateResolvedPlacementTypes(IReadOnlyList<JsonElement> operations, Func<JsonElement, long> resolveExistingSymbol)
    {
        var sourceIds = operations.Where(op => JsonDefaults.String(op, "operationType") == "duplicate_architecture_type")
            .Select(op => Validate(op).SourceTypeId).ToHashSet();
        if (sourceIds.Count == 0) return;
        foreach (var op in operations.Where(op => JsonDefaults.String(op, "operationType") is "create_family_instance" or "create_structural_column"))
        {
            // Dedicated @copy placements are validated separately and resolve to the source surrogate during preview.
            if (JsonDefaults.String(op, "symbolId")?.StartsWith('@') == true) continue;
            var symbolId = resolveExistingSymbol(op);
            if (symbolId <= 0 || symbolId > MaxSafeInteger)
                throw Conflict("The existing placement type did not resolve to a positive safe native ID.");
            if (sourceIds.Contains(symbolId))
                throw Conflict("Placement cannot use a reviewed copy source through either its native ID or family/type names; place the copied type instead.");
        }
    }

    public static void ValidatePlan(IReadOnlyList<JsonElement> operations)
    {
        var sourceIds = new HashSet<long>();
        var copiedReferences = new HashSet<string>(StringComparer.Ordinal);
        var names = new HashSet<(long Source, string Name)>();
        foreach (var op in operations.Where(op => JsonDefaults.String(op, "operationType") == "duplicate_architecture_type"))
        {
            var input = Validate(op);
            if (!names.Add((input.SourceTypeId, input.Name)))
                throw Conflict("The same source cannot be copied to the same target name more than once in a reviewed plan.");
            sourceIds.Add(input.SourceTypeId);
            if (JsonDefaults.String(op, "id") is { } id) copiedReferences.Add("@" + id);
        }
        if (sourceIds.Count > 0)
        {
            foreach (var op in operations)
            {
                var type = JsonDefaults.String(op, "operationType");
                if (type == "load_family") throw Conflict("An architecture-copy plan cannot load a family; loading can change the reviewed source.");
                var target = type is "set_parameter" or "delete_element" ? JsonDefaults.Get(op, "elementId") :
                    type == "duplicate_type" ? JsonDefaults.Get(op, "sourceTypeId") : default;
                if (Protected(target, sourceIds, copiedReferences))
                    throw Conflict("Reviewed source and copied types are protected from same-plan parameter changes, deletion and generic duplication.");
                if (type is "create_family_instance" or "create_structural_column" &&
                    JsonDefaults.Int64(op, "symbolId") is long symbolId && sourceIds.Contains(symbolId))
                    throw Conflict("Placement cannot activate a reviewed copy source in the same plan; place the explicitly copied type instead.");
            }
        }
        var earlier = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var op in operations)
        {
            var type = JsonDefaults.String(op, "operationType");
            var symbol = JsonDefaults.String(op, "symbolId");
            if (symbol is not null && symbol.StartsWith('@'))
            {
                var known = earlier.TryGetValue(symbol[1..], out var source);
                var dedicated = known && JsonDefaults.String(source, "operationType") == "duplicate_architecture_type";
                if (type == "create_structural_column" && (!dedicated || JsonDefaults.String(source, "category") != "OST_StructuralColumns"))
                    throw ReferenceMismatch("A column type reference requires an earlier dedicated architecture copy with the matching structural-column category.");
                var category = JsonDefaults.String(op, "category");
                if (type == "create_family_instance" && (dedicated || IsArchitectureCategory(category)) &&
                    (!dedicated || category is not ("OST_Doors" or "OST_Windows") || JsonDefaults.String(source, "category") != category))
                    throw ReferenceMismatch("A copied architecture type requires an earlier dedicated copy and an explicit matching door or window placement category; columns use create_structural_column.");
            }
            foreach (var property in op.EnumerateObject())
            {
                if (property.Name.EndsWith("Id", StringComparison.Ordinal) && IsCopiedReference(property.Value, copiedReferences) &&
                    !(property.Name == "symbolId" && type is "create_family_instance" or "create_structural_column"))
                    throw ReferenceMismatch("A copied architecture type may be referenced only as the symbol of its matching reviewed placement.");
                if (property.Name.EndsWith("Ids", StringComparison.Ordinal) && property.Value.ValueKind == JsonValueKind.Array &&
                    property.Value.EnumerateArray().Any(value => IsCopiedReference(value, copiedReferences)))
                    throw ReferenceMismatch("Copied architecture types cannot be used as instance-element references.");
            }
            if (JsonDefaults.String(op, "id") is { } id) earlier.Add(id, op);
        }
    }

    private static bool IsArchitectureCategory(string? category) => category is "OST_StructuralColumns" or "OST_Doors" or "OST_Windows";
    private static bool IsCopiedReference(JsonElement value, HashSet<string> references) =>
        value.ValueKind == JsonValueKind.String && references.Contains(value.GetString()!);
    private static bool Protected(JsonElement value, HashSet<long> sources, HashSet<string> references) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var id) && sources.Contains(id) || IsCopiedReference(value, references);
    private static BridgeException Conflict(string message) => new("architecture_type_copy_conflict", message);
    private static BridgeException ReferenceMismatch(string message) => new("architecture_type_reference_mismatch", message);

    private static long Integer(JsonElement value, string field, bool positive)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var id) || id == 0 ||
            id > MaxSafeInteger || id < -MaxSafeInteger || positive && id < 0)
            throw Invalid(field + (positive ? " must be an existing positive safe integer ID; deferred references are not allowed." : " must be an explicit nonzero signed safe integer parameter ID."));
        return id;
    }
    private static string Text(JsonElement value, string field, bool trimmed, int maxLength = 200)
    {
        if (value.ValueKind != JsonValueKind.String) throw Invalid(field + " must be an explicit string.");
        var text = value.GetString()!;
        if (string.IsNullOrWhiteSpace(text) || text.Length > maxLength || text.Any(char.IsControl) || trimmed && text != text.Trim())
            throw Invalid(field + " must be nonempty, bounded and exact" + (trimmed ? " without surrounding whitespace." : "."));
        return text;
    }
    private static void Shape(JsonElement value, string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("Explicit object inputs are required.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name, StringComparer.Ordinal) || !names.Add(property.Name))
                throw Invalid("Unsupported or duplicate type-copy field '" + property.Name + "'.");
    }
}
