using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal sealed record ElementStorageSchemaInput(string DocumentIdentity,long ExpectedRevision,long[] ElementIds);
internal sealed record ElementStorageSchemaGuids(bool Supported,bool Complete,Guid[] Guids,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] int? Count,bool Truncated=false,string? Reason=null);
internal sealed record ElementStorageSchemaFieldMetadata(string Name,string ValueType,string ContainerType,string? SpecTypeId);
internal sealed record ElementStorageSchemaMetadata(Guid Guid,string MetadataStatus,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? SchemaName,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? VendorId,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] Guid? ApplicationGuid,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? ReadAccessLevel,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? WriteAccessLevel,
    ElementStorageSchemaFieldMetadata[] Fields);
internal sealed record ElementStorageSchemaItem(long ElementId,bool Exists,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] ElementDependencySummary? Summary,
    ElementStorageSchemaEvidence SchemaEvidence);
internal sealed record ElementStorageSchemaEvidence(bool Supported,bool Complete,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] int? Count,bool Truncated,
    ElementStorageSchemaMetadata[] Schemas,string? Reason=null);

internal static class ElementStorageSchemaRules
{
    public const long MaxSafeInteger=9007199254740991;
    public const int MaxRootElements=20,MaxSchemasPerElement=32,MaxTotalSchemas=128,
        MaxFieldsPerSchema=128,MaxTotalFields=512,MaxResponseBytes=2*1024*1024;
    public const int MaxSchemaNameLength=256,MaxVendorIdLength=128,MaxFieldNameLength=256,
        MaxValueTypeLength=512,MaxContainerTypeLength=64,MaxSpecTypeIdLength=256;

    public static ElementStorageSchemaInput Parse(JsonElement request)
    {
        BridgeException Invalid(string message)=>new("invalid_element_storage_schema_request",message);
        if(request.ValueKind!=JsonValueKind.Object)throw Invalid("Element storage schema audit requires an object.");
        var allowed=new HashSet<string>(["documentIdentity","expectedRevision","elementIds"],StringComparer.Ordinal);
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var property in request.EnumerateObject())
            if(!allowed.Contains(property.Name)||!seen.Add(property.Name))
                throw Invalid($"Unknown or duplicate storage schema audit field '{property.Name}'.");
        var identity=JsonDefaults.String(request,"documentIdentity");
        if(string.IsNullOrWhiteSpace(identity)||identity.Length>200)
            throw Invalid("documentIdentity must be the current nonempty session identity, at most 200 characters.");
        if(!request.TryGetProperty("expectedRevision",out var revisionValue)||revisionValue.ValueKind!=JsonValueKind.Number||
           !revisionValue.TryGetInt64(out var revision)||revision<0||revision>MaxSafeInteger)
            throw Invalid("expectedRevision must be an explicit nonnegative safe integer.");
        if(!request.TryGetProperty("elementIds",out var rawIds)||rawIds.ValueKind!=JsonValueKind.Array||
           rawIds.GetArrayLength()<1||rawIds.GetArrayLength()>MaxRootElements)
            throw Invalid("elementIds must contain 1 to 20 unique positive safe native IDs.");
        var ids=rawIds.EnumerateArray().Select(value=>value.ValueKind==JsonValueKind.Number&&value.TryGetInt64(out var id)&&id>0&&id<=MaxSafeInteger
            ?id:throw Invalid("elementIds must contain only positive safe integers.")).ToArray();
        if(ids.Distinct().Count()!=ids.Length)throw Invalid("Repeated element IDs are not allowed.");
        return new(identity,revision,ids);
    }

    public static ElementStorageSchemaGuids ReadSchemaGuids(Func<IEnumerable<Guid>?> read,Action check,ref int totalSchemas)
    {
        check();
        IEnumerator<Guid> iterator;
        try
        {
            var values=read();
            if(values is null)
            {
                check();
                return new(false,false,[],null,false,"native_schema_guid_list_unavailable");
            }
            iterator=values.GetEnumerator();
        }
        catch(NotSupportedException)
        {
            check();
            return new(false,false,[],null,false,"native_api_not_supported");
        }
        using(iterator)
        {
            var guids=new HashSet<Guid>();
            while(true)
            {
                check();
                Guid guid;
                try{if(!iterator.MoveNext())break;guid=iterator.Current;}
                catch(NotSupportedException){check();return new(false,false,[],null,false,"native_api_not_supported");}
                if(guid==Guid.Empty)throw new BridgeException("element_storage_schema_invalid_native_evidence","The native schema GUID list contained an empty GUID.");
                guids.Add(guid);
                if(guids.Count>MaxSchemasPerElement||totalSchemas+guids.Count>MaxTotalSchemas)
                    throw new BridgeException("element_storage_schema_limit_exceeded","Attached schema definitions exceed their bounded budget. Narrow the explicit element IDs; no partial metadata was returned.");
            }
            check();
            var ordered=guids.Order().ToArray();
            totalSchemas+=ordered.Length;
            return new(true,true,ordered,ordered.Length,false);
        }
    }

    public static string RequireNativeText(string? value,string label,int maximumLength,bool allowEmpty=false)
    {
        if(value is null||(!allowEmpty&&value.Length==0)||value.Length>maximumLength)
            throw new BridgeException("element_storage_schema_invalid_native_evidence",$"Native storage schema metadata '{label}' is unavailable or exceeds its limit.");
        return value;
    }

    public static void RequireSchemaFieldBudget(int fieldCount,ref int totalFields)
    {
        if(fieldCount<0||fieldCount>MaxFieldsPerSchema||totalFields+fieldCount>MaxTotalFields)
            throw new BridgeException("element_storage_schema_limit_exceeded","Schema field definitions exceed their bounded budget. Narrow the explicit element IDs; no partial metadata was returned.");
        totalFields+=fieldCount;
    }

    public static void RequireResponseBudget(string envelope)
    {
        if((long)Encoding.UTF8.GetByteCount(envelope)+2>MaxResponseBytes)
            throw new BridgeException("element_storage_schema_response_too_large","The complete native schema metadata response exceeds the 2 MiB wire budget. Narrow the explicit element IDs; no response was truncated.");
    }
}
