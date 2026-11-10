using System.Text.Json;

namespace RevitAutoV27;

internal sealed record TitleBlockReadResult<T>(bool Supported,T? Value,string? ErrorCode,string? Error,bool Partial) where T:class;

internal static class TitleBlockReadPolicy
{
    public static TitleBlockReadResult<T> Read<T>(Func<T> read,Func<Exception,bool> unsupported) where T:class
    {
        try{return new(true,read(),null,null,false);}
        catch(BridgeException error) when(error.Code=="invalid_titleblock_change")
        {return new(false,null,error.Code,error.Message,false);}
        catch(Exception error) when(error is not OperationCanceledException&&unsupported(error))
        {return new(false,null,"titleblock_read_unsupported",error.Message,false);}
    }
}

internal static class TitleBlockChangeRules
{
    private static readonly HashSet<string> Allowed = new(StringComparer.Ordinal)
    { "operationType", "id", "dependencies", "titleBlockInstanceId", "sheetId", "targetTypeId" };
    private static BridgeException Invalid(string message) => new("invalid_titleblock_change", message);
    public static long ExistingId(JsonElement op,string field)
    {
        if(!op.TryGetProperty(field,out var value)||value.ValueKind!=JsonValueKind.Number||!value.TryGetInt64(out var id)||id<=0||id>9007199254740991)
            throw Invalid(field+" must be an explicit positive safe integer native ID.");
        return id;
    }
    public static void Validate(JsonElement op)
    {
        if(op.ValueKind!=JsonValueKind.Object||JsonDefaults.String(op,"operationType")!="change_titleblock_type")
            throw Invalid("Expected operationType change_titleblock_type.");
        var fields=op.EnumerateObject().Select(property=>property.Name).ToArray();
        if(fields.Any(field=>!Allowed.Contains(field))||fields.Distinct(StringComparer.Ordinal).Count()!=fields.Length)
            throw Invalid("Unknown or duplicate titleblock change field.");
        if(op.TryGetProperty("id",out var operationId)&&(operationId.ValueKind!=JsonValueKind.String||string.IsNullOrWhiteSpace(operationId.GetString())||operationId.GetString()!.Length>80))
            throw Invalid("Operation ID must be a non-empty string of at most 80 characters.");
        if(op.TryGetProperty("dependencies",out var dependencies)&&(dependencies.ValueKind!=JsonValueKind.Array||dependencies.GetArrayLength()>1000||
            dependencies.EnumerateArray().Any(value=>value.ValueKind!=JsonValueKind.String||string.IsNullOrWhiteSpace(value.GetString())||value.GetString()!.Length>80)))
            throw Invalid("Dependencies must be an explicit bounded array of operation IDs.");
        var ids=new[]{ExistingId(op,"titleBlockInstanceId"),ExistingId(op,"sheetId"),ExistingId(op,"targetTypeId")};
        if(ids.Distinct().Count()!=ids.Length)throw Invalid("Titleblock instance, owner sheet and target type must be distinct native elements.");
    }
    public static void ValidatePlan(IEnumerable<JsonElement> operations)
    {
        var rows=operations.ToArray();
        var changes=rows.Where(op=>JsonDefaults.String(op,"operationType")=="change_titleblock_type").ToArray();
        if(changes.Length>0&&(changes.Length!=1||rows.Length!=1))
            throw Invalid("A titleblock type change must be the only operation in its reviewed plan; ChangeTypeId may replace the instance.");
        foreach(var change in changes)Validate(change);
    }
}
