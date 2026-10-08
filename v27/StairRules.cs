using System.Text.Json;
namespace RevitAutoV27;
internal static class StairRules
{
    private static BridgeException Invalid(string message)=>new("invalid_stair",message);
    public static void Validate(JsonElement op)
    {
        var allowed=new HashSet<string>(["operationType","id","dependencies","stairTypeId","baseLevelId","topLevelId","desiredRisersNumber","treadDepthMm","geometryToleranceMm","landingMode","runs","landings"],StringComparer.Ordinal);
        var seen=new HashSet<string>();foreach(var field in op.EnumerateObject())if(!allowed.Contains(field.Name)||!seen.Add(field.Name))throw Invalid($"Unknown or duplicate stair field '{field.Name}'.");
        foreach(var field in new[]{"stairTypeId","baseLevelId","topLevelId"}){var n=JsonDefaults.Int64(op,field);if(n is null||n<=0||n>9007199254740991)throw Invalid($"Provide an explicit existing {field}, not a deferred reference or a default type.");}
        if(JsonDefaults.Int64(op,"baseLevelId")==JsonDefaults.Int64(op,"topLevelId"))throw Invalid("Base and top level must be different.");
        var desired=Count(op,"desiredRisersNumber");var tread=PlanRules.Number(op,"treadDepthMm");if(tread<=0)throw Invalid("treadDepthMm must be explicitly positive.");
        var tolerance=PlanRules.Number(op,"geometryToleranceMm");if(tolerance<=0||tolerance>100)throw Invalid("geometryToleranceMm must be explicit in (0,100] mm.");
        var mode=JsonDefaults.String(op,"landingMode");if(mode is not("none" or "automaticBetweenRuns" or "sketched"))throw Invalid("Specify none, automaticBetweenRuns or sketched landingMode.");
        var raw=JsonDefaults.Get(op,"runs");if(raw.ValueKind!=JsonValueKind.Array||raw.GetArrayLength()<1||raw.GetArrayLength()>8)throw Invalid("A stair requires 1..8 explicit straight runs.");
        if(mode=="automaticBetweenRuns"&&raw.GetArrayLength()<2)throw Invalid("automaticBetweenRuns needs at least two runs.");
        int sum=0;foreach(var run in raw.EnumerateArray())
        {
            Exact(run,["start","end","widthMm","risersNumber"]);var a=OpeningRules.Point(JsonDefaults.Get(run,"start"));var b=OpeningRules.Point(JsonDefaults.Get(run,"end"));
            if(Math.Abs(a.Z-b.Z)>0.01)throw Invalid("A straight run path must be horizontal with full absolute project XYZ; it is not a slope line.");
            if(Math.Sqrt((a.X-b.X)*(a.X-b.X)+(a.Y-b.Y)*(a.Y-b.Y))<1||PlanRules.Number(run,"widthMm")<=0)throw Invalid("Straight run needs positive length and width.");
            sum+=Count(run,"risersNumber");
        }
        if(sum!=desired)throw Invalid("Explicit per-run risersNumber sum must equal desiredRisersNumber.");
        if(mode=="sketched")
        {
            var landings=JsonDefaults.Get(op,"landings");if(landings.ValueKind!=JsonValueKind.Array||landings.GetArrayLength()<1||landings.GetArrayLength()>8)throw Invalid("Sketched mode needs 1..8 explicit landing profiles.");
            foreach(var landing in landings.EnumerateArray())
            {
                Exact(landing,["elevationMm","boundary"]);var z=PlanRules.Number(landing,"elevationMm");var profile=JsonDefaults.Get(landing,"boundary");if(profile.ValueKind!=JsonValueKind.Array||profile.GetArrayLength()<3||profile.GetArrayLength()>128)throw Invalid("Landing boundary needs 3..128 full XYZ vertices.");
                var points=profile.EnumerateArray().Select(OpeningRules.Point).ToArray();OpeningRules.ValidatePolygon(points,true);if(points.Any(p=>Math.Abs(p.Z-z)>0.01))throw Invalid("Landing elevationMm must equal every boundary's explicit absolute Z.");
            }
        }
        else if(op.TryGetProperty("landings",out _))throw Invalid("Explicit landings are only valid for sketched mode; no fields are silently ignored.");
    }
    private static void Exact(JsonElement value,string[] fields){if(value.ValueKind!=JsonValueKind.Object)throw Invalid("Stair run/landing input must be an object.");var names=value.EnumerateObject().Select(p=>p.Name).ToArray();if(names.Length!=fields.Length||names.Distinct().Count()!=fields.Length||fields.Any(field=>!names.Contains(field)))throw Invalid("Stair runs/landings require exactly their explicit geometry and count fields.");}
    public static int Count(JsonElement op,string field){var raw=JsonDefaults.Get(op,field);if(raw.ValueKind!=JsonValueKind.Number||!raw.TryGetInt32(out var n)||n<1||n>1000)throw Invalid($"{field} must be an explicit integer in [1,1000].");return n;}
    public static void VerifyRunElevations(JsonElement op,double baseMm,double topMm)
    {
        if(!double.IsFinite(baseMm)||!double.IsFinite(topMm)||topMm<=baseMm)throw Invalid("Native base/top elevations are unknown or invalid.");
        var riser=(topMm-baseMm)/Count(op,"desiredRisersNumber");int index=0;
        foreach(var run in JsonDefaults.Array(op,"runs")){var requested=OpeningRules.Point(JsonDefaults.Get(run,"start")).Z;var expected=baseMm+index*riser;if(Math.Abs(requested-expected)>PlanRules.Number(op,"geometryToleranceMm"))throw Invalid("Each run's absolute start Z must match the explicit preceding riser counts and selected base/top elevations.");index+=Count(run,"risersNumber");}
        if(JsonDefaults.String(op,"landingMode")=="sketched")foreach(var landing in JsonDefaults.Array(op,"landings")){var z=PlanRules.Number(landing,"elevationMm");var steps=(z-baseMm)/riser;if(z<=baseMm||z>=topMm||Math.Abs(steps-Math.Round(steps))*riser>PlanRules.Number(op,"geometryToleranceMm"))throw Invalid("Explicit landing elevation must be strictly inside the selected levels and align with the reviewed riser grid.");}
    }
}
