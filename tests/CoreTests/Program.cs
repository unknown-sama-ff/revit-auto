using System.Text.Json;
using RevitAutoV27;

int tests = 0;
void Test(string name, Action action) { action(); tests++; Console.WriteLine("PASS " + name); }
JsonElement Json(string s) => JsonDocument.Parse(s).RootElement.Clone();
void Throws(string code, Action action) { try { action(); } catch (BridgeException e) when (e.Code == code) { return; } throw new Exception("Expected " + code); }
var valid = Json("""[{"operationType":"create_level","id":"level1","name":"AI Level","elevationMm":0},{"operationType":"create_grid","id":"grid1","start":{"xMm":0,"yMm":0},"end":{"xMm":3000,"yMm":0}}]""");
Test("valid read-only plan data", () => { if (PlanRules.Validate(valid).Count != 2) throw new Exception(); });
Test("arbitrary code not supported", () => Throws("unsupported_operation", () => PlanRules.Validate(Json("""[{"operationType":"send_code_to_revit","code":"bad"}]"""))));
Test("missing geometry rejected", () => Throws("invalid_number", () => PlanRules.Validate(Json("""[{"operationType":"create_grid","start":{"yMm":0},"end":{"xMm":1,"yMm":0}}]"""))));
Test("coordinate strings rejected", () => Throws("invalid_number", () => PlanRules.Validate(Json("""[{"operationType":"create_level","name":"a","elevationMm":"3000"}]"""))));
Test("forward references rejected", () => Throws("invalid_reference", () => PlanRules.Validate(Json("""[{"operationType":"set_parameter","elementId":"@later","parameter":"a","value":"b"}]"""))));
Test("duplicate operation ids rejected", () => Throws("invalid_operation_id", () => PlanRules.Validate(Json("""[{"operationType":"create_level","id":"a","name":"A","elevationMm":0},{"operationType":"create_level","id":"a","name":"B","elevationMm":3000}]"""))));
Test("existing symbol id required or exact family/type", () => Throws("missing_field", () => PlanRules.Validate(Json("""[{"operationType":"create_family_instance","xMm":0,"yMm":0}]"""))));
Test("zero-valued connector index accepted", () => PlanRules.Validate(Json("""[{"operationType":"connect_elements","firstElementId":1,"secondElementId":2,"firstConnectorId":0,"secondConnectorId":1}]""")));
Test("negative connector index rejected", () => Throws("invalid_connector", () => PlanRules.Validate(Json("""[{"operationType":"connect_elements","firstElementId":1,"secondElementId":2,"firstConnectorId":-1}]"""))));
Test("prior level reference accepted", () => PlanRules.Validate(Json("""[{"operationType":"create_level","id":"L","name":"L","elevationMm":0},{"operationType":"create_room","levelId":"@L","xMm":10,"yMm":10}]""")));
Test("explicit legacyPoint geometry is accepted as plan data", () => PlanRules.Validate(Json("""[{"operationType":"create_family_instance","symbolId":1,"levelId":311,"xMm":0,"yMm":0,"zMm":3000,"placementMode":"legacyPoint"}]""")));
Test("legacyPoint cannot attach a host implicitly", () => Throws("invalid_placement", () => PlanRules.Validate(Json("""[{"operationType":"create_family_instance","symbolId":1,"levelId":311,"xMm":0,"yMm":0,"placementMode":"legacyPoint","hostElementId":9}]"""))));
Test("unknown placement mode is rejected", () => Throws("invalid_placement", () => PlanRules.Validate(Json("""[{"operationType":"create_family_instance","symbolId":1,"levelId":311,"xMm":0,"yMm":0,"placementMode":"any"}]"""))));
Test("cancelled plan never executes", () => Throws("plan_not_pending", () => PlanLifecycle.ValidateConfirmation(new ModelPlan { DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[],Status="cancelled" }, "A",2,DateTime.UtcNow)));
Test("switch to different project rejected", () => Throws("stale_plan", () => PlanLifecycle.ValidateConfirmation(new ModelPlan { DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[] }, "B",2,DateTime.UtcNow)));
Test("edits after preview rejected", () => Throws("stale_plan", () => PlanLifecycle.ValidateConfirmation(new ModelPlan { DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[] }, "A",3,DateTime.UtcNow)));
Test("expiry enforced at the exact deadline", () => {
    var plan=new ModelPlan {DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[]};
    Throws("plan_expired", () => PlanLifecycle.ValidateConfirmation(plan,"A",2,plan.ExpiresAtUtc));
});
Test("committed plan receipt remains idempotent", () => PlanLifecycle.ValidateConfirmation(new ModelPlan { DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[],Status="committed" }, "A",3,DateTime.UtcNow));
Test("matching document/revision allowed", () => PlanLifecycle.ValidateConfirmation(new ModelPlan { DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[] }, "A",2,DateTime.UtcNow));
Test("plan preview requests only chat approval", () => {
    var plan = new ModelPlan { DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[] };
    var data=JsonSerializer.SerializeToElement(plan.View());
    if (data.GetProperty("confirmationMode").GetString() != "chat" || data.GetProperty("requiresRevitConfirmation").GetBoolean()) throw new Exception("Unexpected second confirmation requirement.");
    if (!data.GetProperty("requiresConfirmation").GetBoolean() || plan.Status != "pending") throw new Exception("Chat approval/preview safety removed.");
});
var nativeA = new NativeTestDocument();
var nativeB = new NativeTestDocument();
var sessions = new DocumentSessionRegistry<TestDocumentWrapper>((a,b) => a.Equals(b), d => d.Native.Open);
var firstWrapper = new TestDocumentWrapper(nativeA);
var firstSession = sessions.Get(firstWrapper);
Test("different wrapper references preserve native document identity", () => {
    for (int i=0; i<8; i++) if (sessions.Get(new TestDocumentWrapper(nativeA)).Id != firstSession.Id) throw new Exception("Document identity drifted.");
});
Test("active document equality uses native session, not wrapper reference", () => {
    if (!sessions.Same(firstWrapper, new TestDocumentWrapper(nativeA)) || sessions.Same(firstWrapper,new TestDocumentWrapper(nativeB))) throw new Exception("Wrong document equality guard.");
});
Test("same title/path in different open sessions has distinct identity", () => {
    if (sessions.Get(new TestDocumentWrapper(nativeB)).Id == firstSession.Id) throw new Exception("Sessions mixed.");
});
Test("DocumentChanged wrapper increments same revision without changing identity", () => {
    sessions.Changed(new TestDocumentWrapper(nativeA));
    var current = sessions.Get(new TestDocumentWrapper(nativeA));
    if (current.Id != firstSession.Id || current.Revision != 1) throw new Exception("Revision state lost.");
});
Test("cancelled or failed closing preserves identity and revision", () => {
    sessions.Closed(false);
    var current=sessions.Get(new TestDocumentWrapper(nativeA));
    if (current.Id != firstSession.Id || current.Revision != 1) throw new Exception("Cancelled closing retired session.");
});
Test("successful close/reopen issues new identity even for same path", () => {
    var oldId=firstSession.Id; nativeA.Open=false; sessions.Closed(true);
    var reopened=sessions.Get(new TestDocumentWrapper(new NativeTestDocument()));
    if (reopened.Id == oldId || reopened.Revision != 0) throw new Exception("Reopened session reused state.");
});
Test("closed wrappers cannot register or compare as active document", () => {
    if (sessions.Same(firstWrapper,firstWrapper)) throw new Exception("Invalid document treated as active.");
    try {sessions.Get(firstWrapper);} catch(InvalidOperationException){return;} throw new Exception("Invalid document registered.");
});
Test("switching A/B/A preserves identities independently", () => {
    var a = new NativeTestDocument();var b = new NativeTestDocument();
    var sa=sessions.Get(new TestDocumentWrapper(a));var sb=sessions.Get(new TestDocumentWrapper(b));
    if (sa.Id == sb.Id || sessions.Get(new TestDocumentWrapper(a)).Id != sa.Id) throw new Exception("Project switch replaced identity.");
});
Test("late execution failure is distinguished from preview rejection", () => {
    var progress=new ExecutionProgress();
    progress.Begin(1);progress.Complete();progress.Begin(2);progress.Complete();progress.Begin(3);
    if (progress.CompletedOperationCount != 2 || progress.FailedOperationIndex != 3) throw new Exception("Failure progress missing.");
});
Test("commit phase failure does not name an already completed operation", () => {
    var progress=new ExecutionProgress();progress.Begin(1);progress.Complete();
    if (progress.CompletedOperationCount != 1 || progress.FailedOperationIndex is not null) throw new Exception("Commit failure misclassified.");
});
Test("physical connected/disconnected status remains explicit", () => {
    var connected=ConnectorReadPolicy.ConnectionStatus(() => true,_ => false);
    var disconnected=ConnectorReadPolicy.ConnectionStatus(() => false,_ => false);
    if (!connected.Supported || connected.Connected != true || !disconnected.Supported || disconnected.Connected != false) throw new Exception("Connection status was changed.");
});
Test("unsupported connector property is unknown, not disconnected", () => {
    var result=ConnectorReadPolicy.ConnectionStatus(() => throw new NotSupportedException("PhysicalConn only"),e => e is NotSupportedException);
    if (result.Supported || result.Connected is not null || result.Error != "PhysicalConn only") throw new Exception("Unsupported property was guessed.");
});
Test("unsupported coordinate/status properties remain unknown", () => {
    var result=ConnectorReadPolicy.TryRead<ConnectorPoint>(() => throw new NotSupportedException("Origin is available only for PhysicalConn"),e => e is NotSupportedException);
    if (result.Supported || result.Value is not null || result.Error is null) throw new Exception("Unsupported connector property was guessed.");
});
Test("unexpected connector errors are not suppressed", () => {
    try {ConnectorReadPolicy.ConnectionStatus(() => throw new ArgumentException("invalid connector"),e => e is NotSupportedException);}
    catch(ArgumentException){return;} throw new Exception("Unexpected API error was hidden.");
});
Test("change journal explains intervening transactions and exact element ids", () => {
    var journal=new DocumentChangeJournal();journal.Record(1,"TransactionCommitted",["注释写入"],[],[2290242],[]);journal.Record(2,"TransactionCommitted",["视图设置"],[],[770796],[]);
    var value=JsonSerializer.SerializeToElement(journal.Since(1,2));
    if(!value.GetProperty("historyComplete").GetBoolean()||value.GetProperty("changes")[0].GetProperty("ModifiedElementIds")[0].GetInt64()!=770796)throw new Exception("Change diagnosis missing.");
});
Test("bounded journal reports missing history instead of asserting unchanged", () => {
    var journal=new DocumentChangeJournal(2);for(int i=1;i<=3;i++)journal.Record(i,"TransactionCommitted",["t"],[],[i],[]);
    var value=JsonSerializer.SerializeToElement(journal.Since(0,3));if(value.GetProperty("historyComplete").GetBoolean())throw new Exception("Incomplete journal claimed complete.");
});
Test("change journal caps element payload while preserving real counts", () => {
    var journal=new DocumentChangeJournal(4,2);journal.Record(1,"Undo",["撤销"],[1,2,3],[],[]);
    var change=JsonSerializer.SerializeToElement(journal.Since(0,1)).GetProperty("changes")[0];
    if(change.GetProperty("AddedCount").GetInt32()!=3||change.GetProperty("AddedElementIds").GetArrayLength()!=2||!change.GetProperty("ElementIdsTruncated").GetBoolean())throw new Exception("Change truncation hidden.");
});
Test("a chat approval after 30 minutes still has a valid default preview", () => {
    var plan=new ModelPlan {DocumentIdentity="A",DocumentRevision=2,Summary="waiting for human chat",Operations=[]};
    PlanLifecycle.ValidateConfirmation(plan,"A",2,DateTime.UtcNow.AddMinutes(30));
});
Test("default human approval lifetime is two hours", () => {
    if (PlanLifetimePolicy.DefaultMinutes != 120) throw new Exception("Incorrect default lifetime.");
    var start=DateTime.UtcNow;var plan=new ModelPlan {DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[]};
    if((plan.ExpiresAtUtc-start).TotalMinutes is < 119.9 or > 120.1)throw new Exception("Default preview lifetime drifted.");
});
Test("legacy private config without TTL preserves the new default", () => {
    var settings=JsonSerializer.Deserialize<BridgeSettings>("""{"port":8091,"token":"test-only-token"}""",JsonDefaults.Options)!;
    if(settings.PlanLifetimeMinutes!=120||settings.Port!=8091||settings.Token!="test-only-token")throw new Exception("Configuration fields changed.");
});
Test("explicit private lifetime config is honored", () => {
    var settings=JsonSerializer.Deserialize<BridgeSettings>("""{"port":8091,"token":"test-only-token","planLifetimeMinutes":45}""",JsonDefaults.Options)!;
    var now=DateTime.UtcNow;if((PlanLifetimePolicy.Expires(now,settings.PlanLifetimeMinutes)-now).TotalMinutes!=45)throw new Exception("Configured lifetime ignored.");
});
Test("preview lifetime bounds are enforced", () => {
    var now=DateTime.UtcNow;PlanLifetimePolicy.Expires(now,15);PlanLifetimePolicy.Expires(now,480);
    Throws("invalid_plan_lifetime",()=>PlanLifetimePolicy.Expires(now,14));Throws("invalid_plan_lifetime",()=>PlanLifetimePolicy.Expires(now,481));
});
Test("longer human waiting never bypasses revision invalidation", () => {
    var plan=new ModelPlan {DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[]};
    Throws("stale_plan",()=>PlanLifecycle.ValidateConfirmation(plan,"A",3,DateTime.UtcNow.AddMinutes(30)));
});
Test("cancelled longer-lived preview cannot execute", () => {
    var plan=new ModelPlan {DocumentIdentity="A",DocumentRevision=2,Summary="test",Operations=[],Status="cancelled"};
    Throws("plan_not_pending",()=>PlanLifecycle.ValidateConfirmation(plan,"A",2,DateTime.UtcNow.AddMinutes(30)));
});
Test("explicit reference-view configuration accepts known settings and paper point", () => PlanRules.Validate(Json("""[{"operationType":"configure_view","viewId":2,"referenceViewId":1,"settings":["viewRange","crop","discipline"],"discipline":"Electrical","viewportId":3,"paperPoint":{"xMm":420,"yMm":280,"zMm":0}}]""")));
Test("configuration refuses guessed empty settings", () => Throws("invalid_view_settings",()=>PlanRules.Validate(Json("""[{"operationType":"configure_view","viewId":2,"referenceViewId":1,"settings":[]}]"""))));
Test("configuration refuses duplicate or unknown settings", () => {
    foreach(var settings in new[]{"[\"crop\",\"crop\"]","[\"autoFixEverything\"]"})Throws("invalid_view_settings",()=>PlanRules.Validate(Json("[{\"operationType\":\"configure_view\",\"viewId\":2,\"referenceViewId\":1,\"settings\":"+settings+"}]")));
});
Test("recenter always requires an explicit viewport and paper XY", () => Throws("invalid_view_settings",()=>PlanRules.Validate(Json("""[{"operationType":"configure_view","viewId":2,"referenceViewId":1,"settings":["crop"],"viewportId":3}]"""))));
Test("paper coordinates reject nonzero model Z", () => Throws("invalid_view_settings",()=>PlanRules.Validate(Json("""[{"operationType":"configure_view","viewId":2,"referenceViewId":1,"settings":["crop"],"viewportId":3,"paperPoint":{"xMm":420,"yMm":280,"zMm":3000}}]"""))));
Test("discipline cannot be changed implicitly outside the selected settings", () => Throws("invalid_view_settings",()=>PlanRules.Validate(Json("""[{"operationType":"configure_view","viewId":2,"referenceViewId":1,"settings":["crop"],"discipline":"Electrical"}]"""))));
Test("configuration never silently ignores arbitrary parameter maps", () => Throws("invalid_view_settings",()=>PlanRules.Validate(Json("""[{"operationType":"configure_view","viewId":2,"referenceViewId":1,"settings":["crop"],"parameters":{"x":1}}]"""))));

Test("explicit project XY crop bounds accepted",()=>PlanRules.Validate(Json("""[{"operationType":"configure_view","viewId":2,"referenceViewId":1,"settings":["crop"],"cropBounds":{"min":{"xMm":32000,"yMm":16000},"max":{"xMm":38000,"yMm":22000}}}]""")));
Test("explicit crop requires selected crop setting",()=>Throws("invalid_crop_bounds",()=>ViewConfigurationRules.Settings(Json("""{"settings":["viewRange"],"cropBounds":{"min":{"xMm":32000,"yMm":16000},"max":{"xMm":38000,"yMm":22000}}}"""))));
Test("explicit crop rejects malformed shapes",()=>{foreach(var bounds in new[]{"null","[]","{}","{\"min\":{\"xMm\":0,\"yMm\":0}}"})Throws("invalid_crop_bounds",()=>ViewConfigurationRules.Settings(Json("{\"settings\":[\"crop\"],\"cropBounds\":"+bounds+"}")));});
Test("explicit crop rejects Z and unknown fields",()=>{foreach(var bounds in new[]{"{\"min\":{\"xMm\":0,\"yMm\":0,\"zMm\":0},\"max\":{\"xMm\":100,\"yMm\":100}}","{\"min\":{\"xMm\":0,\"yMm\":0},\"max\":{\"xMm\":100,\"yMm\":100},\"active\":false}"})Throws("invalid_crop_bounds",()=>ViewConfigurationRules.Settings(Json("{\"settings\":[\"crop\"],\"cropBounds\":"+bounds+"}")));});
Test("explicit crop rejects empty inverted and tiny rectangles",()=>{foreach(var maxX in new[]{-1,0,0.5})Throws("invalid_crop_bounds",()=>ViewConfigurationRules.Settings(Json("{\"settings\":[\"crop\"],\"cropBounds\":{\"min\":{\"xMm\":0,\"yMm\":0},\"max\":{\"xMm\":"+maxX.ToString(System.Globalization.CultureInfo.InvariantCulture)+",\"yMm\":100}}}")));});
Test("explicit crop rejects string and oversized coordinates",()=>{foreach(var x in new[]{"\"0\"","100000001"})Throws("invalid_number",()=>ViewConfigurationRules.Settings(Json("{\"settings\":[\"crop\"],\"cropBounds\":{\"min\":{\"xMm\":"+x+",\"yMm\":0},\"max\":{\"xMm\":100,\"yMm\":100}}}")));});

Console.WriteLine($"{tests} core validation/lifecycle tests passed.");

sealed class NativeTestDocument { public bool Open { get; set; } = true; }
sealed class TestDocumentWrapper(NativeTestDocument native)
{
    public NativeTestDocument Native { get; } = native;
    public override bool Equals(object? other) => other is TestDocumentWrapper wrapper && ReferenceEquals(Native,wrapper.Native);
    public override int GetHashCode() => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(Native);
}

