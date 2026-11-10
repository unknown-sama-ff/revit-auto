import test from 'node:test';
import assert from 'node:assert/strict';
import {previewRegisteredWriteWorkflow} from '../registered-planning.mjs';
import {getWorkflow} from '../workflow-registry.mjs';
import {validateOperations,workflowOperations} from '../workflows.mjs';
import {inspectElectricalSheetScope} from '../electrical-sheet.mjs';
const move={placementId:10,sheetId:20,viewId:30,xMm:420,yMm:280};
const context={active:true,document:{identity:'doc-a',revision:0,path:'model.rvt',isModified:false}};
const items=[
  {summary:{id:10,className:'PanelScheduleSheetInstance',ownerViewId:20},drawing:{sheetId:20,viewId:30,position:{xMm:400,yMm:200,zMm:0}}},
  {summary:{id:20,className:'ViewSheet'},parameters:[{id:-1007400,storageType:'String',hasValue:true,value:'Old sheet',readOnly:false,valueSupported:true}]},
  {summary:{id:30,className:'PanelScheduleView',isViewTemplate:false}}
];
function fixture(contexts=[context]){
  const calls=[];let count=0;
  return {calls,call:async(method,args)=>{
    calls.push({method,args});
    if(method==='revit.context.get')return structuredClone(contexts[Math.min(count++,contexts.length-1)]);
    if(method==='revit.inspect')return {items:structuredClone(items.filter(item=>args.elementIds.includes(item.summary.id)))};
    if(method==='revit.plan.create')return {planId:'plan-a',status:'pending',documentIdentity:'doc-a',documentRevision:0,operations:args.operations};
    if(method==='revit.plan.cancel')return {status:'cancelled'};
    throw new Error('Unexpected method '+method);
  }};
}
for(const name of ['electrical.sheet','architecture.documentation']){
  const args={name,documentIdentity:'doc-a',expectedRevision:0,input:{placementMoves:[move]}};
  test(name+' previews a standalone panel-table move with exact before/after and no view setting changes',async()=>{
    const f=fixture(),result=await previewRegisteredWriteWorkflow(args,getWorkflow(name),f.call);
    assert.equal(result.planCreated,true);assert.equal(result.domainReview.requiredNativeFeature,'drawing-placement-move');
    assert.deepEqual(result.domainReview.placementMoves[0].before,{xMm:400,yMm:200,zMm:0});
    assert.deepEqual(result.domainReview.placementMoves[0].after,{xMm:420,yMm:280,zMm:0});
    assert.deepEqual(result.plan.operations,[{...move,operationType:'move_drawing_placement',id:'placementMove1'}]);
    assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get','revit.inspect','revit.context.get','revit.plan.create','revit.context.get']);
    assert.ok(!f.calls.some(c=>/confirm|save/.test(c.method)));
  });
  test(name+' rejects malformed or conflicting placement input before contacting Revit',async()=>{
    for(const input of [{placementMoves:[{...move,placementId:'@created'}]},{placementMoves:[{...move,parameters:{Comments:'Unsafe'}}]},{placementMoves:[move,move]},{placementMoves:[{...move,sheetId:30}]}]){
      const f=fixture();await assert.rejects(previewRegisteredWriteWorkflow({...args,input},getWorkflow(name),f.call));assert.deepEqual(f.calls,[]);
    }
  });
  test(name+' ask creates no plan and movement inspection races stop before planning',async()=>{
    const f=fixture(),ask=await previewRegisteredWriteWorkflow({...args,planningMode:'ask',input:{}},getWorkflow(name),f.call);
    assert.equal(ask.planCreated,false);assert.deepEqual(f.calls,[]);
    for(const patch of [{revision:1},{path:'OTHER.rvt'},{isModified:true}]){
      const changed=fixture([context,{...context,document:{...context.document,...patch}}]);
      await assert.rejects(previewRegisteredWriteWorkflow(args,getWorkflow(name),changed.call));
      assert.equal(changed.calls.filter(c=>c.method==='revit.plan.create').length,0);
    }
  });
}
test('combined sheet metadata and placement scope counts distinct inspected elements and preserves both disclosures',async()=>{
  const f=fixture(),result=await inspectElectricalSheetScope({sheetChanges:[{sheetId:20,name:'New sheet'}],placementMoves:[move]},f.call);
  assert.equal(result.inspectedElementCount,3);assert.deepEqual([...result.inspectedElementIds].sort((a,b)=>a-b),[10,20,30]);
  assert.equal(result.sheetChanges[0].parameters[0].before,'Old sheet');assert.equal(result.placementMoves[0].before.xMm,400);
  assert.ok(result.warnings.length>=3);assert.equal(result.automaticSave,false);
});
test('raw move operation refuses references, extra setters, invalid metadata and duplicate movement',()=>{
  const op={...move,operationType:'move_drawing_placement',id:'move'};
  for(const patch of [{placementId:'@level'},{sheetId:10},{zMm:1},{parameters:{}},{paperPoint:{xMm:1,yMm:2}},{code:'unsafe'},{dependencies:'level'}]){
    assert.throws(()=>validateOperations([{operationType:'create_level',id:'level',name:'L',elevationMm:0},{...op,...patch}]));
  }
  assert.throws(()=>validateOperations([op,{...op,id:'second',xMm:421}]));
  assert.doesNotThrow(()=>validateOperations([op]));
  const configure={operationType:'configure_view',viewId:30,referenceViewId:31,settings:['crop'],viewportId:10,paperPoint:{xMm:1,yMm:2,zMm:0}};
  assert.throws(()=>validateOperations([configure,op]));assert.throws(()=>validateOperations([op,configure]));
});
test('documentation builder rejects duplicate moves rather than silently appending extra operations',()=>{
  assert.throws(()=>workflowOperations('architecture.documentation',{placementMoves:[move,move]}));
});
