using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using System.Text.Json;

namespace RevitAutoV27;

// Adapted bounded selection/MoveElements/final placement pattern from
// bimwright/rvt-mcp, TransformElementsHandlers.cs at b44ee0b8032f0603f8e52656bc05ab43aa599263.
// Keep this project's existing preview, transaction group and rollback owner.
internal sealed class LightingMoveService
{
    private Document? boundDocument;
    private LightingMoveInput? completedInput;
    private LightingMoveState[]? completedBefore;
    private static BridgeException Invalid(string message) => new("invalid_lighting_move", message);
    private static LightingMovePoint Point(XYZ p)
    {
        var value = new LightingMovePoint(JsonDefaults.InternalToMm(p.X), JsonDefaults.InternalToMm(p.Y), JsonDefaults.InternalToMm(p.Z));
        LightingMoveRules.CheckPoint(value); return value;
    }
    private static LightingMoveState Capture(Document document, long elementId)
    {
        if (document.GetElement(new ElementId(elementId)) is not FamilyInstance element ||
            element.Category?.Id.Value != (long)BuiltInCategory.OST_LightingFixtures ||
            element.Pinned || element.GroupId != ElementId.InvalidElementId || element.SuperComponent is not null ||
            element.Host is not null || element.HostFace is not null || element.OwnerViewId != ElementId.InvalidElementId ||
            element.Location is not LocationPoint location ||
            element.Symbol.Family.FamilyPlacementType is not (FamilyPlacementType.OneLevelBased or FamilyPlacementType.WorkPlaneBased))
            throw Invalid("Only existing unpinned, ungrouped, unnested, unhosted point lighting fixtures are supported.");
        var mep = element.MEPModel ?? throw Invalid("Electrical connector evidence is unavailable; no move is permitted.");
        var manager = mep.ConnectorManager ?? throw Invalid("Lighting connector manager is unavailable.");
        var connectors = manager.Connectors.Cast<Connector>().Take(33).ToArray();
        if (connectors.Length is < 1 or > 32) throw Invalid("Expected 1..32 readable electrical connectors per fixture.");
        var ports = connectors.Select(connector => {
            if (connector.Id < 0 || connector.Domain != Domain.DomainElectrical) throw Invalid("Unknown or non-electrical lighting port.");
            var references = connector.AllRefs.Cast<Connector>().Take(129).ToArray();
            if (references.Length > 128) throw Invalid("Lighting port peer evidence exceeds the bounded scope.");
            var peers = references.Select(peer => {
                var owner = peer.Owner ?? throw Invalid("A connector peer owner is unknown.");
                if (!owner.IsValidObject || owner.Id.Value <= 0 || peer.Id < 0) throw Invalid("A connector peer identity is unknown.");
                return $"{owner.Id.Value}:{owner.UniqueId}:{owner.GetTypeId().Value}:{owner.OwnerViewId.Value}:{peer.Id}:{peer.Domain}:{peer.ConnectorType}";
            }).Append($"self:{connector.Domain}:{connector.ConnectorType}").Order(StringComparer.Ordinal).ToArray();
            return new LightingMovePort(connector.Id, Point(connector.Origin), peers);
        }).OrderBy(port => port.ConnectorId).ToArray();
        var systems = mep.GetElectricalSystems() ?? throw Invalid("Electrical system evidence is unknown.");
        var circuits = systems.Take(9).ToArray();
        if (circuits.Length > 8) throw Invalid("More than eight circuits per fixture exceeds this controlled scope.");
        var circuitKeys = circuits.Select(system => {
            var members = system.Elements.Cast<Element>().Take(251).Select(e => e.Id.Value).Order().ToArray();
            if (members.Length > 250) throw Invalid("Circuit membership exceeds the bounded 250-element scope.");
            return $"{system.Id.Value}:{system.UniqueId}:{system.BaseEquipment?.Id.Value}:{system.CircuitNumber}:{string.Join(',', members)}";
        }).Order(StringComparer.Ordinal).ToArray();
        var rotation = location.Rotation;
        if (!double.IsFinite(rotation)) throw Invalid("Lighting rotation is unknown.");
        return new(element.Id.Value, element.UniqueId, element.GetTypeId().Value, element.LevelId.Value,
            Point(location.Point), rotation, ports, circuitKeys);
    }
    private static LightingMoveState[] Before(Document document, LightingMoveInput input)
    {
        if (document.IsReadOnly || document.IsFamilyDocument) throw Invalid("A writable project document is required.");
        return input.Targets.Select(target => {
            var state = Capture(document, target.ElementId);
            if (state.SymbolId != target.SymbolId) throw Invalid("A target family type differs from the reviewed type.");
            LightingMoveRules.RequirePoint(state.Point, target.Point, input.ToleranceMm);
            return state;
        }).ToArray();
    }
    public static object Preview(Document document, JsonElement operation)
    {
        var input = LightingMoveRules.Parse(operation);
        var before = Before(document, input);
        return new { input, before, expectedPoints = before.Select(value => new {
            value.ElementId, point = new LightingMovePoint(value.Point.XMm + input.Translation.XMm, value.Point.YMm + input.Translation.YMm, value.Point.ZMm) }),
            scope = "XY translation only. Native wire geometry may follow/reshape; inspect all affected wire vertices and PNG independently.",
            sideEffectsVerified = false, visualVerified = false, persistenceVerified = false };
    }
    public static void Validate(Document document, JsonElement operation) => _ = Before(document, LightingMoveRules.Parse(operation));
    public OperationReceipt Apply(Document document, JsonElement operation)
    {
        if (completedInput is not null) throw Invalid("Only one lighting move may execute in a plan.");
        var input = LightingMoveRules.Parse(operation);
        var before = Before(document, input);
        var ids = before.Select(value => new ElementId(value.ElementId)).ToArray();
        ElementTransformUtils.MoveElements(document, ids, new XYZ(input.Translation.XMm / 304.8, input.Translation.YMm / 304.8, 0));
        document.Regenerate();
        var after = Verify(document, before, input);
        boundDocument = document; completedInput = input; completedBefore = before;
        return new([], before.Select(value => value.ElementId).ToList()) {
            Evidence = new { operationType = "move_lighting_fixtures", before, after, input.Translation,
                nativeReadbackVerified = true, connectorPeersPreserved = true, circuitMembershipAndPanelPreserved = true,
                sideEffectsVerified = false, persistenceVerified = false, visualVerified = false,
                wireVerticesAndWholeModelEffectsVerified = false }
        };
    }
    private static LightingMoveState[] Verify(Document document, LightingMoveState[] before, LightingMoveInput input)
    {
        return before.Select(expected => {
            var current = Capture(document, expected.ElementId);
            LightingMoveRules.Verify(expected, current, input); return current;
        }).ToArray();
    }
    public object VerifyCompleted(Document document, string phase)
    {
        if (completedInput is null) return new { phase, completedMoveCount = 0 };
        if (boundDocument is null || !boundDocument.IsValidObject || !boundDocument.Equals(document) || completedBefore is null)
            throw Invalid("Lighting move readback belongs to another native document.");
        var after = Verify(document, completedBefore, completedInput);
        return new { phase, completedMoveCount = 1, after, nativeReadbackVerified = true,
            connectorPeersPreserved = true, circuitMembershipAndPanelPreserved = true,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false,
            wireVerticesAndWholeModelEffectsVerified = false };
    }
}
