using System.Text.Json;
namespace RevitAutoV27;

internal sealed record ConnectorCriteria(string Domain, string Shape, double XMm, double YMm, double ZMm, double ToleranceMm);
internal sealed record ConnectorMatch(int Id, string Domain, string Shape, double XMm, double YMm, double ZMm);
internal static class ConnectorSelectionRules
{
    private static readonly HashSet<string> Domains = new(StringComparer.Ordinal) { "DomainPiping", "DomainHvac", "DomainElectrical" };
    private static readonly HashSet<string> Shapes = new(StringComparer.Ordinal) { "Round", "Rectangular", "Oval", "Invalid" };
    private static BridgeException Invalid(string message) => new("invalid_connector", message);
    public static ConnectorCriteria Criteria(JsonElement criteria)
    {
        if (criteria.ValueKind != JsonValueKind.Object) throw Invalid("Connector criteria must be an object.");
        var fields = criteria.EnumerateObject().Select(p=>p.Name).ToArray();
        if (fields.Length != 4 || fields.Distinct(StringComparer.Ordinal).Count()!=4 || fields.Any(n=>n is not ("domain" or "shape" or "point" or "toleranceMm"))) throw Invalid("Specify exactly domain, shape, point and toleranceMm.");
        var domain=JsonDefaults.String(criteria,"domain"); var shape=JsonDefaults.String(criteria,"shape");
        if (domain is null || !Domains.Contains(domain) || shape is null || !Shapes.Contains(shape)) throw Invalid("Unknown connector domain or shape.");
        var point=JsonDefaults.Get(criteria,"point");
        if(point.ValueKind!=JsonValueKind.Object)throw Invalid("Connector point requires explicit XYZ millimeters.");
        var axes=point.EnumerateObject().Select(p=>p.Name).ToArray();
        if(axes.Length!=3||axes.Distinct(StringComparer.Ordinal).Count()!=3||axes.Any(n=>n is not ("xMm" or "yMm" or "zMm")))throw Invalid("Connector point accepts exactly xMm, yMm and zMm.");
        var x=PlanRules.Number(point,"xMm"); var y=PlanRules.Number(point,"yMm"); var z=PlanRules.Number(point,"zMm");
        var tolerance=JsonDefaults.Double(criteria,"toleranceMm");
        if(tolerance is null || tolerance<=0 || tolerance>10000)throw Invalid("Connector toleranceMm must be finite and between 0 (exclusive) and 10000.");
        return new(domain,shape,x,y,z,tolerance.Value);
    }
    public static void ValidateSelection(JsonElement op,string prefix)
    {
        var hasId=op.TryGetProperty(prefix+"ConnectorId",out var id);
        var hasCriteria=op.TryGetProperty(prefix+"Connector",out var criteria);
        if(hasId==hasCriteria)throw Invalid(prefix+" requires exactly one connector ID or criteria.");
        if(hasId){if(id.ValueKind!=JsonValueKind.Number || !id.TryGetInt32(out var n)||n<0)throw Invalid("Connector IDs must be nonnegative 32-bit integers.");}
        else Criteria(criteria);
    }
    public static bool Matches(ConnectorMatch candidate, ConnectorCriteria criteria)
    {
        if(candidate.Domain!=criteria.Domain||candidate.Shape!=criteria.Shape||!double.IsFinite(candidate.XMm)||!double.IsFinite(candidate.YMm)||!double.IsFinite(candidate.ZMm))return false;
        var dx=candidate.XMm-criteria.XMm; var dy=candidate.YMm-criteria.YMm; var dz=candidate.ZMm-criteria.ZMm;
        return dx*dx+dy*dy+dz*dz<=criteria.ToleranceMm*criteria.ToleranceMm;
    }
    public static int Unique(IEnumerable<ConnectorMatch> candidates,ConnectorCriteria criteria)
    {
        var matches=candidates.Where(c=>Matches(c,criteria)).ToArray();
        if(matches.Length!=1)throw new BridgeException(matches.Length==0?"connector_missing":"connector_ambiguous",$"Connector criteria returned {matches.Length} matches; no connector was selected.");
        return matches[0].Id;
    }
}
