import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const scene={routes:[{id:'r',pipeTypeId:10,systemTypeId:20,levelId:30,diameterMm:80,flowIntent:'supply',points:[{xMm:0,yMm:0,zMm:1000},{xMm:1000,yMm:0,zMm:1000}]}],clearanceCheck:{mode:'skip',reason:'User requests an isolated modeling test, not a clearance assessment.'}};
const nativeContext={active:true,document:{identity:'doc-a',revision:0,path:'test.rvt',isFamilyDocument:false,isReadOnly:false,isModified:false}};
async function fixture(t,{reportPatch={},features=['collision-check'],errorCode,planError,stalePlan=false,contexts=[nativeContext],planPatch={}}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-pump-plan-mcp-'));const token='pump-planning-fixture-'.repeat(4),calls=[],sockets=new Set();let contextReads=0;
 const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buf='';socket.on('data',chunk=>{
  buf+=chunk.toString('utf8');const i=buf.indexOf('\n');if(i<0)return;const r=JSON.parse(buf.slice(0,i));assert.equal(r.token,token);calls.push(r);let payload;
  if(r.method==='revit.bridge.info')payload={ok:true,result:{protocol:'revit-auto-2027-v2',confirmationMode:'chat',features}};
  else if(r.method==='revit.context.get')payload={ok:true,result:contexts[Math.min(contextReads++,contexts.length-1)]};
  else if(r.method==='revit.collision.check')payload=errorCode?{ok:false,error:{code:errorCode,message:'Native preflight failed'}}:{ok:true,result:{documentIdentity:'doc-a',documentRevision:0,scope:{truncated:false,includesLinkedModels:false,targetElementIds:r.params.targetElementIds,excludeElementIds:r.params.excludeElementIds||[],clearanceMm:r.params.clearanceMm},diagnostics:{complete:true,truncated:false},collisions:[],unknown:[],clearanceCandidates:[],...reportPatch}};
  else if(r.method==='revit.plan.create')payload=planError?{ok:false,error:{code:planError,message:'Native plan rejected'}}:{ok:true,result:{planId:'pump-preview',documentIdentity:'doc-a',documentRevision:stalePlan?1:0,status:'pending',operations:r.params.operations,source:r.params.source,summary:r.params.summary,warnings:[],requiresConfirmation:true,confirmationMode:'chat',requiresRevitConfirmation:false,...planPatch}};
  else if(r.method==='revit.plan.cancel')payload={ok:true,result:{planId:r.params.planId,status:'cancelled'}};
  else payload={ok:false,error:{code:'unexpected_write',message:'This fixture never permits confirm/save'}};
  socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',...payload})+'\n');
 });});
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>bridge.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('revit-pump-plan-mcp-'));await fs.rm(dir,{recursive:true,force:true});});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const config=path.join(dir,'bridge.json');await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token}));
 const client=new Client({name:'pump-planning-contract',version:'1.0'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));return {client,calls};
}
const request={name:'pump_room.route',documentIdentity:'doc-a',expectedRevision:0};
async function invoke(client,args){const r=await client.callTool({name:'revit_workflow_run',arguments:args});return {error:r.isError===true,data:JSON.parse(r.content[0].text)};}
for(const name of ['pump_room.build','pump_room.route','pump_room.connect'])test(name+' ask is accepted and creates no native request',async t=>{
 const {client,calls}=await fixture(t);const r=await invoke(client,{...request,name,planningMode:'ask'});assert.equal(r.error,false);assert.equal(r.data.requiresClarification,true);assert.equal(r.data.planCreated,false);assert.ok(r.data.questions.length);assert.ok(r.data.missingInputs.length);assert.deepEqual(calls,[]);
});
test('explicit route missing system diameter Z flow and clearance returns exact missing paths without a plan',async t=>{
 const {client,calls}=await fixture(t);const r=await invoke(client,{...request,planningMode:'explicit',input:{routes:[{pipeTypeId:10,levelId:30,points:[{xMm:0,yMm:0},{xMm:1000,yMm:0}]}]}});
 assert.equal(r.error,false);assert.equal(r.data.planCreated,false);assert.equal(r.data.requiresClarification,true);
 for(const field of ['routes[0].systemTypeId','routes[0].diameterMm','routes[0].points[0].zMm','routes[0].flowIntent','clearanceCheck'])assert.ok(r.data.missingInputs.some(g=>g.field===field),field);
 assert.deepEqual(calls,[]);
});
test('explicit complete route returns one pinned preview and disclosed clearance skip',async t=>{
 const {client,calls}=await fixture(t);const r=await invoke(client,{...request,planningMode:'explicit',input:scene});assert.equal(r.error,false);assert.equal(r.data.requiresClarification,false);assert.equal(r.data.planCreated,true);assert.equal(r.data.plan.status,'pending');assert.equal(r.data.candidateOnly,false);assert.ok(r.data.warnings.some(w=>/净距/.test(w)));assert.equal(r.data.preflight.clearanceCheck.mode,'skip');assert.equal(r.data.preflight.newGeometryVerified,false);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);
 assert.equal(calls.find(c=>c.method==='revit.plan.create').params.expectedRevision,0);
});
test('assisted route keeps assumptions and alternatives and never guesses unresolved inputs',async t=>{
 const {client,calls}=await fixture(t);const assumptions=['Use the model-reviewed supply pipe type for this candidate only.'];const r=await invoke(client,{...request,planningMode:'assisted',assumptions,input:scene});assert.equal(r.error,false);assert.equal(r.data.candidateOnly,true);assert.deepEqual(r.data.assumptions,assumptions);assert.ok(Array.isArray(r.data.alternatives));assert.ok(Array.isArray(r.data.missingInputs));assert.ok(r.data.warnings.length);assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
 const incomplete=await invoke(client,{...request,planningMode:'assisted',assumptions,input:{routes:[{points:scene.routes[0].points}]}});assert.equal(incomplete.error,false);assert.equal(incomplete.data.requiresClarification,true);assert.equal(incomplete.data.planCreated,false);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);
});
test('assisted connect requires declared assumptions and registry advertises all three modes',async t=>{
 const {client,calls}=await fixture(t);const r=await invoke(client,{...request,name:'pump_room.connect',planningMode:'assisted',input:{}});assert.equal(r.error,true);assert.match(r.data.message,/assumptions_required/);assert.equal(calls.length,0);
 const list=await client.callTool({name:'revit_workflow_list',arguments:{}});const workflows=JSON.parse(list.content[0].text).workflows;for(const name of ['pump_room.build','pump_room.route','pump_room.connect'])assert.deepEqual(workflows.find(w=>w.workflowId===name).planningModes,['explicit','ask','assisted']);
});
const screened={...scene,clearanceCheck:{mode:'screen_existing',targetElementIds:[123],clearanceMm:100,maxCandidates:10}};
test('existing geometry screening precedes pinned plan creation and is not certification of new route geometry',async t=>{
 const {client,calls}=await fixture(t);const r=await invoke(client,{...request,planningMode:'explicit',input:screened});assert.equal(r.error,false);assert.equal(r.data.planCreated,true);assert.equal(r.data.preflight.newGeometryVerified,false);assert.equal(r.data.preflight.clearanceReport.documentRevision,0);
 const methods=calls.filter(c=>c.method!=='revit.bridge.info').map(c=>c.method);assert.ok(methods.indexOf('revit.collision.check')<methods.indexOf('revit.plan.create'));const params=calls.find(c=>c.method==='revit.collision.check').params;assert.equal(params.documentIdentity,'doc-a');assert.equal(params.expectedRevision,0);assert.equal(params.clearanceMm,100);assert.equal(params.maxCandidates,10);
});
for(const [label,patch] of [['collision',{collisions:[{firstElementId:123}]}],['unknown geometry',{unknown:[{elementId:123}]}],['truncation',{diagnostics:{complete:false,truncated:true}}],['clearance candidate',{clearanceCandidates:[{elementId:123}]}]])test('screening '+label+' returns evidence and questions without creating a plan',async t=>{
 const {client,calls}=await fixture(t,{reportPatch:patch});const r=await invoke(client,{...request,planningMode:'explicit',input:screened});assert.equal(r.error,false);assert.equal(r.data.requiresClarification,true);assert.equal(r.data.planCreated,false);assert.ok(r.data.preflight.clearanceReport);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});
test('native preflight revision mismatch or failure is propagated once, never planned or retried',async t=>{
 const {client,calls}=await fixture(t,{reportPatch:{documentRevision:1}});const r=await invoke(client,{...request,planningMode:'explicit',input:screened});assert.equal(r.error,true);assert.equal(r.data.code,'document_revision_changed');assert.equal(calls.filter(c=>c.method==='revit.collision.check').length,1);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});


test('screening native failure preserves cause without retry or preview',async t=>{
 const {client,calls}=await fixture(t,{errorCode:'collision_analysis_timeout'});const r=await invoke(client,{...request,planningMode:'explicit',input:screened});assert.equal(r.error,true);assert.equal(r.data.code,'collision_analysis_timeout');assert.equal(calls.filter(c=>c.method==='revit.collision.check').length,1);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});
test('report without matching selected element scope cannot authorize a preview',async t=>{
 const {client,calls}=await fixture(t,{reportPatch:{scope:{truncated:false,targetElementIds:[999],excludeElementIds:[],clearanceMm:100}}});const r=await invoke(client,{...request,planningMode:'explicit',input:screened});assert.equal(r.error,true);assert.equal(r.data.code,'invalid_preflight_evidence');assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});
test('pump workflow disallows raw operation injection or arbitrary script fields',async t=>{
 const {client,calls}=await fixture(t);for(const extra of [{operations:[{operationType:'set_parameter',elementId:1,parameter:'x',value:'y'}]},{scriptPath:'old.csx'},{code:'C#'}]){const r=await invoke(client,{...request,planningMode:'explicit',input:{...scene,...extra}});assert.equal(r.error,true);}assert.equal(calls.length,0);
});
test('connector criteria gaps are returned without guessed port ids or native queries',async t=>{
 const {client,calls}=await fixture(t);const r=await invoke(client,{...request,name:'pump_room.connect',planningMode:'explicit',input:{connections:[{firstElementId:10,secondElementId:11,flowIntent:'return'}],clearanceCheck:scene.clearanceCheck}});assert.equal(r.error,false);assert.equal(r.data.requiresClarification,true);assert.equal(r.data.planCreated,false);assert.deepEqual(r.data.missingInputs.map(g=>g.field),['connections[0].firstConnector','connections[0].secondConnector']);assert.deepEqual(calls,[]);
});
test('assisted and default-ask connect work through the actual SDK registry gate',async t=>{
 const {client,calls}=await fixture(t);const input={connections:[{firstElementId:10,secondElementId:11,flowIntent:'return',firstConnectorId:0,secondConnectorId:1}],clearanceCheck:scene.clearanceCheck};const query=await invoke(client,{...request,name:'pump_room.connect',input});assert.equal(query.error,false);assert.equal(query.data.planningMode,'ask');assert.equal(query.data.planCreated,false);assert.equal(calls.length,0);
 const candidate=await invoke(client,{...request,name:'pump_room.connect',planningMode:'assisted',assumptions:['User allows this inspected connector pair as a candidate.'],input});assert.equal(candidate.error,false);assert.equal(candidate.data.planCreated,true);assert.equal(candidate.data.candidateOnly,true);assert.equal(candidate.data.plan.operations[0].firstConnectorId,0);assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});


test('changed native preview is cancelled once without a write',async t=>{
 const {client,calls}=await fixture(t,{stalePlan:true});const r=await invoke(client,{...request,planningMode:'explicit',input:scene});assert.equal(r.error,true);assert.equal(r.data.code,'document_revision_changed');assert.deepEqual(calls.filter(c=>c.method==='revit.plan.cancel').map(c=>c.params),[{planId:'pump-preview'}]);assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});
test('native plan validation error never triggers another plan or a commit',async t=>{
 const {client,calls}=await fixture(t,{planError:'invalid_operation'});const r=await invoke(client,{...request,planningMode:'explicit',input:scene});assert.equal(r.error,true);assert.equal(r.data.code,'invalid_operation');assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK pump build keeps equipment, pipe and connector references in one exact uncommitted preview',async t=>{
 const {client,calls}=await fixture(t,{features:['collision-check','connector-criteria-connections']});
 const point={xMm:0,yMm:0,zMm:1000};
 const selector={domain:'DomainPiping',shape:'Round',point,toleranceMm:1};
 const input={
  equipment:[{id:'pump',symbolId:50,levelId:30,...point}],
  pipes:[{id:'pipe',pipeTypeId:10,systemTypeId:20,levelId:30,diameterMm:80,flowIntent:'neutral',start:point,end:{...point,xMm:1000}}],
  connections:[{id:'connect',flowIntent:'neutral',firstElementId:'@pump',firstConnector:selector,
   secondElementId:'@pipe',secondConnector:selector}],
  clearanceCheck:scene.clearanceCheck
 };
 const result=await invoke(client,{...request,name:'pump_room.build',planningMode:'explicit',input});
 assert.equal(result.error,false);assert.equal(result.data.documentRevision,0);
 assert.deepEqual(result.data.plan.operations.map(op=>op.operationType),['create_family_instance','create_pipe','connect_elements']);
 assert.equal(result.data.plan.operations[2].firstElementId,'@pump');
 assert.equal(result.data.plan.operations[2].secondElementId,'@pipe');
 const create=calls.find(c=>c.method==='revit.plan.create');
 assert.deepEqual(result.data.plan.operations,create.params.operations);
 assert.deepEqual(calls.filter(c=>c.method!=='revit.bridge.info').map(c=>c.method),
  ['revit.context.get','revit.plan.create','revit.context.get']);
 assert.ok(!calls.some(c=>/confirm|commit|save|lifecycle/.test(c.method)));
});

test('SDK pump build rejects final revision drift and exposes one preview cleanup receipt',async t=>{
 const {client,calls}=await fixture(t,{contexts:[nativeContext,{...nativeContext,document:{...nativeContext.document,revision:1}}]});
 const input={pipes:[{id:'pipe',pipeTypeId:10,systemTypeId:20,levelId:30,diameterMm:80,flowIntent:'neutral',
  start:{xMm:0,yMm:0,zMm:1000},end:{xMm:1000,yMm:0,zMm:1000}}],clearanceCheck:scene.clearanceCheck};
 const result=await invoke(client,{...request,name:'pump_room.build',planningMode:'explicit',input});
 assert.equal(result.error,true);assert.equal(result.data.code,'document_revision_changed');
 assert.equal(result.data.details.planId,'pump-preview');
 assert.equal(result.data.details.previewCleanup.status,'cancelled');
 assert.deepEqual(calls.filter(c=>c.method!=='revit.bridge.info').map(c=>c.method),
  ['revit.context.get','revit.plan.create','revit.context.get','revit.plan.cancel']);
 assert.ok(!calls.some(c=>/confirm|commit|save|lifecycle/.test(c.method)));
});
