using System.Text.Json;

namespace RevitAutoV27;

internal static class AnnotationInputRules
{
    private static readonly HashSet<string> TagFields = new(StringComparer.Ordinal)
    { "operationType", "id", "dependencies", "parameters", "mark", "elementId", "viewId", "tagTypeId", "xMm", "yMm", "zMm", "leader" };
    private static readonly HashSet<string> DimensionFields = new(StringComparer.Ordinal)
    { "operationType", "id", "dependencies", "parameters", "mark", "viewId", "dimensionTypeId", "start", "end", "references" };
    private static BridgeException Invalid(string message) => new("invalid_annotation_input", message);

    internal static void Validate(JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType");
        var allowed = kind == "create_tag" ? TagFields : DimensionFields;
        if (op.EnumerateObject().Any(property => !allowed.Contains(property.Name)))
            throw Invalid("Annotation operation has unsupported fields; use its documented case-sensitive fields.");
        var typeField = kind == "create_tag" ? "tagTypeId" : "dimensionTypeId";
        if (op.TryGetProperty(typeField, out var type) &&
            !(type.ValueKind == JsonValueKind.Number && type.TryGetInt64(out var id) && id > 0) &&
            !(type.ValueKind == JsonValueKind.String && type.GetString() is { Length: > 1 } reference && reference[0] == '@'))
            throw Invalid("An optional annotation type must be a positive id or a prior @reference when supplied.");
        if (kind != "create_dimension") return;
        if (!op.TryGetProperty("references", out var references) || references.ValueKind != JsonValueKind.Array ||
            references.GetArrayLength() < 2 || references.GetArrayLength() > DimensionCreationReadbackRules.MaxReferences)
            throw Invalid("Dimension references require 2..128 distinct nonblank stable-reference strings.");
        var known = new HashSet<string>(StringComparer.Ordinal);
        foreach (var value in references.EnumerateArray())
            if (value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()) ||
                value.GetString()!.Length > DimensionCreationReadbackRules.MaxStableReferenceLength || !known.Add(value.GetString()!))
                throw Invalid("Dimension references require distinct nonblank stable-reference strings of at most 4096 characters.");
    }
}
