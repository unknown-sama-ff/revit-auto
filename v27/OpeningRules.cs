using System.Text.Json;
namespace RevitAutoV27;
internal sealed record OpeningPoint(double X,double Y,double Z);
internal static class OpeningRules
{
    private static BridgeException Invalid(string message)=>new("invalid_opening",message);
    public static void Validate(JsonElement op)
    {
        var kind=JsonDefaults.String(op,"openingKind");
        string[] fields=kind switch
        {
            "wall_rectangle"=>["operationType","id","dependencies","openingKind","hostElementId","start","end","hostToleranceMm"],
            "floor_profile"=>["operationType","id","dependencies","openingKind","hostElementId","boundary","cutDirection","hostToleranceMm"],
            "shaft"=>["operationType","id","dependencies","openingKind","baseLevelId","topLevelId","boundary","hostToleranceMm"],
            _=>throw Invalid("Specify wall_rectangle, floor_profile or shaft; no host/kind is inferred.")
        };
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var property in op.EnumerateObject())if(!fields.Contains(property.Name,StringComparer.Ordinal)||!seen.Add(property.Name))throw Invalid($"Unsupported or duplicate opening field '{property.Name}'.");
        foreach(var field in kind=="shaft"?new[]{"baseLevelId","topLevelId"}:new[]{"hostElementId"})
        {
            var value=JsonDefaults.Get(op,field);
            if(value.ValueKind!=JsonValueKind.Number||!value.TryGetInt64(out var id)||id<=0||id>9007199254740991)throw Invalid($"{field} must be an existing positive safe native ID; new/deferred hosts require a subsequent reviewed plan.");
        }
        var tolerance=PlanRules.Number(op,"hostToleranceMm");if(tolerance<=0||tolerance>100)throw Invalid("hostToleranceMm must be explicitly provided in (0,100] mm.");
        if(kind=="wall_rectangle")
        {
            PlanRules.Require(op,"hostElementId");var a=Point(JsonDefaults.Get(op,"start"));var b=Point(JsonDefaults.Get(op,"end"));
            if(Math.Sqrt((b.X-a.X)*(b.X-a.X)+(b.Y-a.Y)*(b.Y-a.Y))<1||b.Z-a.Z<1)throw Invalid("Wall corners require at least 1 mm horizontal span and an explicit lower start/upper end.");
        }
        else
        {
            if(kind=="floor_profile"){PlanRules.Require(op,"hostElementId");if(JsonDefaults.String(op,"cutDirection") is not("vertical" or "perpendicular"))throw Invalid("Specify cutDirection vertical or perpendicular; no face-cut direction is guessed.");}
            else{PlanRules.Require(op,"baseLevelId");PlanRules.Require(op,"topLevelId");if(JsonDefaults.Get(op,"baseLevelId").GetRawText()==JsonDefaults.Get(op,"topLevelId").GetRawText())throw Invalid("Shaft levels must be different and native top elevation above base.");}
            var boundary=JsonDefaults.Get(op,"boundary");if(boundary.ValueKind!=JsonValueKind.Array||boundary.GetArrayLength()<3||boundary.GetArrayLength()>128)throw Invalid("Opening boundary needs 3..128 distinct full XYZ vertices, without a repeated closing point.");
            ValidatePolygon(boundary.EnumerateArray().Select(Point).ToArray(),kind=="shaft"||JsonDefaults.String(op,"cutDirection")=="vertical");
        }
    }
    public static bool EdgesMatch(OpeningPoint[] expected,(OpeningPoint Start,OpeningPoint End)[] actual,double toleranceMm)
    {
        if(actual.Length!=expected.Length||!double.IsFinite(toleranceMm)||toleranceMm<=0)return false;
        static double Distance(OpeningPoint a,OpeningPoint b)=>Math.Sqrt((a.X-b.X)*(a.X-b.X)+(a.Y-b.Y)*(a.Y-b.Y)+(a.Z-b.Z)*(a.Z-b.Z));
        var remaining=actual.ToList();
        for(int i=0;i<expected.Length;i++)
        {
            var a=expected[i];var b=expected[(i+1)%expected.Length];
            var match=remaining.FindIndex(edge=>Distance(a,edge.Start)<=toleranceMm&&Distance(b,edge.End)<=toleranceMm||Distance(a,edge.End)<=toleranceMm&&Distance(b,edge.Start)<=toleranceMm);
            if(match<0)return false;remaining.RemoveAt(match);
        }
        return remaining.Count==0;
    }    public static OpeningPoint Point(JsonElement point)
    {
        if(point.ValueKind!=JsonValueKind.Object||point.EnumerateObject().Count()!=3||point.EnumerateObject().Any(p=>p.Name is not("xMm" or "yMm" or "zMm")))throw Invalid("Opening vertices require only full xMm/yMm/zMm, not implicit zero or arbitrary fields.");
        return new(PlanRules.Number(point,"xMm"),PlanRules.Number(point,"yMm"),PlanRules.Number(point,"zMm"));
    }
    public static void ValidatePolygon(OpeningPoint[] points,bool horizontal)
    {
        static OpeningPoint Sub(OpeningPoint a,OpeningPoint b)=>new(a.X-b.X,a.Y-b.Y,a.Z-b.Z);
        static OpeningPoint Cross(OpeningPoint a,OpeningPoint b)=>new(a.Y*b.Z-a.Z*b.Y,a.Z*b.X-a.X*b.Z,a.X*b.Y-a.Y*b.X);
        static double Length(OpeningPoint p)=>Math.Sqrt(p.X*p.X+p.Y*p.Y+p.Z*p.Z);
        if(horizontal&&points.Any(p=>Math.Abs(p.Z-points[0].Z)>0.01))throw Invalid("Shaft and vertical-cut profiles must have explicitly horizontal XYZ coordinates.");
        OpeningPoint? normal=null;
        for(int i=1;i<points.Length-1;i++){var candidate=Cross(Sub(points[i],points[0]),Sub(points[i+1],points[0]));if(Length(candidate)>0.001){normal=candidate;break;}}
        if(normal is null)throw Invalid("Opening profile has no area.");
        var length=Length(normal);
        foreach(var point in points){var d=Sub(point,points[0]);if(Math.Abs(d.X*normal.X+d.Y*normal.Y+d.Z*normal.Z)/length>0.01)throw Invalid("Opening profile is not planar within 0.01 mm.");}
        var dominant=Math.Abs(normal.Z)>=Math.Max(Math.Abs(normal.X),Math.Abs(normal.Y))?2:Math.Abs(normal.X)>=Math.Abs(normal.Y)?0:1;
        var projected=points.Select(p=>dominant==2?(p.X,p.Y):dominant==0?(p.Y,p.Z):(p.X,p.Z)).ToArray();
        static double Orient((double X,double Y) a,(double X,double Y) b,(double X,double Y)c)=>(b.X-a.X)*(c.Y-a.Y)-(b.Y-a.Y)*(c.X-a.X);
        static bool On((double X,double Y)a,(double X,double Y)b,(double X,double Y)p)=>Math.Abs(Orient(a,b,p))<1e-8&&p.X>=Math.Min(a.X,b.X)-1e-8&&p.X<=Math.Max(a.X,b.X)+1e-8&&p.Y>=Math.Min(a.Y,b.Y)-1e-8&&p.Y<=Math.Max(a.Y,b.Y)+1e-8;
        static bool Intersects((double X,double Y)a,(double X,double Y)b,(double X,double Y)c,(double X,double Y)d){var x=Orient(a,b,c);var y=Orient(a,b,d);var z=Orient(c,d,a);var w=Orient(c,d,b);return(x*y<0&&z*w<0)||On(a,b,c)||On(a,b,d)||On(c,d,a)||On(c,d,b);}
        double area=0;
        for(int i=0;i<points.Length;i++)
        {
            var j=(i+1)%points.Length;if(Length(Sub(points[i],points[j]))<1)throw Invalid("Opening edges must be at least 1 mm; duplicate/closing points are forbidden.");
            if(Math.Abs(Orient(projected[(i+points.Length-1)%points.Length],projected[i],projected[j]))<1e-8)throw Invalid("Opening profile contains redundant collinear vertices.");
            area+=projected[i].Item1*projected[j].Item2-projected[j].Item1*projected[i].Item2;
            for(int k=i+1;k<points.Length;k++){var l=(k+1)%points.Length;if(k==j||l==i)continue;if(Intersects(projected[i],projected[j],projected[k],projected[l]))throw Invalid("Opening polygon intersects or touches itself.");}
        }
        if(Math.Abs(area)/2<1)throw Invalid("Opening profile projected area must be at least 1 mm².");
    }
}
