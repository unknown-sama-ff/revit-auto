using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Native Material.Create and Material.Duplicate adapted from bimwright/rvt-mcp
// b44ee0b8032f0603f8e52656bc05ab43aa599263 (Apache-2.0). The existing plan owns the transaction.
internal sealed class MaterialCreationService
{
    private sealed record Snapshot(long ElementId, string UniqueId, string Name, MaterialGraphics Graphics,
        long AppearanceAssetId, long StructuralAssetId, long ThermalAssetId, long EmbodiedCarbonAssetId,
        long SurfaceForegroundPatternId, long SurfaceBackgroundPatternId, long CutForegroundPatternId, long CutBackgroundPatternId,
        MaterialRgb? SurfaceForegroundPatternColor, MaterialRgb? SurfaceBackgroundPatternColor,
        MaterialRgb? CutForegroundPatternColor, MaterialRgb? CutBackgroundPatternColor);

    private sealed record Binding(MaterialInput Input, Snapshot Created, Snapshot? Source);
    private sealed record Assignment(long TargetId, string TargetUniqueId, long ParameterId, string Parameter,
        long MaterialId, string MaterialUniqueId, long? PreviousMaterialId, bool WritePerformed);
    private readonly List<Binding> bindings = [];
    private readonly List<Assignment> assignments = [];
    private Document? document;

    private static Material Get(Document doc, long id) =>
        doc.GetElement(new ElementId(id)) is Material { IsValidObject: true } material
            ? material : throw MaterialCreationRules.Invalid("The reviewed material does not exist in the active document.");

    internal static void Validate(Document doc, JsonElement op)
    {
        var input = MaterialCreationRules.Validate(op);
        if (!NamingUtils.IsValidName(input.Name)) throw MaterialCreationRules.Invalid("Revit rejected the requested material name.");
        if (new FilteredElementCollector(doc).OfClass(typeof(Material)).Cast<Material>()
            .Any(material => string.Equals(material.Name, input.Name, StringComparison.OrdinalIgnoreCase)))
            throw MaterialCreationRules.Invalid("A material already uses the requested name.");
        if (input.SourceMaterialId is long source) _ = Read(Get(doc, source));
    }

    internal static object Preview(Document doc, JsonElement op)
    {
        Validate(doc, op);
        var input = MaterialCreationRules.Validate(op);
        return new
        {
            requested = input,
            source = input.SourceMaterialId is long source ? Read(Get(doc, source)) : null,
            assetSharingMayOccur = input.SourceMaterialId.HasValue,
            appearanceAssetContentsVerified = false
        };
    }

    internal OperationReceipt Create(Document doc, JsonElement op)
    {
        Validate(doc, op);
        BindDocument(doc);
        var input = MaterialCreationRules.Validate(op);
        var source = input.SourceMaterialId is long id ? Read(Get(doc, id)) : null;
        var result = source is null
            ? Get(doc, Material.Create(doc, input.Name).Value)
            : Get(doc, source.ElementId).Duplicate(input.Name)
                ?? throw MaterialCreationRules.Invalid("Revit did not return a duplicate material.");
        if (input.MaterialClass is not null) result.MaterialClass = input.MaterialClass;
        if (input.MaterialCategory is not null) result.MaterialCategory = input.MaterialCategory;
        if (input.Color is { } rgb) result.Color = new Color((byte)rgb.Red, (byte)rgb.Green, (byte)rgb.Blue);
        if (input.Transparency is int transparency) result.Transparency = transparency;
        doc.Regenerate();
        var created = Read(result);
        if (created.ElementId == source?.ElementId) throw MaterialCreationRules.Invalid("Revit returned the source material as the duplicate.");
        var binding = new Binding(input, created, source);
        var evidence = Verify(doc, binding);
        bindings.Add(binding);
        return OperationReceipt.New(created.ElementId) with { Evidence = evidence };
    }

    internal object? VerifyCompleted(Document doc, string phase)
    {
        if (bindings.Count == 0 && assignments.Count == 0) return null;
        BindDocument(doc);
        return new
        {
            phase, verifiedElementCount = bindings.Count, verifiedAssignmentCount = assignments.Count,
            elements = bindings.Select(binding => Verify(doc, binding)).ToArray(),
            assignments = assignments.Select(assignment => VerifyAssignment(doc, assignment)).ToArray()
        };
    }

    internal static object PreviewAssignment(Element target, string name, Material? material, string? materialReference)
    {
        var parameter = AssignmentParameter(target, name);
        return new { elementId = target.Id.Value, target.UniqueId, parameterId = parameter.Id.Value,
            parameter = parameter.Definition.Name, previousMaterialId = PriorMaterialId(parameter),
            requestedMaterialId = material?.Id.Value, requestedMaterialReference = materialReference,
            assemblyLayerAssignment = false };
    }

    internal OperationReceipt Assign(Document doc, Element target, string name, Material material)
    {
        BindDocument(doc);
        var parameter = AssignmentParameter(target, name);
        var previous = PriorMaterialId(parameter);
        bool changed = previous != material.Id.Value;
        if (changed && !parameter.Set(material.Id)) throw MaterialCreationRules.Invalid("Revit refused the explicit material assignment.");
        if (changed) doc.Regenerate();
        var binding = new Assignment(target.Id.Value, target.UniqueId, parameter.Id.Value, name,
            material.Id.Value, material.UniqueId, previous, changed);
        var evidence = VerifyAssignment(doc, binding);
        assignments.Add(binding);
        return OperationReceipt.ForParameter(binding.TargetId, name, changed) with { Evidence = evidence };
    }

    private static object VerifyAssignment(Document doc, Assignment assignment)
    {
        var target = doc.GetElement(new ElementId(assignment.TargetId));
        if (target is null || target.UniqueId != assignment.TargetUniqueId)
            throw MaterialCreationRules.Invalid("The material assignment target changed before final verification.");
        var parameter = AssignmentParameter(target, assignment.Parameter);
        if (parameter.Id.Value != assignment.ParameterId || PriorMaterialId(parameter) != assignment.MaterialId ||
            Get(doc, assignment.MaterialId).UniqueId != assignment.MaterialUniqueId)
            throw MaterialCreationRules.Invalid("The native material parameter differs from the reviewed assignment.");
        return new { assignment, outcome = assignment.WritePerformed ? "write_performed" : "no_change",
            parameterWritePerformed = assignment.WritePerformed, noOp = !assignment.WritePerformed,
            nativeMaterialParameterVerified = true, allModelSideEffectsVerified = false };
    }

    private static Parameter AssignmentParameter(Element target, string name)
    {
        if (target is ElementType || target is Material || !target.IsValidObject)
            throw MaterialCreationRules.Invalid("Select a model instance with a writable material reference parameter.");
        Parameter? parameter;
        if (name.StartsWith("BIP:", StringComparison.Ordinal) && Enum.TryParse<BuiltInParameter>(name[4..], out var builtin) && Enum.IsDefined(builtin))
            parameter = target.get_Parameter(builtin);
        else
        {
            var matches = target.GetParameters(name);
            parameter = matches.Count == 1 ? matches[0] : null;
        }
        if (parameter is null || parameter.Element?.Id != target.Id || parameter.IsReadOnly || parameter.StorageType != StorageType.ElementId ||
            !parameter.Definition.GetDataType().Equals(SpecTypeId.Reference.Material))
            throw MaterialCreationRules.Invalid("The selected parameter is missing, ambiguous, read-only or not a native material reference.");
        return parameter;
    }

    private static long? PriorMaterialId(Parameter parameter) =>
        parameter.HasValue ? parameter.AsElementId().Value : null;

    private void BindDocument(Document doc)
    {
        if (document is not null && (!document.IsValidObject || !document.Equals(doc)))
            throw MaterialCreationRules.Invalid("Material readback belongs to another document.");
        document = doc;
    }

    internal static object? Inspect(Element element)
    {
        if (element is not Material material) return null;
        try { return new { supported = true, material = Read(material) }; }
        catch (OperationCanceledException) { throw; }
        catch (Exception error) { return new { supported = false, reason = error.Message }; }
    }

    private static object Verify(Document doc, Binding binding)
    {
        var result = Read(Get(doc, binding.Created.ElementId));
        var source = binding.Source is { } prior ? Read(Get(doc, prior.ElementId)) : null;
        if (result != binding.Created || source != binding.Source)
            throw MaterialCreationRules.Invalid("The material or its reviewed duplication source changed before final verification.");
        MaterialCreationRules.Require(binding.Input, result.Name, result.Graphics, source?.Graphics);
        return new
        {
            elementId = result.ElementId,
            material = result,
            duplicationSource = source,
            nativeGraphicsReadbackVerified = true,
            assetLinksReadBack = true,
            appearanceAssetContentsVerified = false,
            allModelSideEffectsVerified = false
        };
    }

    private static Snapshot Read(Material material)
    {
        static MaterialRgb? Rgb(Color? color) => color is { IsValid: true } ? new(color.Red, color.Green, color.Blue) : null;
        var graphics = new MaterialGraphics(material.MaterialClass ?? "", material.MaterialCategory ?? "",
            Rgb(material.Color) ?? throw MaterialCreationRules.Invalid("Native material graphics color is unavailable."),
            material.Transparency, material.Shininess, material.Smoothness, material.UseRenderAppearanceForShading);
        return new(material.Id.Value, material.UniqueId, material.Name, graphics,
            material.AppearanceAssetId.Value, material.StructuralAssetId.Value, material.ThermalAssetId.Value, material.EmbodiedCarbonAssetId.Value,
            material.SurfaceForegroundPatternId.Value, material.SurfaceBackgroundPatternId.Value,
            material.CutForegroundPatternId.Value, material.CutBackgroundPatternId.Value,
            Rgb(material.SurfaceForegroundPatternColor), Rgb(material.SurfaceBackgroundPatternColor),
            Rgb(material.CutForegroundPatternColor), Rgb(material.CutBackgroundPatternColor));
    }
}
