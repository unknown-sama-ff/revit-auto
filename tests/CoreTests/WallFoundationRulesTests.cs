using System.Text.Json;
using RevitAutoV27;

internal static class WallFoundationRulesTests
{
    private static JsonElement Json(string value)=>JsonDocument.Parse(value).RootElement.Clone();
    private const string Good="{\"operationType\":\"create_wall_foundation\",\"hostElementId\":10,\"foundationTypeId\":20}";
    private static void Reject(Action action){try{action();}catch(BridgeException e)when(e.Code=="invalid_wall_foundation"){return;}throw new Exception("Expected invalid_wall_foundation.");}
    public static void Run(Action<string,Action> test)
    {
        test("wall foundation validates exact existing native host and type",()=>WallFoundationRules.Validate(Json(Good)));
        test("wall foundation rejects unknown duplicate missing unsafe and deferred inputs",()=>{
            foreach(var bad in new[]{Good.Replace("10","0"),Good.Replace("10","\"@wall\""),Good.Replace("10","20"),Good.Replace("20","9007199254740992"),Good.Replace("20","null"),Good.Replace("}",",\"rotationDegrees\":0}"),Good.Replace("}",",\"hostElementId\":10}")})Reject(()=>WallFoundationRules.Validate(Json(bad)));
        });
        test("wall foundation reserves one host and protects sources from same plan mutation",()=>{
            var good=Json(Good);WallFoundationRules.ValidatePlan([good]);
            Reject(()=>WallFoundationRules.ValidatePlan([good,good]));
            foreach(var operation in new[]{"set_parameter","delete_element"})foreach(var id in new[]{10,20})
                Reject(()=>WallFoundationRules.ValidatePlan([good,Json($"{{\"operationType\":\"{operation}\",\"elementId\":{id}}}")]));
            WallFoundationRules.ValidatePlan([good,Json("{\"operationType\":\"delete_element\",\"elementId\":30}")]);
        });
        test("wall foundation final readback verifies host geometry type level identity and result",()=>{
            var host=new WallFoundationHostState(10,"wall",11,"walltype",311,"level",100,false,"Line","exact-native-curve");
            var actual=new WallFoundationState(30,"foundation",20,"foundationtype",10,-2001300,"WallFoundation");
            WallFoundationRules.Require(Json(Good),actual,"foundation","foundationtype",host,host);
            foreach(var changed in new[]{actual with {UniqueId="replaced"},actual with {TypeId=21},actual with {WallId=11},actual with {CategoryId=-1},actual with {ClassName="FamilyInstance"}})
                Reject(()=>WallFoundationRules.Require(Json(Good),changed,"foundation","foundationtype",host,host));
            foreach(var changed in new[]{host with {UniqueId="replaced"},host with {CurveGeometryJson="different"},host with {LevelId=694},host with {WidthMm=200},host with {Flipped=true}})
                Reject(()=>WallFoundationRules.Require(Json(Good),actual,"foundation","foundationtype",host,changed));
        });
    }
}
