using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
namespace RevitAutoV27;
internal static class StairGeometryService
{
    private static BridgeException Invalid(string message)=>new("invalid_stair",message);
    private static double Mm(double value)=>UnitUtils.ConvertToInternalUnits(value,UnitTypeId.Millimeters);
    private static double ToMm(double value)=>JsonDefaults.InternalToMm(value);
    private static T Existing<T>(Document doc,JsonElement op,string field)where T:Element=>doc.GetElement(new ElementId(JsonDefaults.Int64(op,field)??throw Invalid($"Missing {field}.")))as T??throw Invalid($"{field} is not an existing {typeof(T).Name} in the current document.");
    public static void Validate(Document doc,JsonElement op)
    {
        StairRules.Validate(op);var bottom=Existing<Level>(doc,op,"baseLevelId");var top=Existing<Level>(doc,op,"topLevelId");var type=Existing<StairsType>(doc,op,"stairTypeId");
        if(doc.GetElement(type.RunType) is not StairsRunType)throw Invalid("The reviewed stairs type does not define a usable native run type.");
        if(JsonDefaults.String(op,"landingMode")!="none"&&doc.GetElement(type.LandingType) is not StairsLandingType)throw Invalid("The reviewed stairs type does not define a usable native landing type.");
        StairRules.VerifyRunElevations(op,ToMm(bottom.Elevation),ToMm(top.Elevation));
        foreach(var run in JsonDefaults.Array(op,"runs")){var a=OpeningRules.Point(JsonDefaults.Get(run,"start"));var b=OpeningRules.Point(JsonDefaults.Get(run,"end"));if(Mm(Math.Sqrt((a.X-b.X)*(a.X-b.X)+(a.Y-b.Y)*(a.Y-b.Y)))<doc.Application.ShortCurveTolerance)throw Invalid("Straight run path is shorter than native ShortCurveTolerance.");}
        if(JsonDefaults.String(op,"landingMode")=="sketched")foreach(var landing in JsonDefaults.Array(op,"landings"))LandingLoop(doc,landing);
    }
    public static void Configure(Document doc,ElementId stairId,JsonElement op)
    {
        var stair=doc.GetElement(stairId)as Stairs??throw Invalid("No native stair exists inside the active edit scope.");var requested=new ElementId(JsonDefaults.Int64(op,"stairTypeId")!.Value);
        if(stair.GetTypeId()!=requested){var replacement=stair.ChangeTypeId(requested);if(replacement!=ElementId.InvalidElementId&&replacement!=stairId)throw Invalid("Changing to the selected type replaced the scope target; refuse rather than adopting an unverified stair.");}
        stair=doc.GetElement(stairId)as Stairs??throw Invalid("The configured stair is not readable.");
        if(stair.GetTypeId()!=requested)throw Invalid("The selected stair type was not applied before generating components.");
        stair.DesiredRisersNumber=StairRules.Count(op,"desiredRisersNumber");stair.ActualTreadDepth=Mm(PlanRules.Number(op,"treadDepthMm"));doc.Regenerate();
        if(stair.DesiredRisersNumber!=StairRules.Count(op,"desiredRisersNumber")||Math.Abs(ToMm(stair.ActualTreadDepth)-PlanRules.Number(op,"treadDepthMm"))>PlanRules.Number(op,"geometryToleranceMm"))throw Invalid("Native stair riser/tread configuration differs from the reviewed values.");
        var bottom=Existing<Level>(doc,op,"baseLevelId");if(Math.Abs(stair.BaseElevation-bottom.Elevation)>Mm(PlanRules.Number(op,"geometryToleranceMm")))throw Invalid("The native stair base has an unreviewed offset.");
    }
    public static CurveLoop LandingLoop(Document doc,JsonElement landing)
    {
        var points=JsonDefaults.Array(landing,"boundary").Select(p=>{var v=OpeningRules.Point(p);return new XYZ(Mm(v.X),Mm(v.Y),Mm(v.Z));}).ToArray();var loop=new CurveLoop();
        for(int i=0;i<points.Length;i++){if(points[i].DistanceTo(points[(i+1)%points.Length])<doc.Application.ShortCurveTolerance)throw Invalid("Landing edge is shorter than native ShortCurveTolerance.");loop.Append(Line.CreateBound(points[i],points[(i+1)%points.Length]));}
        return loop;
    }
    public static long[] CreateSketchedLandings(Document doc,ElementId stairId,JsonElement op,CancellationToken cancellation)
    {
        var stair=(Stairs)doc.GetElement(stairId);var ids=new List<long>();
        foreach(var landing in JsonDefaults.Array(op,"landings")){cancellation.ThrowIfCancellationRequested();ids.Add(StairsLanding.CreateSketchedLanding(doc,stairId,LandingLoop(doc,landing),Mm(PlanRules.Number(landing,"elevationMm"))-stair.BaseElevation).Id.Value);}
        return ids.ToArray();
    }
    public static object Preview(Document doc,JsonElement op)
    {
        Validate(doc,op);var type=Existing<StairsType>(doc,op,"stairTypeId");var bottom=Existing<Level>(doc,op,"baseLevelId");var top=Existing<Level>(doc,op,"topLevelId");
        return new{stairTypeId=type.Id.Value,stairTypeName=type.Name,nativeRunTypeId=type.RunType.Value,nativeLandingTypeId=type.LandingType.Value,desiredRisersNumber=StairRules.Count(op,"desiredRisersNumber"),treadDepthMm=PlanRules.Number(op,"treadDepthMm"),requestedRiserHeightMm=ToMm(top.Elevation-bottom.Elevation)/StairRules.Count(op,"desiredRisersNumber"),landingMode=JsonDefaults.String(op,"landingMode"),typeMutated=false,
            note="The native scope initially creates a default empty stair, but the instance must be rebound to the reviewed type before any component creation. Type-defined supports/railings may be generated; inspect native change receipts. No guessed engineering standard.",nativeGeometryVerified=false,engineeringComplianceVerified=false};
    }
    private static OpeningPoint PlanPoint(XYZ point)=>new(ToMm(point.X),ToMm(point.Y),0);
    private static object ProjectedPoint(XYZ point)=>new{xMm=ToMm(point.X),yMm=ToMm(point.Y)};
    public static void Verify(Document doc,Stairs stair,JsonElement op,long[] runIds,long[] landingIds)
    {
        var tolerance=PlanRules.Number(op,"geometryToleranceMm");var expectedType=Existing<StairsType>(doc,op,"stairTypeId");
        if(stair.GetTypeId()!=expectedType.Id||stair.DesiredRisersNumber!=StairRules.Count(op,"desiredRisersNumber")||Math.Abs(ToMm(stair.ActualTreadDepth)-PlanRules.Number(op,"treadDepthMm"))>tolerance)throw Invalid("Native stair type/riser/tread readback differs from the approved values.");
        if(Math.Abs(stair.BaseElevation-Existing<Level>(doc,op,"baseLevelId").Elevation)>Mm(tolerance)||Math.Abs(stair.TopElevation-Existing<Level>(doc,op,"topLevelId").Elevation)>Mm(tolerance))throw Invalid("Native stair elevations differ from the reviewed levels; unapproved offsets are not allowed.");
        var requests=JsonDefaults.Array(op,"runs").ToArray();if(runIds.Length!=requests.Length||!stair.GetStairsRuns().Select(id=>id.Value).Order().SequenceEqual(runIds.Order()))throw Invalid("Native stair run set differs from the planned component set.");
        for(int i=0;i<runIds.Length;i++)
        {
            var run=doc.GetElement(new ElementId(runIds[i]))as StairsRun??throw Invalid("A created run is unreadable.");var request=requests[i];var point=OpeningRules.Point(JsonDefaults.Get(request,"start"));
            if(run.GetTypeId()!=expectedType.RunType||run.ActualRisersNumber!=StairRules.Count(request,"risersNumber")||Math.Abs(ToMm(run.ActualRunWidth)-PlanRules.Number(request,"widthMm"))>tolerance||Math.Abs(ToMm(stair.BaseElevation+run.BaseElevation)-point.Z)>tolerance)throw Invalid($"Native run {i+1} type/count/width/base differs; do not silently accept native rounding.");
            var expectedHeight=StairRules.Count(request,"risersNumber")*stair.ActualRiserHeight;if(Math.Abs(ToMm(run.TopElevation-run.BaseElevation-expectedHeight))>tolerance)throw Invalid("Native run top elevation does not match its reviewed riser count.");
            var path=run.GetStairsPath().ToArray();var end=OpeningRules.Point(JsonDefaults.Get(request,"end"));var a=new OpeningPoint(point.X,point.Y,0);var b=new OpeningPoint(end.X,end.Y,0);
            if(path.Length!=1||path[0] is not Line||!OpeningRules.EdgesMatch([a,b],[(PlanPoint(path[0].GetEndPoint(0)),PlanPoint(path[0].GetEndPoint(1))),(PlanPoint(path[0].GetEndPoint(1)),PlanPoint(path[0].GetEndPoint(0)))],tolerance))throw Invalid("Native straight path was shortened or changed beyond the reviewed tolerance.");
        }
        if(stair.ActualRisersNumber!=StairRules.Count(op,"desiredRisersNumber"))throw Invalid("Native stair actual riser total does not match the approved total.");
        var landings=stair.GetStairsLandings().Select(id=>(StairsLanding)doc.GetElement(id)).ToList();var mode=JsonDefaults.String(op,"landingMode");
        if(!landings.Select(landing=>landing.Id.Value).Order().SequenceEqual(landingIds.Order()))throw Invalid("Native platform set differs from the actual reviewed-mode creation results.");
        if(mode=="none"&&landings.Count!=0)throw Invalid("Native landings were generated although none was requested.");
        if(mode=="automaticBetweenRuns"&&landings.Count==0)throw Invalid("Requested automatic landings are absent.");
        if(landings.Any(landing=>landing.GetTypeId()!=expectedType.LandingType))throw Invalid("Native landing type differs from the reviewed stair type definition.");
        if(mode=="sketched")
        {
            var requested=JsonDefaults.Array(op,"landings").ToArray();if(landings.Count!=requested.Length)throw Invalid("Native landing set differs from the explicit sketched profiles.");
            foreach(var profile in requested)
            {
                var expected=JsonDefaults.Array(profile,"boundary").Select(p=>{var point=OpeningRules.Point(p);return new OpeningPoint(point.X,point.Y,0);}).ToArray();var match=landings.FindIndex(landing=>Math.Abs(ToMm(stair.BaseElevation+landing.BaseElevation)-PlanRules.Number(profile,"elevationMm"))<=tolerance&&OpeningRules.EdgesMatch(expected,landing.GetFootprintBoundary().Select(curve=>(PlanPoint(curve.GetEndPoint(0)),PlanPoint(curve.GetEndPoint(1)))).ToArray(),tolerance));
                if(match<0)throw Invalid("Native sketched landing elevation or boundary differs from the approved profile.");landings.RemoveAt(match);
            }
        }
    }
    public static object Snapshot(Document doc,Stairs stair)
    {
        var runs=stair.GetStairsRuns().Select(id=>(StairsRun)doc.GetElement(id)).Select(run=>new{runId=run.Id.Value,typeId=run.GetTypeId().Value,actualRisersNumber=run.ActualRisersNumber,widthMm=ToMm(run.ActualRunWidth),baseElevationMm=ToMm(stair.BaseElevation+run.BaseElevation),topElevationMm=ToMm(stair.BaseElevation+run.TopElevation),projectedStairPath=run.GetStairsPath().Select(curve=>new{start=ProjectedPoint(curve.GetEndPoint(0)),end=ProjectedPoint(curve.GetEndPoint(1)),zEvidence="XY projection only; actual run elevations are reported separately"}).ToArray()}).ToArray();
        var landings=stair.GetStairsLandings().Select(id=>(StairsLanding)doc.GetElement(id)).Select(landing=>new{landingId=landing.Id.Value,typeId=landing.GetTypeId().Value,elevationMm=ToMm(stair.BaseElevation+landing.BaseElevation),projectedFootprint=landing.GetFootprintBoundary().Select(curve=>new{start=ProjectedPoint(curve.GetEndPoint(0)),end=ProjectedPoint(curve.GetEndPoint(1))}).ToArray()}).ToArray();
        return NativeReadSnapshot.Freeze(new{stairId=stair.Id.Value,stairTypeId=stair.GetTypeId().Value,baseElevationMm=ToMm(stair.BaseElevation),desiredRisersNumber=stair.DesiredRisersNumber,actualRisersNumber=stair.ActualRisersNumber,treadDepthMm=ToMm(stair.ActualTreadDepth),riserHeightMm=ToMm(stair.ActualRiserHeight),runs,landings,supportIds=stair.GetStairsSupports().Select(id=>id.Value).ToArray(),associatedRailingIds=stair.GetAssociatedRailings().Select(id=>id.Value).ToArray(),engineeringComplianceVerified=false});
    }
}
