using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

internal sealed class RoofCreationService
{
    private sealed record Binding(long Id, string UniqueId, string TypeUniqueId, string LevelUniqueId, double LevelElevationMm, RoofInput Input);
    private sealed record Snapshot(long ElementId, string UniqueId, long RoofTypeId, long LevelId, double BaseOffsetMm,
        double BaseElevationMm, RoofEdge[] Edges);

    private readonly List<Binding> bindings = [];
    private Document? document;
    private static BridgeException Invalid(string message) => RoofCreationRules.Invalid(message);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static CeilingPoint Point(XYZ p) =>
        new(JsonDefaults.InternalToMm(p.X), JsonDefaults.InternalToMm(p.Y), JsonDefaults.InternalToMm(p.Z));
    private static T Existing<T>(Document doc, long id) where T : Element =>
        doc.GetElement(new ElementId(id)) is T { IsValidObject: true } value
            ? value : throw Invalid($"The reviewed {typeof(T).Name} is unavailable.");

    internal static void Validate(Document doc, JsonElement operation)
    {
        var input = RoofCreationRules.Validate(operation);
        var type = Existing<RoofType>(doc, input.RoofTypeId);
        if (type.GetCompoundStructure() is null)
            throw Invalid("Select a compound roof type for footprint creation.");
        var level = Existing<Level>(doc, input.LevelId);
        using var footprint = BuildFootprint(doc, input, level);
        _ = CeilingCreationRules.HeightOffsetMm(input.Boundary[0].ZMm, JsonDefaults.InternalToMm(level.ProjectElevation));
    }

    internal static object Preview(Document doc, JsonElement operation)
    {
        Validate(doc, operation);
        var input = RoofCreationRules.Validate(operation);
        var level = Existing<Level>(doc, input.LevelId);
        var absoluteBaseMm = input.Boundary[0].ZMm;
        var baseOffsetMm = CeilingCreationRules.HeightOffsetMm(absoluteBaseMm, JsonDefaults.InternalToMm(level.ProjectElevation));
        return new { input, absoluteBaseMm, baseOffsetMm, slopeUnits = "rise/run", nativeBaseSurfaceVerified = false };
    }

    internal OperationReceipt Create(Document doc, JsonElement operation)
    {
        Validate(doc, operation);
        if (document is not null && (!document.IsValidObject || !document.Equals(doc)))
            throw Invalid("Roof readback belongs to another document.");
        document = doc;
        var input = RoofCreationRules.Validate(operation);
        var level = Existing<Level>(doc, input.LevelId);
        var type = Existing<RoofType>(doc, input.RoofTypeId);
        var levelElevationMm = JsonDefaults.InternalToMm(level.ProjectElevation);
        using var footprint = BuildFootprint(doc, input, level);
        var mapping = new ModelCurveArray();
        try
        {
            var roof = doc.Create.NewFootPrintRoof(footprint, level, type, out mapping)
                ?? throw Invalid("Revit did not create a footprint roof.");
            var curves = mapping.Cast<ModelCurve>().ToArray();
            var ordered = RoofCreationRules.MatchEdges(input.Boundary, curves.Select(Endpoints).ToArray());
            for (var i = 0; i < ordered.Length; i++)
            {
                var curve = curves[ordered[i]];
                var ratio = input.EdgeSlopes[i];
                roof.set_DefinesSlope(curve, ratio > 0);
                if (ratio > 0) roof.set_SlopeAngle(curve, ratio);
            }
            var offsetMm = CeilingCreationRules.HeightOffsetMm(input.Boundary[0].ZMm, levelElevationMm);
            var offset = ReadParameter(roof, BuiltInParameter.ROOF_LEVEL_OFFSET_PARAM, StorageType.Double);
            if (Math.Abs(JsonDefaults.InternalToMm(offset.AsDouble()) - offsetMm) > CeilingCreationRules.ToleranceMm &&
                (offset.IsReadOnly || !offset.Set(Mm(offsetMm))))
                throw Invalid("The reviewed roof base offset could not be set.");
            doc.Regenerate();
            var binding = new Binding(roof.Id.Value, roof.UniqueId, type.UniqueId, level.UniqueId, levelElevationMm, input);
            var evidence = Verify(doc, binding);
            bindings.Add(binding);
            return OperationReceipt.New(binding.Id) with { Evidence = evidence };
        }
        finally
        {
            mapping?.Dispose();
        }
    }

    internal object? VerifyCompleted(Document doc, string phase)
    {
        if (bindings.Count == 0) return null;
        if (document is null || !document.IsValidObject || !document.Equals(doc))
            throw Invalid("Roof readback belongs to another document.");
        return new { phase, verifiedElementCount = bindings.Count, elements = bindings.Select(binding => Verify(doc, binding)).ToArray() };
    }

    internal static object? Inspect(Element element)
    {
        if (element is not FootPrintRoof roof) return null;
        try { return new { supported = true, footprintRoof = Read(roof) }; }
        catch (OperationCanceledException) { throw; }
        catch (Exception error) { return new { supported = false, reason = error.Message }; }
    }

    private static object Verify(Document doc, Binding binding)
    {
        var roof = Existing<FootPrintRoof>(doc, binding.Id);
        var native = Read(roof);
        var level = Existing<Level>(doc, binding.Input.LevelId);
        if (native.UniqueId != binding.UniqueId || native.RoofTypeId != binding.Input.RoofTypeId ||
            native.LevelId != binding.Input.LevelId || roof.RoofType.UniqueId != binding.TypeUniqueId ||
            level.UniqueId != binding.LevelUniqueId ||
            Math.Abs(JsonDefaults.InternalToMm(level.ProjectElevation) - binding.LevelElevationMm) > CeilingCreationRules.ToleranceMm)
            throw Invalid("Roof, type or level identity changed before final verification.");
        RoofCreationRules.RequireFootprint(binding.Input, native.Edges, native.BaseElevationMm);
        return new { elementId = native.ElementId, native, nativeFootprintPlanAndSlopesVerified = true,
            exactRoofSolidsVerified = false, allModelSideEffectsVerified = false };
    }

    private static Snapshot Read(FootPrintRoof roof)
    {
        using var profiles = roof.GetProfiles();
        if (profiles.Size != 1 || profiles.get_Item(0) is not ModelCurveArray profile || profile.Size is < 3 or > 128)
            throw Invalid("Expected one complete native roof footprint loop.");
        var edges = profile.Cast<ModelCurve>().Select(curve =>
        {
            var (start, end) = Endpoints(curve);
            var slope = roof.get_DefinesSlope(curve);
            return new RoofEdge(start, end, slope, slope ? roof.get_SlopeAngle(curve) : null);
        }).ToArray();
        var baseLevel = ReadParameter(roof, BuiltInParameter.ROOF_BASE_LEVEL_PARAM, StorageType.ElementId).AsElementId();
        var level = Existing<Level>(roof.Document, baseLevel.Value);
        var offsetMm = JsonDefaults.InternalToMm(ReadParameter(roof, BuiltInParameter.ROOF_LEVEL_OFFSET_PARAM, StorageType.Double).AsDouble());
        var baseElevationMm = JsonDefaults.InternalToMm(level.ProjectElevation) + offsetMm;
        if (!double.IsFinite(baseElevationMm)) throw Invalid("The native roof base elevation is unavailable.");
        return new(roof.Id.Value, roof.UniqueId, roof.GetTypeId().Value, baseLevel.Value, offsetMm, baseElevationMm, edges);
    }

    private static (CeilingPoint Start, CeilingPoint End) Endpoints(ModelCurve modelCurve)
    {
        if (modelCurve.GeometryCurve is not Line { IsBound: true } line)
            throw Invalid("Native footprint edges must be bounded straight lines.");
        return (Point(line.GetEndPoint(0)), Point(line.GetEndPoint(1)));
    }

    private static CurveArray BuildFootprint(Document doc, RoofInput input, Level level)
    {
        // The footprint sketch lives on the native level plane. Absolute base Z is applied once through the offset.
        var points = input.Boundary.Select(p => new XYZ(Mm(p.XMm), Mm(p.YMm), level.ProjectElevation)).ToArray();
        var curves = new CurveArray();
        try
        {
            using var loop = new CurveLoop();
            for (var i = 0; i < points.Length; i++)
            {
                XYZ next = points[(i + 1) % points.Length];
                if (!XYZ.IsWithinLengthLimits(points[i]) || points[i].DistanceTo(next) <= doc.Application.ShortCurveTolerance)
                    throw Invalid("The roof footprint exceeds Revit design limits or has a short edge.");
                var line = Line.CreateBound(points[i], next);
                loop.Append(line);
                curves.Append(Line.CreateBound(points[i], next));
            }
            if (!BoundaryValidation.IsValidHorizontalBoundary(new List<CurveLoop> { loop }))
                throw Invalid("Revit rejected the reviewed horizontal footprint.");
            return curves;
        }
        catch
        {
            curves.Dispose();
            throw;
        }
    }

    private static Parameter ReadParameter(Element element, BuiltInParameter key, StorageType storage) =>
        element.get_Parameter(key) is Parameter { HasValue: true } parameter && parameter.StorageType == storage
            ? parameter : throw Invalid($"Native roof parameter {key} is unavailable.");
}
