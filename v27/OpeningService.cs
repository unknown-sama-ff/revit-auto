using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;
internal static class OpeningService
{
    private static BridgeException Invalid(string message)=>new("invalid_opening",message);
    private static double Mm(double n)=>UnitUtils.ConvertToInternalUnits(n,UnitTypeId.Millimeters);
    private static XYZ Point(JsonElement p){var v=OpeningRules.Point(p);return new XYZ(Mm(v.X),Mm(v.Y),Mm(v.Z));}
    private static XYZ[] Vertices(JsonElement op)=>JsonDefaults.Array(op,"boundary").Select(Point).ToArray();
    private static T Host<T>(Document doc,JsonElement op,string field)where T:Element=>doc.GetElement(new ElementId(JsonDefaults.Int64(op,field)??throw Invalid($"Missing {field}.")))as T??throw Invalid($"{field} is not an existing {typeof(T).Name} in the current document.");
    public static void Validate(Document doc,JsonElement op)
    {
        OpeningRules.Validate(op);var kind=JsonDefaults.String(op,"openingKind");var tolerance=Mm(PlanRules.Number(op,"hostToleranceMm"));
        if(kind=="wall_rectangle")
        {
            var wall=Host<Wall>(doc,op,"hostElementId");
            if(wall.WallType.Kind!=WallKind.Basic||wall.get_Parameter(BuiltInParameter.WALL_CROSS_SECTION)?.AsInteger()!=0||wall.Location is not LocationCurve location||location.Curve is not Line line||Math.Abs(line.Direction.Z)>1e-8)throw Invalid("wall_rectangle currently needs a straight upright Basic wall; curved, slanted, stacked or curtain walls require a separate adapter.");
            var bounds=wall.get_BoundingBox(null)??throw Invalid("Wall has no native bounds.");
            foreach(var key in new[]{"start","end"})
            {
                var point=Point(JsonDefaults.Get(op,key));var xy=new XYZ(point.X,point.Y,line.GetEndPoint(0).Z);var projection=line.Project(xy);
                if(projection is null||projection.Distance>tolerance||line.ComputeNormalizedParameter(projection.Parameter)<0||line.ComputeNormalizedParameter(projection.Parameter)>1||point.Z<bounds.Min.Z-tolerance||point.Z>bounds.Max.Z+tolerance)throw Invalid($"Opening {key} must lie on the reviewed wall location line in XY and within its height; coordinates are not moved automatically.");
            }
        }
        else if(kind=="floor_profile")
        {
            var host=Host<Element>(doc,op,"hostElementId");if(host is not HostObject shell||host is not(Floor or Ceiling or RoofBase))throw Invalid("floor_profile host must be a floor, ceiling or roof in the current document.");
            var points=Vertices(op);var faces=HostObjectUtils.GetTopFaces(shell).Select(reference=>host.GetGeometryObjectFromReference(reference)).OfType<PlanarFace>().ToArray();
            // This is a planar-face vertex/midpoint precheck, not exact structural/cut impact certification.
            var samples=points.Concat(points.Select((point,i)=>(point+points[(i+1)%points.Length])*0.5)).ToArray();
            var compatible=faces.Any(face=>samples.All(point=>{var projection=face.Project(point);return projection is not null&&projection.Distance<=tolerance&&face.IsInside(projection.UVPoint);}));
            if(!compatible)throw Invalid("The explicit profile must lie on one native planar top face of the reviewed host. Face projection outside tolerance or trimmed boundaries is refused, not guessed.");
            Profile(doc,op);
        }
        else
        {
            var bottom=Host<Level>(doc,op,"baseLevelId");var top=Host<Level>(doc,op,"topLevelId");if(top.Elevation<=bottom.Elevation)throw Invalid("Shaft top level must be above base level.");
            if(Vertices(op).Any(point=>Math.Abs(point.Z-bottom.Elevation)>tolerance))throw Invalid("Shaft profile Z must explicitly match the selected base level elevation; no base offset is inferred.");
            Profile(doc,op);
        }
    }
    private static CurveArray Profile(Document doc,JsonElement op)
    {
        var vertices=Vertices(op);var result=new CurveArray();
        for(int i=0;i<vertices.Length;i++){var a=vertices[i];var b=vertices[(i+1)%vertices.Length];if(a.DistanceTo(b)<doc.Application.ShortCurveTolerance)throw Invalid("Opening edge is shorter than native ShortCurveTolerance.");result.Append(Line.CreateBound(a,b));}
        return result;
    }
    public static Opening Create(Document doc,JsonElement op)
    {
        Validate(doc,op);var kind=JsonDefaults.String(op,"openingKind");
        if(kind=="wall_rectangle")return doc.Create.NewOpening(Host<Wall>(doc,op,"hostElementId"),Point(JsonDefaults.Get(op,"start")),Point(JsonDefaults.Get(op,"end")));
        if(kind=="floor_profile")return doc.Create.NewOpening(Host<Element>(doc,op,"hostElementId"),Profile(doc,op),JsonDefaults.String(op,"cutDirection")=="perpendicular");
        return doc.Create.NewOpening(Host<Level>(doc,op,"baseLevelId"),Host<Level>(doc,op,"topLevelId"),Profile(doc,op));
    }
    public static object Snapshot(Opening opening)
    {
        var rect=opening.IsRectBoundary;var points=rect?opening.BoundaryRect?.Select(JsonPoint).ToArray():null;
        var curves=rect?null:opening.BoundaryCurves?.Cast<Curve>().Select(c=>new{curveType=c.GetType().Name,start=JsonPoint(c.GetEndPoint(0)),end=JsonPoint(c.GetEndPoint(1))}).ToArray();
        return NativeReadSnapshot.Freeze(new{openingId=opening.Id.Value,hostId=opening.Host?.Id.Value,isRectBoundary=rect,boundaryRect=points,boundaryCurves=curves,
            baseLevelId=opening.get_Parameter(BuiltInParameter.WALL_BASE_CONSTRAINT)?.AsElementId().Value,topLevelId=opening.get_Parameter(BuiltInParameter.WALL_HEIGHT_TYPE)?.AsElementId().Value,
            baseOffsetMm=ReadOffset(opening,BuiltInParameter.WALL_BASE_OFFSET),topOffsetMm=ReadOffset(opening,BuiltInParameter.WALL_TOP_OFFSET),engineeringComplianceVerified=false});
    }
    private static double? ReadOffset(Element element,BuiltInParameter name){var parameter=element.get_Parameter(name);return parameter is null?null:JsonDefaults.InternalToMm(parameter.AsDouble());}
    private static object JsonPoint(XYZ point)=>new{xMm=JsonDefaults.InternalToMm(point.X),yMm=JsonDefaults.InternalToMm(point.Y),zMm=JsonDefaults.InternalToMm(point.Z)};
    public static OperationReceipt Verify(Document doc,Opening opening,JsonElement op)
    {
        doc.Regenerate();var kind=JsonDefaults.String(op,"openingKind");var tolerance=Mm(PlanRules.Number(op,"hostToleranceMm"));
        var changed=new List<long>();
        if(kind!="shaft")
        {
            var host=Host<Element>(doc,op,"hostElementId");if(opening.Host?.Id!=host.Id)throw Invalid("Created opening host does not match the reviewed host; the transaction must roll back.");changed.Add(host.Id.Value);
        }
        if(kind=="wall_rectangle")
        {
            if(!opening.IsRectBoundary||opening.BoundaryRect is not{} rect||rect.Count!=2)throw Invalid("Native wall opening did not return its rectangular boundary.");
            var a=Point(JsonDefaults.Get(op,"start"));var b=Point(JsonDefaults.Get(op,"end"));if(!((rect[0].DistanceTo(a)<=tolerance&&rect[1].DistanceTo(b)<=tolerance)||(rect[1].DistanceTo(a)<=tolerance&&rect[0].DistanceTo(b)<=tolerance)))throw Invalid("Wall opening boundary differs from the reviewed corners; the transaction must roll back.");
        }
        else
        {
            if(opening.IsRectBoundary)throw Invalid("The native profile boundary changed representation; do not certify it without profile readback.");
            var curves=opening.BoundaryCurves?.Cast<Curve>().ToArray()??throw Invalid("Native opening profile is unavailable.");var expected=Vertices(op);
            if(curves.Length!=expected.Length||curves.Any(curve=>curve is not Line))throw Invalid("Native opening profile differs from the reviewed straight-edge polygon.");
            OpeningPoint MmPoint(XYZ p)=>new(JsonDefaults.InternalToMm(p.X),JsonDefaults.InternalToMm(p.Y),JsonDefaults.InternalToMm(p.Z));
            if(!OpeningRules.EdgesMatch(expected.Select(MmPoint).ToArray(),curves.Select(curve=>(MmPoint(curve.GetEndPoint(0)),MmPoint(curve.GetEndPoint(1)))).ToArray(),PlanRules.Number(op,"hostToleranceMm")))throw Invalid("Native profile segments do not match the reviewed polygon edges; the transaction must roll back.");
            if(kind=="shaft")
            {
                var bottom=opening.get_Parameter(BuiltInParameter.WALL_BASE_CONSTRAINT);var top=opening.get_Parameter(BuiltInParameter.WALL_HEIGHT_TYPE);
                if(bottom?.AsElementId()!=Host<Level>(doc,op,"baseLevelId").Id||top?.AsElementId()!=Host<Level>(doc,op,"topLevelId").Id)throw Invalid("Native shaft level constraints are not verified against the reviewed levels.");
                if(Math.Abs(ReadOffset(opening,BuiltInParameter.WALL_BASE_OFFSET)??double.PositiveInfinity)>PlanRules.Number(op,"hostToleranceMm")||Math.Abs(ReadOffset(opening,BuiltInParameter.WALL_TOP_OFFSET)??double.PositiveInfinity)>PlanRules.Number(op,"hostToleranceMm"))throw Invalid("Native shaft offsets are not verified as zero; no offsets were approved.");
            }
        }
        return new OperationReceipt([opening.Id.Value],changed){Evidence=new{openingKind=kind,hostAndBoundaryVerified=true,shaftLevelConstraintsVerified=kind=="shaft",cutDirectionPassedToNative=JsonDefaults.String(op,"cutDirection"),cutDirectionIndependentlyVerified=false,native=Snapshot(opening),sideEffectsVerified=false,engineeringComplianceVerified=false}};
    }
    public static object Preview(Document doc,JsonElement op)
    {
        var kind=JsonDefaults.String(op,"openingKind");
        if(kind!="shaft")
        {
            var host=Host<Element>(doc,op,"hostElementId");var dependents=host.GetDependentElements(null).Select(id=>id.Value).Order().ToArray();
            return new{openingKind=kind,hostId=host.Id.Value,hostCategoryId=host.Category?.Id.Value,hostWillBeCut=true,dependentCount=dependents.Length,dependentElementIds=dependents.Take(200).ToArray(),dependentsTruncated=dependents.Length>200,exactCutImpactVerified=false,structuralDesignVerified=false};
        }
        var points=Vertices(op);var bottom=Host<Level>(doc,op,"baseLevelId");var top=Host<Level>(doc,op,"topLevelId");
        var filter=new BoundingBoxIntersectsFilter(new Outline(new XYZ(points.Min(p=>p.X),points.Min(p=>p.Y),bottom.Elevation),new XYZ(points.Max(p=>p.X),points.Max(p=>p.Y),top.Elevation)));
        var candidates=new FilteredElementCollector(doc).WhereElementIsNotElementType().WherePasses(filter).Where(e=>e is Floor or Ceiling or RoofBase).Select(e=>e.Id.Value).Order().ToArray();
        return new{openingKind=kind,baseLevelId=bottom.Id.Value,topLevelId=top.Id.Value,candidateHostCount=candidates.Length,candidateHostIds=candidates.Take(200).ToArray(),truncated=candidates.Length>200,evidenceKind="bounding-box-range-candidates-only",exactCutImpactVerified=false,structuralDesignVerified=false};
    }
}
