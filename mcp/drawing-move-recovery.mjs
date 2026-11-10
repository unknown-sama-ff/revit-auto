import assert from 'node:assert/strict';
import {canonicalInspectionItems} from './acceptance-helpers.mjs';
import {drawingPlacementOperations} from './drawing-placement.mjs';

const axes=['xMm','yMm','zMm'];
const toleranceMm=0.000001;
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function point(value){
  if(!value||axes.some(key=>!Number.isFinite(value[key]))||Object.keys(value).some(key=>!axes.includes(key)))
    fail('drawing_move_position_unknown','Complete finite paper XYZ evidence is required.');
  return {...value};
}
function near(actual,expected){return axes.every(key=>Math.abs(actual[key]-expected[key])<=toleranceMm);}
function inspectionItems(scope){
  if(!Array.isArray(scope?.items))fail('drawing_move_scope_unknown','A complete native inspection item list is required.');
  const seen=new Set();
  for(const item of scope.items){
    const id=item?.summary?.id;
    if(!Number.isSafeInteger(id)||id<=0||item.exists===false||seen.has(id))
      fail('drawing_move_scope_unknown','Inspection contains missing, disappeared, duplicate or invalid elements.');
    seen.add(id);
  }
  return scope.items;
}
export function assertSameInspectionScope(current,previous,label='Native inspection scope'){
  assert.deepEqual(canonicalInspectionItems(inspectionItems(current)),canonicalInspectionItems(inspectionItems(previous)),label+' changed.');
}
function placement(scope,operation){
  const item=inspectionItems(scope).find(row=>row.summary.id===operation.placementId);
  if(!item||item.summary.className!=='PanelScheduleSheetInstance'||item.summary.ownerViewId!==operation.sheetId||
    item.drawing?.sheetId!==operation.sheetId||item.drawing?.viewId!==operation.viewId)
    fail('drawing_move_relationship_changed','The existing panel-table instance, owner sheet and source view must match the original preview.');
  point(item.drawing.position);
  return item;
}

// Preserve the reviewed absolute destination; never add the displacement to a fresh position.
export function recoveryMove(record){
  assert.equal(record?.status,'PREVIEW_ONLY_REOPENED_SCOPE_VERIFIED');
  assert.equal(record.confirmationCalls,0);
  const oldPosition=point(record.proposal?.oldPosition),requestedPosition=point(record.proposal?.requestedPosition);
  assert.deepEqual(record.proposal.translationMm,{xMm:30,yMm:0});
  assert.equal(oldPosition.zMm,0);assert.equal(requestedPosition.zMm,0);
  assert.ok(Math.abs(requestedPosition.xMm-oldPosition.xMm-30)<=toleranceMm,'Original preview must move exactly 30 mm right.');
  assert.equal(requestedPosition.yMm,oldPosition.yMm,'Original preview must preserve Y.');
  assert.equal(record.plan?.operations?.length,1);
  const operation=structuredClone(record.plan.operations[0]);
  assert.equal(operation.operationType,'move_drawing_placement');
  const {placementId,sheetId,viewId,xMm,yMm,zMm}=operation;
  assert.deepEqual(drawingPlacementOperations({placementMoves:[{placementId,sheetId,viewId,xMm,yMm,zMm}]}),[operation]);
  assert.deepEqual({xMm,yMm,zMm},requestedPosition);
  const move={operation,oldPosition,requestedPosition};
  assertRecoveryStart(record.movementScope,move);
  return move;
}
export function assertRecoveryStart(scope,move){
  const actual=placement(scope,move.operation).drawing.position;
  if(near(actual,move.requestedPosition))
    fail('drawing_move_already_at_target','The instance already occupies the reviewed absolute destination; do not submit another move.');
  if(!near(actual,move.oldPosition))
    fail('drawing_move_start_changed','The instance no longer occupies the original reviewed position; recovery cannot apply another 30 mm offset.');
}
export function expectedMovedScope(before,move,actualPosition){
  const actual=point(actualPosition);
  if(!near(actual,move.requestedPosition))fail('drawing_move_target_mismatch','Native paper position differs from the original absolute destination.');
  assertRecoveryStart(before,move);
  const expected=structuredClone(before);
  placement(expected,move.operation).drawing.position=actual;
  return expected;
}
