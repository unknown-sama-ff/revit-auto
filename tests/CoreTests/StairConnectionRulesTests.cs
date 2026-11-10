using System.Text.Json;
using RevitAutoV27;

internal static class StairConnectionRulesTests
{
    static JsonElement J(string s) => JsonDocument.Parse(s).RootElement.Clone();
    static void Check(bool ok) { if (!ok) throw new Exception("Stair connection evidence differs."); }
    static void Reject(string code, Action call) { try { call(); } catch (BridgeException e) when (e.Code == code) { return; } throw new Exception("Expected " + code); }
    static StairConnectionRow Row(long a, long b, string at="ET_RunEnd", string bt="ET_Landing", long av=1, long bv=2) => new(a,b,at,av,bt,bv);
    static StairComponentConnections C(long id,string kind,StairConnectionRow[] rows,bool complete=true,string? error=null) => new(id,kind,99,complete,rows,error);
    static IEnumerable<StairConnectionRow> Partial() { yield return Row(1,2); throw new InvalidOperationException("native failed"); }

    public static void Run(Action<string,Action> test)
    {
        const string valid="""{"documentIdentity":"doc","expectedRevision":0,"stairId":99}""";
        test("stairs connections require exactly one safe explicit pinned stair",()=>{
            var r=StairConnectionRules.Parse(J(valid));Check(r.StairId==99&&r.ExpectedRevision==0&&r.DocumentIdentity=="doc");
            foreach(var s in new[]{"null","{}",valid.Replace("\"stairId\":99","\"stairId\":0"),valid.Replace("\"stairId\":99","\"stairId\":9007199254740992"),valid.Replace("\"expectedRevision\":0,",""),valid.Replace("\"expectedRevision\":0","\"expectedRevision\":0.5"),valid.Replace("\"doc\"","\" \""),valid.Replace("\"stairId\":99","\"stairId\":99,\"code\":\"x\""),valid.Replace("\"stairId\":99","\"stairId\":99,\"stairId\":99")})Reject("invalid_stairs_connections_request",()=>StairConnectionRules.Parse(J(s)));
        });
        test("native stairs reciprocal run landing rows preserve duplicates and inputs",()=>{
            var a=Row(1,2);var b=Row(2,1,"ET_Landing","ET_RunEnd",2,1);var rows=new[]{C(2,"landing",[b]),C(1,"run",[a])};
            var before=JsonSerializer.Serialize(rows);var g=StairConnectionRules.Analyze(99,rows);
            Check(g.EnumerationComplete&&g.ReciprocityStatus=="verified"&&g.Issues.Length==0&&g.IsolatedComponentIds.Length==0);Check(before==JsonSerializer.Serialize(rows));
            var duplicate=StairConnectionRules.Analyze(99,[C(1,"run",[a,a]),C(2,"landing",[b])]);Check(duplicate.ReciprocityStatus=="inconsistent"&&duplicate.Issues.Any(i=>i.Code=="duplicate_connection"));
        });
        test("known empty stair components are isolated while unknown is never disconnected",()=>{
            var g=StairConnectionRules.Analyze(99,[C(1,"run",[])]);Check(g.EnumerationComplete&&g.ReciprocityStatus=="verified"&&g.IsolatedComponentIds.SequenceEqual([1L]));
            var partial=StairConnectionRules.Analyze(99,[C(1,"run",[],false,"native failed"),C(2,"landing",[])]);Check(!partial.EnumerationComplete&&partial.ReciprocityStatus=="unknown"&&partial.IsolatedComponentIds.SequenceEqual([2L]));
        });
        test("native stair relation membership does not assume getter-relative record orientation",()=>{
            var row=Row(1,2);var members=new[]{C(1,"run",[row]),C(2,"landing",[row])};
            var before=JsonSerializer.Serialize(members);var g=StairConnectionRules.Analyze(99,members);
            Check(g.ReciprocityStatus=="verified"&&g.Issues.Length==0&&before==JsonSerializer.Serialize(members));
        });
        test("stairs graph reports wrong self external endpoint and one-sided evidence",()=>{
            foreach(var rows in new[]{new[]{C(1,"run",[Row(1,1)])},new[]{C(1,"run",[Row(1,9)])},new[]{C(1,"run",[Row(1,2)]),C(2,"landing",[])},new[]{C(1,"run",[Row(1,2,"ET_Landing")]),C(2,"landing",[])},new[]{C(1,"run",[Row(3,2)]),C(2,"landing",[])},new[]{C(1,"run",[Row(1,2,"ET_RunEnd","ET_RunStart")]),C(2,"run",[Row(2,1,"ET_RunStart","ET_RunEnd")])}}){var g=StairConnectionRules.Analyze(99,rows);Check(g.EnumerationComplete&&g.ReciprocityStatus=="inconsistent"&&g.Issues.Length>0);}
        });
        test("future native stair endpoint types remain unknown even with reciprocal rows",()=>{
            var g=StairConnectionRules.Analyze(99,[C(1,"run",[Row(1,2,"future-end","ET_Landing",8,2)]),C(2,"landing",[Row(2,1,"ET_Landing","future-end",2,8)])]);
            Check(g.EnumerationComplete&&g.ReciprocityStatus=="unknown"&&g.Issues.Any(i=>i.Code=="endpoint_type_unknown"));
        });
        test("stairs graph requires reverse endpoint types and numeric native enum values",()=>{
            var g=StairConnectionRules.Analyze(99,[C(1,"run",[Row(1,2)]),C(2,"landing",[Row(2,1,"ET_Landing","ET_RunStart",2,0)])]);Check(g.Issues.Any(i=>i.Code=="missing_reverse_connection"));
            var wrongValue=StairConnectionRules.Analyze(99,[C(1,"run",[Row(1,2)]),C(2,"landing",[Row(2,1,"ET_Landing","ET_RunEnd",2,8)])]);Check(wrongValue.ReciprocityStatus=="inconsistent");
        });
        test("stairs graph rejects invalid membership unsafe IDs and contradictory completeness",()=>{
            foreach(var rows in new[]{new[]{C(1,"run",[]),C(1,"run",[])},new[]{C(0,"run",[])},new[]{C(1,"other",[])},new[]{new StairComponentConnections(1,"run",98,true,[],null)},new[]{C(1,"run",[],false)},new[]{C(1,"run",[],true,"bad")},new[]{C(1,"run",[Row(1,0)])}})Reject("stairs_connections_invalid_native_evidence",()=>StairConnectionRules.Analyze(99,rows));
        });
        test("stair bounded reader retains partial records and explicit unknown failures",()=>{
            int total=0;var p=StairConnectionRules.ReadConnections(Partial,()=>{},ref total);Check(!p.Complete&&p.Records.Length==1&&total==1&&p.Error!.Contains("native failed"));
            var empty=StairConnectionRules.ReadConnections(()=>Array.Empty<StairConnectionRow>(),()=>{},ref total);Check(empty.Complete&&empty.Records.Length==0&&empty.Error is null);
            var missing=StairConnectionRules.ReadConnections(()=>null,()=>{},ref total);Check(!missing.Complete&&missing.Error is not null);
        });
        test("stair reader propagates cancellation pin failures and stops at total budget",()=>{
            int total=0;try{StairConnectionRules.ReadConnections(()=>throw new OperationCanceledException(),()=>{},ref total);throw new Exception();}catch(OperationCanceledException){}
            Reject("document_changed",()=>StairConnectionRules.ReadConnections(()=>Array.Empty<StairConnectionRow>(),()=>throw new BridgeException("document_changed","pin"),ref total));
            total=StairConnectionRules.MaxConnections;Reject("stairs_connections_limit_exceeded",()=>StairConnectionRules.ReadConnections(()=>new[]{Row(1,2)},()=>{},ref total));
            Reject("stairs_connections_limit_exceeded",()=>StairConnectionRules.Analyze(99,Enumerable.Range(1,StairConnectionRules.MaxComponents+1).Select(i=>C(i,"run",[])).ToArray()));
        });
        test("stair unknown error is wire bounded and null remains explicitly serialized",()=>{
            int total=0;var p=StairConnectionRules.ReadConnections(()=>throw new Exception(new string('x',5000)),()=>{},ref total);Check(p.Error!.Length<=1200);
            var value=NativeReadSnapshot.Freeze(C(1,"run",[]));Check(value.GetProperty("error").ValueKind==JsonValueKind.Null);
            Reject("stairs_connections_response_too_large",()=>StairConnectionRules.RequireResponseBudget(new string('x',StairConnectionRules.MaxResponseBytes)));
        });
    }
}
