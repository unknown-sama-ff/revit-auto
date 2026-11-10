import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDrawingPlacementInput,drawingPlacementOperations,inspectDrawingPlacementScope,reviewDrawingPlacementScope} from '../drawing-placement.mjs';
import {validateOperations} from '../workflows.mjs';

const move={placementId:10,sheetId:20,viewId:30,xMm:420,yMm:280,zMm:0};
function fixture(kind='Viewport',patch={}){
  const sourceClass=kind==='PanelScheduleSheetInstance'?'PanelScheduleView':kind==='ScheduleSheetInstance'?'ViewSchedule':'ViewPlan';
  const items=[
    {summary:{id:10,className:kind,ownerViewId:20},drawing:{sheetId:20,viewId:30,position:{xMm:400,yMm:200,zMm:23}}},
    {summary:{id:20,className:'ViewSheet'}},
    {summary:{id:30,className:sourceClass,isViewTemplate:false}}
  ];
  for(const [key,update] of Object.entries(patch))Object.assign(items[Number(key)],update);
  const calls=[];
  const call=async(method,args)=>{assert.equal(method,'revit.inspect');calls.push(args);return {items:args.elementIds.map(id=>items.find(item=>item.summary.id===id))};};
  return {items,call,calls};
}
test('movement builder emits only one named native move for each explicit existing placement',()=>{
  assert.deepEqual(drawingPlacementOperations({placementMoves:[move]}),[{...move,operationType:'move_drawing_placement',id:'placementMove1'}]);
  assert.deepEqual(drawingPlacementOperations(),[]);
});
test('raw movement operations retain strict IDs fields and metadata validation',()=>{
  const operation={...move,operationType:'move_drawing_placement',id:'move1',dependencies:[]};
  assert.deepEqual(validateOperations([operation]),[operation]);
  for(const update of [
    {id:null},{id:''},{id:3},{dependencies:null},{dependencies:''},{dependencies:{}},{dependencies:[null]},
    {dependencies:['']},{dependencies:['later']},{sheetId:'@newSheet'},
    {parameters:{Comments:'hidden'}},{point:{xMm:1,yMm:2}},{placementId:Number.MAX_SAFE_INTEGER+1},{viewId:20}
  ])assert.throws(()=>validateOperations([{...operation,...update}]));
  assert.throws(()=>validateOperations([operation,{...operation,id:'move2',xMm:421}]));
});
test('movement schemas reject unknown inputs, guessed references, duplicate targets and ambiguous paper coordinates',()=>{
  for(const row of [
    {...move,placementId:'@newPlacement'}, {...move,sheetId:0}, {...move,viewId:20},
    {...move,xMm:NaN},{...move,yMm:Infinity},{...move,zMm:23},
    {...move,xMm:undefined},{...move,point:{xMm:1,yMm:2,zMm:0}},
    {...move,parameters:{Comments:'Unsafe'}},{...move,code:'unsafe'},{...move,path:'file'},
    {...move,placementId:Number.MAX_SAFE_INTEGER+1}
  ])assert.throws(()=>parseDrawingPlacementInput({placementMoves:[row]}));
  assert.throws(()=>parseDrawingPlacementInput({placementMoves:[move,{...move,xMm:1}]}));
  assert.throws(()=>parseDrawingPlacementInput({operations:[]}));
  assert.doesNotThrow(()=>parseDrawingPlacementInput({placementMoves:[{placementId:10,sheetId:20,viewId:30,xMm:0,yMm:0}]}));
});
test('three native drawing classes disclose exact source/owner relationships and before/after positions',async()=>{
  for(const kind of ['Viewport','PanelScheduleSheetInstance','ScheduleSheetInstance']){
    const f=fixture(kind),review=await inspectDrawingPlacementScope({placementMoves:[move]},f.call);
    assert.equal(review.selectedScopeVerified,true);assert.equal(review.inspectedElementCount,3);
    assert.deepEqual(f.calls,[{elementIds:[10,20,30]}]);
    assert.deepEqual(review.placementMoves[0].before,{xMm:400,yMm:200,zMm:23});
    assert.deepEqual(review.placementMoves[0].after,{xMm:420,yMm:280,zMm:0});
    assert.equal(review.placementMoves[0].noOp,false);assert.equal(review.placementMoves[0].className,kind);
    assert.equal(review.requiredNativeFeature,'drawing-placement-move');
    assert.equal(review.nativeMovementAccepted,false);assert.equal(review.automaticSave,false);
    assert.equal(review.placementMoves[0].pinStateVerified,false);assert.equal(review.placementMoves[0].writeabilityVerified,false);
  }
});
test('known no-op compares sheet XY and preserves native viewport depth as evidence',async()=>{
  const f=fixture(),same={...move,xMm:400,yMm:200};
  const review=await inspectDrawingPlacementScope({placementMoves:[same]},f.call);
  assert.equal(review.placementMoves[0].noOp,true);assert.equal(review.placementMoves[0].before.zMm,23);
  const nearly=await inspectDrawingPlacementScope({placementMoves:[{...same,xMm:same.xMm+0.5}]},f.call);
  assert.equal(nearly.placementMoves[0].noOp,false);
});
test('wrong placement class, sheet, source view and templates cannot pass preflight',async()=>{
  for(const [kind,patch,code] of [
    ['Viewport',{0:{summary:{id:10,className:'FamilyInstance',ownerViewId:20}}},'drawing_placement_class_mismatch'],
    ['Viewport',{1:{summary:{id:20,className:'ViewPlan'}}},'drawing_placement_sheet_mismatch'],
    ['Viewport',{0:{summary:{id:10,className:'Viewport',ownerViewId:99}}},'drawing_placement_relationship_mismatch'],
    ['Viewport',{0:{drawing:{sheetId:99,viewId:30,position:{xMm:1,yMm:2,zMm:0}}}},'drawing_placement_relationship_mismatch'],
    ['Viewport',{0:{drawing:{sheetId:20,viewId:99,position:{xMm:1,yMm:2,zMm:0}}}},'drawing_placement_relationship_mismatch'],
    ['Viewport',{0:{drawing:null}},'drawing_placement_relationship_mismatch'],
    ['Viewport',{2:{summary:{id:30,className:'ViewPlan',isViewTemplate:true}}},'drawing_placement_view_unknown'],
    ['Viewport',{2:{summary:{id:30,className:'ViewPlan'}}},'drawing_placement_view_unknown'],
    ['Viewport',{2:{summary:{id:30,className:'UnknownView',isViewTemplate:false}}},'drawing_placement_view_mismatch'],
    ['Viewport',{2:{summary:{id:30,className:'ViewSchedule',isViewTemplate:false}}},'drawing_placement_view_mismatch'],
    ['PanelScheduleSheetInstance',{2:{summary:{id:30,className:'ViewSchedule',isViewTemplate:false}}},'drawing_placement_view_mismatch'],
    ['ScheduleSheetInstance',{2:{summary:{id:30,className:'PanelScheduleView',isViewTemplate:false}}},'drawing_placement_view_mismatch']
  ])await assert.rejects(inspectDrawingPlacementScope({placementMoves:[move]},fixture(kind,patch).call),error=>error.code===code);
});
test('unknown paper positions never become a default origin',async()=>{
  for(const position of [null,undefined,{}, {xMm:1,yMm:2}, {xMm:NaN,yMm:2,zMm:0}, {xMm:1,yMm:Infinity,zMm:0}, {xMm:1,yMm:2,zMm:Infinity}]){
    const f=fixture('Viewport',{0:{drawing:{sheetId:20,viewId:30,position}}});
    await assert.rejects(inspectDrawingPlacementScope({placementMoves:[move]},f.call),error=>error.code==='drawing_placement_position_unknown');
  }
});
test('known pinned, readonly and revision-table evidence fails before a native plan',async()=>{
  for(const patch of [
    {summary:{id:10,className:'ScheduleSheetInstance',ownerViewId:20,pinned:true}},
    {summary:{id:10,className:'ScheduleSheetInstance',ownerViewId:20,isReadOnly:true}},
    {drawing:{sheetId:20,viewId:30,position:{xMm:1,yMm:2,zMm:0},isTitleblockRevisionSchedule:true}}
  ])await assert.rejects(inspectDrawingPlacementScope({placementMoves:[move]},fixture('ScheduleSheetInstance',{0:patch}).call),error=>error.code==='drawing_placement_read_only');
  const f=fixture('ScheduleSheetInstance',{0:{summary:{id:10,className:'ScheduleSheetInstance',ownerViewId:20,pinned:false,isReadOnly:false},drawing:{sheetId:20,viewId:30,position:{xMm:1,yMm:2,zMm:0},isTitleblockRevisionSchedule:false}}});
  const review=await inspectDrawingPlacementScope({placementMoves:[move]},f.call);assert.equal(review.placementMoves[0].writeabilityVerified,true);
});
test('missing, duplicate and unexpected inspection results are rejected without retry',async()=>{
  const f=fixture();
  for(const response of [null,{items:[]},{items:f.items.slice(1)},{items:[f.items[0],f.items[0],f.items[2]]},{items:[f.items[0],f.items[1],{id:30,exists:false}]},{items:[f.items[0],f.items[1],{summary:{id:31,className:'ViewPlan'}}]}]){
    let calls=0;await assert.rejects(inspectDrawingPlacementScope({placementMoves:[move]},async()=>{calls++;return response;}),error=>error.code==='drawing_placement_scope_unknown');assert.equal(calls,1);
  }
});
test('shared views/sheets are deduplicated and native reads stay in 100-ID batches',async()=>{
  const moves=Array.from({length:101},(_,index)=>({...move,placementId:1000+index}));
  const calls=[],call=async(_,args)=>{
    calls.push(args.elementIds);
    return {items:args.elementIds.map(id=>id===20?{summary:{id,className:'ViewSheet'}}:id===30?{summary:{id,className:'ViewPlan',isViewTemplate:false}}:{summary:{id,className:'Viewport',ownerViewId:20},drawing:{sheetId:20,viewId:30,position:{xMm:1,yMm:2,zMm:0}}})};
  };
  const review=await inspectDrawingPlacementScope({placementMoves:moves},call);
  assert.equal(review.inspectedElementCount,103);assert.deepEqual(calls.map(ids=>ids.length),[100,3]);
  assert.equal(calls.flat().filter(id=>id===20).length,1);assert.equal(calls.flat().filter(id=>id===30).length,1);
});
test('cancellation and empty movement scopes cannot contact native tools',async()=>{
  let calls=0;const call=async()=>{calls++;};
  assert.equal(await inspectDrawingPlacementScope({},call),null);assert.equal(calls,0);
  const controller=new AbortController();controller.abort();
  await assert.rejects(inspectDrawingPlacementScope({placementMoves:[move]},call,controller.signal));assert.equal(calls,0);
});

test('independent placement inspection always reads fresh native rows',async()=>{
  const f=fixture();
  const previous=new Map(structuredClone(f.items).map(item=>[item.summary.id,item]));
  f.items[0].drawing.position.xMm=410;
  const review=await inspectDrawingPlacementScope({placementMoves:[move]},f.call,undefined,previous);
  assert.equal(f.calls.length,1);assert.equal(review.placementMoves[0].before.xMm,410);
});

test('cancellation during a completed native batch cannot return accepted movement evidence',async()=>{
  const controller=new AbortController(),f=fixture();
  await assert.rejects(inspectDrawingPlacementScope({placementMoves:[move]},async()=>{controller.abort();return {items:f.items};},controller.signal),error=>error.name==='AbortError');
});

test('pure placement review validates the requested rows without mutating the shared snapshot',()=>{
  const f=fixture(),snapshot=new Map(f.items.map(item=>[item.summary.id,item])),before=structuredClone(snapshot);
  snapshot.set(99,{summary:{id:99,className:'ViewSheet'}});before.set(99,{summary:{id:99,className:'ViewSheet'}});
  const review=reviewDrawingPlacementScope({placementMoves:[move]},snapshot);
  assert.equal(review.inspectedElementCount,3);assert.equal(review.nativeMovementAccepted,false);
  assert.deepEqual(snapshot,before);
  for(const value of [undefined,null,[],{}, {summary:{id:31,className:'ViewPlan'}}, {summary:{id:30},exists:false}]){
    const malformed=new Map(snapshot);malformed.set(30,value);
    assert.throws(()=>reviewDrawingPlacementScope({placementMoves:[move]},malformed),error=>error.code==='drawing_placement_scope_unknown');
  }
  assert.throws(()=>reviewDrawingPlacementScope({placementMoves:[move]},{}),error=>error.code==='drawing_placement_scope_unknown');
});
