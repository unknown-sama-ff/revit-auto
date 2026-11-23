// Ceiling.Create + CurveLoop pattern selectively adapted from bimwright/rvt-mcp,
// b44ee0b8032f0603f8e52656bc05ab43aa599263 (Apache-2.0). See THIRD_PARTY_NOTICES.md.
// Defaults/independent transaction removed; strict geometry and repeated native evidence added.
using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

internal sealed class CeilingCreationService
{
    private sealed record Binding(long ElementId, string UniqueId, JsonElement ReviewedOperation, string TypeUniqueId,
        string LevelUniqueId, double LevelProjectElevationMm, long SketchId);
    private readonly List<Binding> completed = [];
    private Document? capturedDocument;
    private static BridgeException Invalid(string message) => CeilingCreationRules.Invalid(message);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static CeilingPoint Point(XYZ value) => new(JsonDefaults.InternalToMm(value.X), JsonDefaults.InternalToMm(value.Y), JsonDefaults.InternalToMm(value.Z));
    private static T Existing<T>(Document doc, JsonElement op, string field) where T : Element =>
        doc.GetElement(new ElementId(CeilingCreationRules.Id(op, field))) is T { IsValidObject: true } item && item.Document.Equals(doc)
            ? item : throw Invalid($"{field} must identify an existing {typeof(T).Name} in this native document; no default/new/deferred selection is permitted.");

    public static void Validate(Document doc, JsonElement op)
    {
        CeilingCreationRules.Validate(op);
        if (!doc.IsValidObject || doc.IsFamilyDocument) throw Invalid("Ceiling creation requires a valid native project document.");
        Existing<CeilingType>(doc, op, "ceilingTypeId");
        var level = Existing<Level>(doc, op, "levelId");
        CeilingCreationRules.HeightOffsetMm(CeilingCreationRules.Boundary(op)[0].ZMm, JsonDefaults.InternalToMm(level.ProjectElevation));
        using var profile = Profile(doc, op, level);
        if (!BoundaryValidation.IsValidHorizontalBoundary(new List<CurveLoop> { profile })) throw Invalid("Native Revit horizontal boundary validation rejected the explicit ceiling polygon; geometry is not projected or repaired.");
    }

    public static object Preview(Document doc, JsonElement op)
    {
        Validate(doc, op);
        var type = Existing<CeilingType>(doc, op, "ceilingTypeId");
        var level = Existing<Level>(doc, op, "levelId");
        var points = CeilingCreationRules.Boundary(op);
        var projectElevation = JsonDefaults.InternalToMm(level.ProjectElevation);
        return new
        {
            operationType = "create_ceiling", ceilingTypeId = type.Id.Value, ceilingTypeUniqueId = type.UniqueId, ceilingTypeName = type.Name,
            levelId = level.Id.Value, levelUniqueId = level.UniqueId, levelName = level.Name, levelProjectElevationMm = projectElevation,
            absoluteProfileZMm = points[0].ZMm, heightOffsetMm = CeilingCreationRules.HeightOffsetMm(points[0].ZMm, projectElevation),
            heightOffsetParameter = nameof(BuiltInParameter.CEILING_HEIGHTABOVELEVEL_PARAM), boundary = JsonDefaults.Get(op, "boundary").Clone(),
            segmentCount = points.Length, expectedSignedAreaMm2 = CeilingCreationRules.SignedAreaMm2(points),
            coordinateFrame = "Revit internal/project origin, millimeters", elevationPolicy = "absolute-profile-Z-minus-native-level-ProjectElevation",
            nativeAcceptance = false, nativeEntityVerified = false, connectionsVerified = false, sideEffectsVerified = false,
            allSideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false
        };
    }

    internal OperationReceipt Create(Document doc, JsonElement op)
    {
        Validate(doc, op);
        if (!doc.IsModifiable) throw Invalid("The existing plan executor must own an active native transaction for ceiling creation.");
        RequireDocument(doc, true);
        var type = Existing<CeilingType>(doc, op, "ceilingTypeId");
        var level = Existing<Level>(doc, op, "levelId");
        var projectElevationMm = JsonDefaults.InternalToMm(level.ProjectElevation);
        var offsetMm = CeilingCreationRules.HeightOffsetMm(CeilingCreationRules.Boundary(op)[0].ZMm, projectElevationMm);
        using var loop = Profile(doc, op, level);
        var ceiling = Ceiling.Create(doc, new List<CurveLoop> { loop }, type.Id, level.Id) ?? throw Invalid("Native Ceiling.Create did not return an element.");
        var offset = ReadParameter(ceiling, BuiltInParameter.CEILING_HEIGHTABOVELEVEL_PARAM, StorageType.Double);
        if (offset.IsReadOnly) throw Invalid("Native ceiling Height Offset From Level is read-only; the explicit absolute Z cannot be applied.");
        offset.Set(Mm(offsetMm));
        doc.Regenerate();
        var binding = new Binding(ceiling.Id.Value, ceiling.UniqueId, op.Clone(), type.UniqueId, level.UniqueId, projectElevationMm, ceiling.SketchId.Value);
        var evidence = Verify(doc, binding, "immediate-after-creation");
        completed.Add(binding);
        return OperationReceipt.New(ceiling.Id.Value) with { Evidence = evidence };
    }

    internal object VerifyCompleted(Document doc, string phase)
    {
        RequireDocument(doc, completed.Count > 0);
        var elements = completed.Select(binding => Verify(doc, binding, phase)).ToArray();
        return new { phase, verifiedElementCount = elements.Length, nativeReadbackVerified = true, elements,
            nativeEntityVerified = false, connectionsVerified = false, sideEffectsVerified = false, allSideEffectsVerified = false,
            persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }

    private void RequireDocument(Document doc, bool capture)
    {
        if (capturedDocument is null && capture) capturedDocument = doc;
        if (!doc.IsValidObject || capturedDocument is not null && (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc)))
            throw Invalid("Ceiling creation evidence belongs to an invalid or different native document.");
    }
    private static object Verify(Document doc, Binding binding, string phase)
    {
        var op = binding.ReviewedOperation;
        var type = Existing<CeilingType>(doc, op, "ceilingTypeId");
        var level = Existing<Level>(doc, op, "levelId");
        var elevationMm = JsonDefaults.InternalToMm(level.ProjectElevation);
        if (type.UniqueId != binding.TypeUniqueId || level.UniqueId != binding.LevelUniqueId || !double.IsFinite(elevationMm) ||
            Math.Abs(elevationMm - binding.LevelProjectElevationMm) > CeilingCreationRules.ToleranceMm)
            throw Invalid("Reviewed native ceiling type/level identity or level project elevation changed before verification; roll back.");
        if (doc.GetElement(new ElementId(binding.ElementId)) is not Ceiling { IsValidObject: true } ceiling || !ceiling.Document.Equals(doc) ||
            ceiling.UniqueId != binding.UniqueId || ceiling.SketchId.Value != binding.SketchId)
            throw Invalid("Created native ceiling identity or sketch binding changed or disappeared; roll back.");
        var native = ReadNative(ceiling);
        CeilingCreationRules.Require(op, binding.LevelProjectElevationMm, binding.ElementId, native);
        var expected = CeilingCreationRules.Boundary(op);
        return NativeReadSnapshot.Freeze(new
        {
            phase, elementId = binding.ElementId, uniqueId = binding.UniqueId, reviewedOperation = op,
            coordinateFrame = "Revit internal/project origin, millimeters", elevationPolicy = "absolute-profile-Z-minus-native-level-ProjectElevation",
            levelProjectElevationMm = elevationMm, heightOffsetMm = native.HeightOffsetMm,
            expectedSignedAreaMm2 = CeilingCreationRules.SignedAreaMm2(expected),
            actualSignedAreaMm2 = CeilingCreationRules.SignedAreaMm2(native.Boundary.Select(edge => edge.Start).ToArray()),
            boundaryEvidenceScope = "complete-owned-native-Sketch-single-loop-bounded-straight-edge-XYZ", native,
            nativeReadbackVerified = true, nativeEntityVerified = false, connectionsVerified = false, sideEffectsVerified = false,
            allSideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false
        });
    }

    internal static object? Inspect(Element element)
    {
        if (element is not Ceiling ceiling) return null;
        try
        {
            var native = ReadNative(ceiling);
            CeilingCreationRules.RequireNative(native);
            var doc = ceiling.Document;
            if (doc.GetElement(new ElementId(native.TypeId)) is not CeilingType { IsValidObject: true } type ||
                doc.GetElement(new ElementId(native.LevelId)) is not Level { IsValidObject: true } level)
                throw Invalid("Native ceiling type or level is unavailable.");
            var levelElevation = JsonDefaults.InternalToMm(level.ProjectElevation);
            if (!double.IsFinite(levelElevation)) throw Invalid("Native ceiling level project elevation is non-finite.");
            return NativeReadSnapshot.Freeze(new
            {
                supported = true, coordinateFrame = "Revit internal/project origin, millimeters", uniqueId = ceiling.UniqueId,
                typeUniqueId = type.UniqueId, levelUniqueId = level.UniqueId, levelProjectElevationMm = levelElevation, native,
                actualSignedAreaMm2 = CeilingCreationRules.SignedAreaMm2(native.Boundary.Select(edge => edge.Start).ToArray()),
                boundaryEvidenceScope = "complete-owned-native-Sketch-single-loop-bounded-straight-edge-XYZ",
                nativeEntityVerified = false, connectionsVerified = false, sideEffectsVerified = false, allSideEffectsVerified = false,
                persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false
            });
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error)
        {
            return new { supported = false, code = error is BridgeException bridge ? bridge.Code : "ceiling_readback_unavailable",
                reason = error.Message, nativeEntityVerified = false, connectionsVerified = false, sideEffectsVerified = false,
                allSideEffectsVerified = false, visualVerified = false };
        }
    }
    private static CeilingCreationReadback ReadNative(Ceiling ceiling)
    {
        if (!ceiling.IsValidObject) throw Invalid("Native ceiling is invalid.");
        var sketch = ceiling.Document.GetElement(ceiling.SketchId) as Sketch ?? throw Invalid("Actual native ceiling Sketch is unavailable; input geometry is not readback evidence.");
        var profile = sketch.Profile;
        if (!sketch.IsValidObject || !sketch.Document.Equals(ceiling.Document) || sketch.OwnerId != ceiling.Id || profile is null || profile.Size != 1)
            throw Invalid("Actual native ceiling Sketch must be owned by this ceiling and contain exactly one complete loop.");
        var boundary = profile.get_Item(0);
        if (boundary is null || boundary.Size is < 3 or > 128) throw Invalid("Native ceiling boundary exceeds the complete evidence budget or is incomplete; never truncate.");
        var edges = new List<CeilingBoundaryEdge>();
        foreach (Curve curve in boundary)
        {
            if (curve is not Line || !curve.IsBound) throw Invalid("Native ceiling sketch contains a non-linear or unbounded curve; readback is unsupported.");
            edges.Add(new(Point(curve.GetEndPoint(0)), Point(curve.GetEndPoint(1))));
        }
        var heightOffsetMm = JsonDefaults.InternalToMm(ReadParameter(ceiling, BuiltInParameter.CEILING_HEIGHTABOVELEVEL_PARAM, StorageType.Double).AsDouble());
        return new(ceiling.Id.Value, ceiling.GetTypeId().Value, ceiling.LevelId.Value, sketch.Id.Value, sketch.OwnerId.Value, heightOffsetMm, edges.ToArray());
    }
    private static CurveLoop Profile(Document doc, JsonElement op, Level level)
    {
        var points = CeilingCreationRules.Boundary(op); var loop = new CurveLoop();
        try
        {
            for (var i = 0; i < points.Length; i++)
            {
                var a = points[i]; var b = points[(i + 1) % points.Length];
                var start = new XYZ(Mm(a.XMm), Mm(a.YMm), level.ProjectElevation); var end = new XYZ(Mm(b.XMm), Mm(b.YMm), level.ProjectElevation);
                if (start.DistanceTo(end) < doc.Application.ShortCurveTolerance) throw Invalid("Ceiling edge is shorter than native ShortCurveTolerance.");
                loop.Append(Line.CreateBound(start, end));
            }
            return loop;
        }
        catch { loop.Dispose(); throw; }
    }
    private static Parameter ReadParameter(Element element, BuiltInParameter key, StorageType storage)
    {
        var parameter = element.get_Parameter(key);
        return parameter is not null && parameter.HasValue && parameter.StorageType == storage ? parameter :
            throw Invalid($"Native ceiling {key} is missing, unknown or has the wrong storage type.");
    }
}
