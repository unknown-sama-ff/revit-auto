using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class FlowDirectionDiagnostic
{
    private static object? Read(Func<object?> read, out bool supported, out string? error)
    {
        try { supported = true; error = null; return read(); }
        catch (Exception exception) { supported = false; error = exception.Message; return null; }
    }
    private static object ElementSummary(Element element) => new
    {
        id = element.Id.Value,
        uniqueId = element.UniqueId,
        category = element.Category?.Name,
        categoryId = element.Category?.Id.Value,
        className = element.GetType().Name,
        name = element.Name,
        typeId = element.GetTypeId().Value
    };
    private static object ConnectorData(Connector connector)
    {
        var direction = Read(() => connector.Direction.ToString(), out var directionSupported, out var directionError);
        var flow = Read(() => connector.Flow, out var flowSupported, out var flowError);
        var axis = Read(() => new { x = connector.CoordinateSystem.BasisZ.X, y = connector.CoordinateSystem.BasisZ.Y, z = connector.CoordinateSystem.BasisZ.Z }, out var axisSupported, out var axisError);
        var peers = Read(() => connector.AllRefs.Cast<Connector>().Where(peer => peer.ConnectorType != ConnectorType.Logical && peer.Owner.Id != connector.Owner.Id).Select(peer => new { elementId = peer.Owner.Id.Value, connectorId = peer.Id }).Distinct().ToArray(), out var peersSupported, out var peersError);
        return new
        {
            elementId = connector.Owner.Id.Value,
            connectorId = connector.Id,
            connectorType = connector.ConnectorType.ToString(),
            domain = connector.Domain.ToString(),
            shape = connector.Shape.ToString(),
            connected = connector.IsConnected,
            direction,
            directionSupported,
            directionError,
            flow,
            flowSupported,
            flowError,
            axis,
            axisSupported,
            axisError,
            peers,
            peersSupported,
            peersError
        };
    }
    public static object Diagnose(UIApplication app, JsonElement parameters)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        var identity = RevitCommandRouter.Identity(doc);
        var revision = RevitCommandRouter.Revision(doc);
        if (JsonDefaults.String(parameters, "documentIdentity") is { } expected && expected != identity) throw new BridgeException("document_changed", "Read the current document before diagnosing flow direction.");
        if (JsonDefaults.Int64(parameters, "expectedRevision") is long expectedRevision && expectedRevision != revision) throw new BridgeException("document_revision_changed", "The project changed before flow diagnosis.");
        var systemId = JsonDefaults.Int64(parameters, "systemId") ?? throw new BridgeException("invalid_flow_diagnostic_request", "systemId is required.");
        var system = doc.GetElement(new ElementId(systemId)) as PipingSystem ?? throw new BridgeException("element_not_found", $"Piping system {systemId} is missing.");
        var network = new List<Element>();
        var networkError = (string?)null;
        try { network.AddRange(system.PipingNetwork.Cast<Element>()); }
        catch (Exception exception) { networkError = exception.Message; }
        var memberIds = network.Select(element => element.Id.Value).Distinct().Order().ToArray();
        var members = network.DistinctBy(element => element.Id.Value).OrderBy(element => element.Id.Value).Select(element => new
        {
            element = ElementSummary(element),
            location = element.Location is LocationCurve curve && curve.Curve is { IsBound: true } line ? new { start = new { xMm = JsonDefaults.InternalToMm(line.GetEndPoint(0).X), yMm = JsonDefaults.InternalToMm(line.GetEndPoint(0).Y), zMm = JsonDefaults.InternalToMm(line.GetEndPoint(0).Z) }, end = new { xMm = JsonDefaults.InternalToMm(line.GetEndPoint(1).X), yMm = JsonDefaults.InternalToMm(line.GetEndPoint(1).Y), zMm = JsonDefaults.InternalToMm(line.GetEndPoint(1).Z) } } : null,
            connectors = ConnectorRows(element)
        }).ToArray();
        var baseEquipment = Read(() => system.BaseEquipmentConnector, out var baseSupported, out var baseError);
        var systemTypeId = system.get_Parameter(BuiltInParameter.RBS_PIPING_SYSTEM_TYPE_PARAM)?.AsElementId();
        var systemType = systemTypeId is { } typeId && typeId != ElementId.InvalidElementId ? doc.GetElement(typeId) as PipingSystemType : null;
        var flowValue = Read(() => system.GetFlow(), out var systemFlowSupported, out var systemFlowError);
        var pressureValue = Read(() => system.GetStaticPressure(), out var pressureSupported, out var pressureError);
        var volumeValue = Read(() => system.GetVolume(), out var volumeSupported, out var volumeError);
        return new
        {
            documentIdentity = identity,
            documentRevision = revision,
            system = new
            {
                element = ElementSummary(system),
                systemType = systemType is null ? null : ElementSummary(systemType),
                systemClassification = systemType?.SystemClassification.ToString(),
                memberIds,
                memberCount = memberIds.Length,
                networkSupported = networkError is null,
                networkError,
                baseEquipmentConnector = baseEquipment is Connector connector ? ConnectorData(connector) : null,
                baseEquipmentSupported = baseSupported,
                baseEquipmentError = baseError,
                flow = flowValue,
                flowSupported = systemFlowSupported,
                flowError = systemFlowError,
                staticPressure = pressureValue,
                staticPressureSupported = pressureSupported,
                staticPressureError = pressureError,
                volume = volumeValue,
                volumeSupported,
                volumeError
            },
            members,
            diagnostics = new { connectedMemberCount = members.Count(member => member.connectors.Any(connector => JsonSerializer.SerializeToElement(connector).GetProperty("connected").GetBoolean())), unsupportedFlowConnectorCount = members.Sum(member => member.connectors.Count(connector => !JsonSerializer.SerializeToElement(connector).GetProperty("flowSupported").GetBoolean())), memberCount = members.Length }
        };
    }
    private static object[] ConnectorRows(Element element)
    {
        var manager = element switch { FamilyInstance family => family.MEPModel?.ConnectorManager, MEPCurve curve => curve.ConnectorManager, _ => null };
        if (manager is null) return [];
        try { return manager.Connectors.Cast<Connector>().Where(connector => connector.ConnectorType != ConnectorType.Logical).Select(ConnectorData).ToArray(); }
        catch (Exception exception) { return [new { error = exception.Message }]; }
    }
}
