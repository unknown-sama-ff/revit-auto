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


Test("native receipt preserves eight actual additions and three unreported modifications behind three primary elements",()=>{
 var c=new NativeChangeReceipt("doc",0);
 c.Record("doc",1,"TransactionCommitted",["approved test"],[10,11,12,13,14,15,16,17],[100,101,102],[]);
 var e=c.Snapshot(1,"committed",[10,11,12],[]);
 if(e.ObservedAddedElementIds.Length!=8||e.AdditionalAddedElementIds.Length!=5||e.UnreportedModifiedElementIds.Length!=3||!e.CaptureComplete||e.SideEffectsVerified||e.NetModelDiffVerified)throw new Exception("Primary-only receipt concealed native side effects");
});
Test("native receipt ignores another document events and deduplicates same-session ids",()=>{
 var c=new NativeChangeReceipt("doc",0);c.Record("other",10,"TransactionCommitted",["unrelated"],[999],[998],[997]);c.Record("doc",1,"TransactionCommitted",["one"],[10,10],[10,20,20],[]);c.Record("doc",2,"TransactionCommitted",["two"],[11],[20],[]);
 var e=c.Snapshot(2,"committed",[10,11],[20]);if(!e.CaptureComplete||e.ObservedEventCount!=2||!e.ObservedAddedElementIds.SequenceEqual(new long[]{10,11})||e.UnreportedModifiedElementIds.Length!=0)throw new Exception("Native receipt crossed sessions or duplicated ids");
});
Test("native receipt preserves deletions and transient added-deleted elements without asserting net or rollback success",()=>{
 var c=new NativeChangeReceipt("doc",2);c.Record("doc",3,"TransactionCommitted",["temporary"],[10],[],[20]);c.Record("doc",4,"TransactionGroupRolledBack",["rollback"],[],[],[10]);var e=c.Snapshot(4,"failed",[],[]);
 if(!e.ObservedDeletedElementIds.SequenceEqual(new long[]{10,20})||!e.ObservedThenDeletedElementIds.SequenceEqual(new long[]{10})||e.NetModelDiffVerified||e.SideEffectsVerified||e.ExecutionOutcome!="failed")throw new Exception("Rollback trace was misrepresented as final model contents");
});
Test("native receipt id cap explicitly rejects complete evidence and retains bounded arrays",()=>{
 var c=new NativeChangeReceipt("doc",0,elementLimit:2);c.Record("doc",1,"TransactionCommitted",["batch"],[1,2,3,4],[],[]);var e=c.Snapshot(1,"committed",[1],[]);if(!e.ElementIdsTruncated||e.CaptureComplete||e.ObservedAddedElementIds.Length!=2||e.Events.Single().AddedCount!=4)throw new Exception("ID cap was hidden");
});
Test("native receipt metadata cap and long labels never silently claim complete capture",()=>{
 var c=new NativeChangeReceipt("doc",0,eventLimit:1);c.Record("doc",1,"TransactionCommitted",[new string('x',600)],[1],[],[]);c.Record("doc",2,"TransactionCommitted",["second"],[2],[],[]);var e=c.Snapshot(2,"committed",[1,2],[]);if(!e.EventMetadataTruncated||e.CaptureComplete||e.Events.Length!=1||e.Events[0].TransactionNames[0].Length!=500||e.ObservedEventCount!=2)throw new Exception("Event truncation was hidden");
});
Test("native receipt missing event revision or primary evidence cannot certify completeness",()=>{
 var c=new NativeChangeReceipt("doc",0);c.Record("doc",2,"TransactionCommitted",["gap"],[1],[],[]);if(c.Snapshot(2,"committed",[1],[]).RevisionCoverageComplete)throw new Exception("Missing event not detected");
 var empty=new NativeChangeReceipt("doc",0);if(empty.Snapshot(0,"committed",[1],[]).CaptureComplete)throw new Exception("Primary creation without native events was accepted");if(!empty.Snapshot(0,"committed",[],[]).CaptureComplete)throw new Exception("Noop was not preserved");
});
Test("native receipt snapshot is immutable after subsequent events",()=>{
 var c=new NativeChangeReceipt("doc",0);c.Record("doc",1,"TransactionCommitted",["first"],[1],[],[]);var e=c.Snapshot(1,"committed",[1],[]);c.Record("doc",2,"TransactionCommitted",["later"],[2],[],[]);if(e.ObservedEventCount!=1||e.Events.Length!=1||e.ObservedAddedElementIds.Length!=1||e.EndRevision!=1)throw new Exception("Receipt changed after it was returned");
});
Test("native receipt flags invalid native ids instead of certifying a clean change set",()=>{
 var c=new NativeChangeReceipt("doc",0);c.Record("doc",1,"TransactionCommitted",["invalid"],[-1,0,1],[],[]);var e=c.Snapshot(1,"committed",[1],[]);if(e.CaptureComplete||!e.ObservedAddedElementIds.SequenceEqual(new long[]{1}))throw new Exception("Malformed native evidence became complete");
});


Test("native receipt evidence serializes all changed classes without asserting harmlessness",()=>{
 var c=new NativeChangeReceipt("doc",0);c.Record("doc",1,"TransactionCommitted",["approved"],[1,2,3,4,5],[100],[]);
 var e=c.Snapshot(1,"committed",[1,2,3],[]);var json=JsonSerializer.SerializeToElement(e,JsonDefaults.Options);
 if(json.GetProperty("additionalAddedElementIds").GetArrayLength()!=2||json.GetProperty("unreportedModifiedElementIds").GetArrayLength()!=1||json.GetProperty("netModelDiffVerified").GetBoolean()||json.GetProperty("sideEffectsVerified").GetBoolean())throw new Exception("Receipt serialization concealed evidence");
});


Test("native receipt captures above old journal element cap without dropping observed ids",()=>{
 var ids=Enumerable.Range(1,600).Select(x=>(long)x).ToArray();var c=new NativeChangeReceipt("doc",0);var journal=new DocumentChangeJournal();
 c.Record("doc",1,"TransactionCommitted",["large"],ids,[],[]);journal.Record(1,"TransactionCommitted",["large"],ids,[],[]);
 var e=c.Snapshot(1,"committed",[1],[]);var historical=JsonSerializer.SerializeToElement(journal.Since(0,1),JsonDefaults.Options);
 if(e.ObservedAddedElementIds.Length!=600||!e.ElementEvidenceComplete||!e.CaptureComplete||!historical.GetProperty("changes")[0].GetProperty("elementIdsTruncated").GetBoolean())throw new Exception("Receipt inherited bounded history truncation");
});
Test("receipt metadata truncation does not hide independent element coverage state",()=>{
 var c=new NativeChangeReceipt("doc",0,eventLimit:1);c.Record("doc",1,"TransactionCommitted",[new string('x',600)],[1],[],[]);c.Record("doc",2,"TransactionCommitted",["later"],[2],[],[]);var e=c.Snapshot(2,"committed",[1,2],[]);
 if(!e.ElementEvidenceComplete||e.CaptureComplete||!e.EventMetadataTruncated)throw new Exception("Metadata and element completeness were conflated");
});


Test("stair cancel returns action evidence but never declares rollback verified",()=>{
 var state=new StairExecutionCleanup();state.StartingScope();state.ScopeStarted();state.Phase=StairExecutionPhase.BuildingLandings;int calls=0;var e=state.AfterFailure(()=>calls++);
 if(calls!=1||e.CancelCallSucceeded!=true||e.CancelAttempted!=true||e.RollbackVerified||!e.RequiresNativeInspection||e.RollbackStatus!="cancel-returned-unverified"||e.Stage!="BuildingLandings")throw new Exception("Stair cancel return became rollback proof");
});
Test("stair cancellation failure retains diagnostic exception type and cannot report success",()=>{
 var state=new StairExecutionCleanup();state.StartingScope();state.ScopeStarted();var e=state.AfterFailure(()=>throw new InvalidOperationException("cleanup failed"));
 if(e.CancelErrorType!="InvalidOperationException"||e.CancelCallSucceeded!=false||e.CancelAttempted!=true||e.RollbackVerified||e.RollbackStatus!="cancel-failed")throw new Exception("Cleanup exception was hidden");
});
Test("stair startup failure still attempts cancellation once without assuming no native changes",()=>{
 var state=new StairExecutionCleanup();state.StartingScope();var e=state.AfterFailure(()=>{});if(e.ScopeStartReturned!=false||e.CancelAttempted!=true||!e.RequiresNativeInspection||e.RollbackVerified)throw new Exception("Startup failure assumed no model impact");
});
Test("stair failure before scope startup does not invoke cancel or assert rollback",()=>{
 int calls=0;var e=new StairExecutionCleanup().AfterFailure(()=>calls++);if(calls!=0||e.CancelAttempted!=false||e.RollbackStatus!="not-started"||e.RollbackVerified||e.RequiresNativeInspection)throw new Exception("Prestart cleanup performed native action");
});
Test("stair readback failure after commit return cannot cancel a possibly committed result",()=>{
 int calls=0;var state=new StairExecutionCleanup();state.StartingScope();state.ScopeStarted();state.ScopeCommitReturned();var e=state.AfterFailure(()=>calls++);
 if(calls!=0||e.CancelAttempted!=false||e.ScopeCommitReturned!=true||e.RollbackVerified||!e.RequiresNativeInspection||e.RollbackStatus!="scope-commit-returned-unverified")throw new Exception("Readback exception falsely cancelled committed scope");
});
Test("stair cleanup diagnostic queries never repeat cancel or overwrite first failure evidence",()=>{
 int calls=0;var state=new StairExecutionCleanup();state.StartingScope();var first=state.AfterFailure(()=>{calls++;throw new IOException("cancel failed");});var second=state.AfterFailure(()=>calls++);
 if(calls!=1||!ReferenceEquals(first,second)||second.CancelErrorType!="IOException"||second.CancelCallSucceeded!=false)throw new Exception("Cleanup retried a native action");
});
Test("stair execution failure preserves original bridge cause and transaction warnings",()=>{
 var cause=new BridgeException("invalid_operation","landing rejected",new{target=42});var e=new StairExecutionFailure(cause,StairCleanupEvidence.Unknown(),["native warning"]);
 if(e.CauseCode!="invalid_operation"||e.Message!="landing rejected"||!ReferenceEquals(e.InnerException,cause)||e.CauseDetails is null||e.Warnings.Single()!="native warning")throw new Exception("Original failure evidence was overwritten");
});
Test("stair cancelled execution has a stable cause and no fabricated rollback fields",()=>{
 var e=new StairExecutionFailure(new OperationCanceledException(),StairCleanupEvidence.Unknown(),[]);var json=JsonSerializer.SerializeToElement(e.Cleanup,JsonDefaults.Options);
 if(e.CauseCode!="execution_cancelled"||json.GetProperty("rollbackVerified").GetBoolean()||json.GetProperty("rollbackStatus").GetString()!="unknown"||json.TryGetProperty("rolledBack",out _))throw new Exception("Unknown/cancelled state fabricated rollback");
});

Test("native read snapshot evaluates deferred data in its owner context before background serialization",()=>{
 bool ownerContext=true;int reads=0;
 IEnumerable<object> ReadNativeRows(){if(!ownerContext)throw new Exception("API accessed after UI context");reads++;yield return new{elementId=1,mark="L1"};}
 var snapshot=NativeReadSnapshot.Freeze(new{rows=ReadNativeRows()});ownerContext=false;
 var encoded=CommandResult.Success(snapshot).Serialize();Json(encoded);
 if(reads!=1||snapshot.GetProperty("rows")[0].GetProperty("elementId").GetInt32()!=1)throw new Exception("Native enumerator escaped snapshot");
});
Test("native read snapshot owns copied values and cannot observe later source mutations",()=>{
 var ids=new List<long>{1,2};var snapshot=NativeReadSnapshot.Freeze(new{ids});ids.Clear();
 if(snapshot.GetProperty("ids").GetArrayLength()!=2)throw new Exception("Snapshot retained mutable source data");
 Json(CommandResult.Success(snapshot).Serialize());
});
Test("electrical audit native input preserves revision zero and exact selected circuit IDs",()=>{
 var input=ElectricalAuditRules.Parse(Json("""{"documentIdentity":"doc-a","expectedRevision":0,"circuitIds":[12,19],"maxCircuits":2,"maxMembersPerCircuit":10,"maxParametersPerCircuit":20}"""));
 if(input.ExpectedRevision!=0||!input.CircuitIds.SequenceEqual(new long[]{12,19})||input.MaxCircuits!=2||input.MaxMembersPerCircuit!=10||input.MaxParametersPerCircuit!=20)throw new Exception("Audit scope changed");
});
Test("electrical audit default request stays bounded without an inferred circuit selection",()=>{
 var input=ElectricalAuditRules.Parse(Json("""{"documentIdentity":"doc-a"}"""));
 if(input.CircuitIds.Length!=0||input.ExpectedRevision is not null||input.MaxCircuits!=100||input.MaxMembersPerCircuit!=100||input.MaxParametersPerCircuit!=64)throw new Exception("Audit defaults not bounded");
});
Test("electrical audit refuses code paths duplicate IDs unsafe revisions and invalid limits",()=>{
 foreach(var json in new[]{"""{"documentIdentity":"doc","code":"x"}""","""{"documentIdentity":"doc","filePath":"x.csx"}""","""{"documentIdentity":"doc","circuitIds":[]}""","""{"documentIdentity":"doc","circuitIds":[1,1]}""","""{"documentIdentity":"doc","circuitIds":[0]}""","""{"documentIdentity":"doc","circuitIds":[1.2]}""","""{"documentIdentity":"doc","expectedRevision":null}""","""{"documentIdentity":"doc","expectedRevision":-1}""","""{"documentIdentity":"doc","expectedRevision":9007199254740992}""","""{"documentIdentity":"doc","maxCircuits":201}""","""{"documentIdentity":"doc","maxMembersPerCircuit":501}""","""{"documentIdentity":"doc","maxParametersPerCircuit":129}""","""{"documentIdentity":"doc","circuitIds":[1,2],"maxCircuits":1}""","""{"documentIdentity":"doc","maxCircuits":1,"maxCircuits":2}""","""{"documentIdentity":" "}"""})
  Throws("invalid_electrical_audit_request",()=>ElectricalAuditRules.Parse(Json(json)));
});
Test("electrical audit distinguishes unavailable native values from known absence and zero",()=>{
 var zero=AuditValueEvidence.Read(()=>0L);var absent=AuditValueEvidence.Read(()=>null);var failed=AuditValueEvidence.Read(()=>throw new InvalidOperationException("Unsupported getter"));
 if(zero.State!="known"||!Equals(zero.Value,0L)||absent.State!="known-null"||!absent.Supported||failed.State!="unknown"||failed.Supported||failed.Value is not null||failed.ErrorType!="InvalidOperationException")throw new Exception("Native audit uncertainty was guessed");
 Json(CommandResult.Success(new{zero,absent,failed}).Serialize());
});
Test("electrical audit numeric failures are unknown and oversized strings disclose truncation",()=>{
 foreach(var value in new object[]{double.NaN,double.PositiveInfinity,float.NegativeInfinity}){var evidence=AuditValueEvidence.Read(()=>value);if(evidence.Supported||evidence.Value is not null||evidence.State!="unknown")throw new Exception("Nonfinite audit value fabricated");Json(CommandResult.Success(evidence).Serialize());}
 var text=AuditValueEvidence.Read(()=>new string('x',3000));if(!text.Truncated||((string)text.Value!).Length!=2048)throw new Exception("Oversized audit text not disclosed");
});
Test("electrical audit read failures retain bounded diagnostics without hiding cancellation",()=>{
 var evidence=AuditValueEvidence.Read(()=>throw new IOException(new string('x',600)));if(evidence.Error!.Length!=400||evidence.ErrorType!="IOException")throw new Exception("Unbounded audit diagnostic");
 try{AuditValueEvidence.Read(()=>throw new OperationCanceledException());throw new Exception("Cancellation hidden");}catch(OperationCanceledException){}
});
Test("UI-owned read snapshot can be serialized on a background thread without reentering native getters",()=>{
 int ownerThread=Environment.CurrentManagedThreadId,reads=0;
 IEnumerable<long> ReadNativeIds(){if(Environment.CurrentManagedThreadId!=ownerThread)throw new Exception("Wrong native API thread");reads++;yield return 12;yield return 19;}
 var snapshot=NativeReadSnapshot.Freeze(new{ids=ReadNativeIds()});
 var json=Task.Run(()=>CommandResult.Success(snapshot).Serialize()).GetAwaiter().GetResult();Json(json);
 if(reads!=1||snapshot.GetProperty("ids").GetArrayLength()!=2)throw new Exception("Background response reentered native API");
});
Test("opening plan supports explicit wall rectangles and rejects implicitly guessed XYZ hosts and tolerance",()=>{
 var op=Json("""[{"operationType":"create_opening","openingKind":"wall_rectangle","hostElementId":10,"start":{"xMm":100,"yMm":0,"zMm":500},"end":{"xMm":900,"yMm":0,"zMm":1800},"hostToleranceMm":1}]""");if(PlanRules.Validate(op).Count!=1)throw new Exception("Opening operation missing");
 foreach(var replacement in new[]{op.GetRawText().Replace("\"zMm\":1800","\"zMm\":0"),op.GetRawText().Replace("\"hostToleranceMm\":1","\"hostToleranceMm\":0"),op.GetRawText().Replace("\"hostElementId\":10","\"hostElementId\":null"),op.GetRawText().Replace("\"zMm\":1800","\"q\":1800")})
 {try{PlanRules.Validate(Json(replacement));throw new Exception("Invalid opening accepted");}catch(BridgeException){}}
});
Test("opening polygon validation rejects crossing nonplanar duplicate closing and implicit vertical cuts",()=>{
 OpeningPoint[] square=[new(0,0,3000),new(1000,0,3000),new(1000,1000,3000),new(0,1000,3000)];OpeningRules.ValidatePolygon(square,true);OpeningRules.ValidatePolygon(square.Reverse().ToArray(),true);
 foreach(var points in new[]{new[]{square[0],square[2],square[1],square[3]},square.Concat([square[0]]).ToArray(),new[]{square[0],square[1],new OpeningPoint(1000,1000,3100),square[3]},new[]{square[0],square[1],square[1],square[3]}})
 {try{OpeningRules.ValidatePolygon(points,true);throw new Exception("Unsafe opening polygon accepted");}catch(BridgeException){}}
 OpeningRules.ValidatePolygon(square.Select(p=>new OpeningPoint(p.X,p.Y,p.X+3000)).ToArray(),false);
});
Test("opening native profile readback compares edges not an unordered vertex bag",()=>{
 OpeningPoint[] points=[new(0,0,0),new(100,0,0),new(100,100,0),new(0,100,0)];var edges=points.Select((p,i)=>(p,points[(i+1)%points.Length])).ToArray();
 if(!OpeningRules.EdgesMatch(points,edges.Reverse().Select(e=>(e.Item2,e.Item1)).ToArray(),1))throw new Exception("Native edge order/reversal incorrectly rejected");
 var wrong=new[]{(points[0],points[2]),(points[2],points[1]),(points[1],points[3]),(points[3],points[0])};if(OpeningRules.EdgesMatch(points,wrong,1))throw new Exception("Same vertex set certified crossed geometry");
 if(OpeningRules.EdgesMatch(points,edges[..3],1)||OpeningRules.EdgesMatch(points,edges,double.NaN))throw new Exception("Missing edges or unknown tolerance accepted");
});
Test("opening floor shaft profiles preserve explicit direction level scope and safe existing native IDs",()=>{
 var floor=Json("""{"operationType":"create_opening","openingKind":"floor_profile","hostElementId":10,"boundary":[{"xMm":0,"yMm":0,"zMm":3000},{"xMm":100,"yMm":0,"zMm":3000},{"xMm":100,"yMm":100,"zMm":3000},{"xMm":0,"yMm":100,"zMm":3000}],"cutDirection":"vertical","hostToleranceMm":1}""");OpeningRules.Validate(floor);
 var shaft=floor.GetRawText().Replace("floor_profile","shaft").Replace("\"hostElementId\":10","\"baseLevelId\":10,\"topLevelId\":11").Replace(",\"cutDirection\":\"vertical\"","");OpeningRules.Validate(Json(shaft));
 foreach(var bad in new[]{floor.GetRawText().Replace("vertical","unknown"),shaft.Replace("\"topLevelId\":11","\"topLevelId\":10"),floor.GetRawText().Replace("\"hostElementId\":10","\"hostElementId\":\"@wall\""),floor.GetRawText().Replace("\"hostToleranceMm\":1","\"hostToleranceMm\":101"),floor.GetRawText().Replace("\"hostToleranceMm\":1","\"hostToleranceMm\":1,\"code\":\"unsafe\"")})
 {try{OpeningRules.Validate(Json(bad));throw new Exception("Unsafe scope/field accepted");}catch(BridgeException){}}
});
var explicitStairJson="""{"operationType":"create_stair","stairTypeId":9,"baseLevelId":1,"topLevelId":2,"desiredRisersNumber":20,"treadDepthMm":280,"geometryToleranceMm":1,"landingMode":"automaticBetweenRuns","runs":[{"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":0,"yMm":3000,"zMm":0},"widthMm":1200,"risersNumber":10},{"start":{"xMm":1500,"yMm":3000,"zMm":1500},"end":{"xMm":1500,"yMm":0,"zMm":1500},"widthMm":1200,"risersNumber":10}]}""";
Test("explicit stairs validate reviewed type total risers tread depth and full horizontal paths",()=>{StairRules.Validate(Json(explicitStairJson));StairRules.VerifyRunElevations(Json(explicitStairJson),0,3000);});
Test("stairs refuse unknown types implicit XYZ tilted paths and native riser-count guessing",()=>{
 foreach(var invalid in new[]{explicitStairJson.Replace("\"stairTypeId\":9,",""),explicitStairJson.Replace("\"stairTypeId\":9","\"stairTypeId\":\"@type\""),explicitStairJson.Replace("\"desiredRisersNumber\":20","\"desiredRisersNumber\":21"),explicitStairJson.Replace("\"treadDepthMm\":280","\"treadDepthMm\":0"),explicitStairJson.Replace("\"zMm\":0","\"elevation\":0"),explicitStairJson.Replace("\"geometryToleranceMm\":1","\"geometryToleranceMm\":101"),explicitStairJson.Replace("\"stairTypeId\":9","\"stairTypeId\":9,\"code\":\"unsafe\"")}){try{StairRules.Validate(Json(invalid));throw new Exception("Unsafe stair values accepted");}catch(BridgeException){}}
});
Test("stairs do not silently overlap both runs at the base or accept unknown native levels",()=>{
 var overlapping=Json(explicitStairJson.Replace("\"zMm\":1500","\"zMm\":0"));Throws("invalid_stair",()=>StairRules.VerifyRunElevations(overlapping,0,3000));Throws("invalid_stair",()=>StairRules.VerifyRunElevations(Json(explicitStairJson),double.NaN,3000));Throws("invalid_stair",()=>StairRules.VerifyRunElevations(Json(explicitStairJson),3000,0));
});
Test("sketched landing data must be horizontal explicit and aligned with riser grid",()=>{
 var sketch=explicitStairJson.Replace("automaticBetweenRuns","sketched").Replace("\"runs\":", "\"landings\":[{\"elevationMm\":1500,\"boundary\":[{\"xMm\":-600,\"yMm\":3000,\"zMm\":1500},{\"xMm\":2100,\"yMm\":3000,\"zMm\":1500},{\"xMm\":2100,\"yMm\":4200,\"zMm\":1500},{\"xMm\":-600,\"yMm\":4200,\"zMm\":1500}]}],\"runs\":");StairRules.Validate(Json(sketch));StairRules.VerifyRunElevations(Json(sketch),0,3000);
 Throws("invalid_stair",()=>StairRules.Validate(Json(sketch.Replace("\"elevationMm\":1500","\"elevationMm\":1600"))));
 var offGrid=sketch.Replace("\"elevationMm\":1500","\"elevationMm\":1600").Replace("\"zMm\":1500","\"zMm\":1600");Throws("invalid_stair",()=>StairRules.VerifyRunElevations(Json(offGrid),0,3000));
});
Test("non-sketched stair modes reject landings that would otherwise be silently ignored",()=>{
 Throws("invalid_stair",()=>StairRules.Validate(Json(explicitStairJson.Replace("\"runs\":","\"landings\":[],\"runs\":"))));
});
Console.WriteLine($"{tests} core validation/lifecycle tests passed.");

sealed class NativeTestDocument { public bool Open { get; set; } = true; }
sealed class TestDocumentWrapper(NativeTestDocument native)
{
    public NativeTestDocument Native { get; } = native;
    public override bool Equals(object? other) => other is TestDocumentWrapper wrapper && ReferenceEquals(Native,wrapper.Native);
    public override int GetHashCode() => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(Native);
}
