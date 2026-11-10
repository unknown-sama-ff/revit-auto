import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { previewRegisteredWriteWorkflow, registeredWriteWorkflowIds } from '../registered-planning.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const context = {active:true,document:{identity:'doc-a',revision:0,path:'model.rvt',isModified:false,isFamilyDocument:false,isReadOnly:false}};
const pending = {planId:'plan-a',status:'pending',documentIdentity:'doc-a',documentRevision:0,requiresConfirmation:true,requiresRevitConfirmation:false};
const wall = {wallTypeId:11,levelId:12,start:{xMm:0,yMm:0,zMm:0},end:{xMm:1000,yMm:0,zMm:0},heightMm:3000};
const base = {name:'architecture.build',documentIdentity:'doc-a',expectedRevision:0,input:{walls:[wall]}};
const scene = {
  'architecture.build':base.input,
  'architecture.rooms':{rooms:[{levelId:12,xMm:1000,yMm:1000,number:'101',name:'Office'}]},
  'architecture.openings':{doors:[{symbolId:21,hostElementId:22,levelId:12,xMm:1000,yMm:0,zMm:0}]},
  'architecture.documentation':{sheets:[{number:'A101',name:'Plan',titleBlockId:30}]},
  'lighting.full':{lights:[{symbolId:21,levelId:12,xMm:1000,yMm:1000,zMm:3000}]},
  'lighting.place':{lights:[{symbolId:21,levelId:12,xMm:1000,yMm:1000,zMm:3000}]},
  'electrical.circuit':{circuits:[{elementIds:[21,22],panelId:23,name:'Lighting'}]},
  'electrical.wire':{wires:[{firstElementId:21,secondElementId:22,wireTypeId:23,viewId:24}]},
  'electrical.sheet':{sheets:[{number:'E101',name:'Lighting',titleBlockId:30}]}
};

function fixture(options={}) {
  const {contexts=[context],createError,cancelError,finalError}=options;
  const plan=Object.hasOwn(options,'plan')?options.plan:pending;
  const calls=[];let index=0;
  const call=async(method,args)=>{
    calls.push({method,args});
    if(method==='revit.context.get'){
      if(index && finalError)throw finalError;
      return structuredClone(contexts[Math.min(index++,contexts.length-1)]);
    }
    if(method==='revit.inspect'){
      return {items:args.elementIds.map(id=>({summary:{id,className:'FamilyInstance',categoryId:id===23?-2001040:-2001120},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]},parameters:[]}))};
    }
    if(method==='revit.search')return {items:[],hasMore:false,offset:args.offset,limit:args.limit};
    if(method==='revit.plan.create'){
      if(createError)throw createError;
      return structuredClone(plan);
    }
    if(method==='revit.plan.cancel'){
      if(cancelError)throw cancelError;
      return {status:'cancelled'};
    }
    throw new Error('Unexpected method: '+method);
  };
  return {call,calls};
}
const run=(args,f,signal)=>previewRegisteredWriteWorkflow(args,getWorkflow(args.name),f.call,signal);

for(const name of registeredWriteWorkflowIds){
  test(name+' pins revision zero and returns only one preview',async()=>{
    const f=fixture();const result=await run({...base,name,input:scene[name]},f);
    assert.equal(result.planCreated,true);assert.equal(result.requiresClarification,false);
    assert.equal(result.candidateOnly,false);assert.equal(result.documentRevision,0);
    assert.equal(result.plan.requiresRevitConfirmation,false);
    assert.deepEqual(f.calls.map(c=>c.method),name==='electrical.circuit' ? ['revit.context.get','revit.inspect','revit.context.get','revit.plan.create','revit.context.get'] : name==='electrical.sheet' ? ['revit.context.get','revit.search','revit.context.get','revit.plan.create','revit.context.get'] : ['revit.context.get','revit.plan.create','revit.context.get']);
    const createCall=f.calls.find(c=>c.method==='revit.plan.create');
    assert.equal(createCall.args.expectedRevision,0);assert.equal(createCall.args.documentIdentity,'doc-a');
    assert.ok(createCall.args.operations.length);assert.equal(createCall.args.source,'workflow:'+name+':explicit');
  });
  test(name+' ask returns questions without any native calls',async()=>{
    const f=fixture();const result=await run({...base,name,planningMode:'ask',input:{}},f);
    assert.equal(result.planCreated,false);assert.equal(result.requiresClarification,true);
    assert.ok(result.questions.length);assert.equal(result.planningMode,'ask');assert.deepEqual(f.calls,[]);
  });
}

test('assisted requires nonempty assumptions and creates a candidate preview',async()=>{
  const f=fixture();await assert.rejects(run({...base,planningMode:'assisted'},f),e=>e.code==='assumptions_required');assert.deepEqual(f.calls,[]);
  const result=await run({...base,planningMode:'assisted',assumptions:['User permits this inspected wall type for a candidate.']},f);
  assert.equal(result.candidateOnly,true);assert.equal(result.assumptions.length,1);assert.ok(result.warnings.length);
  assert.match(f.calls[1].args.summary,/User permits/);
});

test('empty malformed executable and raw-operation inputs never contact the bridge',async()=>{
  for(const input of [{},{walls:[]},{walls:'not-a-list'},[],null,{operations:[{operationType:'delete_element',elementId:1}]},{...base.input,code:'Document.Delete(...)'},{...base.input,scriptPath:'legacy.csx'},{...base.input,filePath:'legacy.csx'},{...base.input,pipes:[]}]){
    const f=fixture();await assert.rejects(run({...base,input},f));assert.deepEqual(f.calls,[],JSON.stringify(input));
  }
});

test('nested pin conflicts and invalid pins fail before native calls',async()=>{
  for(const input of [{...base.input,documentIdentity:'other'},{...base.input,expectedRevision:1},{...base.input,expectedRevision:null},{...base.input,documentIdentity:' '}]){
    const f=fixture();await assert.rejects(run({...base,input},f));assert.deepEqual(f.calls,[]);
  }
});

test('nested expectedRevision is enforced when top-level revision is absent',async()=>{
  const f=fixture();await assert.rejects(run({...base,expectedRevision:undefined,input:{...base.input,expectedRevision:1}},f),e=>e.code==='document_revision_changed');
  assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get']);
  const valid=fixture();await run({...base,expectedRevision:undefined,input:{...base.input,expectedRevision:0}},valid);
  assert.equal(valid.calls[1].args.expectedRevision,0);
});

test('unknown inactive stale family and read-only contexts cannot create previews',async()=>{
  for(const next of [{active:false},{active:true,document:{identity:'doc-a'}},{...context,document:{...context.document,revision:null}},{...context,document:{...context.document,identity:'other'}},{...context,document:{...context.document,revision:1}},{...context,document:{...context.document,isFamilyDocument:true}},{...context,document:{...context.document,isReadOnly:true}}]){
    const f=fixture({contexts:[next]});await assert.rejects(run(base,f));assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get']);
  }
});

test('native preview needs an exact identity revision and pending plan ID',async()=>{
  for(const plan of [undefined,null,{}, {...pending,planId:''},{...pending,status:'committed'},{...pending,documentIdentity:undefined},{...pending,documentIdentity:'other'},{...pending,documentRevision:undefined},{...pending,documentRevision:1}]){
    const f=fixture({plan});await assert.rejects(run(base,f));
    assert.equal(f.calls.filter(c=>c.method==='revit.plan.create').length,1);
    assert.ok(f.calls.filter(c=>c.method==='revit.plan.cancel').length<=1);
    assert.ok(!f.calls.some(c=>/confirm|commit|save/.test(c.method)));
  }
});

test('changes after preview creation cancel that preview once and preserve the cause',async()=>{
  for(const [patch,code] of [[{identity:'other'},'document_changed'],[{revision:1},'document_revision_changed'],[{path:'OTHER.rvt'},'planning_state_changed'],[{isModified:true},'planning_state_changed']]){
    const f=fixture({contexts:[context,{...context,document:{...context.document,...patch}}]});
    await assert.rejects(run(base,f),e=>e.code===code && e.details.planId==='plan-a' && e.details.previewCleanup.status==='cancelled');
    assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get','revit.plan.create','revit.context.get','revit.plan.cancel']);
  }
});

test('preview failure never retries and cleanup failure stays unknown',async()=>{
  const timeout=Object.assign(new Error('Preview timed out'),{code:'preview_timeout'});
  const f=fixture({createError:timeout});await assert.rejects(run(base,f),e=>e===timeout);
  assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get','revit.plan.create']);
  const cleanup=fixture({contexts:[context,{...context,document:{...context.document,revision:1}}],cancelError:new Error('Disconnected')});
  await assert.rejects(run(base,cleanup),e=>e.code==='document_revision_changed' && e.details.previewCleanup.status==='unknown');
  assert.equal(cleanup.calls.filter(c=>c.method==='revit.plan.cancel').length,1);
});

test('aborted requests stop before reads and model-plan creation',async()=>{
  const f=fixture();const abort=new AbortController();abort.abort();await assert.rejects(run(base,f,abort.signal));assert.deepEqual(f.calls,[]);
});

async function sdkFixture(t,{contexts=[context],plan=pending,inspectItems=[],searchItems=[],features=[]}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-registered-preview-'));
  const token='registered-planning-test-'.repeat(3);const calls=[];const sockets=new Set();let index=0;
  const bridge=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
    socket.on('data',data=>{
      buffer+=data.toString('utf8');const i=buffer.indexOf('\n');if(i<0)return;
      const request=JSON.parse(buffer.slice(0,i));assert.equal(request.token,token);calls.push({method:request.method,args:request.params});
      let result;
      if(request.method==='revit.bridge.info')result={protocol:'revit-auto-2027-v2',features,confirmationMode:'chat'};
      else if(request.method==='revit.context.get')result=contexts[Math.min(index++,contexts.length-1)];
      else if(request.method==='revit.inspect')result={items:inspectItems.filter(item=>request.params.elementIds.includes(item.summary.id))};
      else if(request.method==='revit.search'){const offset=request.params.offset??0,limit=request.params.limit??500;result={items:searchItems.slice(offset,offset+limit),hasMore:offset+limit<searchItems.length};}
      else if(request.method==='revit.plan.create')result={...plan,operations:request.params.operations};
      else if(request.method==='revit.plan.cancel')result={status:'cancelled'};
      else {socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:false,error:{code:'unexpected_method',message:request.method}})+'\n');return;}
      socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result})+'\n');
    });
  });
  t.after(async()=>{
    for(const socket of sockets)socket.destroy();await new Promise(resolve=>bridge.close(resolve));
    assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('revit-registered-preview-'));
    await fs.rm(dir,{recursive:true,force:true});
  });
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const config=path.join(dir,'bridge.json');await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token}));
  const client=new Client({name:'registered-preview-contract',version:'1.0'});t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
  return {client,calls};
}
const invoke=async(client,args)=>{const result=await client.callTool({name:'revit_workflow_run',arguments:args});return {error:result.isError===true,data:JSON.parse(result.content[0].text)};};

test('SDK discovers all nine registered write workflows and performs only a pinned preview',async t=>{
  const {client,calls}=await sdkFixture(t);
  const registry=await client.callTool({name:'revit_workflow_list',arguments:{}});const rows=JSON.parse(registry.content[0].text).workflows;
  for(const id of registeredWriteWorkflowIds)assert.deepEqual(rows.find(r=>r.workflowId===id).planningModes,['explicit','ask','assisted']);
  const result=await invoke(client,base);assert.equal(result.error,false);assert.equal(result.data.planCreated,true);assert.equal(result.data.documentRevision,0);
  assert.equal(result.data.plan.operations[0].wallTypeId,11);
  assert.deepEqual(calls.filter(c=>c.method!=='revit.bridge.info').map(c=>c.method),['revit.context.get','revit.plan.create','revit.context.get']);
});

for(const name of ['architecture.build','architecture.openings'])test('SDK '+name+' preserves dedicated copy dimensions and matching placement in one pinned preview',async t=>{
  const {client,calls}=await sdkFixture(t,{features:['architecture-type-copy','controlled-structural-columns']});
  const category=name==='architecture.build'?'OST_StructuralColumns':'OST_Doors';
  const typeCopy={sourceTypeId:10,name:'Reviewed native type',category,dimensions:[{parameterId:-1001301,name:'Reviewed width',valueMm:500},{parameterId:102,name:'Reviewed height',valueMm:500}],id:'reviewed-type'};
  const placement=name==='architecture.build'?{columns:[{symbolId:'@reviewed-type',baseLevelId:20,topLevelId:30,baseOffsetMm:0,topOffsetMm:0,point:{xMm:1000,yMm:2000}}]}:
    {doors:[{symbolId:'@reviewed-type',hostElementId:40,levelId:20,point:{xMm:1000,yMm:0,zMm:0}}]};
  const result=await invoke(client,{...base,name,input:{typeCopies:[typeCopy],...placement}});
  assert.equal(result.error,false);assert.equal(result.data.planCreated,true);
  const create=calls.find(row=>row.method==='revit.plan.create');assert.equal(create.args.expectedRevision,0);assert.equal(create.args.documentIdentity,base.documentIdentity);
  assert.deepEqual(create.args.operations[0],{...typeCopy,operationType:'duplicate_architecture_type'});assert.equal(create.args.operations[1].symbolId,'@reviewed-type');
  assert.deepEqual(calls.filter(row=>row.method!=='revit.bridge.info').map(row=>row.method),['revit.context.get','revit.plan.create','revit.context.get']);
  calls.length=0;const invalid=await invoke(client,{...base,name,input:{typeCopies:[{...typeCopy,name:'Unreviewed/type'}],...placement}});
  assert.equal(invalid.error,true);assert.deepEqual(calls,[]);
});

test('SDK architecture copy previews stop at an older host capability gate without confirmation or plan forwarding',async t=>{
  const {client,calls}=await sdkFixture(t,{features:['controlled-structural-columns','controlled-family-loading']});
  const typeCopy={sourceTypeId:10,name:'Reviewed native type',category:'OST_StructuralColumns',dimensions:[{parameterId:101,name:'b',valueMm:500},{parameterId:102,name:'h',valueMm:500}]};
  for(const name of ['architecture.build','architecture.openings']){
    const result=await invoke(client,{...base,name,input:{typeCopies:[typeCopy]}});
    assert.equal(result.error,true);assert.equal(result.data.code,'feature_not_loaded');assert.ok(result.data.details.requiredFeatures.includes('architecture-type-copy'));
  }
  assert.deepEqual(calls.filter(row=>row.method!=='revit.bridge.info').map(row=>row.method),['revit.context.get','revit.context.get']);
});

test('SDK ask and unsupported workflow inputs never contact the native bridge',async t=>{
  const {client,calls}=await sdkFixture(t);
  const ask=await invoke(client,{...base,planningMode:'ask',input:{}});assert.equal(ask.error,false);assert.equal(ask.data.planCreated,false);
  for(const input of [{operations:[]},{walls:[],code:'unsafe'},{...base.input,expectedRevision:2},{}]){
    const result=await invoke(client,{...base,input});assert.equal(result.error,true);
  }
  assert.deepEqual(calls,[]);
});

test('SDK assisted mode preserves assumptions without confirmation or additional approval fields',async t=>{
  const {client,calls}=await sdkFixture(t);
  const result=await invoke(client,{...base,name:'lighting.full',planningMode:'assisted',assumptions:['User authorizes these explicit candidate light positions.'],input:scene['lighting.full']});
  assert.equal(result.error,false);assert.equal(result.data.candidateOnly,true);assert.equal(result.data.plan.requiresRevitConfirmation,false);assert.equal(result.data.assumptions.length,1);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK changed context discards and cancels one pending preview',async t=>{
  const {client,calls}=await sdkFixture(t,{contexts:[context,{...context,document:{...context.document,revision:1}}]});
  const result=await invoke(client,base);assert.equal(result.error,true);assert.equal(result.data.code,'document_revision_changed');
  assert.equal(calls.filter(c=>c.method==='revit.plan.cancel').length,1);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK legacy parameter-table preview uses the same pinned adapter and returns preview metadata',async t=>{
  const {client,calls}=await sdkFixture(t);
  const result=await client.callTool({name:'revit_import_preview',arguments:{
    documentIdentity:'doc-a',expectedRevision:0,summary:'Legacy table entry',
    rows:[{operationType:'create_level',name:'Imported Level',elevationMm:'0'}]
  }});
  assert.notEqual(result.isError,true);
  const data=JSON.parse(result.content[0].text);
  assert.equal(data.status,'preview');assert.equal(data.planCreated,true);assert.equal(data.workflowId,'imports.parameter_table');
  assert.equal(data.planningMode,'explicit');assert.notEqual(data.candidateOnly,true);assert.equal(data.documentIdentity,'doc-a');assert.equal(data.documentRevision,0);
  assert.deepEqual(data.plan.operations,[{operationType:'create_level',name:'Imported Level',elevationMm:0}]);
  assert.deepEqual(calls.filter(call=>call.method!=='revit.bridge.info').map(call=>call.method),['revit.context.get','revit.plan.create','revit.context.get']);
  const create=calls.find(call=>call.method==='revit.plan.create');
  assert.equal(create.args.expectedRevision,0);assert.equal(create.args.documentIdentity,'doc-a');assert.equal(create.args.summary,'Legacy table entry；明确约束预览');
  assert.ok(!calls.some(call=>/confirm|commit|save/.test(call.method)));
});

test('SDK legacy parameter-table preview rejects stale revision before parsing or planning',async t=>{
  const {client,calls}=await sdkFixture(t,{contexts:[{...context,document:{...context.document,revision:1}}]});
  const result=await client.callTool({name:'revit_import_preview',arguments:{
    documentIdentity:'doc-a',expectedRevision:0,
    rows:[{operationType:'create_level',name:'Imported Level',elevationMm:0}]
  }});
  assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,'document_revision_changed');
  assert.deepEqual(calls.filter(call=>call.method!=='revit.bridge.info').map(call=>call.method),['revit.context.get']);
});

test('SDK legacy parameter-table preview cancels only its known plan after context drift',async t=>{
  const {client,calls}=await sdkFixture(t,{contexts:[context,{...context,document:{...context.document,revision:1}}]});
  const result=await client.callTool({name:'revit_import_preview',arguments:{
    documentIdentity:'doc-a',expectedRevision:0,
    rows:[{operationType:'create_level',name:'Imported Level',elevationMm:0}]
  }});
  assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,'document_revision_changed');
  assert.deepEqual(calls.filter(call=>call.method!=='revit.bridge.info').map(call=>call.method),['revit.context.get','revit.plan.create','revit.context.get','revit.plan.cancel']);
  assert.equal(calls.filter(call=>call.method==='revit.plan.cancel').length,1);
  assert.equal(calls.find(call=>call.method==='revit.plan.cancel').args.planId,'plan-a');
  assert.ok(!calls.some(call=>/confirm|commit|save/.test(call.method)));
});

test('SDK electrical.wire discloses explicit replacement and control-label baseline without committing',async t=>{
  const inspectItems=[
    {summary:{id:31,className:'Wire',ownerViewId:24,typeId:23}},
    {summary:{id:24,className:'ViewPlan',isViewTemplate:false}},
    {summary:{id:32,className:'FamilyInstance',categoryId:-2008087},parameters:[{id:-1140110,storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'K1'}]}
  ];
  const {client,calls}=await sdkFixture(t,{inspectItems});
  const result=await invoke(client,{...base,name:'electrical.wire',input:{...scene['electrical.wire'],wireDeletions:[{elementId:31,viewId:24}],switchControls:[{elementId:32,controlId:'K2'}]}});
  assert.equal(result.error,false);assert.equal(result.data.planCreated,true);
  assert.deepEqual(result.data.plan.operations.map(op=>op.operationType),['delete_element','create_wire','set_parameter']);
  assert.equal(result.data.domainReview.switchControls[0].before,'K1');
  assert.equal(result.data.domainReview.switchControls[0].after,'K2');
  assert.equal(result.data.domainReview.exactDeletionCascadeVerified,false);
  assert.equal(calls.filter(c=>c.method==='revit.inspect').length,1);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
  const registry=await client.callTool({name:'revit_workflow_list',arguments:{}});
  assert.ok(JSON.parse(registry.content[0].text).workflows.find(workflow=>workflow.workflowId==='electrical.wire').affectedCategories.includes('OST_LightingDevices'));
});

test('SDK refuses wrong-view replacement before creating any native plan',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:[{summary:{id:31,className:'Wire',ownerViewId:25}},{summary:{id:24,className:'ViewPlan',isViewTemplate:false}}]});
  const result=await invoke(client,{...base,name:'electrical.wire',input:{...scene['electrical.wire'],wireDeletions:[{elementId:31,viewId:24}]}});
  assert.equal(result.error,true);assert.equal(result.data.code,'wire_scope_mismatch');
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});

const circuitScope=[
  {summary:{id:21,className:'FamilyInstance',categoryId:-2001120},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]}},
  {summary:{id:22,className:'FamilyInstance',categoryId:-2001120},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]}},
  {summary:{id:23,className:'FamilyInstance',categoryId:-2001040},parameters:[{id:-1140064,storageType:'ElementId',readOnly:false,valueSupported:true,hasValue:true,value:25}]},
  {summary:{id:24,className:'FamilyInstance',categoryId:-2008087},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]}},
  {summary:{id:25,className:'DistributionSysType',categoryId:-2008041}},
  {summary:{id:26,className:'ElectricalSystem'},parameters:[{id:-1140089,storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'Original'}]}
];
const circuitArgs={...base,name:'electrical.circuit'};

test('SDK circuit preview discloses existing name and distribution no-op without writes',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:circuitScope});
  const result=await invoke(client,{...circuitArgs,input:{panelDistributionSystems:[{panelId:23,distributionSystemId:25}],parameterChanges:[{elementId:26,parameter:'BIP:RBS_ELEC_CIRCUIT_NAME',value:'Reviewed'}]}});
  assert.equal(result.error,false);assert.equal(result.data.domainReview.parameterChanges[0].before,'Original');
  assert.equal(result.data.domainReview.parameterChanges[0].after,'Reviewed');
  assert.equal(result.data.domainReview.panelDistributionSystems[0].before,25);
  assert.equal(result.data.domainReview.panelDistributionSystems[0].noOp,true);
  assert.deepEqual(result.data.plan.operations.map(op=>op.operationType),['set_parameter','set_parameter']);
  assert.equal(result.data.plan.requiresRevitConfirmation,false);
  assert.deepEqual(calls.filter(c=>c.method!=='revit.bridge.info').map(c=>c.method),['revit.context.get','revit.inspect','revit.context.get','revit.plan.create','revit.context.get']);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK circuit unsafe parameter types and duplicate reservations fail before bridge calls',async t=>{
  const {client,calls}=await sdkFixture(t);
  for(const input of [
    {parameterChanges:[{elementId:26,parameter:'BIP:RBS_ELEC_CIRCUIT_NAME',value:25}]},
    {parameterChanges:[{elementId:23,parameter:'BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM',value:'25'}]},
    {circuits:[{elementIds:[21],panelId:23},{elementIds:[21],panelId:23}]},
    {circuits:[{elementIds:[21],panelId:23,id:'same'},{elementIds:[22],panelId:23,id:'same'}]}
  ])assert.equal((await invoke(client,{...circuitArgs,input})).error,true);
  assert.deepEqual(calls,[]);
});

test('SDK circuit rejects unknown membership before any plan is created',async t=>{
  const inspectItems=circuitScope.map(item=>item.summary.id===21?{...item,electrical:undefined}:item);
  const {client,calls}=await sdkFixture(t,{inspectItems});
  const result=await invoke(client,{...circuitArgs,input:{circuits:[{elementIds:[21,22],switchIds:[24],panelId:23}]}});
  assert.equal(result.error,true);assert.equal(result.data.code,'circuit_membership_unknown');
  assert.equal(calls.filter(c=>c.method==='revit.inspect').length,1);
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK circuit generic distribution parameter path verifies actual native type',async t=>{
  const inspectItems=circuitScope.map(item=>item.summary.id===25?{summary:{id:25,className:'Wall',categoryId:-2000011}}:item);
  const {client,calls}=await sdkFixture(t,{inspectItems});
  const result=await invoke(client,{...circuitArgs,input:{parameterChanges:[{elementId:23,parameter:'BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM',value:25}]}});
  assert.equal(result.error,true);assert.equal(result.data.code,'distribution_system_mismatch');
  assert.deepEqual(calls.find(c=>c.method==='revit.inspect').args.elementIds,[23,25]);
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});

test('SDK circuit context changes after inspection stop before preview',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:circuitScope,contexts:[context,{...context,document:{...context.document,revision:1}}]});
  const result=await invoke(client,{...circuitArgs,input:scene['electrical.circuit']});
  assert.equal(result.error,true);assert.equal(result.data.code,'document_revision_changed');
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});

test('SDK circuit stale result cancels once and never retries creation or confirmation',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:circuitScope,contexts:[context,context,{...context,document:{...context.document,revision:1}}]});
  const result=await invoke(client,{...circuitArgs,input:scene['electrical.circuit']});
  assert.equal(result.error,true);assert.equal(result.data.code,'document_revision_changed');
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);
  assert.equal(calls.filter(c=>c.method==='revit.plan.cancel').length,1);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK circuit ask stays offline and assisted requires disclosed assumptions',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:circuitScope});
  const ask=await invoke(client,{...circuitArgs,planningMode:'ask',input:{}});
  assert.equal(ask.error,false);assert.equal(ask.data.planCreated,false);assert.ok(ask.data.questions.length>0);assert.deepEqual(calls,[]);
  const missing=await invoke(client,{...circuitArgs,planningMode:'assisted',input:scene['electrical.circuit']});
  assert.equal(missing.error,true);assert.equal(missing.data.code,'assumptions_required');assert.deepEqual(calls,[]);
  const candidate=await invoke(client,{...circuitArgs,planningMode:'assisted',assumptions:['User permits these explicit candidate circuit members.'],input:scene['electrical.circuit']});
  assert.equal(candidate.error,false);assert.equal(candidate.data.candidateOnly,true);assert.equal(candidate.data.assumptions.length,1);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

const sheetMetadataScope=[
  {summary:{id:41,className:'ViewSheet',sheetNumber:'A101',name:'Original sheet'},parameters:[
    {id:-1007401,storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'A101'},
    {id:-1007400,storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'Original sheet'}
  ]},
  {summary:{id:42,className:'ViewPlan',isViewTemplate:false,name:'Original view',viewScale:100},parameters:[
    {id:-1005112,storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'Original view'},
    {id:-1005151,storageType:'Integer',readOnly:false,valueSupported:true,hasValue:true,value:100}
  ]}
];
test('SDK sheet metadata preview uses inspected built-in baselines and only reviewed fields',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:sheetMetadataScope,searchItems:[{id:41,className:'ViewSheet',sheetNumber:'A101'}]});
  const result=await invoke(client,{...base,name:'electrical.sheet',input:{sheetChanges:[{sheetId:41,number:'E101',name:'Lighting sheet'}],viewChanges:[{viewId:42,name:'Lighting plan',scale:50}]}});
  assert.equal(result.error,false,JSON.stringify(result.data));
  assert.equal(result.data.planCreated,true);assert.ok(result.data.domainReview);
  const ops=result.data.plan.operations;assert.equal(ops.length,4);
  const projected=ops.map(({elementId,parameter,value})=>({elementId,parameter,value}));
  for(const expected of [
    {elementId:41,parameter:'BIP:SHEET_NUMBER',value:'E101'},
    {elementId:41,parameter:'BIP:SHEET_NAME',value:'Lighting sheet'},
    {elementId:42,parameter:'BIP:VIEW_NAME',value:'Lighting plan'},
    {elementId:42,parameter:'BIP:VIEW_SCALE_PULLDOWN_METRIC',value:50}
  ])assert.ok(projected.some(actual=>JSON.stringify(actual)===JSON.stringify(expected)),JSON.stringify(projected));
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);
  assert.ok(calls.some(c=>c.method==='revit.inspect'));assert.ok(calls.some(c=>c.method==='revit.search'));
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});
test('SDK rejects conflicting sheet numbering and ignored configure fields before plan creation',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:sheetMetadataScope,searchItems:[{id:41,className:'ViewSheet',sheetNumber:'A101'},{id:43,className:'ViewSheet',sheetNumber:'E101'}]});
  const conflict=await invoke(client,{...base,name:'electrical.sheet',input:{sheetChanges:[{sheetId:41,number:'E101'}]}});
  assert.equal(conflict.error,true);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
  const invalid=await invoke(client,{...base,name:'electrical.sheet',input:{viewConfigurations:[{viewId:42,referenceViewId:44,settings:['crop'],name:'Ignored mutation'}]}});
  assert.equal(invalid.error,true);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});
test('SDK sheet metadata read races stop before preview creation',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:sheetMetadataScope,contexts:[context,{...context,document:{...context.document,revision:1}}]});
  const result=await invoke(client,{...base,name:'electrical.sheet',input:{viewChanges:[{viewId:42,scale:50}]}});
  assert.equal(result.error,true);assert.equal(result.data.code,'document_revision_changed');
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});

test('SDK new sheet creation rejects an occupied native number without creating a plan',async t=>{
  const {client,calls}=await sdkFixture(t,{searchItems:[{id:41,className:'ViewSheet',sheetNumber:'E101'}]});
  const result=await invoke(client,{...base,name:'electrical.sheet',input:{sheets:[{number:'E101',name:'New sheet'}]}});
  assert.equal(result.error,true);assert.equal(result.data.code,'sheet_number_conflict');
  assert.equal(calls.filter(c=>c.method==='revit.search').length,1);
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK new sheet creation rejects duplicate new numbers without any native calls',async t=>{
  const {client,calls}=await sdkFixture(t);
  const result=await invoke(client,{...base,name:'electrical.sheet',input:{sheets:[{number:'E201',name:'First'},{number:'E201',name:'Second'}]}});
  assert.equal(result.error,true);assert.equal(result.data.code,'sheet_number_conflict');assert.deepEqual(calls,[]);
});

test('SDK new sheet creation discloses catalog-only scope and preserves exact requested input',async t=>{
  const {client,calls}=await sdkFixture(t,{searchItems:[{id:41,className:'ViewSheet',sheetNumber:'E101'}]});
  const result=await invoke(client,{...base,name:'electrical.sheet',input:{sheets:[{number:' E201 ',name:' New sheet ',titleBlockId:30}]}});
  assert.equal(result.error,false,JSON.stringify(result.data));
  assert.equal(result.data.domainReview.scope,'new-sheet-number-catalog-only');
  assert.equal(result.data.domainReview.sheetNumberCatalog.count,1);
  assert.equal(result.data.domainReview.inspectedElementCount,0);
  assert.equal(result.data.domainReview.nativeCreationAccepted,false);
  assert.equal(result.data.plan.operations[0].number,' E201 ');
  assert.equal(result.data.plan.operations[0].name,' New sheet ');
  assert.equal(result.data.plan.operations[0].titleBlockId,30);
  assert.deepEqual(calls.filter(c=>c.method!=='revit.bridge.info').map(c=>c.method),
    ['revit.context.get','revit.search','revit.context.get','revit.plan.create','revit.context.get']);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK new sheet creation rejects state drift after its catalog read',async t=>{
  const {client,calls}=await sdkFixture(t,{contexts:[context,{...context,document:{...context.document,revision:1}}]});
  const result=await invoke(client,{...base,name:'electrical.sheet',input:{sheets:[{number:'E201',name:'New sheet'}]}});
  assert.equal(result.error,true);assert.equal(result.data.code,'document_revision_changed');
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('SDK new sheet creation cannot bypass its catalog through a name-only metadata row',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:sheetMetadataScope,searchItems:[{id:41,className:'ViewSheet',sheetNumber:'A101'}]});
  const result=await invoke(client,{...base,name:'electrical.sheet',input:{sheetChanges:[{sheetId:41,name:'Renamed'}],sheets:[{number:'A101',name:'New sheet'}]}});
  assert.equal(result.error,true);assert.equal(result.data.code,'sheet_number_conflict');
  assert.equal(calls.filter(c=>c.method==='revit.search').length,1);
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});
test('SDK parameter import ask mode uses both entrances without source reads or native calls',async t=>{
  const {client,calls}=await sdkFixture(t);
  const result=await invoke(client,{name:'imports.parameter_table',documentIdentity:'doc-a',planningMode:'ask',input:{}});
  assert.equal(result.error,false,JSON.stringify(result.data));assert.equal(result.data.planCreated,false);assert.equal(result.data.requiresClarification,true);
  const raw=await client.callTool({name:'revit_parameter_import_preview',arguments:{documentIdentity:'doc-a',planningMode:'ask'}});
  assert.ok(!raw.isError);assert.equal(JSON.parse(raw.content[0].text).planCreated,false);
  assert.deepEqual(calls,[]);
});
test('SDK parameter import assisted requires assumptions and preserves candidate disclosure',async t=>{
  const {client,calls}=await sdkFixture(t);
  const args={name:'imports.parameter_table',documentIdentity:'doc-a',expectedRevision:0,planningMode:'assisted',input:{rows:[{operationType:'create_level',name:'Reviewed level',elevationMm:'0'}],mapping:{},defaults:{}}};
  const missing=await invoke(client,args);assert.equal(missing.error,true);assert.deepEqual(calls,[]);
  const result=await invoke(client,{...args,assumptions:['User permits these explicit table rows as a candidate.']});
  assert.equal(result.error,false,JSON.stringify(result.data));assert.equal(result.data.candidateOnly,true);assert.equal(result.data.planningMode,'assisted');
  assert.ok(result.data.assumptions.length);assert.ok(result.data.warnings.length);assert.ok(Array.isArray(result.data.missingInputs));assert.ok(Array.isArray(result.data.alternatives));
  const creates=calls.filter(c=>c.method==='revit.plan.create');assert.equal(creates.length,1);assert.equal(creates[0].args.source,'workflow:imports.parameter_table:assisted');
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});
test('SDK parameter import context changes cancel only the known pending preview',async t=>{
  const {client,calls}=await sdkFixture(t,{contexts:[context,{...context,document:{...context.document,revision:1}}]});
  const result=await invoke(client,{name:'imports.parameter_table',documentIdentity:'doc-a',expectedRevision:0,input:{rows:[{operationType:'create_level',name:'Reviewed level',elevationMm:'0'}],mapping:{},defaults:{}}});
  assert.equal(result.error,true);
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);assert.equal(calls.filter(c=>c.method==='revit.plan.cancel').length,1);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('registered previews reject unknown path or saved-state evidence before metadata inspection',async()=>{
  for(const document of [
    {identity:'doc-a',revision:0},
    {...context.document,path:undefined},
    {...context.document,isModified:undefined},
    {...context.document,isModified:null}
  ]){
    const f=fixture({contexts:[{active:true,document}]});
    await assert.rejects(run({...base,name:'electrical.sheet',input:{viewChanges:[{viewId:42,scale:50}]}},f),error=>error.code==='planning_context_invalid');
    assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get']);
  }
});
test('registered previews permit explicitly known unsaved-new-project paths',async()=>{
  const fresh={...context,document:{...context.document,path:'',isModified:true}};
  const f=fixture({contexts:[fresh]});const result=await run(base,f);
  assert.equal(result.planCreated,true);
});

const drawingMoveInput={placementMoves:[{placementId:51,sheetId:52,viewId:53,xMm:420,yMm:280}]};
const drawingMoveScope=[
  {summary:{id:51,className:'PanelScheduleSheetInstance',ownerViewId:52},drawing:{sheetId:52,viewId:53,position:{xMm:400,yMm:200,zMm:0}}},
  {summary:{id:52,className:'ViewSheet'}},
  {summary:{id:53,className:'PanelScheduleView',isViewTemplate:false}}
];
test('registered sheet union inspection rechecks the session before preview without duplicate reads',async()=>{
  for(const patch of [null,{revision:1},{path:'other.rvt'},{isModified:true}]){
    const calls=[];let contextReads=0;
    const items=structuredClone(drawingMoveScope);
    items[1].parameters=[{id:-1007400,storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'Existing sheet'}];
    const call=async(method,args)=>{
      calls.push({method,args});
      if(method==='revit.context.get')return {...structuredClone(context),document:{...context.document,...(contextReads++>0?patch:null)}};
      if(method==='revit.inspect')return {items:args.elementIds.map(id=>structuredClone(items.find(item=>item.summary.id===id)))};
      if(method==='revit.plan.create')return structuredClone(pending);
      throw new Error('Unexpected '+method);
    };
    const args={...base,name:'electrical.sheet',input:{...drawingMoveInput,sheetChanges:[{sheetId:52,name:'Reviewed name'}]}};
    if(patch){
      await assert.rejects(previewRegisteredWriteWorkflow(args,getWorkflow(args.name),call),error=>error.code===(patch.revision?'document_revision_changed':'planning_state_changed'));
      assert.deepEqual(calls.map(row=>row.method),['revit.context.get','revit.inspect','revit.context.get']);
    }else{
      const result=await previewRegisteredWriteWorkflow(args,getWorkflow(args.name),call);
      assert.equal(result.domainReview.inspectedElementCount,3);assert.equal(result.domainReview.inspectionSnapshotShared,true);
      assert.deepEqual(calls.map(row=>row.method),['revit.context.get','revit.inspect','revit.context.get','revit.plan.create','revit.context.get']);
    }
    assert.deepEqual(calls.filter(row=>row.method==='revit.inspect').map(row=>row.args.elementIds),[[52,51,53]]);
  }
});
for(const name of ['electrical.sheet','architecture.documentation']){
  test('SDK '+name+' creates one reviewed movement preview with a capable host and never confirms',async t=>{
    const {client,calls}=await sdkFixture(t,{inspectItems:drawingMoveScope,features:['drawing-placement-move']});
    const result=await invoke(client,{...base,name,input:drawingMoveInput});
    assert.equal(result.error,false,JSON.stringify(result.data));assert.equal(result.data.planCreated,true);
    assert.equal(result.data.domainReview.placementMoves[0].before.xMm,400);
    assert.equal(result.data.plan.operations[0].operationType,'move_drawing_placement');
    assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);
    assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
  });
}
test('SDK movement never forwards plan creation to a host without the native movement feature',async t=>{
  const {client,calls}=await sdkFixture(t,{inspectItems:drawingMoveScope});
  const result=await invoke(client,{...base,name:'electrical.sheet',input:drawingMoveInput});
  assert.equal(result.error,true);assert.equal(result.data.code,'feature_not_loaded');
  assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
  assert.ok(!calls.some(c=>/confirm|commit|save/.test(c.method)));
});
