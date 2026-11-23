using System.Text.Json;
using System.Text.Json.Serialization;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Native material ID, area and volume queries follow the bimwright/rvt-mcp
// GetMaterialQuantitiesHandler pattern at b44ee0b (Apache-2.0).
internal static class MaterialQuantitiesService
{
    internal const int MaxElements = 20;
    private const int MaxMaterialsPerElement = 64;
    private record Quantity(long MaterialId,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Name,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? AreaM2,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? VolumeM3);

    internal static object Read(Document doc, JsonElement request, CancellationToken cancellation)
    {
        if (request.ValueKind != JsonValueKind.Object) throw Invalid("Material quantity request must be an object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in request.EnumerateObject())
            if (item.Name is not ("documentIdentity" or "expectedRevision" or "elementIds") || !seen.Add(item.Name))
                throw Invalid("Unsupported or duplicate material quantity field.");
        if (!seen.Contains("documentIdentity") || !seen.Contains("expectedRevision"))
            throw Invalid("Material quantities require both document read pins.");
        var ids = JsonDefaults.Get(request, "elementIds");
        if (ids.ValueKind != JsonValueKind.Array || ids.GetArrayLength() is < 1 or > MaxElements)
            throw Invalid("Supply 1 to 20 explicit distinct model element IDs.");
        var selected = ids.EnumerateArray().Select(value =>
        {
            if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var id) || id <= 0 || id > 9007199254740991)
                throw Invalid("Each selected model element ID must be a positive safe integer.");
            return id;
        }).ToArray();
        if (selected.Distinct().Count() != selected.Length) throw Invalid("Element IDs must be distinct.");

        return new
        {
            documentIdentity = RevitCommandRouter.Identity(doc),
            documentRevision = RevitCommandRouter.Revision(doc),
            readOnly = true,
            quantityScope = "selected-elements-nonpaint-model-materials",
            items = selected.Select(id => Observe(doc, id, cancellation)).ToArray()
        };
    }

    private static object Observe(Document doc, long id, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var element = doc.GetElement(new ElementId(id));
        if (element is null) return new { elementId = id, status = "missing" };
        if (element is ElementType || element.Category?.HasMaterialQuantities != true)
            return new { elementId = id, uniqueId = element.UniqueId, status = "unsupported" };
        ElementId[] materials;
        try { materials = element.GetMaterialIds(false).OrderBy(material => material.Value).ToArray(); }
        catch (OperationCanceledException) { throw; }
        catch (Exception) { return new { elementId = id, uniqueId = element.UniqueId, status = "material_ids_unavailable" }; }
        if (materials.Length > MaxMaterialsPerElement)
            return new { elementId = id, uniqueId = element.UniqueId, status = "material_budget_exceeded", materialCount = materials.Length };
        var rows = new List<Quantity>(materials.Length);
        foreach (var material in materials)
        {
            cancellation.ThrowIfCancellationRequested();
            string? name;
            try { name = (doc.GetElement(material) as Material)?.Name; }
            catch (OperationCanceledException) { throw; }
            catch (Exception) { name = null; }
            rows.Add(new(material.Value, name,
                QuantityIn(() => element.GetMaterialArea(material, false), UnitTypeId.SquareMeters),
                QuantityIn(() => element.GetMaterialVolume(material), UnitTypeId.CubicMeters)));
        }
        bool complete = rows.All(row => row.Name is not null && row.AreaM2.HasValue && row.VolumeM3.HasValue);
        return new { elementId = id, uniqueId = element.UniqueId, status = complete ? "read" : "partial", materials = rows };
    }

    private static double? QuantityIn(Func<double> query, ForgeTypeId unit)
    {
        try
        {
            double result = UnitUtils.ConvertFromInternalUnits(query(), unit);
            return double.IsFinite(result) && result >= 0 ? result : null;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception) { return null; }
    }

    private static BridgeException Invalid(string message) => new("invalid_material_quantities_request", message);
}
