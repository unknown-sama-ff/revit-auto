using System.Text.Json;
using RevitAutoV27;

internal static class TitleBlockChangeRulesTests
{
    private const string Valid="""{"operationType":"change_titleblock_type","id":"block1","titleBlockInstanceId":10,"sheetId":20,"targetTypeId":30}""";
    private static JsonElement Json(string text)=>JsonDocument.Parse(text).RootElement.Clone();
    private static void Reject(Action action)
    {
        try{action();}catch(BridgeException error)when(error.Code=="invalid_titleblock_change"){return;}
        throw new Exception("Expected invalid_titleblock_change.");
    }
    public static void Run(Action<string,Action> test)
    {
        test("titleblock change preserves three explicit existing identifiers",()=>{
            var op=Json(Valid);TitleBlockChangeRules.Validate(op);TitleBlockChangeRules.ValidatePlan([op]);
            if(TitleBlockChangeRules.ExistingId(op,"titleBlockInstanceId")!=10||TitleBlockChangeRules.ExistingId(op,"targetTypeId")!=30)throw new Exception();
        });
        test("titleblock change rejects unknown duplicate ambiguous and malformed fields",()=>{
            foreach(var invalid in new[]{
                Valid.Replace("\"targetTypeId\":30","\"targetTypeId\":0"),Valid.Replace("\"targetTypeId\":30","\"targetTypeId\":9007199254740992"),
                Valid.Replace("\"targetTypeId\":30","\"targetTypeId\":30.5"),Valid.Replace("\"targetTypeId\":30","\"targetTypeId\":\"@type\""),
                Valid.Replace("\"sheetId\":20","\"sheetId\":10"),Valid.Replace("\"targetTypeId\":30","\"targetTypeId\":null"),
                Valid.Replace("\"targetTypeId\":30","\"targetTypeId\":30,\"targetTypeId\":40"),
                Valid.Replace("}",",\"parameters\":{\"Comments\":\"hidden\"}}"),Valid.Replace("}",",\"xMm\":0}"),
                Valid.Replace("\"id\":\"block1\"","\"id\":null"),Valid.Replace("block1"," "),
                Valid.Replace("}",",\"dependencies\":null}"),Valid.Replace("}",",\"dependencies\":[null]}"),
                Valid.Replace("change_titleblock_type","move_drawing_placement")
            })Reject(()=>TitleBlockChangeRules.Validate(Json(invalid)));
        });
        test("native titleblock replacements cannot share plans with other writes",()=>{
            var op=Json(Valid);Reject(()=>TitleBlockChangeRules.ValidatePlan([op,op]));
            Reject(()=>TitleBlockChangeRules.ValidatePlan([op,Json("""{"operationType":"delete_element","elementId":10}""")]));
            TitleBlockChangeRules.ValidatePlan([Json("""{"operationType":"delete_element","elementId":10}""")]);
        });
        test("titleblock readonly evidence preserves known success and converts unsupported state",()=>{
            var value=new object();var calls=0;
            var success=TitleBlockReadPolicy.Read(()=>{calls++;return value;},_=>false);
            if(!success.Supported||success.Value!=value||success.Error is not null||success.ErrorCode is not null||success.Partial||calls!=1)throw new Exception("Successful evidence changed.");
            var unsupported=TitleBlockReadPolicy.Read<object>(()=>throw new NotSupportedException("native state unavailable"),error=>error is NotSupportedException);
            if(unsupported.Supported||unsupported.Value is not null||unsupported.ErrorCode!="titleblock_read_unsupported"||unsupported.Error!="native state unavailable"||unsupported.Partial)throw new Exception("Unsupported evidence was not marked explicitly.");
        });
        test("titleblock evidence converts its own completeness errors without pretending partial data",()=>{
            var result=TitleBlockReadPolicy.Read<object>(()=>throw new BridgeException("invalid_titleblock_change","Dependencies exceed the supported evidence bound."),_=>false);
            if(result.Supported||result.Value is not null||result.ErrorCode!="invalid_titleblock_change"||result.Error!="Dependencies exceed the supported evidence bound."||result.Partial)throw new Exception("Bounded read failure changed.");
        });
        test("titleblock readonly evidence propagates unexpected errors other bridge errors and cancellation",()=>{
            foreach(var expected in new Exception[]{new InvalidOperationException("unexpected defect"),new BridgeException("unrelated_error","not this reader"),new OperationCanceledException("cancelled")})
            {
                try{TitleBlockReadPolicy.Read<object>(()=>throw expected,error=>error is OperationCanceledException);}
                catch(Exception actual)when(ReferenceEquals(actual,expected)){continue;}
                throw new Exception("Unknown error or cancellation was swallowed.");
            }
        });
        test("titleblock replacement readback follows the native result ID",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            TitleBlockChangeReadbackRules.Require(expected,new TitleBlockChangeReadback(10,42,20,30,true),false,true);
            RejectReadback(()=>TitleBlockChangeReadbackRules.Require(expected,new TitleBlockChangeReadback(10,10,20,30,false),true,true));
            RejectReadback(()=>TitleBlockChangeReadbackRules.Require(expected,new TitleBlockChangeReadback(10,42,20,30,true),true,true));
        });
        test("titleblock no-op readback retains the original ID",()=>
        {
            var expected=new TitleBlockChangeReadback(10,10,20,30,false);
            TitleBlockChangeReadbackRules.Require(expected,new TitleBlockChangeReadback(10,10,20,30,false),true,true);
            RejectReadback(()=>TitleBlockChangeReadbackRules.Require(expected,new TitleBlockChangeReadback(10,42,20,30,true),false,true));
        });
        test("titleblock replacement exempts only its missing original self reference while reporting raw absence",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            long[] reviewed=[10];
            var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,reviewed,id=>id==42);
            Ids(result.RequiredDependentElementIds);
            Ids(result.ExemptOriginalSelfReferenceIds,10);
            Ids(result.MissingDependentElementIds);
            Ids(reviewed,10);
            if(!result.Verified||result.AllOriginalDependentIdsStillExist)throw new Exception("Replacement confused required preservation with raw self existence.");
            TitleBlockChangeReadbackRules.Require(expected,expected,false,result.Verified);
            RejectReadback(()=>TitleBlockChangeReadbackRules.Require(expected,expected,false,result.AllOriginalDependentIdsStillExist));
        });
        test("titleblock replacement preserves every real dependent and the reviewed list order",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            long[] reviewed=[60,10,50];
            var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,reviewed,id=>id is 42 or 50 or 60);
            Ids(result.RequiredDependentElementIds,60,50);
            Ids(result.ExemptOriginalSelfReferenceIds,10);
            Ids(result.MissingDependentElementIds);
            Ids(reviewed,60,10,50);
            if(!result.Verified||result.AllOriginalDependentIdsStillExist)throw new Exception("Real dependency retention was not distinguished from old self absence.");
            TitleBlockChangeReadbackRules.Require(expected,expected,false,result.Verified);
        });
        test("titleblock replacement never exempts another missing dependent",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            foreach(var missing in new long[]{50,60})
            {
                var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,new long[]{10,50,60},id=>id==42||id!=10&&id!=missing);
                Ids(result.RequiredDependentElementIds,50,60);
                Ids(result.ExemptOriginalSelfReferenceIds,10);
                Ids(result.MissingDependentElementIds,missing);
                if(result.Verified||result.AllOriginalDependentIdsStillExist)throw new Exception("A deleted real dependent was accepted.");
                RejectReadback(()=>TitleBlockChangeReadbackRules.Require(expected,expected,false,result.Verified));
            }
        });
        test("titleblock in-place and no-op dependency checks retain the original self",()=>
        {
            var expected=new TitleBlockChangeReadback(10,10,20,30,false);
            var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,new long[]{10,50},id=>id is 10 or 50);
            Ids(result.RequiredDependentElementIds,10,50);
            Ids(result.ExemptOriginalSelfReferenceIds);
            Ids(result.MissingDependentElementIds);
            if(!result.Verified||!result.AllOriginalDependentIdsStillExist)throw new Exception("An unchanged self dependency was misclassified.");
            TitleBlockChangeReadbackRules.Require(expected,expected,true,result.Verified);
            RejectReadback(()=>TitleBlockChangeReadbackRules.InspectDependencies(expected,new long[]{10,50},id=>id==50));
        });
        test("titleblock in-place dependency checks reject deleted real dependents without self exemption",()=>
        {
            var expected=new TitleBlockChangeReadback(10,10,20,30,false);
            var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,new long[]{50},id=>id==10);
            Ids(result.RequiredDependentElementIds,50);
            Ids(result.ExemptOriginalSelfReferenceIds);
            Ids(result.MissingDependentElementIds,50);
            if(result.Verified||result.AllOriginalDependentIdsStillExist)throw new Exception("Missing in-place dependent was hidden.");
            RejectReadback(()=>TitleBlockChangeReadbackRules.Require(expected,expected,true,result.Verified));
        });
        test("titleblock dependency checks require actual old removal and new result existence",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            RejectReadback(()=>TitleBlockChangeReadbackRules.InspectDependencies(expected,Array.Empty<long>(),_=>true));
            RejectReadback(()=>TitleBlockChangeReadbackRules.InspectDependencies(expected,Array.Empty<long>(),_=>false));
            RejectReadback(()=>TitleBlockChangeReadbackRules.InspectDependencies(new(10,42,20,30,false),Array.Empty<long>(),_=>true));
            RejectReadback(()=>TitleBlockChangeReadbackRules.InspectDependencies(new(10,10,20,30,true),Array.Empty<long>(),_=>false));
        });
        test("titleblock empty and non-self dependency lists preserve their exact meaning",()=>
        {
            foreach(var replaced in new[]{false,true})
            {
                var expected=new TitleBlockChangeReadback(10,replaced?42:10,20,30,replaced);
                bool Exists(long id)=>replaced?id!=10:true;
                foreach(var reviewed in new long[][]{Array.Empty<long>(),[50,60]})
                {
                    var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,reviewed,Exists);
                    Ids(result.RequiredDependentElementIds,reviewed);
                    Ids(result.ExemptOriginalSelfReferenceIds);
                    Ids(result.MissingDependentElementIds);
                    if(!result.Verified||!result.AllOriginalDependentIdsStillExist)throw new Exception("Empty or non-self evidence acquired a fabricated missing self.");
                    TitleBlockChangeReadbackRules.Require(expected,expected,!replaced,result.Verified);
                }
            }
        });
        test("titleblock dependency inspection caches each native existence read only within one call",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            var reads=new Dictionary<long,int>();
            bool Exists(long id){reads[id]=reads.GetValueOrDefault(id)+1;return id!=10;}
            var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,new long[]{10,42,50},Exists);
            Ids(result.RequiredDependentElementIds,42,50);
            if(!result.Verified||reads.Count!=3||reads.Values.Any(count=>count!=1))throw new Exception("One snapshot read the same ID inconsistently more than once.");
            TitleBlockChangeReadbackRules.InspectDependencies(expected,new long[]{10,42,50},Exists);
            if(reads.Values.Any(count=>count!=2))throw new Exception("Existence cache leaked into a later verification stage.");
        });
        test("titleblock real dependency loss is re-read and rejected at before or after commit stages",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            foreach(var lossStage in new[]{1,2})
            {
                var present=new HashSet<long>{42,50};
                for(var stage=0;stage<3;stage++)
                {
                    if(stage==lossStage)present.Remove(50);
                    var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,new long[]{10,50},present.Contains);
                    if(stage<lossStage)
                    {
                        if(!result.Verified)throw new Exception("An existing real dependent was rejected before its loss.");
                        TitleBlockChangeReadbackRules.Require(expected,expected,false,result.Verified);
                    }
                    else
                    {
                        Ids(result.MissingDependentElementIds,50);
                        if(result.Verified)throw new Exception("A later stage reused earlier true existence evidence.");
                        RejectReadback(()=>TitleBlockChangeReadbackRules.Require(expected,expected,false,result.Verified));
                    }
                }
            }
        });
        test("titleblock dependency snapshots neither mutate nor alias the reviewed input",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            long[] reviewed=[50,10];
            var result=TitleBlockChangeReadbackRules.InspectDependencies(expected,reviewed,id=>id!=10);
            Ids(reviewed,50,10);
            reviewed[0]=999;
            Ids(result.RequiredDependentElementIds,50);
            Ids(result.ExemptOriginalSelfReferenceIds,10);
        });
        test("titleblock dependency bounds reject null unsafe duplicate and oversized evidence before native reads",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            IReadOnlyList<long>[] invalid=[null!,new long[]{0},new long[]{-1},new long[]{9007199254740992},new long[]{50,50},Enumerable.Range(100,1001).Select(x=>(long)x).ToArray()];
            foreach(var reviewed in invalid)
            {
                var reads=0;
                RejectReadback(()=>TitleBlockChangeReadbackRules.InspectDependencies(expected,reviewed,_=>{reads++;return true;}));
                if(reads!=0)throw new Exception("Invalid dependency input contacted native existence reads.");
            }
            RejectReadback(()=>TitleBlockChangeReadbackRules.InspectDependencies(expected,Array.Empty<long>(),null!));
            var bounded=Enumerable.Range(100,1000).Select(x=>(long)x).ToArray();
            var success=TitleBlockChangeReadbackRules.InspectDependencies(expected,bounded,id=>id!=10);
            if(!success.Verified||success.RequiredDependentElementIds.Length!=1000)throw new Exception("The reviewed1000-ID bound was rejected or truncated.");
        });
        test("titleblock dependency identity validation rejects unsafe IDs and inconsistent native replacement metadata",()=>
        {
            var valid=new TitleBlockChangeReadback(10,42,20,30,true);
            foreach(var invalid in new[]{valid with{OriginalInstanceId=0},valid with{ResultingInstanceId=-1},valid with{SheetId=9007199254740992},valid with{TargetTypeId=0},valid with{ResultingInstanceId=10},valid with{Replaced=false}})
            {
                var reads=0;
                RejectReadback(()=>TitleBlockChangeReadbackRules.InspectDependencies(invalid,Array.Empty<long>(),_=>{reads++;return true;}));
                if(reads!=0)throw new Exception("Malformed result identity was allowed to inspect native state.");
            }
            foreach(var changed in new[]{valid with{OriginalInstanceId=11},valid with{ResultingInstanceId=43},valid with{SheetId=21},valid with{TargetTypeId=31},valid with{Replaced=false}})
                RejectReadback(()=>TitleBlockChangeReadbackRules.Require(valid,changed,false,true));
        });
        test("titleblock dependency inspection propagates native read failures and cancellation unchanged",()=>
        {
            var expected=new TitleBlockChangeReadback(10,42,20,30,true);
            foreach(var failure in new Exception[]{new InvalidOperationException("native failure"),new BridgeException("unrelated_error","native detail"),new OperationCanceledException("cancelled")})
            {
                try{TitleBlockChangeReadbackRules.InspectDependencies(expected,new long[]{10,50},id=>id==50?throw failure:id!=10);}
                catch(Exception actual)when(ReferenceEquals(actual,failure)){continue;}
                throw new Exception("Unknown native failure was swallowed or replaced by guessed absence.");
            }
        });
    }

    private static void RejectReadback(Action action)
    {
        try{action();}catch(BridgeException error)when(error.Code=="invalid_documentation_readback"){return;}
        throw new Exception("Expected invalid_documentation_readback.");
    }

    private static void Ids(IReadOnlyList<long> actual,params long[] expected)
    {
        if(!actual.SequenceEqual(expected))throw new Exception("Dependency IDs changed: ["+string.Join(",",actual)+"] expected ["+string.Join(",",expected)+"].");
    }
}
