using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class ConnectorResolutionService
{
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static object Point(XYZ value) => new { xMm = JsonDefaults.InternalToMm(value.X), yMm = JsonDefaults.InternalToMm(value.Y), zMm = JsonDefaults.InternalToMm(value.Z) };
    private static bool Matches(Element element, Connector connector, string? domain, string? shape, XYZ? point, double toleranceMm)
    {
        if (domain is not null && connector.Domain.ToString() != domain) return false;
        if (shape is not null && connector.Shape.ToString() != shape) return false;
        return point is null || connector.Origin.DistanceTo(point) <= Mm(toleranceMm);
    }
    private static object Candidate(Connector connector, bool includePeers = false)
    {
        var peers = includePeers ? connector.AllRefs.Cast<Connector>().Where(peer => peer.ConnectorType != ConnectorType.Logical && peer.Owner.Id != connector.Owner.Id).Select(peer => new { elementId = peer.Owner.Id.Value, connectorId = peer.Id }).Distinct().OrderBy(peer => peer.elementId).ThenBy(peer => peer.connectorId).ToArray() : Array.Empty<object>();
        return new { connectorId = connector.Id, connectorType = connector.ConnectorType.ToString(), domain = connector.Domain.ToString(), shape = connector.Shape.ToString(), connected = connector.IsConnected, origin = Point(connector.Origin), peers };
    }
    private static List<Connector> Candidates(Element element, out string? error)
    {
        error = null;
        try
        {
            var manager = element is FamilyInstance family ? family.MEPModel?.ConnectorManager : element is MEPCurve curve ? curve.ConnectorManager : null;
            if (manager is null) { error = "The element has no MEP connector manager."; return []; }
            var result = new List<Connector>();
            if (element is Pipe)
            {
                // Pipe connector-set enumeration is unstable in this Revit session.
                // Probe the bounded native lookup table instead; only successful lookups count.
                for (var index = 0; index < 32; index++)
                {
                    try
                    {
                        var connector = manager.Lookup(index);
                        if (connector is { IsValidObject: true } && connector.ConnectorType != ConnectorType.Logical && result.All(existing => existing.Id != connector.Id)) result.Add(connector);
                    }
                    catch { /* unknown lookup index */ }
                }
            }
            else
            {
                foreach (Connector connector in manager.Connectors)
                    if (connector.ConnectorType != ConnectorType.Logical && connector.IsValidObject && result.All(existing => existing.Id != connector.Id)) result.Add(connector);
            }
            if (result.Count == 0) error = "No readable physical connectors were found; connector IDs remain unknown.";
            return result;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return [];
        }
    }
    public static object Resolve(UIApplication app, JsonElement parameters)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        var elementId = JsonDefaults.Int64(parameters, "elementId") ?? throw new BridgeException("missing_element", "elementId is required.");
        var element = doc.GetElement(new ElementId(elementId)) ?? throw new BridgeException("element_not_found", $"Element {elementId} was not found.");
        var domain = JsonDefaults.String(parameters, "domain");
        var shape = JsonDefaults.String(parameters, "shape");
        var tolerance = JsonDefaults.Double(parameters, "toleranceMm") ?? throw new BridgeException("missing_tolerance", "toleranceMm is required for deterministic connector resolution.");
        if (tolerance <= 0 || tolerance > 10000) throw new BridgeException("invalid_tolerance", "toleranceMm must be greater than 0 and no greater than 10000.");
        XYZ? point = null;
        if (JsonDefaults.Has(parameters, "point"))
        {
            var value = JsonDefaults.Get(parameters, "point");
            PlanRules.Point(value);
            point = new XYZ(Mm(PlanRules.Number(value, "xMm")), Mm(PlanRules.Number(value, "yMm")), Mm(PlanRules.Number(value, "zMm")));
        }
        var candidates = Candidates(element, out var error);
        var matches = candidates.Where(connector =>
        {
            try { return Matches(element, connector, domain, shape, point, tolerance); }
            catch { return false; }
        }).ToList();
        var evidence = new { elementId, documentIdentity = RevitCommandRouter.Identity(doc), documentRevision = RevitCommandRouter.Revision(doc), requested = new { domain, shape, toleranceMm = tolerance, point = point is null ? null : Point(point) }, candidateCount = candidates.Count, candidates = candidates.Select(c => Candidate(c)).ToArray(), error };
        if (matches.Count == 1) return new { status = "resolved", resolved = Candidate(matches[0], true), evidence };
        if (matches.Count == 0) return new { status = candidates.Count == 0 ? "unavailable" : "missing", evidence };
        return new { status = "ambiguous", evidence, matches = matches.Select(c => Candidate(c)).ToArray() };
    }
}

