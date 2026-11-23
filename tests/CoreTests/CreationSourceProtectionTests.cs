using System.Text.Json;
using RevitAutoV27;

internal static class CreationSourceProtectionTests
{
    private static JsonElement Json(string text)=>JsonDocument.Parse(text).RootElement.Clone();
    private const string Rebar="""{"operationType":"create_rebar_set","hostElementId":10,"barTypeId":20,"start":{"xMm":0,"yMm":0,"zMm":100},"end":{"xMm":1000,"yMm":0,"zMm":100},"normal":{"x":0,"y":1,"z":0},"layout":{"rule":"Single"}}""";
    private const string Ceiling="""{"operationType":"create_ceiling","ceilingTypeId":10,"levelId":20,"boundary":[{"xMm":0,"yMm":0,"zMm":3000},{"xMm":4000,"yMm":0,"zMm":3000},{"xMm":4000,"yMm":3000,"zMm":3000},{"xMm":0,"yMm":3000,"zMm":3000}]}""";
    private static void Reject(string code,Action action){try{action();}catch(BridgeException error)when(error.Code==code){return;}throw new Exception("Expected "+code);}
    public static void Run(Action<string,Action> test)
    {
        test("new rebar source IDs cannot be mutated before or after creation in the same plan",()=>{
            foreach(var id in new[]{10,20})foreach(var kind in new[]{"set_parameter","delete_element"})
            {
                var change=Json($"{{\"operationType\":\"{kind}\",\"elementId\":{id},\"parameter\":\"Comments\",\"value\":\"test\"}}");
                Reject("invalid_rebar_creation",()=>RebarCreationRules.ValidatePlan([Json(Rebar),change]));
                Reject("invalid_rebar_creation",()=>RebarCreationRules.ValidatePlan([change,Json(Rebar)]));
            }
            Reject("invalid_rebar_creation",()=>RebarCreationRules.ValidatePlan([Json(Rebar),Json("{\"operationType\":\"load_family\"}")]));
            RebarCreationRules.ValidatePlan([Json(Rebar),Json("{\"operationType\":\"delete_element\",\"elementId\":30}")]);
            Reject("invalid_rebar_creation",()=>PlanRules.Validate(Json("["+Rebar+",{\"operationType\":\"set_parameter\",\"elementId\":20,\"parameter\":\"Comments\",\"value\":\"test\"}]")));
        });
        test("new ceiling type and level cannot be mutated before or after creation in the same plan",()=>{
            foreach(var id in new[]{10,20})foreach(var kind in new[]{"set_parameter","delete_element"})
            {
                var change=Json($"{{\"operationType\":\"{kind}\",\"elementId\":{id},\"parameter\":\"Comments\",\"value\":\"test\"}}");
                Reject("invalid_ceiling_creation",()=>CeilingCreationRules.ValidatePlan([Json(Ceiling),change]));
                Reject("invalid_ceiling_creation",()=>CeilingCreationRules.ValidatePlan([change,Json(Ceiling)]));
            }
            Reject("invalid_ceiling_creation",()=>CeilingCreationRules.ValidatePlan([Json(Ceiling),Json("{\"operationType\":\"load_family\"}")]));
            CeilingCreationRules.ValidatePlan([Json(Ceiling),Json("{\"operationType\":\"delete_element\",\"elementId\":30}")]);
            Reject("invalid_ceiling_creation",()=>PlanRules.Validate(Json("["+Ceiling+",{\"operationType\":\"set_parameter\",\"elementId\":10,\"parameter\":\"Comments\",\"value\":\"test\"}]")));
        });
    }
}
