import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryMove,assertRecoveryStart,assertSameInspectionScope,expectedMovedScope} from '../drawing-move-recovery.mjs';

const oldPosition={xMm:368.499999999924,yMm:567.9999999999939,zMm:0};
const requestedPosition={xMm:398.499999999924,yMm:567.9999999999939,zMm:0};
function fixture(){
  const items=[
    {summary:{id:10,className:'PanelScheduleSheetInstance',ownerViewId:20},drawing:{sheetId:20,viewId:30,position:{...oldPosition}},parameters:[{id:2,value:'AL1'},{id:1,value:'same'}]},
    {summary:{id:20,className:'ViewSheet',sheetNumber:'AI-E102-REUSE'},drawing:{viewports:[{geometrySupported:true,projectionSupported:true,position:{xMm:1,yMm:2,zMm:0},projectionOrigin:{xMm:0,yMm:0,zMm:0}}]}},
    {summary:{id:30,className:'PanelScheduleView',isViewTemplate:false}},
    {summary:{id:40,className:'FamilySymbol'},parameters:[{id:1,value:'THS-A1'}]}
  ];
  return {status:'PREVIEW_ONLY_REOPENED_SCOPE_VERIFIED',confirmationCalls:0,
    proposal:{translationMm:{xMm:30,yMm:0},oldPosition:{...oldPosition},requestedPosition:{...requestedPosition}},
    plan:{operations:[{placementId:10,sheetId:20,viewId:30,...requestedPosition,operationType:'move_drawing_placement',id:'placementMove1'}]},
    movementScope:{items}};
}
test('recovery keeps the original absolute destination and never mutates saved evidence',()=>{
  const record=fixture(),before=structuredClone(record),move=recoveryMove(record);
  assert.deepEqual(move.operation,record.plan.operations[0]);
  assert.deepEqual(move.oldPosition,oldPosition);assert.deepEqual(move.requestedPosition,requestedPosition);
  move.operation.xMm=900;move.oldPosition.xMm=900;
  assert.deepEqual(record,before);
});
test('already moved, shifted and non-finite positions cannot become another 30 mm move',()=>{
  const record=fixture(),move=recoveryMove(record);
  for(const [position,code] of [
    [requestedPosition,'drawing_move_already_at_target'],
    [{...oldPosition,xMm:oldPosition.xMm+0.001},'drawing_move_start_changed'],
    [{...oldPosition,yMm:oldPosition.yMm+0.001},'drawing_move_start_changed'],
    [{...oldPosition,zMm:0.001},'drawing_move_start_changed'],
    [{...oldPosition,xMm:NaN},'drawing_move_position_unknown'],
    [{xMm:oldPosition.xMm,yMm:oldPosition.yMm},'drawing_move_position_unknown']
  ]){
    const changed=structuredClone(record.movementScope);changed.items[0].drawing.position=position;
    assert.throws(()=>assertRecoveryStart(changed,move),error=>error.code===code);
  }
});
test('wrong sheet, source view, owner and class fail even at the original position',()=>{
  const record=fixture(),move=recoveryMove(record);
  for(const mutate of [
    item=>{item.summary.ownerViewId=21;},item=>{item.drawing.sheetId=21;},
    item=>{item.drawing.viewId=31;},item=>{item.summary.className='Viewport';}
  ]){
    const changed=structuredClone(record.movementScope);mutate(changed.items[0]);
    assert.throws(()=>assertRecoveryStart(changed,move),error=>error.code==='drawing_move_relationship_changed');
  }
});
test('scope equality tolerates only established unordered native collections',()=>{
  const scope=fixture().movementScope,changed=structuredClone(scope);
  changed.items.reverse();changed.items.find(item=>item.summary.id===10).parameters.reverse();
  assertSameInspectionScope(changed,scope);
  const original=structuredClone(scope);assertSameInspectionScope(scope,scope);assert.deepEqual(scope,original);
});
test('strict scope comparison detects geometry, projection, added fields, and source titleblock changes',()=>{
  const scope=fixture().movementScope;
  for(const mutate of [
    value=>{value.items[1].drawing.viewports[0].geometrySupported=false;},
    value=>{delete value.items[1].drawing.viewports[0].projectionSupported;},
    value=>{value.items[1].drawing.viewports[0].projectionOrigin.xMm=1;},
    value=>{value.items[1].drawing.viewports[0].newEvidence=true;},
    value=>{value.items[3].parameters[0].value='Other titleblock';}
  ]){
    const changed=structuredClone(scope);mutate(changed);
    assert.throws(()=>assertSameInspectionScope(changed,scope));
  }
});
test('missing, duplicated, disappeared and invalid scope elements never compare as equal',()=>{
  const scope=fixture().movementScope;
  for(const changed of [null,{items:[]},{items:[scope.items[0],scope.items[0]]},{items:[{summary:{id:0}}]},{items:[{summary:{id:10},exists:false}]}])
    assert.throws(()=>assertSameInspectionScope(changed,scope));
  const duplicates={items:[scope.items[0],scope.items[0]]};
  assert.throws(()=>assertSameInspectionScope(duplicates,duplicates),error=>error.code==='drawing_move_scope_unknown');
});
test('post-move expectations permit only the moved instance position and preserve every other field',()=>{
  const record=fixture(),scope=record.movementScope,original=structuredClone(scope),move=recoveryMove(record);
  const actual={...requestedPosition,xMm:requestedPosition.xMm+1e-8};
  const expected=expectedMovedScope(scope,move,actual),after=structuredClone(scope);
  after.items[0].drawing.position={...actual};assertSameInspectionScope(after,expected);
  assert.deepEqual(scope,original);
  for(const mutate of [
    value=>{value.items[0].parameters[0].value='changed';},
    value=>{value.items[0].drawing.viewId=31;},
    value=>{value.items[1].drawing.viewports[0].projectionSupported=false;},
    value=>{value.items[3].parameters[0].value='changed';}
  ]){
    const changed=structuredClone(after);mutate(changed);
    assert.throws(()=>assertSameInspectionScope(changed,expected));
  }
  assert.throws(()=>expectedMovedScope(scope,move,{...requestedPosition,yMm:requestedPosition.yMm+0.001}),error=>error.code==='drawing_move_target_mismatch');
});
test('historical proposal must contain one exact rightward move and consistent native baseline',()=>{
  for(const mutate of [
    record=>{record.confirmationCalls=1;},record=>{record.proposal.translationMm.xMm=60;},
    record=>{record.proposal.requestedPosition.yMm+=1;},
    record=>{record.plan.operations.push({...record.plan.operations[0]});},
    record=>{record.plan.operations[0].xMm+=30;},
    record=>{record.plan.operations[0].parameters={Comments:'hidden'};},
    record=>{record.movementScope.items[0].drawing.position={...requestedPosition};}
  ]){
    const changed=fixture();mutate(changed);assert.throws(()=>recoveryMove(changed));
  }
});
