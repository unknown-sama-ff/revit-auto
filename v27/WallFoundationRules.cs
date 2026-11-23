using System.Text.Json;

namespace RevitAutoV27;

internal sealed record WallFoundationHostState(long ElementId, string UniqueId, long TypeId, string TypeUniqueId,
    long LevelId, string LevelUniqueId, double WidthMm, bool Flipped, string CurveKind, string CurveGeometryJson);
internal sealed record WallFoundationState(long ElementId, string UniqueId, long TypeId, string TypeUniqueId,
    long WallId, long CategoryId, string ClassName);

internal static class WallFoundationRules
{
    internal static BridgeException Invalid(string message) => new("invalid_wall_foundation", message);
    internal static long Id(JsonElement op, string field)
    {
        var value=JsonDefaults.Get(op,field);
        if(value.ValueKind!=JsonValueKind.Number||!value.TryGetInt64(out var id)||id<=0||id>9007199254740991)
            throw Invalid($"{field} must be an existing positive safe native ID; deferred references are not supported.");
        return id;
    }
    public static void Validate(JsonElement op)
    {
        if(op.ValueKind!=JsonValueKind.Object)throw Invalid("An explicit wall-foundation operation object is required.");
        var allowed=new HashSet<string>(["operationType","id","dependencies","hostElementId","foundationTypeId"],StringComparer.Ordinal);
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var property in op.EnumerateObject())if(!allowed.Contains(property.Name)||!seen.Add(property.Name))throw Invalid("Unknown or duplicate wall-foundation field: "+property.Name);
        if(JsonDefaults.String(op,"operationType")!="create_wall_foundation")throw Invalid("Expected create_wall_foundation.");
        var host=Id(op,"hostElementId");var type=Id(op,"foundationTypeId");
        if(host==type)throw Invalid("Host wall and foundation type must identify distinct elements.");
    }
    public static void ValidatePlan(IReadOnlyList<JsonElement> operations)
    {
        var hosts=new HashSet<long>();var protectedIds=new HashSet<long>();
        foreach(var op in operations.Where(op=>JsonDefaults.String(op,"operationType")=="create_wall_foundation"))
        {
            Validate(op);var host=Id(op,"hostElementId");
            if(!hosts.Add(host))throw Invalid("Only one wall foundation may be requested for a host wall in one plan.");
            protectedIds.Add(host);protectedIds.Add(Id(op,"foundationTypeId"));
        }
        foreach(var op in operations.Where(op=>JsonDefaults.String(op,"operationType") is "set_parameter" or "delete_element"))
            if(JsonDefaults.Int64(op,"elementId") is long id&&protectedIds.Contains(id))throw Invalid("A wall-foundation host or type cannot be changed/deleted in the same plan; use a separately reviewed plan.");
    }
    public static void Require(JsonElement op,WallFoundationState actual,string expectedUniqueId,string expectedTypeUniqueId,
        WallFoundationHostState expectedHost,WallFoundationHostState actualHost)
    {
        Validate(op);
        if(actual.ElementId<=0||string.IsNullOrWhiteSpace(expectedUniqueId)||actual.UniqueId!=expectedUniqueId||
            actual.TypeId!=Id(op,"foundationTypeId")||string.IsNullOrWhiteSpace(expectedTypeUniqueId)||actual.TypeUniqueId!=expectedTypeUniqueId||
            actual.WallId!=Id(op,"hostElementId")||actual.CategoryId!=-2001300||actual.ClassName!="WallFoundation")
            throw Invalid("Native wall-foundation identity, type, category or host differs from the reviewed result.");
        if(expectedHost.ElementId!=Id(op,"hostElementId")||expectedHost!=actualHost||string.IsNullOrWhiteSpace(actualHost.UniqueId)||
            actualHost.TypeId<=0||actualHost.LevelId<=0||!double.IsFinite(actualHost.WidthMm)||actualHost.WidthMm<=0||
            actualHost.CurveKind is not ("Line" or "Arc")||string.IsNullOrWhiteSpace(actualHost.CurveGeometryJson))
            throw Invalid("The reviewed native host identity, wall type, level, width, flip or curve changed or is unavailable.");
    }
}
