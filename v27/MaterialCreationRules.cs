using System.Text.Json;

namespace RevitAutoV27;

internal sealed record MaterialRgb(int Red, int Green, int Blue);
internal sealed record MaterialGraphics(string MaterialClass, string MaterialCategory, MaterialRgb Color, int Transparency,
    int Shininess, int Smoothness, bool UseRenderAppearanceForShading);
internal sealed record MaterialInput(string Name, long? SourceMaterialId, string? MaterialClass, string? MaterialCategory,
    MaterialRgb? Color, int? Transparency);

internal static class MaterialCreationRules
{
    internal static BridgeException Invalid(string message) => new("invalid_material_creation", message);
    internal static bool IsCreation(string? kind) => kind is "create_material" or "duplicate_material";

    internal static void ValidateAssignment(JsonElement operation)
    {
        CheckFields(operation, ["operationType", "id", "dependencies", "elementId", "parameter", "materialId"]);
        var target = JsonDefaults.Int64(operation, "elementId");
        if (target is null or <= 0 or > 9007199254740991)
            throw Invalid("Assign a material to an explicitly selected existing model instance.");
        _ = Text(JsonDefaults.Get(operation, "parameter"), "parameter", allowEmpty: false);
        var value = JsonDefaults.Get(operation, "materialId");
        if (value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 1 } reference && reference[0] == '@') return;
        if (JsonDefaults.Int64(operation, "materialId") is null or <= 0 or > 9007199254740991)
            throw Invalid("materialId requires an existing material ID or a reference to an earlier material.");
    }

    internal static MaterialInput Validate(JsonElement operation)
    {
        var kind = JsonDefaults.String(operation, "operationType");
        if (!IsCreation(kind)) throw Invalid("Expected create_material or duplicate_material.");
        var copies = kind == "duplicate_material";
        CheckFields(operation, copies
            ? ["operationType", "id", "dependencies", "name", "sourceMaterialId"]
            : ["operationType", "id", "dependencies", "name", "materialClass", "materialCategory", "color", "transparency"]);

        var name = Text(JsonDefaults.Get(operation, "name"), "name", allowEmpty: false);
        if (name.IndexOfAny(['{', '}', '[', ']', '|', ';', '<', '>', '?', (char)96, '~']) >= 0)
            throw Invalid("name contains a character prohibited in native material names.");

        if (copies)
        {
            var source = JsonDefaults.Get(operation, "sourceMaterialId");
            if (source.ValueKind != JsonValueKind.Number || !source.TryGetInt64(out var sourceId)
                || sourceId <= 0 || sourceId > 9007199254740991)
                throw Invalid("sourceMaterialId must identify an existing native material using a positive safe integer.");
            return new(name, sourceId, null, null, null, null);
        }

        MaterialRgb? color = null;
        if (operation.TryGetProperty("color", out var rgb))
        {
            CheckFields(rgb, ["red", "green", "blue"]);
            color = new(Integer(JsonDefaults.Get(rgb, "red"), "color.red", 255),
                Integer(JsonDefaults.Get(rgb, "green"), "color.green", 255),
                Integer(JsonDefaults.Get(rgb, "blue"), "color.blue", 255));
        }
        return new(name, null, OptionalText(operation, "materialClass"), OptionalText(operation, "materialCategory"), color,
            operation.TryGetProperty("transparency", out var opacity) ? Integer(opacity, "transparency", 100) : null);
    }

    internal static void ValidatePlan(IReadOnlyList<JsonElement> operations)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var materialReferences = new HashSet<string>(StringComparer.Ordinal);
        var sourceIds = new HashSet<long>();
        var assignmentTargets = new HashSet<long>();
        foreach (var operation in operations.Where(op => IsCreation(JsonDefaults.String(op, "operationType"))))
        {
            var input = Validate(operation);
            if (!names.Add(input.Name)) throw Invalid("New material names must be distinct within a plan.");
            if (input.SourceMaterialId is long source) sourceIds.Add(source);
            if (JsonDefaults.String(operation, "id") is { } reference) materialReferences.Add("@" + reference);
        }
        foreach (var operation in operations.Where(op => JsonDefaults.String(op, "operationType") == "assign_material"))
        {
            var target = JsonDefaults.Int64(operation, "elementId")!.Value;
            if (!assignmentTargets.Add(target)) throw Invalid("Use one explicit material assignment per target instance in a plan.");
            if (JsonDefaults.Int64(operation, "materialId") is long material) sourceIds.Add(material);
            else if (!materialReferences.Contains(JsonDefaults.String(operation, "materialId")!))
                throw Invalid("A material reference must point to an earlier create_material or duplicate_material operation.");
        }
        foreach (var operation in operations.Where(op => JsonDefaults.String(op, "operationType") is "set_parameter" or "delete_element"))
            if (JsonDefaults.Int64(operation, "elementId") is long target && (sourceIds.Contains(target) || assignmentTargets.Contains(target)))
                throw Invalid("Modify a reviewed material or assignment target in a separate plan.");
    }

    internal static void Require(MaterialInput input, string nativeName, MaterialGraphics actual, MaterialGraphics? source)
    {
        if (!string.Equals(input.Name, nativeName, StringComparison.Ordinal))
            throw Invalid("Native material name differs from the reviewed input.");
        if (input.SourceMaterialId.HasValue && (source is null || actual != source))
            throw Invalid("The duplicate did not retain the source material's reviewed graphics fields.");
        if ((input.MaterialClass is not null && actual.MaterialClass != input.MaterialClass)
            || (input.MaterialCategory is not null && actual.MaterialCategory != input.MaterialCategory)
            || (input.Color is not null && actual.Color != input.Color)
            || (input.Transparency.HasValue && actual.Transparency != input.Transparency))
            throw Invalid("Native material graphics differ from the requested fields.");
    }

    private static string? OptionalText(JsonElement operation, string field) =>
        operation.TryGetProperty(field, out var value) ? Text(value, field, allowEmpty: true) : null;

    private static string Text(JsonElement value, string field, bool allowEmpty)
    {
        if (value.ValueKind != JsonValueKind.String || value.GetString() is not { } text || text.Length > 200
            || (!allowEmpty && text.Length == 0) || text.Trim() != text || text.Any(char.IsControl))
            throw Invalid($"{field} requires a string up to 200 characters without controls or surrounding whitespace.");
        return text;
    }

    private static int Integer(JsonElement value, string field, int max)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number) || number < 0 || number > max)
            throw Invalid($"{field} must be an integer from 0 through {max}.");
        return number;
    }

    private static void CheckFields(JsonElement value, string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("Material object is required.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name))
                throw Invalid($"Unsupported or duplicate material field: {property.Name}.");
    }
}
