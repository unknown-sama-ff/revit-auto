using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.UI;
namespace RevitAutoV27;

internal static class ConnectorResolutionService
{
    private static object Point(XYZ p) => new { xMm=JsonDefaults.InternalToMm(p.X), yMm=JsonDefaults.InternalToMm(p.Y), zMm=JsonDefaults.InternalToMm(p.Z) };
    private static bool Unsupported(Exception e) => e is Autodesk.Revit.Exceptions.InvalidOperationException or NotSupportedException;
    private static ConnectorManager Manager(Element e) => e switch
    {
        FamilyInstance f => f.MEPModel?.ConnectorManager ?? throw new BridgeException("connector_unavailable","Element has no MEP connector manager."),
        MEPCurve c => c.ConnectorManager,
        _ => throw new BridgeException("connector_unavailable","Element has no physical connector manager.")
    };
    private static ConnectorMatch MatchData(Connector connector)
    {
        var point=connector.Origin;
        return new(connector.Id,connector.Domain.ToString(),connector.Shape.ToString(),JsonDefaults.InternalToMm(point.X),JsonDefaults.InternalToMm(point.Y),JsonDefaults.InternalToMm(point.Z));
    }
    private static List<Connector> Candidates(Element element)
    {
        var manager=Manager(element);
        var connectors=new List<Connector>();
        if(element is Pipe)
        {
            // Revit 2027.3 can abort the bridge while enumerating a Pipe ConnectorSet.
            // Bounded native lookup is deterministic for Pipe endpoint IDs (0/1 here).
            for(var id=0;id<32;id++)
            {
                try
                {
                    var connector=manager.Lookup(id);
                    if(connector is {IsValidObject:true}&&connector.ConnectorType!=ConnectorType.Logical&&connectors.All(existing=>existing.Id!=connector.Id))connectors.Add(connector);
                }
                catch { }
            }
        }
        else
        {
            connectors.AddRange(manager.Connectors.Cast<Connector>().Where(c=>c.IsValidObject&&c.ConnectorType!=ConnectorType.Logical));
        }
        foreach(var c in connectors)
        {
            var data=MatchData(c);
            if(!double.IsFinite(data.XMm)||!double.IsFinite(data.YMm)||!double.IsFinite(data.ZMm))throw new BridgeException("connector_unavailable","Connector origin is nonfinite; no matching connector can be certified.");
        }
        return connectors;
    }    internal static Connector ById(Element element,long id)
    {
        if(id<0||id>int.MaxValue)throw new BridgeException("invalid_connector","Connector ID is out of range.");
        var connector=Manager(element).Lookup((int)id);
        if(connector is null || !connector.IsValidObject || connector.Owner.Id!=element.Id || connector.Id!=id || connector.ConnectorType==ConnectorType.Logical)
            throw new BridgeException("connector_missing",$"Physical connector {id} is missing on {element.Id.Value}.");
        return connector;
    }
    internal static Connector ResolveForExecution(Element element,JsonElement input)
    {
        var criteria=ConnectorSelectionRules.Criteria(input);
        var candidates=Candidates(element);
        var id=ConnectorSelectionRules.Unique(candidates.Select(MatchData),criteria);
        return candidates.Single(c=>c.Id==id);
    }
    private static object Candidate(Connector c,bool includePeers=false)
    {
        var connection=ConnectorReadPolicy.ConnectionStatus(()=>c.IsConnected,Unsupported);
        var direction=ConnectorReadPolicy.TryRead(()=>c.Direction.ToString(),Unsupported);
        var axis=ConnectorReadPolicy.TryRead(()=>{var z=c.CoordinateSystem.BasisZ;return new{x=z.X,y=z.Y,z=z.Z};},Unsupported);
        var diameter=ConnectorReadPolicy.TryRead(()=>ParameterReadPolicy.Normalize(JsonDefaults.InternalToMm(c.Radius*2)),Unsupported);
        var system=ConnectorReadPolicy.TryRead(()=>c.PipeSystemType.ToString(),Unsupported);
        var peers=includePeers?ConnectorReadPolicy.TryRead(()=>c.AllRefs.Cast<Connector>().Where(p=>p.ConnectorType!=ConnectorType.Logical&&p.Owner.Id!=c.Owner.Id).Select(p=>new{elementId=p.Owner.Id.Value,connectorId=p.Id}).Distinct().OrderBy(p=>p.elementId).ThenBy(p=>p.connectorId).ToArray(),Unsupported):null;
        return new { connectorId=c.Id,connectorType=c.ConnectorType.ToString(),domain=c.Domain.ToString(),shape=c.Shape.ToString(),origin=Point(c.Origin),connected=connection.Connected,connectionStatusSupported=connection.Supported,connectionStatusError=connection.Error,
            direction=direction.Value,directionSupported=direction.Supported,axis=axis.Value,axisSupported=axis.Supported,
            diameterMm=diameter.Value?.Value,diameterSupported=diameter.Supported&&diameter.Value?.Supported==true,
            pipeSystemType=system.Value,pipeSystemTypeSupported=system.Supported,
            pipingSystemEvidence=c.Domain==Domain.DomainPiping?PipingCompatibilityService.Evidence(c):null,
            peers=peers?.Value,peerReferencesSupported=peers?.Supported??false,peerReferencesError=peers?.Error };
    }
    public static object Resolve(UIApplication app,JsonElement parameters)
    {
        var doc=app.ActiveUIDocument?.Document??throw new BridgeException("no_active_document","Open a project first.");
        var identity=RevitCommandRouter.Identity(doc);var revision=RevitCommandRouter.Revision(doc);
        if(JsonDefaults.String(parameters,"documentIdentity") is {} expected&&expected!=identity)throw new BridgeException("document_changed","Read the current document before resolving a connector.");
        if(JsonDefaults.Int64(parameters,"expectedRevision") is long r&&r!=revision)throw new BridgeException("document_revision_changed","Document changed during connector inspection.");
        var id=JsonDefaults.Int64(parameters,"elementId")??throw new BridgeException("missing_element","elementId is required.");
        var element=doc.GetElement(new ElementId(id))??throw new BridgeException("element_not_found","Connector owner is missing.");
        var domain=JsonDefaults.String(parameters,"domain");var shape=JsonDefaults.String(parameters,"shape");
        var tolerance=JsonDefaults.Double(parameters,"toleranceMm");if(tolerance is null||tolerance<=0||tolerance>10000)throw new BridgeException("invalid_tolerance","Specify finite toleranceMm in (0,10000].");
        ConnectorCriteria? criteria=null;
        if(parameters.TryGetProperty("point",out var point)){
            criteria=ConnectorSelectionRules.Criteria(JsonSerializer.SerializeToElement(new { domain,shape,point,toleranceMm=tolerance.Value }));
        }
        List<Connector> candidates;
        try{candidates=Candidates(element);}catch(Exception error){return new{status="unavailable",evidence=new{elementId=id,documentIdentity=identity,documentRevision=revision,enumerationComplete=false,error=error.Message},note="Unknown connector evidence is not a disconnected or missing connector."};}
        var matches=candidates.Where(c=>criteria is not null?ConnectorSelectionRules.Matches(MatchData(c),criteria):(domain is null||c.Domain.ToString()==domain)&&(shape is null||c.Shape.ToString()==shape)).ToArray();
        var evidence=new { elementId=id,documentIdentity=identity,documentRevision=revision,enumerationComplete=true,requested=parameters,candidateCount=candidates.Count,candidates=candidates.Select(c=>Candidate(c)).ToArray() };
        if(matches.Length==1)return new{status="resolved",resolved=Candidate(matches[0],true),evidence};
        return new{status=matches.Length==0?"missing":"ambiguous",evidence,matches=matches.Select(c=>Candidate(c)).ToArray()};
    }
}
