using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;

namespace RevitAutoV27;

// Controlled CableTray and Conduit creation selectively adapted from bimwright/rvt-mcp
// commit b44ee0b8032f0603f8e52656bc05ab43aa599263 (CreateCableTrayHandler, CreateConduitHandler;
// Apache-2.0). Removes implicit type/level defaults and independent transactions, refuses read-only
// cross-section parameters, and adds 3-phase readback plus end-connector snapshots.
internal sealed class ElectricalRunService
{
    private sealed record Binding(
        long ElementId,
        string UniqueId,
        string Kind,
        string TypeUniqueId,
        string LevelUniqueId,
        CableTrayInput? TrayInput,
        ConduitInput? ConduitInput);

    private readonly List<Binding> completed = [];
    private Document? capturedDocument;

    private static BridgeException Invalid(string message) => ElectricalRunRules.Invalid(message);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static XYZ ToXyz(ElectricalRunPointMm p) => new(Mm(p.XMm), Mm(p.YMm), Mm(p.ZMm));
    private static ElectricalRunPointMm PointMm(XYZ p) => new(JsonDefaults.InternalToMm(p.X), JsonDefaults.InternalToMm(p.Y), JsonDefaults.InternalToMm(p.Z));

    public static void Validate(Document doc, JsonElement op)
    {
        if (!doc.IsValidObject || doc.IsFamilyDocument)
            throw Invalid("Electrical run creation requires a valid project document.");
        var kind = JsonDefaults.String(op, "operationType");
        if (kind == "create_cable_tray")
        {
            var input = ElectricalRunRules.ValidateCableTray(op);
            var type = RequireElement<CableTrayType>(doc, input.CableTrayTypeId, "cableTrayTypeId");
            if (!CableTray.IsValidCableTrayType(doc, type.Id))
                throw Invalid($"cableTrayTypeId ({input.CableTrayTypeId}) is not a valid CableTrayType for placement.");
            _ = RequireElement<Level>(doc, input.LevelId, "levelId");
            ValidateSegment(doc, input.Start, input.End);
        }
        else if (kind == "create_conduit")
        {
            var input = ElectricalRunRules.ValidateConduit(op);
            var type = RequireElement<ConduitType>(doc, input.ConduitTypeId, "conduitTypeId");
            if (!Conduit.IsValidConduitType(doc, type.Id))
                throw Invalid($"conduitTypeId ({input.ConduitTypeId}) is not a valid ConduitType for placement.");
            _ = RequireElement<Level>(doc, input.LevelId, "levelId");
            ValidateSegment(doc, input.Start, input.End);
        }
        else
        {
            throw Invalid("Expected create_cable_tray or create_conduit.");
        }
    }

    public static object Preview(Document doc, JsonElement op)
    {
        Validate(doc, op);
        var kind = JsonDefaults.String(op, "operationType")!;
        if (kind == "create_cable_tray")
        {
            var input = ElectricalRunRules.ValidateCableTray(op);
            var type = RequireElement<CableTrayType>(doc, input.CableTrayTypeId, "cableTrayTypeId");
            var level = RequireElement<Level>(doc, input.LevelId, "levelId");
            return new
            {
                operationType = kind,
                cableTrayTypeId = type.Id.Value,
                cableTrayTypeName = type.Name,
                levelId = level.Id.Value,
                levelName = level.Name,
                start = input.Start,
                end = input.End,
                widthMm = input.WidthMm,
                heightMm = input.HeightMm,
                coordinateFrame = "Revit internal/project origin, absolute XYZ millimeters",
                nativeAcceptance = false,
                routingAndClearanceVerified = false,
                allModelSideEffectsVerified = false
            };
        }
        var conduitInput = ElectricalRunRules.ValidateConduit(op);
        var conduitType = RequireElement<ConduitType>(doc, conduitInput.ConduitTypeId, "conduitTypeId");
        var conduitLevel = RequireElement<Level>(doc, conduitInput.LevelId, "levelId");
        return new
        {
            operationType = kind,
            conduitTypeId = conduitType.Id.Value,
            conduitTypeName = conduitType.Name,
            levelId = conduitLevel.Id.Value,
            levelName = conduitLevel.Name,
            start = conduitInput.Start,
            end = conduitInput.End,
            diameterMm = conduitInput.DiameterMm,
            coordinateFrame = "Revit internal/project origin, absolute XYZ millimeters",
            nativeAcceptance = false,
            routingAndClearanceVerified = false,
            allModelSideEffectsVerified = false
        };
    }

    internal OperationReceipt Create(Document doc, JsonElement op)
    {
        Validate(doc, op);
        if (!doc.IsModifiable)
            throw Invalid("The plan executor must own an active native transaction.");
        RequireDocument(doc, capture: true);
        var kind = JsonDefaults.String(op, "operationType")!;

        Binding binding;
        if (kind == "create_cable_tray")
        {
            var input = ElectricalRunRules.ValidateCableTray(op);
            var type = RequireElement<CableTrayType>(doc, input.CableTrayTypeId, "cableTrayTypeId");
            var level = RequireElement<Level>(doc, input.LevelId, "levelId");
            var tray = CableTray.Create(doc, type.Id, ToXyz(input.Start), ToXyz(input.End), level.Id)
                ?? throw Invalid("Revit did not return a CableTray.");
            SetDoubleParameter(tray, BuiltInParameter.RBS_CABLETRAY_WIDTH_PARAM, Mm(input.WidthMm), "widthMm");
            SetDoubleParameter(tray, BuiltInParameter.RBS_CABLETRAY_HEIGHT_PARAM, Mm(input.HeightMm), "heightMm");
            doc.Regenerate();
            binding = new(tray.Id.Value, tray.UniqueId, kind, type.UniqueId, level.UniqueId, input, null);
        }
        else
        {
            var input = ElectricalRunRules.ValidateConduit(op);
            var type = RequireElement<ConduitType>(doc, input.ConduitTypeId, "conduitTypeId");
            var level = RequireElement<Level>(doc, input.LevelId, "levelId");
            var conduit = Conduit.Create(doc, type.Id, ToXyz(input.Start), ToXyz(input.End), level.Id)
                ?? throw Invalid("Revit did not return a Conduit.");
            SetDoubleParameter(conduit, BuiltInParameter.RBS_CONDUIT_DIAMETER_PARAM, Mm(input.DiameterMm), "diameterMm");
            doc.Regenerate();
            binding = new(conduit.Id.Value, conduit.UniqueId, kind, type.UniqueId, level.UniqueId, null, input);
        }

        var evidence = Verify(doc, binding, "immediate-after-creation");
        completed.Add(binding);
        return OperationReceipt.New(binding.ElementId) with { Evidence = evidence };
    }

    internal object? VerifyCompleted(Document doc, string phase)
    {
        if (completed.Count == 0) return null;
        RequireDocument(doc, capture: true);
        var elements = completed.Select(b => Verify(doc, b, phase)).ToArray();
        return new
        {
            phase,
            verifiedElementCount = elements.Length,
            nativeReadbackVerified = true,
            routingAndClearanceVerified = false,
            allModelSideEffectsVerified = false,
            elements
        };
    }

    internal static object? Inspect(Element element)
    {
        if (element is not (CableTray or Conduit)) return null;
        try
        {
            var actual = ReadCurve((MEPCurve)element);
            return NativeReadSnapshot.Freeze(new
            {
                supported = true,
                kind = actual.Kind,
                native = actual,
                routingAndClearanceVerified = false,
                allModelSideEffectsVerified = false
            });
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) { return new { supported = false, reason = ex.Message }; }
    }

    private static object Verify(Document doc, Binding binding, string phase)
    {
        if (binding.Kind == "create_cable_tray")
        {
            var input = binding.TrayInput!;
            var type = RequireElement<CableTrayType>(doc, input.CableTrayTypeId, "cableTrayTypeId");
            var level = RequireElement<Level>(doc, input.LevelId, "levelId");
            if (type.UniqueId != binding.TypeUniqueId || level.UniqueId != binding.LevelUniqueId)
                throw Invalid("CableTray type or level identity changed before verification.");
            if (doc.GetElement(new ElementId(binding.ElementId)) is not CableTray { IsValidObject: true } tray)
                throw Invalid("Created CableTray disappeared or became invalid before verification.");
            var actual = ReadCurve(tray);
            ElectricalRunRules.RequireCableTray(input, binding.UniqueId, actual);
            return NativeReadSnapshot.Freeze(new
            {
                phase,
                elementId = actual.ElementId,
                uniqueId = actual.UniqueId,
                kind = binding.Kind,
                native = actual,
                nativeReadbackVerified = true,
                routingAndClearanceVerified = false,
                allModelSideEffectsVerified = false
            });
        }
        else
        {
            var input = binding.ConduitInput!;
            var type = RequireElement<ConduitType>(doc, input.ConduitTypeId, "conduitTypeId");
            var level = RequireElement<Level>(doc, input.LevelId, "levelId");
            if (type.UniqueId != binding.TypeUniqueId || level.UniqueId != binding.LevelUniqueId)
                throw Invalid("Conduit type or level identity changed before verification.");
            if (doc.GetElement(new ElementId(binding.ElementId)) is not Conduit { IsValidObject: true } conduit)
                throw Invalid("Created Conduit disappeared or became invalid before verification.");
            var actual = ReadCurve(conduit);
            ElectricalRunRules.RequireConduit(input, binding.UniqueId, actual);
            return NativeReadSnapshot.Freeze(new
            {
                phase,
                elementId = actual.ElementId,
                uniqueId = actual.UniqueId,
                kind = binding.Kind,
                native = actual,
                nativeReadbackVerified = true,
                routingAndClearanceVerified = false,
                allModelSideEffectsVerified = false
            });
        }
    }

    private static ElectricalRunReadback ReadCurve(MEPCurve curve)
    {
        if (!curve.IsValidObject) throw Invalid("Electrical run element is invalid.");
        if (curve.Location is not LocationCurve { Curve: Line { IsBound: true } line })
            throw Invalid("Electrical run location is not a bounded straight line.");
        var levelId = curve.ReferenceLevel?.Id.Value ?? curve.LevelId.Value;
        double? widthMm = curve is CableTray ? ReadMmParam(curve, BuiltInParameter.RBS_CABLETRAY_WIDTH_PARAM) : null;
        double? heightMm = curve is CableTray ? ReadMmParam(curve, BuiltInParameter.RBS_CABLETRAY_HEIGHT_PARAM) : null;
        double? diameterMm = curve is Conduit ? ReadMmParam(curve, BuiltInParameter.RBS_CONDUIT_DIAMETER_PARAM) : null;

        var connectors = new List<ElectricalRunConnectorSnapshot>();
        try
        {
            if (curve.ConnectorManager?.Connectors is ConnectorSet set)
            {
                foreach (Connector c in set)
                {
                    if (c.ConnectorType != ConnectorType.End) continue;
                    ElectricalRunPointMm? origin = null;
                    try { origin = PointMm(c.Origin); } catch { }
                    connectors.Add(new(c.Id, c.Domain.ToString(), c.Shape.ToString(), c.IsConnected, origin));
                }
            }
        }
        catch (OperationCanceledException) { throw; }
        catch { }

        return new(
            curve.Id.Value,
            curve.UniqueId,
            curve is CableTray ? "create_cable_tray" : "create_conduit",
            curve.GetTypeId().Value,
            levelId,
            PointMm(line.GetEndPoint(0)),
            PointMm(line.GetEndPoint(1)),
            JsonDefaults.InternalToMm(line.Length),
            widthMm,
            heightMm,
            diameterMm,
            connectors.OrderBy(c => c.ConnectorId).ToArray());
    }

    private static double? ReadMmParam(Element element, BuiltInParameter bip)
    {
        var p = element.get_Parameter(bip);
        if (p is null || !p.HasValue || p.StorageType != StorageType.Double) return null;
        var val = JsonDefaults.InternalToMm(p.AsDouble());
        return double.IsFinite(val) ? val : null;
    }

    private static void SetDoubleParameter(Element element, BuiltInParameter bip, double internalValue, string label)
    {
        var p = element.get_Parameter(bip);
        if (p is null || p.IsReadOnly || p.StorageType != StorageType.Double || !p.Set(internalValue))
            throw Invalid($"Revit refused explicit {label} parameter ({bip}) on the created element.");
    }

    private static void ValidateSegment(Document doc, ElectricalRunPointMm startMm, ElectricalRunPointMm endMm)
    {
        var start = ToXyz(startMm);
        var end = ToXyz(endMm);
        if (!XYZ.IsWithinLengthLimits(start) || !XYZ.IsWithinLengthLimits(end))
            throw Invalid("Electrical run endpoint exceeds Revit coordinate limits.");
        if (start.DistanceTo(end) <= doc.Application.ShortCurveTolerance)
            throw Invalid("Electrical run length is shorter than Revit's ShortCurveTolerance.");
    }

    private static T RequireElement<T>(Document doc, long id, string field) where T : Element =>
        doc.GetElement(new ElementId(id)) is T { IsValidObject: true } item && item.Document.Equals(doc)
            ? item
            : throw Invalid($"{field} ({id}) does not resolve to an existing {typeof(T).Name} in the active document.");

    private void RequireDocument(Document doc, bool capture)
    {
        if (capturedDocument is null && capture) capturedDocument = doc;
        if (!doc.IsValidObject || (capturedDocument is not null && (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc))))
            throw Invalid("Electrical run evidence belongs to an invalid or different native document.");
    }
}
