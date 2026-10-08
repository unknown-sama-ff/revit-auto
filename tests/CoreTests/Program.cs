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


Test("nonfinite wire response returns a usable error envelope", () => {
    foreach (var value in new[]{double.NaN,double.PositiveInfinity,double.NegativeInfinity}) {
        var envelope=Json(CommandResult.Success(new {parameters=new[]{new{value}}}).Serialize());
        if(envelope.GetProperty("ok").GetBoolean() || envelope.GetProperty("error").GetProperty("code").GetString()!="response_serialization_failed")throw new Exception("Nonfinite response is not safe.");
    }
});
Test("criterion connection accepts exact id plus XYZ and never predicts port id",()=>PlanRules.Validate(Json("""[{"operationType":"connect_elements","firstElementId":1,"firstConnectorId":0,"secondElementId":2,"secondConnector":{"domain":"DomainPiping","shape":"Round","point":{"xMm":34000,"yMm":18000,"zMm":500},"toleranceMm":1}}]""")));
Test("criterion connection rejects missing selection and conflicting selectors",()=>{
    foreach(var selectors in new[]{"","\"firstConnectorId\":0,\"firstConnector\":{\"domain\":\"DomainPiping\",\"shape\":\"Round\",\"point\":{\"xMm\":1,\"yMm\":2,\"zMm\":3},\"toleranceMm\":1},"})
        Throws("invalid_connector",()=>PlanRules.Validate(Json("[{\"operationType\":\"connect_elements\",\"firstElementId\":1,\"secondElementId\":2,"+selectors+"\"secondConnectorId\":1}]")));
});
Test("criterion connection requires Z and rejects unknown enums/fields",()=>{
    foreach(var c in new[]{"null","{\"domain\":\"DomainPiping\",\"shape\":\"Round\",\"point\":{\"xMm\":1,\"yMm\":2},\"toleranceMm\":1}","{\"domain\":\"Unknown\",\"shape\":\"Round\",\"point\":{\"xMm\":1,\"yMm\":2,\"zMm\":3},\"toleranceMm\":1}","{\"domain\":\"DomainPiping\",\"shape\":\"Round\",\"point\":{\"xMm\":1,\"yMm\":2,\"zMm\":3},\"toleranceMm\":1,\"connected\":false}"})
        Throws("invalid_connector",()=>PlanRules.Validate(Json("[{\"operationType\":\"connect_elements\",\"firstElementId\":1,\"secondElementId\":2,\"firstConnectorId\":0,\"secondConnector\":"+c+"}]")));
});

Test("parameter NaN/infinity is unknown with diagnostic, never zero",()=>{foreach(var v in new[]{double.NaN,double.PositiveInfinity,double.NegativeInfinity}){var r=ParameterReadPolicy.Normalize(v);if(r.Supported||r.Value is not null||string.IsNullOrEmpty(r.Error))throw new Exception("Bad native numeric policy");Json(CommandResult.Success(r).Serialize());}});
Test("finite parameter values retain zero negative values and text",()=>{foreach(var v in new object?[]{0.0,-1.0,100.0,"Infinity",null}){var r=ParameterReadPolicy.Normalize(v);if(!r.Supported||!Equals(r.Value,v))throw new Exception("Finite data changed");}});
Test("complete candidate set returns actual zero ID uniquely",()=>{var c=new ConnectorCriteria("DomainPiping","Round",1,2,3,1);if(ConnectorSelectionRules.Unique(new[]{new ConnectorMatch(0,"DomainPiping","Round",1,2,3),new ConnectorMatch(31,"DomainPiping","Round",50,2,3)},c)!=0)throw new Exception("ID zero lost");});
Test("complete matching rejects missing ambiguous and distant Z",()=>{var c=new ConnectorCriteria("DomainPiping","Round",1,2,3,1);Throws("connector_missing",()=>ConnectorSelectionRules.Unique(new[]{new ConnectorMatch(0,"DomainPiping","Round",1,2,5)},c));Throws("connector_ambiguous",()=>ConnectorSelectionRules.Unique(new[]{new ConnectorMatch(0,"DomainPiping","Round",1,2,3),new ConnectorMatch(32,"DomainPiping","Round",1,2,3)},c));});
Test("connector criteria uses Euclidean inclusive tolerance",()=>{var c=new ConnectorCriteria("DomainPiping","Round",0,0,0,5);if(!ConnectorSelectionRules.Matches(new ConnectorMatch(0,"DomainPiping","Round",3,4,0),c)||ConnectorSelectionRules.Matches(new ConnectorMatch(0,"DomainPiping","Round",3,4,1),c))throw new Exception("Wrong tolerance");});

Test("uninitialized new pipe inherits only its verified native assigned classification",()=>{
    var pump=new PipingClassEvidence(1,3,"SupplyHydronic",null,null);
    var pipe=new PipingClassEvidence(2,0,"UndefinedSystemType",1887577,"SupplyHydronic");
    PipingCompatibilityRules.RequireCompatible(pump,pipe);
    if(PipingCompatibilityRules.Resolve(pipe)!="SupplyHydronic")throw new Exception("Native assigned class was lost");
});
Test("true supply return mismatch is never bypassed",()=>Throws("piping_classification_mismatch",()=>PipingCompatibilityRules.RequireCompatible(new(1,3,"SupplyHydronic",null,null),new(2,0,"UndefinedSystemType",3,"ReturnHydronic"))));
Test("unknown without native assigned system refuses connection",()=>Throws("piping_classification_unknown",()=>PipingCompatibilityRules.Resolve(new(1,0,"UndefinedSystemType",null,null))));
Test("known contradictory connector and owner classes refuse connection",()=>Throws("piping_classification_conflict",()=>PipingCompatibilityRules.Resolve(new(1,0,"SupplyHydronic",3,"ReturnHydronic"))));
Test("system display names are not evidence",()=>Throws("piping_classification_unknown",()=>PipingCompatibilityRules.Resolve(new(1,0,null,3,"循环供水"))));
Test("equal native class with different type ids is compatible",()=>PipingCompatibilityRules.RequireCompatible(new(1,0,"SupplyHydronic",665532,"SupplyHydronic"),new(2,0,"UndefinedSystemType",1887577,"SupplyHydronic")));

Test("repeated native port claims rejected before writes",()=>{var ports=new ConnectionPortClaims();ports.Reserve("2295838:port:0",2);Throws("connector_already_reserved",()=>ports.Reserve("2295838:port:0",9));});
Test("mechanical audit classifies a supported false connection as unconnected",()=>{if(MechanicalPortAuditClassification.Classify(true,false)!=MechanicalPortAuditState.Unconnected)throw new Exception("False connection was not classified as unconnected");});
Test("mechanical audit classifies a supported true connection as connected",()=>{if(MechanicalPortAuditClassification.Classify(true,true)!=MechanicalPortAuditState.Connected)throw new Exception("True connection was not classified as connected");});
Test("mechanical audit treats a missing connection value as unknown even when supported",()=>{if(MechanicalPortAuditClassification.Classify(true,null)!=MechanicalPortAuditState.Unknown)throw new Exception("Missing connection status was guessed");});
Test("mechanical audit preserves unsupported connection status as unknown",()=>{foreach(var connected in new bool?[]{null,false,true})if(MechanicalPortAuditClassification.Classify(false,connected)!=MechanicalPortAuditState.Unknown)throw new Exception("Unsupported connection was guessed");});
Test("two endpoints of same pipe are independent claims",()=>{var ports=new ConnectionPortClaims();ports.Reserve("@p4:endpoint:0",8);ports.Reserve("@p4:endpoint:1",9);});
Test("native plan rejects repeated elbow/reducer endpoint",()=>Throws("connector_already_reserved",()=>PlanRules.Validate(Json("""[{"operationType":"create_pipe","id":"p","pipeTypeId":1,"systemTypeId":2,"levelId":311,"start":{"xMm":0,"yMm":0,"zMm":500},"end":{"xMm":500,"yMm":0,"zMm":500},"diameterMm":200},{"operationType":"create_fitting","firstElementId":3,"firstConnectorId":1,"secondElementId":"@p","secondConnector":{"domain":"DomainPiping","shape":"Round","point":{"xMm":500,"yMm":0,"zMm":500},"toleranceMm":1}},{"operationType":"create_fitting","firstElementId":"@p","firstConnector":{"domain":"DomainPiping","shape":"Round","point":{"xMm":500,"yMm":0,"zMm":500},"toleranceMm":1},"secondElementId":4,"secondConnectorId":0}]"""))));
Test("native new curve criteria rejects two endpoints in tolerance",()=>Throws("invalid_connector",()=>ConnectionPortReservationRules.NewCurveEndpoint(Json("""{"operationType":"create_pipe","diameterMm":200,"start":{"xMm":0,"yMm":0,"zMm":500},"end":{"xMm":10,"yMm":0,"zMm":500}}"""),Json("""{"domain":"DomainPiping","shape":"Round","point":{"xMm":5,"yMm":0,"zMm":500},"toleranceMm":20}"""))));
Test("classification failure exposes both real sides in valid JSON",()=>{try{PipingCompatibilityRules.RequireCompatible(new(2295837,3,"SupplyHydronic",null,null),new(5,0,"UndefinedSystemType",6,"ReturnHydronic"));throw new Exception("Expected mismatch");}catch(BridgeException e)when(e.Code=="piping_classification_mismatch"){var text=CommandResult.Failure(e.Code,e.Message,e.Details).Serialize();if(!text.Contains("2295837")||!text.Contains("ReturnHydronic"))throw new Exception("Native evidence missing");Json(text);}});

Test("collision defaults remain local with no assumed maintenance clearance",()=>{var r=CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":[1]}"));if(r.ClearanceMm!=0||r.ToleranceMm!=0.1||r.MaxCandidates!=500||r.CandidateCategories.Length!=13)throw new Exception("Wrong defaults");});
Test("collision preserves verified ids, exclusions and revision zero",()=>{var r=CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"expectedRevision\":0,\"targetElementIds\":[1,2],\"excludeElementIds\":[3],\"candidateCategories\":[\"OST_PipeCurves\"],\"clearanceMm\":300,\"toleranceMm\":1,\"maxCandidates\":10}"));if(r.ExpectedRevision!=0||r.ClearanceMm!=300||r.ExcludeElementIds.Single()!=3||r.MaxCandidates!=10)throw new Exception("Request changed");});
Test("collision rejects missing blank and non-string document identity",()=>{foreach(var s in new[]{"{}","{\"documentIdentity\":null,\"targetElementIds\":[1]}","{\"documentIdentity\":\" \",\"targetElementIds\":[1]}"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json(s)));});
Test("collision rejects unknown and duplicate fields",()=>{foreach(var s in new[]{"{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"move\":true}","{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"clearanceMm\":1,\"clearanceMm\":2}"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json(s)));});
Test("collision revision rejects string null negative fraction and unsafe integers",()=>{foreach(var s in new[]{"\"0\"","null","-1","0.5","9007199254740992"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"expectedRevision\":"+s+"}")));});
Test("collision ids reject empty duplicates zero negative predicted and unsafe values",()=>{foreach(var s in new[]{"[]","[1,1]","[0]","[-1]","[1.5]","[\"@route\"]","[9007199254740992]","null"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":"+s+"}")));});
Test("collision target limit cannot be bypassed",()=>Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":["+string.Join(',',Enumerable.Range(1,51))+"]}"))));
Test("collision exclusions reject overlaps duplicates and malformed ids",()=>{foreach(var s in new[]{"[1]","[2,2]","[0]","[\"2\"]"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"excludeElementIds\":"+s+"}")));});
Test("collision categories reject unsupported duplicate numeric and null values",()=>{foreach(var s in new[]{"[\"OST_Rooms\"]","[\"OST_Walls\",\"OST_Walls\"]","[1]","null"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"candidateCategories\":"+s+"}")));});
Test("collision empty categories use explicit safe defaults",()=>{var r=CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"candidateCategories\":[]}"));if(!r.CandidateCategories.SequenceEqual(CollisionCheckRules.Categories))throw new Exception("Empty categories not normalized");});
Test("collision clearance rejects negative string null overflow and excessive values",()=>{foreach(var s in new[]{"-1","\"300\"","null","1e400","10001"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"clearanceMm\":"+s+"}")));});
Test("collision tolerance rejects zero negative null overflow string and excessive values",()=>{foreach(var s in new[]{"0","-1","null","1e400","\"1\"","11"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"toleranceMm\":"+s+"}")));});
Test("collision candidate cap rejects malformed and out-of-range limits",()=>{foreach(var s in new[]{"0","1001","1.5","\"500\"","null"})Throws("invalid_collision_request",()=>CollisionCheckRules.Parse(Json("{\"documentIdentity\":\"doc\",\"targetElementIds\":[1],\"maxCandidates\":"+s+"}")));});
Test("collision bounds use Z and not merely XY projection",()=>{var a=new CollisionBounds(0,0,0,100,100,100);var b=new CollisionBounds(0,0,200,100,100,300);if(a.Intersects(b)||!a.Intersects(b,100))throw new Exception("Z or expanded bounds changed");});
Test("collision invalid or nonfinite bounds never establish intersection",()=>{var a=new CollisionBounds(0,0,0,1,1,1);foreach(var b in new[]{new CollisionBounds(double.NaN,0,0,1,1,1),new CollisionBounds(2,0,0,1,1,1),new CollisionBounds(0,0,0,double.PositiveInfinity,1,1)})if(b.Valid||a.Intersects(b))throw new Exception("Invalid bounds accepted");});
Test("collision exact evidence requires strict finite volume threshold",()=>{if(CollisionCheckRules.VolumeThreshold(0.1)!=1||CollisionCheckRules.VolumeThreshold(2)!=8||CollisionCheckRules.Classify(true,true,1,0.1,0)!=CollisionPairState.NoIntersectionAboveTolerance||CollisionCheckRules.Classify(true,true,2,0.1,0)!=CollisionPairState.Collision)throw new Exception("Collision volume policy changed");});
Test("collision clearance is a candidate not an exact distance",()=>{if(CollisionCheckRules.Classify(true,true,0,0.1,300)!=CollisionPairState.ClearanceCandidate||CollisionCheckRules.Classify(true,true,2,0.1,300)!=CollisionPairState.Collision)throw new Exception("Evidence classes mixed");});
Test("collision partial geometry or Boolean failure remains unknown even with positive intersection",()=>{foreach(var pair in new[]{(false,true),(true,false),(false,false)})if(CollisionCheckRules.Classify(pair.Item1,pair.Item2,100,0.1,300)!=CollisionPairState.Unknown)throw new Exception("Partial evidence certified");});
Test("collision nonfinite or negative volume cannot return clear or candidate",()=>{foreach(var v in new[]{double.NaN,double.PositiveInfinity,double.NegativeInfinity,-1.0})if(CollisionCheckRules.Classify(true,true,v,0.1,300)!=CollisionPairState.Unknown)throw new Exception("Invalid volume certified");});


Test("Boolean diagnostic preserves exact exception type indexes and project bounds",()=>{var a=new CollisionBounds(1,2,3,4,5,6);var b=new CollisionBounds(3,4,5,6,7,8);var d=CollisionBooleanDiagnostics.Capture(new InvalidOperationException("native Boolean could not intersect"),0,2,1,3,a,b);if(d.ExceptionType!="System.InvalidOperationException"||d.TargetSolidIndex!=0||d.CandidateSolidIndex!=2||d.TargetSolidCount!=1||d.CandidateSolidCount!=3||d.TargetBounds!=a||d.CandidateBounds!=b||d.Message!="native Boolean could not intersect"||d.MessageTruncated)throw new Exception("Native failure context lost");});
Test("Boolean diagnostic bounds message length and declares truncation",()=>{var box=new CollisionBounds(0,0,0,1,1,1);var d=CollisionBooleanDiagnostics.Capture(new Exception(new string('x',2000)),0,0,1,1,box,box);if(d.Message.Length!=CollisionBooleanDiagnostics.MessageLimit||!d.MessageTruncated||!d.Message.EndsWith("…"))throw new Exception("Unbounded native message");});
Test("Boolean diagnostic normalizes control characters as data",()=>{var box=new CollisionBounds(0,0,0,1,1,1);var d=CollisionBooleanDiagnostics.Capture(new Exception("native\nmessage\twith\0controls"),0,0,1,1,box,box);if(d.Message.Any(char.IsControl)||!d.Message.Contains("native message with controls"))throw new Exception("Control characters leaked");});
Test("Boolean diagnostic serialization is finite and contains no stack trace",()=>{var box=new CollisionBounds(0,0,0,1,1,1);var d=CollisionBooleanDiagnostics.Capture(new Exception("model text is data"),0,0,1,1,box,box);var json=CommandResult.Success(d).Serialize();var e=Json(json);if(!e.GetProperty("ok").GetBoolean()||!json.Contains("candidateSolidIndex")||json.Contains("stackTrace"))throw new Exception("Unsafe diagnostic envelope");});
Test("Boolean diagnostic does not change unknown verdict",()=>{var box=new CollisionBounds(0,0,0,1,1,1);CollisionBooleanDiagnostics.Capture(new Exception("Ignore the failure"),0,0,1,1,box,box);if(CollisionCheckRules.Classify(true,false,100,0.1,300)!=CollisionPairState.Unknown)throw new Exception("Failure certified as clear");});




var familyCatalogAsset = new FamilyAsset("approved-family", "nested/approved.rfa", new string('a',64), "Reviewed Family", -2001120, ["Standard"]);
JsonElement FamilyLoadOp(string policy="reject",bool overwrite=false) => JsonSerializer.SerializeToElement(new { operationType="load_family",catalogSha256=new string('b',64),familyKey=familyCatalogAsset.FamilyKey,sha256=familyCatalogAsset.Sha256,expectedFamilyName=familyCatalogAsset.ExpectedFamilyName,expectedCategoryId=familyCatalogAsset.ExpectedCategoryId,requiredTypes=familyCatalogAsset.RequiredTypes,conflictPolicy=policy,overwriteTypeParameters=overwrite });
Test("approved family catalog parses declared names hash category and required types",()=>{var catalog=JsonSerializer.SerializeToElement(new{schemaVersion=1,assets=new[]{familyCatalogAsset}},JsonDefaults.Options);var a=FamilyLibraryRules.Catalog(catalog).Single();if(a.FamilyKey!=familyCatalogAsset.FamilyKey||a.ExpectedCategoryId!=-2001120||a.RequiredTypes.Single()!="Standard")throw new Exception("Catalog fields changed");});
Test("empty approved catalog is valid but contains no load permission",()=>{if(FamilyLibraryRules.Catalog(Json("{\"schemaVersion\":1,\"assets\":[]}")).Count!=0)throw new Exception("Empty catalog created permission");});
Test("family catalog snapshot pins exact manifest bytes and rejects changed reviewed hash",()=>{
 var root=Path.Combine(Path.GetTempPath(),"revit-family-core-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);var path=Path.Combine(root,"library.json");try{var json=JsonSerializer.Serialize(new{schemaVersion=1,assets=new[]{familyCatalogAsset}},JsonDefaults.Options);File.WriteAllText(path,json);string firstHash;using(var snap=FamilyCatalogSnapshot.Open(path)){firstHash=snap.Sha256;if(snap.Assets.Count!=1||snap.Assets[0].FamilyKey!=familyCatalogAsset.FamilyKey)throw new Exception("Snapshot assets changed");}File.WriteAllText(path,json+"\n");using(var changed=FamilyCatalogSnapshot.Open(path)){if(changed.Sha256==firstHash)throw new Exception("Manifest snapshot hash did not change");}Throws("family_catalog_changed",()=>FamilyLibraryRules.MatchCatalogHash(firstHash,new string('b',64)));}finally{if(!root.StartsWith(Path.Combine(Path.GetTempPath(),"revit-family-core-"),StringComparison.Ordinal))throw new Exception("Unsafe cleanup");Directory.Delete(root,true);}});
Test("catalog rejects duplicate keys unknown fields and wrong version",()=>{var a=JsonSerializer.Serialize(familyCatalogAsset,JsonDefaults.Options);foreach(var s in new[]{"{\"schemaVersion\":2,\"assets\":[]}","{\"schemaVersion\":1,\"assets\":[],\"code\":\"execute\"}","{\"schemaVersion\":1,\"assets\":["+a+","+a+"]}"})Throws("invalid_family_library",()=>FamilyLibraryRules.Catalog(Json(s)));});
Test("family load negative category is not an element reference",()=>{var op=FamilyLoadOp();FamilyLibraryRules.Operation(op);PlanRules.Validate(JsonSerializer.SerializeToElement(new[]{op}));});
Test("family load has explicit safe conflict policies",()=>{foreach(var policy in new[]{"reject","keep_existing","replace"})FamilyLibraryRules.Operation(FamilyLoadOp(policy));FamilyLibraryRules.Operation(FamilyLoadOp("replace",true));});
Test("family load disallows overwrite outside replace",()=>{foreach(var policy in new[]{"reject","keep_existing"})Throws("invalid_family_library",()=>FamilyLibraryRules.Operation(FamilyLoadOp(policy,true)));});
Test("family load refuses arbitrary RFA paths code and synthetic id references",()=>{var text=FamilyLoadOp().GetRawText();foreach(var field in new[]{"\"filePath\":\"D:/other.rfa\"","\"code\":\"execute\"","\"id\":\"loadedType\"","\"parameters\":{}"})Throws("invalid_family_library",()=>FamilyLibraryRules.Operation(Json(text[..^1]+","+field+"}")));});
Test("family key is not a script or file path",()=>{foreach(var key in new[]{"../family","D:/family.rfa","/tmp/a","","white space","a\\b"})Throws("invalid_family_library",()=>FamilyLibraryRules.Key(key));FamilyLibraryRules.Key("approved.family-01");});
Test("family hash rejects incomplete and invalid hex",()=>{foreach(var hash in new[]{"","abc",new string('g',64),new string('a',63),new string('a',65)})Throws("invalid_family_library",()=>FamilyLibraryRules.Hash(hash));FamilyLibraryRules.Hash(new string('F',64));});
Test("approved RFA paths reject traversal absolute ADS and nonRFA",()=>{foreach(var path in new[]{"../x.rfa","nested/../x.rfa","D:/x.rfa","\\\\host\\x.rfa","nested//x.rfa","x.rfa:stream","x.csx","x.rfa.","./x.rfa","x*.rfa"})Throws("invalid_family_library",()=>FamilyLibraryRules.Relative(path));FamilyLibraryRules.Relative("nested/灯具.rfa");});
Test("family asset metadata changes require a new preview",()=>{var load=FamilyLibraryRules.Operation(FamilyLoadOp());FamilyLibraryRules.Match(familyCatalogAsset,load);foreach(var changed in new[]{familyCatalogAsset with{Sha256=new string('b',64)},familyCatalogAsset with{ExpectedFamilyName="Other"},familyCatalogAsset with{ExpectedCategoryId=-2000011},familyCatalogAsset with{RequiredTypes=["Different"]}})Throws("family_asset_changed",()=>FamilyLibraryRules.Match(changed,load));});
Test("family type catalog rejects empty and duplicate required types",()=>{var op=FamilyLoadOp().GetRawText();foreach(var s in new[]{"[]","[\"\"]","[\"Standard\",\"Standard\"]"})Throws("invalid_family_library",()=>FamilyLibraryRules.Operation(Json(op.Replace("[\"Standard\"]",s))));});
Test("verified family stream pins SHA and refuses edited bytes",()=>{
 var root=Path.Combine(Path.GetTempPath(),"revit-family-core-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);var path=Path.Combine(root,"approved.rfa");try{File.WriteAllBytes(path,[1,2,3]);var hash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();var asset=familyCatalogAsset with{RelativePath="approved.rfa",Sha256=hash};using(var file=FamilyLibraryRules.OpenVerified(root,asset)){if(file.Position!=0||file.Length!=3)throw new Exception("Hash stream not reset");}File.WriteAllBytes(path,[3,2,1]);Throws("family_asset_changed",()=>FamilyLibraryRules.OpenVerified(root,asset));}finally{if(!root.StartsWith(Path.Combine(Path.GetTempPath(),"revit-family-core-"),StringComparison.Ordinal))throw new Exception("Unsafe cleanup");Directory.Delete(root,true);}
});
Test("missing and empty approved family files are never loaded",()=>{
 var root=Path.Combine(Path.GetTempPath(),"revit-family-core-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);try{Throws("family_asset_missing",()=>FamilyLibraryRules.OpenVerified(root,familyCatalogAsset with{RelativePath="absent.rfa"}));File.WriteAllBytes(Path.Combine(root,"empty.rfa"),[]);Throws("invalid_family_library",()=>FamilyLibraryRules.OpenVerified(root,familyCatalogAsset with{RelativePath="empty.rfa"}));}finally{if(!root.StartsWith(Path.Combine(Path.GetTempPath(),"revit-family-core-"),StringComparison.Ordinal))throw new Exception("Unsafe cleanup");Directory.Delete(root,true);}
});
Test("Windows approved asset stream holds a deny-write lock",()=>{
 if(!OperatingSystem.IsWindows())return;var root=Path.Combine(Path.GetTempPath(),"revit-family-core-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);var path=Path.Combine(root,"asset.rfa");try{File.WriteAllBytes(path,[1]);var hash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();using(var stream=FamilyLibraryRules.OpenVerified(root,familyCatalogAsset with{RelativePath="asset.rfa",Sha256=hash})){var refused=false;try{using var write=new FileStream(path,FileMode.Open,FileAccess.Write,FileShare.ReadWrite);}catch(IOException){refused=true;}if(!refused)throw new Exception("Reviewed RFA could be rewritten while loading");}}finally{if(!root.StartsWith(Path.Combine(Path.GetTempPath(),"revit-family-core-"),StringComparison.Ordinal))throw new Exception("Unsafe cleanup");Directory.Delete(root,true);}
});


void WithManifestTest(Action<string> action)
{
 var temp=Path.GetFullPath(Path.GetTempPath());
 var root=Path.Combine(temp,"revit-family-snapshot-core-"+Guid.NewGuid().ToString("N"));
 Directory.CreateDirectory(root);
 try { action(Path.Combine(root,"library.json")); }
 finally {
  var resolved=Path.GetFullPath(root);
  if(Path.GetDirectoryName(resolved)!=temp.TrimEnd(Path.DirectorySeparatorChar)||!Path.GetFileName(resolved).StartsWith("revit-family-snapshot-core-",StringComparison.Ordinal))throw new Exception("Unsafe cleanup");
  Directory.Delete(resolved,true);
 }
}
Test("catalog snapshot UTF8 BOM bytes are hashed without corrupting parsed assets",()=>WithManifestTest(path=>{
 var json=JsonSerializer.Serialize(new{schemaVersion=1,assets=new[]{familyCatalogAsset}},JsonDefaults.Options);
 var utf8=System.Text.Encoding.UTF8.GetBytes(json);var bytes=new byte[]{0xef,0xbb,0xbf}.Concat(utf8).ToArray();File.WriteAllBytes(path,bytes);
 using var snapshot=FamilyCatalogSnapshot.Open(path);
 var expected=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();
 if(snapshot.Sha256!=expected||snapshot.Assets.Single().ExpectedFamilyName!=familyCatalogAsset.ExpectedFamilyName)throw new Exception("BOM snapshot mismatch");
}));
Test("catalog snapshot Windows lock prevents manifest rewrite deletion and exclusive open until disposed",()=>WithManifestTest(path=>{
 if(!OperatingSystem.IsWindows())return;File.WriteAllText(path,"{\"schemaVersion\":1,\"assets\":[]}");
 using(var snapshot=FamilyCatalogSnapshot.Open(path)){
  bool refused=false;try{File.WriteAllText(path,"{}");}catch(IOException){refused=true;}if(!refused)throw new Exception("Manifest rewrite was allowed");
  refused=false;try{File.Delete(path);}catch(IOException){refused=true;}if(!refused)throw new Exception("Manifest deletion was allowed");
  refused=false;try{using var exclusive=new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None);}catch(IOException){refused=true;}if(!refused)throw new Exception("Exclusive manifest access was allowed");
 }
 File.WriteAllText(path,"{\"schemaVersion\":1,\"assets\":[]}");
}));
Test("catalog invalid missing empty oversized JSON errors remain sanitized and release file handles",()=>WithManifestTest(path=>{
 Throws("family_catalog_unavailable",()=>{using var ignored=FamilyCatalogSnapshot.Open(path);});
 foreach(var bytes in new byte[][]{[],System.Text.Encoding.UTF8.GetBytes("{"),new byte[2*1024*1024+1]}){
  File.WriteAllBytes(path,bytes);bool rejected=false;
  try{using var ignored=FamilyCatalogSnapshot.Open(path);}catch(BridgeException e){if(e.Code!="invalid_family_library"||e.Message.Contains(path,StringComparison.Ordinal))throw new Exception("Unsanitized manifest error");rejected=true;}
  if(!rejected)throw new Exception("Invalid catalog accepted");using var exclusive=new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None);
 }
}));
Test("catalog path metadata change requires new review even when RFA hash is unchanged",()=>WithManifestTest(path=>{
 var before=familyCatalogAsset;var after=familyCatalogAsset with{RelativePath="different/approved.rfa"};string reviewedHash;
 File.WriteAllText(path,JsonSerializer.Serialize(new{schemaVersion=1,assets=new[]{before}},JsonDefaults.Options));using(var snapshot=FamilyCatalogSnapshot.Open(path)){reviewedHash=snapshot.Sha256;}
 File.WriteAllText(path,JsonSerializer.Serialize(new{schemaVersion=1,assets=new[]{after}},JsonDefaults.Options));using var changed=FamilyCatalogSnapshot.Open(path);
 if(changed.Assets[0].Sha256!=before.Sha256)throw new Exception("Fixture RFA hash changed");
 Throws("family_catalog_changed",()=>FamilyLibraryRules.MatchCatalogHash(changed.Sha256,reviewedHash));
}));

Console.WriteLine($"{tests} core validation/lifecycle tests passed.");

sealed class NativeTestDocument { public bool Open { get; set; } = true; }
sealed class TestDocumentWrapper(NativeTestDocument native)
{
    public NativeTestDocument Native { get; } = native;
    public override bool Equals(object? other) => other is TestDocumentWrapper wrapper && ReferenceEquals(Native,wrapper.Native);
    public override int GetHashCode() => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(Native);
}
