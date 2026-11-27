using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;

namespace RevitAutoV27;

// Selectively adapted from bimwright/rvt-mcp (Apache-2.0), fixed commit
// b44ee0b8032f0603f8e52656bc05ab43aa599263, Structural/CreateStructuralBeamHandler.cs
// and Structural/CreateFoundationIsolatedHandler.cs. See THIRD_PARTY_NOTICES.md.
// The executor owns all transactions; this adapter never saves or commits.
internal sealed class StructuralElementService
{
    private sealed record Binding(long ElementId, string UniqueId, JsonElement Reviewed, bool SymbolWasActive);
    private readonly List<Binding> completed = [];
    private Document? capturedDocument;
    private static BridgeException Invalid(string message) => StructuralElementRules.Invalid(message);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static XYZ Point(StructuralPointReadback point) => new(Mm(point.XMm), Mm(point.YMm), Mm(point.ZMm));
    private static T Existing<T>(Document doc, JsonElement op, string key) where T : Element =>
        doc.GetElement(new ElementId(StructuralElementRules.Id(op, key))) as T ?? throw Invalid($"{key} is not an existing {typeof(T).Name} in this document.");

    public static void Validate(Document doc, JsonElement op)
    {
        StructuralElementRules.Validate(op);
        var symbol = Existing<FamilySymbol>(doc, op, "symbolId");
        var beam = StructuralElementRules.IsBeam(op);
        RequireSymbol(symbol, beam);
        var level = Existing<Level>(doc, op, "levelId");
        if (!double.IsFinite(level.ProjectElevation)) throw Invalid("Native project level elevation is unknown or non-finite.");
        if (beam)
        {
            var start = Point(StructuralElementRules.Point(op, "start")); var end = Point(StructuralElementRules.Point(op, "end"));
            if (!double.IsFinite(start.DistanceTo(end)) || start.DistanceTo(end) <= doc.Application.ShortCurveTolerance)
                throw Invalid("Beam length must exceed the current Revit native short-curve tolerance.");
        }
    }

    private static void RequireSymbol(FamilySymbol symbol, bool beam)
    {
        if (symbol.Category?.Id.Value != (long)(beam ? BuiltInCategory.OST_StructuralFraming : BuiltInCategory.OST_StructuralFoundation) ||
            symbol.Family.FamilyPlacementType != (beam ? FamilyPlacementType.CurveDrivenStructural : FamilyPlacementType.OneLevelBased))
            throw Invalid(beam ? "Beam requires an existing OST_StructuralFraming CurveDrivenStructural type." :
                "Isolated foundation requires an existing OST_StructuralFoundation OneLevelBased type; hosted and other placements are unsupported.");
    }

    public static object Preview(Document doc, JsonElement op)
    {
        Validate(doc, op);
        var symbol = Existing<FamilySymbol>(doc, op, "symbolId"); var level = Existing<Level>(doc, op, "levelId");
        var beam = StructuralElementRules.IsBeam(op);
        return new { operationType = JsonDefaults.String(op, "operationType"), symbolId = symbol.Id.Value, family = symbol.FamilyName, type = symbol.Name,
            categoryId = symbol.Category!.Id.Value, placementType = symbol.Family.FamilyPlacementType.ToString(), levelId = level.Id.Value,
            levelName = level.Name, projectLevelElevationMm = JsonDefaults.InternalToMm(level.ProjectElevation),
            start = beam ? StructuralElementRules.Point(op, "start") : null, end = beam ? StructuralElementRules.Point(op, "end") : null,
            point = beam ? null : StructuralElementRules.Point(op, "point"), rotationDegrees = StructuralElementRules.Rotation(op) * 180 / Math.PI,
            rotationPolicy = beam ? "native-cross-section-rotation" : "absolute-location-point-rotation-about-project-Z",
            coordinateFrame = "Revit internal/project origin, absolute XYZ millimeters", elevationPolicy = "explicit-absolute-XYZ; native-normalization-causes-rollback",
            symbolIsActive = symbol.IsActive, activationRequired = !symbol.IsActive, activationScope = new { symbolId = symbol.Id.Value, familyId = symbol.Family.Id.Value },
            typeMutationRequested = false, nativeReadbackVerified = false, engineeringComplianceVerified = false };
    }

    public OperationReceipt Create(Document doc, JsonElement op)
    {
        BindDocument(doc); Validate(doc, op);
        var symbol = Existing<FamilySymbol>(doc, op, "symbolId"); var level = Existing<Level>(doc, op, "levelId");
        var wasActive = symbol.IsActive; var beam = StructuralElementRules.IsBeam(op);
        if (!wasActive) { symbol.Activate(); doc.Regenerate(); }
        FamilyInstance instance;
        if (beam)
        {
            using var line = Line.CreateBound(Point(StructuralElementRules.Point(op, "start")), Point(StructuralElementRules.Point(op, "end")));
            instance = doc.Create.NewFamilyInstance(line, symbol, level, StructuralType.Beam) ?? throw Invalid("Revit returned no structural beam.");
            var (disallowStart, disallowEnd) = GeometryJoinRules.ResolveEndDisallow(op);
            if (disallowStart) StructuralFramingUtils.DisallowJoinAtEnd(instance, 0);
            if (disallowEnd) StructuralFramingUtils.DisallowJoinAtEnd(instance, 1);
            doc.Regenerate();
            SetAngle(instance, StructuralElementRules.Rotation(op));
        }
        else
        {
            var reviewedPoint = StructuralElementRules.Point(op, "point");
            var xyPoint = new XYZ(Mm(reviewedPoint.XMm), Mm(reviewedPoint.YMm), 0);
            instance = doc.Create.NewFamilyInstance(xyPoint, symbol, level, StructuralType.Footing) ?? throw Invalid("Revit returned no isolated foundation.");
            doc.Regenerate();
            if (instance.Location is not LocationPoint location || !double.IsFinite(location.Rotation)) throw Invalid("Native foundation point rotation is unavailable.");
            var delta = StructuralElementRules.Rotation(op) - location.Rotation;
            if (Math.Abs(delta) > 1e-10)
            {
                using var axis = Line.CreateBound(xyPoint, new XYZ(xyPoint.X, xyPoint.Y, 1));
                ElementTransformUtils.RotateElement(doc, instance.Id, axis, delta);
            }
            var desiredOffsetMm = StructuralElementRules.LevelOffsetMm(reviewedPoint.ZMm, JsonDefaults.InternalToMm(level.ProjectElevation));
            SetLevelOffset(instance, Mm(desiredOffsetMm), desiredOffsetMm);
        }
        return Remember(doc, instance, op, wasActive);
    }

    internal OperationReceipt Remember(Document doc, FamilyInstance element, JsonElement op, bool symbolWasActive)
    {
        BindDocument(doc);
        if (!element.IsValidObject || !element.Document.Equals(doc)) throw Invalid("Created structural element belongs to a different native document.");
        var binding = new Binding(element.Id.Value, element.UniqueId, op.Clone(), symbolWasActive);
        doc.Regenerate(); var evidence = Verify(doc, binding); completed.Add(binding);
        return new([element.Id.Value], symbolWasActive ? [] : [element.Symbol.Id.Value]) { Evidence = evidence };
    }

    public object VerifyCompleted(Document doc, string phase)
    {
        BindDocument(doc);
        var elements = completed.Select(binding => Verify(doc, binding)).ToArray();
        return new { phase, verifiedElementCount = elements.Length, nativeReadbackVerified = true, elements,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }
    private void BindDocument(Document doc)
    {
        if (capturedDocument is null) capturedDocument = doc;
        else if (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc)) throw Invalid("Structural readback belongs to a different native document.");
    }
    private static object Verify(Document doc, Binding binding)
    {
        var instance = doc.GetElement(new ElementId(binding.ElementId)) as FamilyInstance ?? throw Invalid("Reviewed structural element disappeared or changed native class.");
        var actual = Read(instance);
        StructuralElementRules.Require(binding.Reviewed, actual, binding.UniqueId,
            (long)(StructuralElementRules.IsBeam(binding.Reviewed) ? BuiltInCategory.OST_StructuralFraming : BuiltInCategory.OST_StructuralFoundation));
        return new { elementId = binding.ElementId, reviewedOperation = binding.Reviewed, native = actual, nativeReadbackVerified = true,
            coordinateFrame = "Revit internal/project origin, absolute XYZ millimeters", endpointOrderPolicy = "beam endpoint order may reverse; complete XYZ and cross-section angle remain checked",
            symbolActivation = new { symbolId = actual.SymbolId, familyId = instance.Symbol.Family.Id.Value, beforeActive = binding.SymbolWasActive,
                afterActive = actual.SymbolIsActive, activationPerformed = !binding.SymbolWasActive },
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }

    public static object? Inspect(Element element)
    {
        if (element.Category?.Id.Value is not ((long)BuiltInCategory.OST_StructuralFraming or (long)BuiltInCategory.OST_StructuralFoundation)) return null;
        try
        {
            if (element is not FamilyInstance instance) throw Invalid("Structural element class is unsupported.");
            return NativeReadSnapshot.Freeze(new { supported = true, native = Read(instance), coordinateFrame = "Revit internal/project origin, absolute XYZ millimeters", sideEffectsVerified = false });
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error) { return new { supported = false, errorType = error.GetType().Name, error = error.Message, sideEffectsVerified = false }; }
    }

    private static StructuralElementReadback Read(FamilyInstance instance)
    {
        var beam = instance.Category?.Id.Value == (long)BuiltInCategory.OST_StructuralFraming;
        RequireSymbol(instance.Symbol, beam);
        var category = instance.Category?.Id.Value ?? throw Invalid("Native structural category is unavailable.");
        if (category != instance.Symbol.Category?.Id.Value) throw Invalid("Native instance and symbol categories disagree.");
        var level = ReadParameter(instance, beam ? BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM : BuiltInParameter.FAMILY_LEVEL_PARAM, StorageType.ElementId).AsElementId();
        if (level.Value <= 0 || instance.Document.GetElement(level) is not Level ||
            (beam ? (instance.LevelId != ElementId.InvalidElementId && instance.LevelId != level) : instance.LevelId != level))
            throw Invalid("Native structural level identity is unknown or disagrees with its level parameter.");
        StructuralPointReadback NativePoint(XYZ value) => new(JsonDefaults.InternalToMm(value.X), JsonDefaults.InternalToMm(value.Y), JsonDefaults.InternalToMm(value.Z));
        StructuralPointReadback? start = null, end = null, point = null; double angle;
        if (beam)
        {
            if (instance.Location is not LocationCurve location || location.Curve is not Line line || !line.IsBound) throw Invalid("Native beam location is not a bounded straight line.");
            start = NativePoint(line.GetEndPoint(0)); end = NativePoint(line.GetEndPoint(1));
            angle = ReadParameter(instance, BuiltInParameter.STRUCTURAL_BEND_DIR_ANGLE, StorageType.Double).AsDouble();
        }
        else
        {
            if (instance.Location is not LocationPoint location) throw Invalid("Native foundation point is unavailable.");
            point = NativePoint(location.Point); angle = location.Rotation;
        }
        if (!double.IsFinite(angle) || new[] { start, end, point }.Where(p => p is not null).Any(p => !double.IsFinite(p!.XMm) || !double.IsFinite(p.YMm) || !double.IsFinite(p.ZMm)))
            throw Invalid("Native structural geometry or rotation is non-finite.");
        return new(instance.Id.Value, instance.UniqueId, instance.Symbol.Id.Value, level.Value, category,
            beam ? "OST_StructuralFraming" : "OST_StructuralFoundation", instance.StructuralType.ToString(), instance.Symbol.Family.FamilyPlacementType.ToString(),
            instance.Symbol.IsActive, start, end, point, angle);
    }
    private static Parameter ReadParameter(Element element, BuiltInParameter key, StorageType storage)
    {
        var parameter = element.get_Parameter(key);
        return parameter is not null && parameter.HasValue && parameter.StorageType == storage ? parameter :
            throw Invalid($"Native structural {key} is missing, unknown or has the wrong storage type.");
    }
    private static void SetAngle(FamilyInstance instance, double expected)
    {
        var parameter = ReadParameter(instance, BuiltInParameter.STRUCTURAL_BEND_DIR_ANGLE, StorageType.Double);
        var actual = parameter.AsDouble();
        if (double.IsFinite(actual) && Math.Abs(Math.Atan2(Math.Sin(actual - expected), Math.Cos(actual - expected))) <= 1e-10) return;
        if (parameter.IsReadOnly || !parameter.Set(expected)) throw Invalid("Revit refused the reviewed beam cross-section rotation.");
    }

    private static void SetLevelOffset(FamilyInstance instance, double offsetInternal, double desiredOffsetMm)
    {
        BuiltInParameter[] candidates = [
            BuiltInParameter.INSTANCE_FREE_HOST_OFFSET_PARAM,
            BuiltInParameter.INSTANCE_ELEVATION_PARAM,
            BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM
        ];
        foreach (var key in candidates)
        {
            var parameter = instance.get_Parameter(key);
            if (parameter is null || parameter.IsReadOnly || parameter.StorageType != StorageType.Double) continue;
            var current = parameter.AsDouble();
            if (double.IsFinite(current) && Math.Abs(current - offsetInternal) <= Mm(1e-6)) return;
            if (parameter.Set(offsetInternal)) return;
        }
        if (Math.Abs(desiredOffsetMm) > StructuralElementRules.PositionToleranceMm)
            throw Invalid($"Revit isolated foundation has no writable level offset parameter for requested offset {desiredOffsetMm:F3} mm.");
    }
}
