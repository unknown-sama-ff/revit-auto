using System.Text.Json;
using RevitAutoV27;

internal static class OpeningHostSurfaceRulesTests
{
    private static JsonElement Op(string direction="vertical", bool sloped=false) => JsonSerializer.SerializeToElement(new
    {
        operationType="create_opening", openingKind="floor_profile", hostElementId=10,
        boundary=Points(sloped).Select(p=>new{xMm=p.X,yMm=p.Y,zMm=p.Z}),cutDirection=direction,hostToleranceMm=1
    });
    private static OpeningPoint[] Points(bool slope=false) => [new(100,100,slope?100:0),new(1100,100,slope?1100:0),new(1100,1100,slope?1100:0),new(100,1100,slope?100:0)];
    private static OpeningHostPlane Plane(bool slope=false) => new(new(0,0,0),slope?new(-1/Math.Sqrt(2),0,1/Math.Sqrt(2)):new(0,0,1));
    private static OpeningHostLoop Loop(OpeningPoint[] points,bool outer=false) => new(outer,true,points.Length,points.Select((p,i)=>new OpeningHostEdge(p,points[(i+1)%points.Length])).ToArray());
    private static OpeningHostLoop Outer(bool slope=false) => Loop([new(-100,-100,slope?-100:0),new(2000,-100,slope?2000:0),new(2000,2000,slope?2000:0),new(-100,2000,slope?-100:0)],true);
    private static OpeningHostFace Face(bool before,bool hole=false,bool slope=false) => new("native-face",Plane(slope),hole?[Outer(slope),Loop(Points(slope))]:[Outer(slope)],before?true:null);
    private static void Reject(Action action,string? message=null)
    {
        try{action();}catch(BridgeException e)when(e.Code=="invalid_opening")
        {if(message is not null&&!e.Message.Contains(message,StringComparison.OrdinalIgnoreCase))throw new Exception("Wrong rejection: "+e.Message);return;}
        throw new Exception("Unsafe host-surface evidence was accepted.");
    }
    public static void Run(Action<string,Action> test)
    {
        test("synthetic host top cut matches XYZ while captured-pattern bottom raw profile remains distinct",()=>
        {
            var op=Op();var expected=Points();var raw=Loop(expected.Select(p=>new OpeningPoint(p.X,p.Y,-100)).ToArray());
            if(OpeningRules.EdgesMatch(expected,raw.Edges.Select(e=>(e.Start,e.End)).ToArray(),1))throw new Exception("Raw bottom was rebased.");
            var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);
            var match=OpeningHostSurfaceRules.Verify(binding,op,[Face(false,true)]);
            if(match.BoundarySource!="native-host-input-top-face-inner-loop"||match.CutBoundary.Length!=4)throw new Exception("No actual host cut evidence.");
        });
        test("host cut permits reversed edge ordering without changing full coordinates",()=>
        {
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);var face=Face(false,true);
            face.Loops[1]=face.Loops[1] with{Edges=face.Loops[1].Edges.Reverse().Select(e=>new OpeningHostEdge(e.End,e.Start)).ToArray()};
            _=OpeningHostSurfaceRules.Verify(binding,op,[face]);
        });
        test("host cut rejects same XY on the native lower plane instead of flattening it",()=>
        {
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);var after=Face(false,true);
            after.Loops[1]=Loop(Points().Select(p=>new OpeningPoint(p.X,p.Y,-100)).ToArray());
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[after]));
        });
        test("prewrite surface must be unique and admitted by native samples",()=>
        {
            Reject(()=>OpeningHostSurfaceRules.Capture(Op(),[Face(true),Face(true)]));
            Reject(()=>OpeningHostSurfaceRules.Capture(Op(),[Face(true) with{InputSamplesInside=false}]));
        });
        test("preexisting matching hole cannot certify a newly created cut",()=>Reject(()=>OpeningHostSurfaceRules.Capture(Op(),[Face(true,true)])));
        test("outer outline cannot stand in for a native inner cut",()=>
        {
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[Face(false) with{Loops=[Loop(Points(),true)]}]));
        });
        test("duplicate native matching inner loops are ambiguous",()=>
        {
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[Face(false,true) with{Loops=[Outer(),Loop(Points()),Loop(Points())]}]));
        });
        test("later missing or moved native hole fails the original binding",()=>
        {
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[Face(false)]));
            var moved=Points().Select(p=>new OpeningPoint(p.X+2,p.Y,p.Z)).ToArray();
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[Face(false,true) with{Loops=[Outer(),Loop(moved)]}]));
        });
        test("host surface binding refuses different host operation or tolerance",()=>
        {
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);
            foreach(var bad in new[]{op.GetRawText().Replace("\"hostElementId\":10","\"hostElementId\":11"),op.GetRawText().Replace("\"hostToleranceMm\":1","\"hostToleranceMm\":2")})
                Reject(()=>OpeningHostSurfaceRules.Verify(binding,JsonDocument.Parse(bad).RootElement,[Face(false,true)]));
        });
        test("postwrite face cannot silently reset the reviewed plane or normal",()=>
        {
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[Face(false,true) with{Plane=new(new(0,0,-100),new(0,0,1))}]));
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[Face(false,true) with{Plane=new(new(0,0,0),new(0,0,-1))}]));
        });
        test("incomplete faces and nonfinite native segments never certify a cut",()=>
        {
            Reject(()=>OpeningHostSurfaceRules.Capture(Op(),[Face(true) with{Complete=false}]));
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);
            var bad=Face(false,true);bad.Loops[1].Edges[0]=new(new(double.NaN,100,0),new(1100,100,0));
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[bad]));
            Reject(()=>OpeningHostSurfaceRules.Capture(op,[Face(true) with{Plane=new(new(0,0,0),new(0,0,double.NaN))}]));
        });
        test("native face loop and curve budgets reject overflow explicitly",()=>
        {
            Reject(()=>OpeningHostSurfaceRules.Capture(Op(),Enumerable.Repeat(Face(true),257).ToArray()),"budget");
            Reject(()=>OpeningHostSurfaceRules.Capture(Op(),[Face(true) with{Loops=Enumerable.Repeat(Outer(),257).ToArray()}]),"budget");
            Reject(()=>OpeningHostSurfaceRules.Capture(Op(),[Face(true) with{Loops=[new(true,false,8193,[])]}]),"budget");
        });
        test("unknown topology or a nonstraight candidate cannot bypass evidence",()=>
        {
            Reject(()=>OpeningHostSurfaceRules.Capture(Op(),[Face(true) with{Loops=[]}]));
            var op=Op();var binding=OpeningHostSurfaceRules.Capture(op,[Face(true)]);
            Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[Face(false) with{Loops=[Outer(),new(false,false,4,[])]}]));
        });
        test("inclined perpendicular host cut preserves its full3D input plane",()=>
        {
            var op=Op("perpendicular",true);var binding=OpeningHostSurfaceRules.Capture(op,[Face(true,false,true)]);
            _=OpeningHostSurfaceRules.Verify(binding,op,[Face(false,true,true)]);
            var wrong=Face(false,true,true);wrong.Loops[1]=Loop(Points());Reject(()=>OpeningHostSurfaceRules.Verify(binding,op,[wrong]));
        });
        test("prewrite operation and plane snapshot survive source disposal and mutation",()=>
        {
            OpeningHostSurfaceBinding binding;
            using(var doc=JsonDocument.Parse(Op().GetRawText()))binding=OpeningHostSurfaceRules.Capture(doc.RootElement,[Face(true)]);
            _=OpeningHostSurfaceRules.Verify(binding,Op(),[Face(false,true)]);
            binding.ReviewedVertices[0]=new(0,0,-100);Reject(()=>OpeningHostSurfaceRules.Verify(binding,Op(),[Face(false,true)]));
        });
    }
}
