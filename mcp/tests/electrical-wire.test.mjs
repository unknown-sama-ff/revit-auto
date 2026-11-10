import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowOperations } from '../workflows.mjs';
import { previewRegisteredWriteWorkflow } from '../registered-planning.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const wire = {firstElementId:21,secondElementId:22,wireTypeId:23,viewId:24,firstConnectorId:0,secondConnectorId:1,bends:[{xMm:1000,yMm:500}]};

test('electrical.wire explicitly replaces selected wires and sets reviewed switch controls',()=>{
  const operations=workflowOperations('electrical.wire',{
    wireDeletions:[{elementId:31,viewId:24}],wires:[wire],switchControls:[{elementId:32,controlId:'K7'}]
  });
  assert.deepEqual(operations.map(op=>op.operationType),['delete_element','create_wire','set_parameter']);
  assert.equal(operations[0].elementId,31);
  assert.equal(operations[1].firstConnectorId,0);
  assert.deepEqual(operations[1].bends,[{xMm:1000,yMm:500}]);
  assert.equal(operations[2].parameter,'BIP:RBS_ELEC_SWITCH_ID_PARAM');
  assert.equal(operations[2].value,'K7');
});

const context={active:true,document:{identity:'doc-a',revision:0,path:'test.rvt',isModified:false,isFamilyDocument:false,isReadOnly:false}};
const request={name:'electrical.wire',documentIdentity:'doc-a',expectedRevision:0,input:{wireDeletions:[{elementId:31,viewId:24}],wires:[wire],switchControls:[{elementId:32,controlId:'K7'}]}};
const nativeWire=id=>({summary:{id,className:'Wire',ownerViewId:24,typeId:23,uniqueId:'wire-'+id}});
const nativeView={summary:{id:24,className:'ViewPlan',isViewTemplate:false}};
const nativeSwitch={summary:{id:32,className:'FamilyInstance',categoryId:-2008087,mark:'SW-Office'},parameters:[{id:-1140110,storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'K1'}]};
function fixture({items=[nativeWire(31),nativeSwitch,nativeView],after=context,afterPreview=after,inspectError,createError}={}){
  const calls=[];let contexts=0;
  const call=async(method,args)=>{
    calls.push({method,args});
    if(method==='revit.context.get')return structuredClone(contexts++===0?context:contexts===2?after:afterPreview);
    if(method==='revit.inspect'){
      if(inspectError)throw inspectError;
      const rows=args.elementIds.map(id=>items.find(item=>(item.summary?.id??item.id)===id));
      return {items:structuredClone(rows.filter(Boolean))};
    }
    if(method==='revit.plan.create'){
      if(createError)throw createError;
      return {planId:'wire-plan',status:'pending',documentIdentity:'doc-a',documentRevision:0,operations:args.operations,warnings:['native dependency warning'],requiresRevitConfirmation:false};
    }
    if(method==='revit.plan.cancel')return {status:'cancelled'};
    throw new Error('Unexpected call '+method);
  };
  return {call,calls};
}
const run=(args,f)=>previewRegisteredWriteWorkflow(args,getWorkflow('electrical.wire'),f.call);

test('wire replacement preview includes baseline controls, exact selected scope and native dependency warnings',async()=>{
  const f=fixture(),result=await run(request,f);
  assert.equal(result.status,'preview');assert.equal(result.domainReview.selectedScopeVerified,true);
  assert.equal(result.domainReview.exactDeletionCascadeVerified,false);
  assert.deepEqual(result.domainReview.switchControls,[{elementId:32,mark:'SW-Office',before:'K1',after:'K7',noChange:false}]);
  assert.deepEqual(result.domainReview.wireDeletions,[{elementId:31,viewId:24,wireTypeId:23,uniqueId:'wire-31'}]);
  assert.deepEqual(result.plan.warnings,['native dependency warning']);assert.ok(result.warnings.length);
  assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get','revit.inspect','revit.context.get','revit.plan.create','revit.context.get']);
  assert.equal(f.calls[3].args.expectedRevision,0);assert.equal(result.plan.requiresRevitConfirmation,false);
});

test('wire ask and assisted retain common clarification and candidate boundaries',async()=>{
  const f=fixture();const ask=await run({...request,planningMode:'ask'},f);
  assert.equal(ask.planCreated,false);assert.equal(ask.requiresClarification,true);assert.deepEqual(f.calls,[]);
  const candidate=await run({...request,planningMode:'assisted',assumptions:['User allows the specified replacement path as a candidate.']},f);
  assert.equal(candidate.candidateOnly,true);assert.equal(candidate.assumptions.length,1);
  assert.ok(!f.calls.some(c=>/confirm|commit|save/.test(c.method)));
});

test('ambiguous destructive and executable wire inputs fail before bridge access',async()=>{
  const inputs=[
    {wireDeletions:[{elementId:31,viewId:24}]},
    {...request.input,wireDeletions:[{elementId:31,viewId:25}]},
    {...request.input,wireDeletions:[{elementId:31,viewId:24},{elementId:31,viewId:24}]},
    {...request.input,switchControls:[{elementId:32,controlId:'K7'},{elementId:32,controlId:'K8'}]},
    {switchControls:[{elementId:32,controlId:' '}]},
    {switchControls:[{elementId:32,controlId:'K7',parameter:'Comments'}]},
    {switchControls:[{elementId:'@guessed',controlId:'K7'}]},
    {...request.input,deleteAll:true},{...request.input,parameterChanges:[{elementId:21,parameter:'Comments',value:'bad'}]},
    {wires:[{...wire,bends:[{xMm:1000,yMm:500,zMm:2000}]}]},
    {wires:[{...wire,firstElementId:22}]},{wires:[{...wire,code:'unsafe'}]},
    {wires:[{...wire,bends:[{xMm:Infinity,yMm:0}]}]},
    {...request.input,operations:[{operationType:'delete_element',elementId:21}]}
  ];
  for(const input of inputs){const f=fixture();await assert.rejects(run({...request,input},f));assert.deepEqual(f.calls,[],JSON.stringify(input));}
});

test('deletion is blocked for a wrong native class, wrong owner view, missing element or template view',async()=>{
  for(const items of [
    [{summary:{...nativeWire(31).summary,className:'Wall'}},nativeSwitch,nativeView],
    [{summary:{...nativeWire(31).summary,ownerViewId:25}},nativeSwitch,nativeView],
    [{id:31,exists:false},nativeSwitch,nativeView],
    [nativeWire(31),nativeSwitch,{summary:{...nativeView.summary,isViewTemplate:true}}],
    [nativeWire(31),nativeSwitch,{summary:{...nativeView.summary,className:'View3D'}}],
    [nativeWire(31),nativeSwitch]
  ]){
    const f=fixture({items});await assert.rejects(run(request,f));
    assert.ok(!f.calls.some(c=>c.method==='revit.plan.create'));
  }
});

test('unknown wrong-category missing ambiguous or read-only switch parameters cannot become default controls',async()=>{
  const parameter=nativeSwitch.parameters[0];
  const switches=[
    {...nativeSwitch,summary:{...nativeSwitch.summary,categoryId:-2001120}},
    {...nativeSwitch,summary:{...nativeSwitch.summary,className:'FamilySymbol'}},
    {...nativeSwitch,parameters:[]},{...nativeSwitch,parameters:[parameter,parameter]},
    ...[{readOnly:true},{readOnly:undefined},{valueSupported:false},{storageType:'Integer',value:1},{value:undefined},{value:null,hasValue:true}].map(patch=>({...nativeSwitch,parameters:[{...parameter,...patch}]}))
  ];
  for(const item of switches){const f=fixture({items:[nativeWire(31),item,nativeView]});await assert.rejects(run(request,f));assert.ok(!f.calls.some(c=>c.method==='revit.plan.create'));}
});

test('switch-only previews disclose no-op and truly unset values without inventing strings',async()=>{
  for(const [patch,before,noChange] of [[{value:'K7'},'K7',true],[{value:null,hasValue:false},null,false]]){
    const item={...nativeSwitch,parameters:[{...nativeSwitch.parameters[0],...patch}]};
    const f=fixture({items:[item]});const result=await run({...request,input:{switchControls:[{elementId:32,controlId:'K7'}]}},f);
    assert.equal(result.domainReview.switchControls[0].before,before);assert.equal(result.domainReview.switchControls[0].noChange,noChange);
    assert.deepEqual(result.plan.operations.map(op=>op.operationType),['set_parameter']);
    assert.deepEqual(result.domainReview.wireDeletions,[]);
  }
});

test('large explicitly selected wire scopes are inspected in complete batches of at most 100',async()=>{
  const deletions=Array.from({length:205},(_,index)=>({elementId:1000+index,viewId:24}));
  const f=fixture({items:[...deletions.map(item=>nativeWire(item.elementId)),nativeView]});
  const result=await run({...request,input:{wireDeletions:deletions,wires:[wire]}},f);
  assert.deepEqual(f.calls.filter(c=>c.method==='revit.inspect').map(c=>c.args.elementIds.length),[100,100,6]);
  assert.equal(result.domainReview.wireDeletions.length,205);
  assert.equal(result.plan.operations.filter(op=>op.operationType==='delete_element').length,205);
});

test('partial duplicate or unexpected inspect results are unknown and do not create a preview',async()=>{
  for(const items of [[nativeWire(31)],[nativeWire(31),nativeWire(31),nativeView],[nativeWire(31),{summary:{id:999}},nativeView]]){
    const calls=[];const call=async(method)=>{calls.push(method);return method==='revit.context.get'?context:{items};};
    await assert.rejects(run(request,{call}),error=>error.code==='wire_scope_unknown');
    assert.deepEqual(calls,['revit.context.get','revit.inspect']);
  }
});

test('a context change during inspection blocks creation and a change after preview cancels once',async()=>{
  for(const patch of [{identity:'other'},{revision:1},{path:'other.rvt'},{isModified:true}]){
    const changed={...context,document:{...context.document,...patch}};
    const beforeCreate=fixture({after:changed});await assert.rejects(run(request,beforeCreate));
    assert.ok(!beforeCreate.calls.some(c=>c.method==='revit.plan.create'));
    const afterCreate=fixture({afterPreview:changed});await assert.rejects(run(request,afterCreate));
    assert.equal(afterCreate.calls.filter(c=>c.method==='revit.plan.cancel').length,1);
  }
});

test('native inspection and plan errors are never retried or committed',async()=>{
  for(const options of [{inspectError:new Error('Disconnected')},{createError:new Error('Native parameter is read-only')}]){
    const f=fixture(options);await assert.rejects(run(request,f));
    assert.equal(f.calls.filter(c=>c.method==='revit.inspect').length,1);
    assert.ok(f.calls.filter(c=>c.method==='revit.plan.create').length<=1);
    assert.ok(!f.calls.some(c=>/confirm|commit|save/.test(c.method)));
  }
});
