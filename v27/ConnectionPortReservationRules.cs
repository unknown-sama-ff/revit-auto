using System.Text.Json;
namespace RevitAutoV27;

internal sealed class ConnectionPortClaims
{
    private readonly Dictionary<string,int> owners=new(StringComparer.Ordinal);
    public void Reserve(string key,int operation)
    {
        if(owners.TryGetValue(key,out var earlier))throw new BridgeException("connector_already_reserved",$"Endpoint {key} is occupied by operation {earlier}; operation {operation} cannot consume it again.",new{endpoint=key,earlierOperation=earlier,repeatedOperation=operation});
        owners.Add(key,operation);
    }
}
internal static class ConnectionPortReservationRules
{
    public static void ValidatePlan(IEnumerable<JsonElement> operations)
    {
        var created=new Dictionary<string,JsonElement>(StringComparer.Ordinal);var claims=new ConnectionPortClaims();var ordinal=0;
        foreach(var op in operations)
        {
            ordinal++;var kind=JsonDefaults.String(op,"operationType");
            if(kind is "connect_elements" or "create_fitting")foreach(var prefix in new[]{"first","second"})
            {
                var value=JsonDefaults.Get(op,prefix+"ElementId");var owner=value.ValueKind==JsonValueKind.String?value.GetString()!:value.GetRawText();string key;
                if(created.TryGetValue(owner.TrimStart('@'),out var curve)&&owner.StartsWith('@')&&JsonDefaults.String(curve,"operationType") is "create_pipe" or "create_duct")
                {
                    if(!op.TryGetProperty(prefix+"Connector",out var selector))throw new BridgeException("invalid_connector","New curves require endpoint criteria, not predicted connector IDs.");
                    var endpoint=NewCurveEndpoint(curve,selector);key=owner+":endpoint:"+endpoint;
                }
                else if(JsonDefaults.Int64(op,prefix+"ConnectorId") is long port)key=owner+":port:"+port;
                else
                {
                    var c=ConnectorSelectionRules.Criteria(JsonDefaults.Get(op,prefix+"Connector"));
                    key=owner+":point:"+JsonSerializer.Serialize(new{c.Domain,c.Shape,c.XMm,c.YMm,c.ZMm});
                }
                claims.Reserve(key,ordinal);
            }
            if(JsonDefaults.String(op,"id") is {} id)created[id]=op;
        }
    }
    public static int NewCurveEndpoint(JsonElement curve,JsonElement selector)
    {
        var c=ConnectorSelectionRules.Criteria(selector);
        var domain=JsonDefaults.String(curve,"operationType")=="create_pipe"?"DomainPiping":"DomainHvac";
        var shape=JsonDefaults.Has(curve,"diameterMm")?"Round":"Rectangular";
        var matches=new List<int>();var index=0;
        foreach(var name in new[]{"start","end"}){var p=JsonDefaults.Get(curve,name);if(ConnectorSelectionRules.Matches(new(index,domain,shape,PlanRules.Number(p,"xMm"),PlanRules.Number(p,"yMm"),JsonDefaults.Double(p,"zMm")??0),c))matches.Add(index);index++;}
        if(matches.Count!=1)throw new BridgeException("invalid_connector",$"New curve endpoint criteria matched {matches.Count} endpoints; no port was selected.");
        return matches[0];
    }
}
