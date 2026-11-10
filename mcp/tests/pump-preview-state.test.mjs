import test from 'node:test';
import assert from 'node:assert/strict';
import {previewPumpWorkflow} from '../pump-planning.mjs';

const context={active:true,document:{identity:'doc-a',revision:0,path:'test.rvt',
  isModified:false,isFamilyDocument:false,isReadOnly:false}};
const point=xMm=>({xMm,yMm:0,zMm:1000});
const request={name:'pump_room.build',documentIdentity:'doc-a',expectedRevision:0,planningMode:'explicit',input:{
  pipes:[{id:'pipe',pipeTypeId:10,systemTypeId:20,levelId:30,diameterMm:80,flowIntent:'neutral',start:point(0),end:point(1000)}],
  clearanceCheck:{mode:'skip',reason:'Explicit isolated test scope.'}}};

function fixture({contexts=[context],planPatch={},createError,cancelError,cancelResult={status:'cancelled'},reportPatch={}}={}){
  const calls=[];let reads=0;
  const call=async(method,args)=>{
    calls.push({method,args:structuredClone(args)});
    if(method==='revit.context.get'){
      const result=contexts[Math.min(reads++,contexts.length-1)];
      if(result instanceof Error)throw result;
      return structuredClone(result);
    }
    if(method==='revit.collision.check')return {documentIdentity:'doc-a',documentRevision:0,
      scope:{truncated:false,targetElementIds:args.targetElementIds,excludeElementIds:args.excludeElementIds??[],clearanceMm:args.clearanceMm},
      diagnostics:{complete:true,truncated:false},collisions:[],unknown:[],clearanceCandidates:[],...structuredClone(reportPatch)};
    if(method==='revit.plan.create'){
      if(createError)throw createError;
      return JSON.parse(JSON.stringify({planId:'pump-plan',status:'pending',documentIdentity:'doc-a',documentRevision:0,
        operations:args.operations,source:args.source,summary:args.summary,warnings:[],requiresConfirmation:true,
        confirmationMode:'chat',requiresRevitConfirmation:false,...planPatch}));
    }
    if(method==='revit.plan.cancel'){
      if(cancelError)throw cancelError;
      return {planId:args.planId,...cancelResult};
    }
    throw new Error('Unexpected native call: '+method);
  };
  return {call,calls};
}

test('pump build rejects a revision change after preview and cancels its own preview once',async()=>{
  const f=fixture({contexts:[context,{...context,document:{...context.document,revision:1}}]});
  await assert.rejects(previewPumpWorkflow(request,f.call),error=>error.code==='document_revision_changed');
  assert.equal(f.calls.filter(c=>c.method==='revit.plan.create').length,1);
  assert.deepEqual(f.calls.filter(c=>c.method==='revit.plan.cancel').map(c=>c.args),[{planId:'pump-plan'}]);
});

test('pump build rejects operations replaced in the native preview',async()=>{
  const f=fixture({planPatch:{operations:[{operationType:'delete_element',elementId:999}]}});
  await assert.rejects(previewPumpWorkflow(request,f.call),error=>error.code==='plan_scope_mismatch');
  assert.equal(f.calls.filter(c=>c.method==='revit.plan.cancel').length,1);
});

const noWrites=calls=>assert.ok(!calls.some(c=>/confirm|commit|save|lifecycle/.test(c.method)));
const scenes={
  'pump_room.build':request.input,
  'pump_room.route':{routes:[{id:'route',pipeTypeId:10,systemTypeId:20,levelId:30,diameterMm:80,
    flowIntent:'neutral',points:[point(0),point(1000)]}],clearanceCheck:request.input.clearanceCheck},
  'pump_room.connect':{connections:[{firstElementId:10,secondElementId:11,firstConnectorId:0,secondConnectorId:1,
    flowIntent:'neutral'}],clearanceCheck:request.input.clearanceCheck}
};
for(const [name,input] of Object.entries(scenes))test(name+' returns one exact preview after checking the final context',async()=>{
  const f=fixture();const result=await previewPumpWorkflow({...request,name,input},f.call);
  assert.equal(result.planCreated,true);assert.equal(result.documentRevision,0);assert.equal(result.documentIdentity,'doc-a');
  assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get','revit.plan.create','revit.context.get']);
  assert.deepEqual(result.plan.operations,f.calls[1].args.operations);
  noWrites(f.calls);
});

test('unknown, family, read-only and stale contexts fail before plan creation',async()=>{
  for(const next of [{active:false},{active:true,document:{}},
    {...context,document:{...context.document,identity:'other'}},
    {...context,document:{...context.document,revision:null}},
    {...context,document:{...context.document,path:null}},
    {...context,document:{...context.document,isModified:undefined}},
    {...context,document:{...context.document,isFamilyDocument:true}},
    {...context,document:{...context.document,isReadOnly:true}}]){
    const f=fixture({contexts:[next]});await assert.rejects(previewPumpWorkflow(request,f.call));
    assert.equal(f.calls.filter(c=>c.method==='revit.plan.create').length,0);noWrites(f.calls);
  }
});

test('final identity, path and saved-state drift cancels exactly one known pending preview',async()=>{
  for(const [patch,code] of [[{identity:'other'},'document_changed'],[{path:'other.rvt'},'planning_state_changed'],
    [{isModified:true},'planning_state_changed']]){
    const f=fixture({contexts:[context,{...context,document:{...context.document,...patch}}]});
    await assert.rejects(previewPumpWorkflow(request,f.call),e=>e.code===code&&e.details.previewCleanup.status==='cancelled');
    assert.equal(f.calls.filter(c=>c.method==='revit.plan.cancel').length,1);noWrites(f.calls);
  }
});

test('unknown preview identity, changed geometry, omitted operations and confirmation contract are rejected',async()=>{
  for(const patch of [{planId:''},{source:'different'},{summary:'different'},
    {operations:[]},{operations:undefined},{operations:[{operationType:'create_pipe',start:point(123)}]},
    {confirmationMode:'dialog'},{requiresRevitConfirmation:true},{requiresConfirmation:false}]){
    const f=fixture({planPatch:patch});await assert.rejects(previewPumpWorkflow(request,f.call));
    assert.equal(f.calls.filter(c=>c.method==='revit.plan.create').length,1);
    assert.ok(f.calls.filter(c=>c.method==='revit.plan.cancel').length<=1);noWrites(f.calls);
  }
});

test('a returned committed plan is not cancelled or retried',async()=>{
  const f=fixture({planPatch:{status:'committed'}});
  await assert.rejects(previewPumpWorkflow(request,f.call),e=>e.code==='invalid_preview_response'&&
    e.details.previewCleanup.attempted===false&&e.details.previewCleanup.observedStatus==='committed');
  assert.equal(f.calls.filter(c=>c.method==='revit.plan.create').length,1);
  assert.equal(f.calls.filter(c=>c.method==='revit.plan.cancel').length,0);noWrites(f.calls);
});

test('native create timeout is propagated once without guessing a plan ID',async()=>{
  const failure=Object.assign(new Error('transport closed'),{code:'bridge_timeout'});
  const f=fixture({createError:failure});
  await assert.rejects(previewPumpWorkflow(request,f.call),e=>e===failure);
  assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get','revit.plan.create']);noWrites(f.calls);
});

test('failed or unverified cleanup preserves the original final-state failure',async()=>{
  for(const options of [{cancelError:new Error('bridge disconnected')},{cancelResult:{status:'committed'}}]){
    const f=fixture({contexts:[context,{...context,document:{...context.document,revision:1}}],...options});
    await assert.rejects(previewPumpWorkflow(request,f.call),e=>e.code==='document_revision_changed'&&
      e.details.planId==='pump-plan'&&e.details.previewCleanup.status==='unknown');
    assert.equal(f.calls.filter(c=>c.method==='revit.plan.cancel').length,1);noWrites(f.calls);
  }
});

const screened={...request,input:{...request.input,clearanceCheck:{mode:'screen_existing',targetElementIds:[123],clearanceMm:0}}};
test('state drift during collision screening prevents plan creation',async()=>{
  const f=fixture({contexts:[context,{...context,document:{...context.document,path:'other.rvt'}}]});
  await assert.rejects(previewPumpWorkflow(screened,f.call),e=>e.code==='planning_state_changed');
  assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get','revit.collision.check','revit.context.get']);noWrites(f.calls);
});

test('an unresolved collision screen rechecks context and returns no plan',async()=>{
  const f=fixture({reportPatch:{unknown:[{elementId:123}]}});
  const result=await previewPumpWorkflow(screened,f.call);
  assert.equal(result.planCreated,false);assert.equal(result.requiresClarification,true);
  assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get','revit.collision.check','revit.context.get']);noWrites(f.calls);
});

test('a failed final read cancels the known preview once while retaining the read error',async()=>{
  const failure=Object.assign(new Error('read unavailable'),{code:'read_timeout'});
  const f=fixture({contexts:[context,failure]});
  await assert.rejects(previewPumpWorkflow(request,f.call),e=>e===failure&&e.details.previewCleanup.status==='cancelled');
  assert.equal(f.calls.filter(c=>c.method==='revit.plan.cancel').length,1);noWrites(f.calls);
});

test('an already aborted request performs no native calls',async()=>{
  const controller=new AbortController();controller.abort();const f=fixture();
  await assert.rejects(previewPumpWorkflow(request,f.call,controller.signal));assert.deepEqual(f.calls,[]);
});
