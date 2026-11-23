using System.Text.Json;
using RevitAutoV27;

internal static class RebarCreationRulesTests
{
    private const string Straight = """{"operationType":"create_rebar_set","hostElementId":10,"barTypeId":20,"start":{"xMm":0,"yMm":0,"zMm":3000},"end":{"xMm":2000,"yMm":0,"zMm":4200},"normal":{"x":0,"y":1,"z":0},"layout":{"rule":"Single"}}""";
    private const string Stirrup = """{"operationType":"create_rebar_stirrup","hostElementId":10,"barTypeId":20,"shapeId":30,"origin":{"xMm":-100,"yMm":-200,"zMm":3000},"xDirection":{"x":1,"y":0,"z":0},"yDirection":{"x":0,"y":0,"z":1},"layout":{"rule":"Single"}}""";
    private const string Fixed = """{"rule":"FixedNumber","quantity":5,"arrayLengthMm":1000,"barsOnNormalSide":false,"includeFirstBar":true,"includeLastBar":false}""";
    private const string Maximum = """{"rule":"MaximumSpacing","spacingMm":200,"arrayLengthMm":1000,"barsOnNormalSide":true,"includeFirstBar":false,"includeLastBar":true}""";
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
    private static JsonElement Set(string text, string field, string value) => Set(Json(text), field, value);
    private static JsonElement Set(JsonElement input, string field, string value)
    { var map=input.EnumerateObject().ToDictionary(property=>property.Name,property=>property.Value.Clone()); map[field]=Json(value); return JsonSerializer.SerializeToElement(map); }
    private static void Reject(Action action)
    { try { action(); } catch(BridgeException error) when(error.Code=="invalid_rebar_creation") { return; } throw new Exception("Expected invalid_rebar_creation."); }
    private static void Check(bool value) { if(!value) throw new Exception("Rebar assertion failed."); }
    private static RebarCurveEvidence Line(RebarPoint a, RebarPoint b) => new("Line",a,b,new((a.XMm+b.XMm)/2,(a.YMm+b.YMm)/2,(a.ZMm+b.ZMm)/2),RebarCreationRules.Length(RebarCreationRules.Between(a,b)));
    private static RebarCurveEvidence[] Polygon(params RebarPoint[] points) => points.Select((point,index)=>Line(point,points[(index+1)%points.Length])).ToArray();
    public static void Run(Action<string,Action> test)
    {
        test("rebar preserves explicit sloping XYZ endpoints and arbitrary vertical shape basis",()=>{
            var straight=RebarCreationRules.Validate(Json(Straight)); var stirrup=RebarCreationRules.Validate(Json(Stirrup));
            Check(straight.Start!.ZMm==3000&&straight.End!.ZMm==4200&&stirrup.Origin!.ZMm==3000);
            RebarCreationRules.RequireVector(new(0,-1,0),RebarCreationRules.ExpectedNormal(stirrup),"explicit shape plane");
            RebarCreationRules.RequirePoint(new(400,-200,3600),RebarCreationRules.MapDefaultPoint(stirrup,new(500,600,0)),"3D source map");
            var vertical=Set(Set(Straight,"end","""{"xMm":0,"yMm":0,"zMm":9000}"""),"normal","""{"x":1,"y":0,"z":0}""");
            RebarCreationRules.Validate(vertical);
        });
        test("rebar requires existing safe IDs and rejects deferred references",()=>{
            foreach(var input in new[]{Straight,Stirrup})foreach(var field in input==Straight?new[]{"hostElementId","barTypeId"}:new[]{"hostElementId","barTypeId","shapeId"})
                foreach(var value in new[]{"null","0","-1","1.5","\"@earlier\"","9007199254740992","{}"}) Reject(()=>RebarCreationRules.Validate(Set(input,field,value)));
            RebarCreationRules.Validate(Set(Straight,"barTypeId","9007199254740991"));
        });
        test("rebar new shape creation defaults off and requires a straight-only explicit boolean",()=>{
            Check(!RebarCreationRules.Validate(Json(Straight)).AllowNewShape);
            Check(RebarCreationRules.Validate(Set(Straight,"allowNewShape","true")).AllowNewShape);
            Check(!RebarCreationRules.Validate(Set(Straight,"allowNewShape","false")).AllowNewShape);
            foreach(var value in new[]{"null","0","\"true\"","{}"})Reject(()=>RebarCreationRules.Validate(Set(Straight,"allowNewShape",value)));
            Reject(()=>RebarCreationRules.Validate(Set(Stirrup,"allowNewShape","true")));
        });
        test("rebar every coordinate axis is mandatory finite numeric bounded and duplicate-free",()=>{
            foreach(var field in new[]{"start","end"})foreach(var point in new[]{"{}","null","""{"xMm":0,"yMm":0}""","""{"xMm":0,"yMm":0,"zMm":null}""","""{"xMm":0,"yMm":0,"zMm":"0"}""","""{"xMm":0,"yMm":0,"zMm":1e309}""","""{"xMm":0,"yMm":0,"zMm":100000001}""","""{"xMm":0,"yMm":0,"zMm":0,"zMm":1}""","""{"xMm":0,"yMm":0,"zMm":0,"z":0}"""})
                Reject(()=>RebarCreationRules.Validate(Set(Straight,field,point)));
            Reject(()=>RebarCreationRules.Validate(Set(Stirrup,"origin","""{"xMm":0,"yMm":0}""")));
            Reject(()=>RebarCreationRules.Validate(Set(Straight,"end","""{"xMm":0.5,"yMm":0,"zMm":3000}""")));
        });
        test("rebar explicit normals and basis reject zero nonunit nonorthogonal and missing axes",()=>{
            foreach(var field in new[]{"normal","xDirection","yDirection"})foreach(var value in new[]{"null","{}","""{"x":0,"y":0,"z":0}""","""{"x":2,"y":0,"z":0}""","""{"x":1,"y":0}""","""{"x":1,"y":0,"z":0,"w":0}""","""{"x":1,"y":0,"z":0,"x":0}"""})
                Reject(()=>RebarCreationRules.Validate(Set(field=="normal"?Straight:Stirrup,field,value)));
            Reject(()=>RebarCreationRules.Validate(Set(Straight,"normal","""{"x":1,"y":0,"z":0}""")));
            Reject(()=>RebarCreationRules.Validate(Set(Stirrup,"yDirection","""{"x":1,"y":0,"z":0}""")));
            RebarCreationRules.Validate(Set(Straight,"normal","""{"x":0,"y":1.0000000001,"z":0}"""));
        });
        test("rebar rejects unknown fields duplicate JSON null metadata and self dependencies",()=>{
            foreach(var field in new[]{"style","hookTypeId","parameters","quantity","shapeId"}) Reject(()=>RebarCreationRules.Validate(Set(Straight,field,"null")));
            foreach(var metadata in new[]{"\"id\":null","\"id\":\"\"","\"id\":\" padded\"","\"id\":\"bad\\nname\"","\"dependencies\":null","\"dependencies\":{}","\"dependencies\":[\"a\",\"a\"]","\"id\":\"same\",\"dependencies\":[\"same\"]","\"barTypeId\":30"})
                Reject(()=>RebarCreationRules.Validate(Json(Straight[..^1]+","+metadata+"}")));
            RebarCreationRules.Validate(Json(Straight[..^1]+",\"id\":\"r1\",\"dependencies\":[\"earlier\"]}"));
        });
        test("rebar layouts require exact names disjoint fields and all explicit booleans",()=>{
            foreach(var layout in new[]{"null","{}","""{"rule":"single"}""","""{"rule":"FIxedNumber"}""","""{"rule":"Single","quantity":1}""",Fixed[..^1]+",\"spacingMm\":10}",Maximum[..^1]+",\"quantity\":3}",Fixed[..^1]+",\"rule\":\"FixedNumber\"}"})
                Reject(()=>RebarCreationRules.Validate(Set(Straight,"layout",layout)));
            foreach(var original in new[]{Fixed,Maximum})foreach(var field in new[]{"arrayLengthMm","barsOnNormalSide","includeFirstBar","includeLastBar"})
            {
                var map=Json(original).EnumerateObject().Where(property=>property.Name!=field).ToDictionary(property=>property.Name,property=>property.Value.Clone());
                Reject(()=>RebarCreationRules.Validate(Set(Straight,"layout",JsonSerializer.Serialize(map))));
            }
            foreach(var field in new[]{"barsOnNormalSide","includeFirstBar","includeLastBar"})foreach(var value in new[]{"null","0","\"true\""})
                Reject(()=>RebarCreationRules.Validate(Set(Json(Straight),"layout",Set(Fixed,field,value).GetRawText())));
        });
        test("rebar fixed quantity means positions and excluded endpoints reduce native Quantity",()=>{
            var input=RebarCreationRules.Validate(Set(Straight,"layout",Fixed));
            Check(input.Layout.Positions==5&&input.Layout.Quantity==4);
            Check(RebarCreationRules.Included(input.Layout,0)&&!RebarCreationRules.Included(input.Layout,4));
            RebarCreationRules.RequireVector(new(0,-1000,0),RebarCreationRules.ExpectedOffset(input,4),"negative side distribution");
            var maximum=RebarCreationRules.Validate(Set(Straight,"layout",Maximum));
            Check(maximum.Layout.Positions==6&&maximum.Layout.Quantity==5&&!RebarCreationRules.Included(maximum.Layout,0));
            RebarCreationRules.RequireVector(new(0,600,0),RebarCreationRules.ExpectedOffset(maximum,3),"maximum spacing distribution");
        });
        test("rebar array and spacing bounds prevent zero negative overflow and too many positions",()=>{
            foreach(var quantity in new[]{"null","1","1.5","1001"})Reject(()=>RebarCreationRules.Validate(Set(Straight,"layout",Set(Fixed,"quantity",quantity).GetRawText())));
            foreach(var field in new[]{"arrayLengthMm","spacingMm"})foreach(var value in new[]{"null","0","-1","100000001","1e309"})
                Reject(()=>RebarCreationRules.Validate(Set(Straight,"layout",Set(Maximum,field,value).GetRawText())));
            Reject(()=>RebarCreationRules.Validate(Set(Straight,"layout",Set(Set(Maximum,"spacingMm","1"),"arrayLengthMm","1000").GetRawText())));
            var max=RebarCreationRules.Validate(Set(Straight,"layout",Set(Set(Maximum,"spacingMm","1"),"arrayLengthMm","999").GetRawText())); Check(max.Layout.Positions==1000);
            var empty=Set(Set(Set(Fixed,"quantity","2"),"includeFirstBar","false"),"includeLastBar","false");
            Reject(()=>RebarCreationRules.Validate(Set(Straight,"layout",empty.GetRawText())));
        });
        test("rebar default polygon reconstruction preserves arbitrary planar shape instead of assuming rectangle",()=>{
            var vertices=new[]{new RebarPoint(-20,-10,0),new RebarPoint(980,-10,0),new RebarPoint(780,590,0),new RebarPoint(200,790,0),new RebarPoint(-20,390,0)};
            var source=Polygon(vertices);var polygon=RebarCreationRules.DefaultPolygon(source,5);
            Check(polygon.Length==5);for(var i=0;i<vertices.Length;i++)RebarCreationRules.RequirePoint(new(vertices[i].XMm+20,vertices[i].YMm+10,0),polygon[i],"native default vertex");
            RebarCreationRules.RequirePolygon(vertices,source.Reverse().Select(curve=>Line(curve.End,curve.Start)).ToArray());
            var drift=source.ToArray();drift[2]=Line(new(780,591,0),vertices[3]);Reject(()=>RebarCreationRules.RequirePolygon(vertices,drift));
        });
        test("rebar default polygon recovers tangent fillet intersections and refuses unprovable arc bounds",()=>{
            var q=50/Math.Sqrt(2);
            RebarCurveEvidence Arc(RebarPoint start,RebarPoint end,RebarPoint center,RebarPoint midpoint)=>new("Arc",start,end,midpoint,25*Math.PI,center,50,new(0,0,1),Math.PI/2);
            var source=new[]{
                Line(new(50,0,0),new(450,0,0)),Arc(new(450,0,0),new(500,50,0),new(450,50,0),new(450+q,50-q,0)),
                Line(new(500,50,0),new(500,250,0)),Arc(new(500,250,0),new(450,300,0),new(450,250,0),new(450+q,250+q,0)),
                Line(new(450,300,0),new(50,300,0)),Arc(new(50,300,0),new(0,250,0),new(50,250,0),new(50-q,250+q,0)),
                Line(new(0,250,0),new(0,50,0)),Arc(new(0,50,0),new(50,0,0),new(50,50,0),new(50-q,50-q,0))};
            var polygon=RebarCreationRules.DefaultPolygon(source,4);
            var expected=new[]{new RebarPoint(0,0,0),new RebarPoint(500,0,0),new RebarPoint(500,300,0),new RebarPoint(0,300,0)};
            for(var i=0;i<4;i++)RebarCreationRules.RequirePoint(expected[i],polygon[i],"recovered fillet corner");
            var wrong=source.ToArray();wrong[1]=wrong[1] with{RadiusMm=100};Reject(()=>RebarCreationRules.DefaultPolygon(wrong,4));
            wrong=source.ToArray();wrong[1]=wrong[1] with{Center=new(449,50,0)};Reject(()=>RebarCreationRules.DefaultPolygon(wrong,4));
        });
        test("rebar default geometry rejects open chains projected Z unknown topology and collinear neighbors",()=>{
            var source=Polygon(new(0,0,0),new(1000,0,0),new(1000,500,0),new(0,500,0));
            var open=source.ToArray();open[0]=Line(new(0,1,0),new(1000,0,0));Reject(()=>RebarCreationRules.DefaultPolygon(open,4));
            var elevated=Polygon(new(0,0,5),new(1000,0,5),new(1000,500,5),new(0,500,5));Reject(()=>RebarCreationRules.DefaultPolygon(elevated,4));
            Reject(()=>RebarCreationRules.DefaultPolygon(source,5));
            var collinear=Polygon(new(0,0,0),new(500,0,0),new(1000,0,0),new(1000,500,0),new(0,500,0));Reject(()=>RebarCreationRules.DefaultPolygon(collinear,5));
        });
        test("rebar analytic arc evidence checks center radius sweep normal type and translation",()=>{
            var arc=new RebarCurveEvidence("Arc",new(10,0,0),new(0,10,0),new(Math.Sqrt(50),Math.Sqrt(50),0),5*Math.PI,new(0,0,0),10,new(0,0,1),Math.PI/2);
            var offset=new RebarVector(0,0,4000);var translated=arc with{Start=new(10,0,4000),End=new(0,10,4000),Midpoint=new(Math.Sqrt(50),Math.Sqrt(50),4000),Center=new(0,0,4000)};
            RebarCreationRules.RequireCurves([arc],[translated],offset,"native arc");
            foreach(var wrong in new[]{translated with{RadiusMm=11},translated with{SweepRadians=Math.PI},translated with{Normal=new(0,0,-1)},translated with{Center=null},translated with{Kind="Line"},translated with{Start=new(10,0,4001)}})
                Reject(()=>RebarCreationRules.RequireCurves([arc],[wrong],offset,"native arc"));
        });
        test("rebar XYZ and direction readbacks fail closed on nonfinite drift",()=>{
            Reject(()=>RebarCreationRules.RequirePoint(new(1,2,3),new(1,2,3.02),"Z"));
            Reject(()=>RebarCreationRules.RequirePoint(new(1,2,3),new(1,2,double.NaN),"Z"));
            Reject(()=>RebarCreationRules.RequireVector(new(0,1,0),new(0,-1,0),"normal"));
            Reject(()=>RebarCreationRules.RequireLength(100,double.PositiveInfinity,"array"));
        });
        test("rebar hook match and shape plane checks validate hooked stirrups strictly",()=>{
            RebarCreationRules.RequireHookMatch(0,-1,null,"start");
            Reject(()=>RebarCreationRules.RequireHookMatch(0,10,Math.PI/2,"start"));
            Reject(()=>RebarCreationRules.RequireHookMatch(0,0,0,"start"));
            RebarCreationRules.RequireHookMatch(135,42,3*Math.PI/4,"end");
            Reject(()=>RebarCreationRules.RequireHookMatch(135,-1,null,"end"));
            Reject(()=>RebarCreationRules.RequireHookMatch(135,42,Math.PI/2,"end"));
            Reject(()=>RebarCreationRules.RequireHookMatch(135,42,double.NaN,"end"));
            var origin=new RebarPoint(100,200,3000); var normal=new RebarVector(0,0,1);
            var inPlane=new[]{Line(new(100,200,3000),new(400,200,3000)),new RebarCurveEvidence("Arc",new(400,200,3000),new(410,210,3000),new(407.07,202.93,3000),15.7,new(400,210,3000),10,new(0,0,1),Math.PI/2)};
            RebarCreationRules.RequirePlanarInShapePlane(origin,normal,inPlane,"stirrup");
            Check(Math.Abs(RebarCreationRules.CoplanarPlaneOffsetMm(origin,normal,inPlane,"stirrup"))<=1e-9);
            var shifted=new[]{Line(new(100,200,3006.35),new(400,200,3006.35)),Line(new(400,200,3006.35),new(400,500,3006.35))};
            Check(Math.Abs(RebarCreationRules.CoplanarPlaneOffsetMm(origin,normal,shifted,"stirrup")-6.35)<=1e-9);
            Reject(()=>RebarCreationRules.RequirePlanarInShapePlane(origin,normal,shifted,"stirrup"));
            Reject(()=>RebarCreationRules.CoplanarPlaneOffsetMm(origin,normal,[shifted[0],shifted[1] with{End=new(400,500,3006.40)}],"stirrup"));
            Reject(()=>RebarCreationRules.RequirePlanarInShapePlane(origin,normal,[],"stirrup"));
            Reject(()=>RebarCreationRules.RequirePlanarInShapePlane(origin,normal,[inPlane[0] with{End=new(400,200,3000.02)}],"stirrup"));
        });
    }
}
