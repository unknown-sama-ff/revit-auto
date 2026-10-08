using System.Text.Json;

namespace RevitAutoV27;

internal sealed record ElectricalAuditInput(string DocumentIdentity,long? ExpectedRevision,long[] CircuitIds,int MaxCircuits,int MaxMembersPerCircuit,int MaxParametersPerCircuit);
internal static class ElectricalAuditRules
{
    public const int MaxCircuits=200, MaxMembers=500, MaxParameters=128, TotalMemberBudget=5000, TotalParameterBudget=2000, MaxResponseBytes=8*1024*1024;
    public static ElectricalAuditInput Parse(JsonElement request)
    {
        BridgeException Invalid(string message)=>new("invalid_electrical_audit_request",message);
        if(request.ValueKind!=JsonValueKind.Object)throw Invalid("Electrical audit requires an object.");
        var fields=new HashSet<string>(["documentIdentity","expectedRevision","circuitIds","maxCircuits","maxMembersPerCircuit","maxParametersPerCircuit"],StringComparer.Ordinal);
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var field in request.EnumerateObject())if(!fields.Contains(field.Name)||!seen.Add(field.Name))throw Invalid($"Unknown or duplicate electrical audit field '{field.Name}'.");
        var identity=JsonDefaults.String(request,"documentIdentity");
        if(string.IsNullOrWhiteSpace(identity)||identity.Length>200)throw Invalid("Read the current documentIdentity before auditing electrical circuits.");
        long? revision=null;
        if(request.TryGetProperty("expectedRevision",out var r))
        {
            if(r.ValueKind!=JsonValueKind.Number||!r.TryGetInt64(out var n)||n<0||n>9007199254740991)throw Invalid("expectedRevision must be a nonnegative safe integer.");
            revision=n;
        }
        long[] ids=[];
        if(request.TryGetProperty("circuitIds",out var raw))
        {
            if(raw.ValueKind!=JsonValueKind.Array||raw.GetArrayLength()<1||raw.GetArrayLength()>MaxCircuits)throw Invalid("circuitIds must contain 1 to 200 unique circuit IDs.");
            ids=raw.EnumerateArray().Select(id=>id.ValueKind==JsonValueKind.Number&&id.TryGetInt64(out var n)&&n>0&&n<=9007199254740991?n:throw Invalid("Circuit IDs must be positive safe integers.")).ToArray();
            if(ids.Distinct().Count()!=ids.Length)throw Invalid("Repeated circuit IDs are not allowed.");
        }
        int Limit(string name,int fallback,int max)
        {
            if(!request.TryGetProperty(name,out var value))return fallback;
            if(value.ValueKind!=JsonValueKind.Number||!value.TryGetInt32(out var n)||n<1||n>max)throw Invalid($"{name} must be an integer in [1,{max}].");
            return n;
        }
        var circuits=Limit("maxCircuits",100,MaxCircuits);
        if(ids.Length>circuits)throw Invalid("The selected circuit count exceeds maxCircuits; split or increase the explicitly bounded request.");
        return new(identity,revision,ids,circuits,Limit("maxMembersPerCircuit",100,MaxMembers),Limit("maxParametersPerCircuit",64,MaxParameters));
    }
}
internal sealed record AuditValueEvidence(string State,bool Supported,object? Value=null,string? ErrorType=null,string? Error=null,bool Truncated=false)
{
    public static AuditValueEvidence Read(Func<object?> read)
    {
        try
        {
            var value=read();
            if(value is double d&&!double.IsFinite(d)||value is float f&&!float.IsFinite(f))return new("unknown",false,Error:"Native numeric value is not finite.");
            if(value is string text&&text.Length>2048)return new("known",true,text[..2048],Truncated:true);
            return new(value is null?"known-null":"known",true,value);
        }
        catch(OperationCanceledException){throw;}
        catch(Exception ex){return new("unknown",false,ErrorType:ex.GetType().Name,Error:ex.Message.Length>400?ex.Message[..400]:ex.Message);}
    }
}
