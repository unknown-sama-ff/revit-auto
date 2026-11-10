import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {callRevit} from './bridge.mjs';
import {assertTestDocument,snapshot} from './acceptance-helpers.mjs';
import {recoveryMove,assertRecoveryStart,assertSameInspectionScope,expectedMovedScope} from './drawing-move-recovery.mjs';

const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const [mode,relativeFile,...flags]=process.argv.slice(2);
assert.ok(['preview','confirm'].includes(mode),'Choose preview or confirm and a private evidence file.');
const sourceFile=path.resolve(root,relativeFile??'');
assert.equal(path.dirname(sourceFile),runtime,'Evidence must be a direct child of the private runtime directory.');
const source=JSON.parse(await fs.readFile(sourceFile,'utf8'));
const client=new Client({name:'recover-exact-approved-drawing-move',version:'0.4.0'});
const allowed=new Set(['revit_context_get','revit_search','revit_inspect','revit_plan_get','revit_plan_cancel','revit_view_export_image']);
if(mode==='preview')allowed.add('revit_workflow_run');
if(mode==='confirm'){
  assert.ok(flags.includes('--chat-approved'),'The same concrete move must have explicit human chat approval.');
  allowed.add('revit_plan_confirm');
}
const evidence={mode,status:'NOT_STARTED',startedAt:new Date().toISOString(),sourceFile,
  confirmationCalls:0,automaticSave:false,automaticRetryPerformed:false,allModelSideEffectsVerified:false};
let createdPlan,executionFile;
async function call(name,args={}){
  assert.ok(allowed.has(name),'Unexpected command: '+name);
  if(name==='revit_plan_confirm'){
    assert.equal(evidence.confirmationCalls,0,'A confirmation was already attempted.');
    evidence.confirmationCalls++;
  }
  const response=await client.callTool({name,arguments:args});
  const result=JSON.parse(response.content[0].text);
  if(response.isError){const error=new Error(result.message);Object.assign(error,{code:result.code,details:result.details});throw error;}
  return result;
}
const ids=scope=>scope.items.map(item=>item.summary.id);
function subset(scope,requested){
  const byId=new Map(scope.items.map(item=>[item.summary.id,item]));
  return {items:requested.map(id=>{assert.ok(byId.has(id),'Missing inspection: '+id);return byId.get(id);})};
}
async function inspect(requested){
  assert.ok(requested.every(id=>Number.isSafeInteger(id)&&id>0));
  requested=[...new Set(requested)].sort((first,second)=>first-second);
  const items=[];
  for(let offset=0;offset<requested.length;offset+=100){
    const report=await call('revit_inspect',{elementIds:requested.slice(offset,offset+100)});
    assert.ok(Array.isArray(report.items));items.push(...report.items);
  }
  assert.deepEqual(items.map(item=>item.summary?.id).sort((first,second)=>first-second),requested);
  return {items};
}
function sameContext(current,previous){
  for(const key of ['document','counts','activeView','selectedElementIds'])assert.deepEqual(current[key],previous[key],key+' changed.');
}
async function absent(file){
  try{await fs.access(file);throw new Error('Existing submission evidence must be reviewed; do not retry: '+file);}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const save=()=>fs.writeFile(executionFile,JSON.stringify(evidence,null,2));
function sameSnapshot(current,previous){
  assert.deepEqual(current.categoryIds,previous.categoryIds);
  assert.deepEqual(current.counts,previous.counts);
  assertSameInspectionScope(current,previous,'electrical snapshot');
}
async function preview(){
  assert.equal(source.status,'PREVIEW_ONLY_REOPENED_SCOPE_VERIFIED');
  assert.equal(source.confirmationCalls,0);
  const move=evidence.move=recoveryMove(source),oldPlanId=source.plan.planId;
  for(const kind of ['attempt','execution'])await absent(path.join(runtime,'electrical-sheet-move-'+kind+'-'+oldPlanId+'.json'));
  const recoveries=(await fs.readdir(runtime)).filter(name=>name.startsWith('drawing-move-recovery-pending-'));
  assert.equal(recoveries.length,0,'Inspect the existing recovered preview; do not recreate it.');
  evidence.bridge=await callRevit('revit.bridge.info',{});
  assert.equal(evidence.bridge.moduleVersionId,source.bridge.moduleVersionId);
  assert.equal(evidence.bridge.documentIdentityPolicy,source.bridge.documentIdentityPolicy);
  assert.ok(evidence.bridge.features.includes('drawing-placement-move'));
  assert.equal(evidence.bridge.confirmationMode,'chat');
  const before=evidence.before=await call('revit_context_get');
  assertTestDocument(before,source.finalContext.document.path,path.join(root,'original-model-write-forbidden.rvt'));
  assert.equal(before.document.isModified,false);
  const expectedDocument={...source.finalContext.document,identity:before.document.identity,revision:before.document.revision};
  assert.deepEqual(before.document,expectedDocument,'The saved test copy changed beyond its native session identity/revision.');
  assert.deepEqual(before.counts,source.finalContext.counts);
  try{
    evidence.oldPlan=await call('revit_plan_get',{planId:oldPlanId});
    assert.ok(['pending','expired'].includes(evidence.oldPlan.status));assert.equal(evidence.oldPlan.receipt,undefined);
    assert.ok(Date.parse(evidence.oldPlan.expiresAtUtc)<=Date.now(),'Use the still-current reviewed preview.');
    assert.deepEqual(evidence.oldPlan.operations,source.plan.operations);
  }catch(error){if(error.code!=='plan_not_found')throw error;evidence.oldPlan={status:'not-found-in-current-session',code:error.code};}
  const baseline=evidence.baseline=await snapshot(call,before);
  sameSnapshot(baseline,source.baseline);
  const scopeNames=['reopenedCreatedScope','reopenedSourceScope','reopenedExistingSheets','reopenedPriorNativeScope','movementScope'];
  const requested=[...Object.values(baseline.categoryIds).flat(),...scopeNames.flatMap(name=>ids(source[name]))];
  const full=evidence.beforeFullScope=await inspect(requested);
  for(const name of scopeNames)assertSameInspectionScope(subset(full,ids(source[name])),source[name],name);
  assertRecoveryStart(full,move);
  sameContext(await call('revit_context_get'),before);
  const {id,operationType,...row}=move.operation;
  evidence.preview=await call('revit_workflow_run',{name:'electrical.sheet',planningMode:'explicit',
    documentIdentity:before.document.identity,expectedRevision:before.document.revision,
    summary:'Recover the reviewed existing panel table movement to the same absolute paper target; preserve Y and all other instances.',
    input:{placementMoves:[row]}});
  createdPlan=evidence.preview.plan;
  assert.equal(evidence.preview.planCreated,true);
  assert.equal(createdPlan.status,'pending');assert.equal(createdPlan.confirmationMode,'chat');
  assert.equal(createdPlan.requiresRevitConfirmation,false);
  assert.equal(createdPlan.documentIdentity,before.document.identity);
  assert.equal(createdPlan.documentRevision,before.document.revision);
  assert.deepEqual(createdPlan.operations,source.plan.operations);
  assert.deepEqual(createdPlan.warnings,source.plan.warnings);
  const review=evidence.preview.domainReview.placementMoves[0];
  assert.deepEqual(review.before,move.oldPosition);assert.deepEqual(review.after,move.requestedPosition);assert.equal(review.noOp,false);
  evidence.afterFullScope=await inspect(requested);
  assertSameInspectionScope(evidence.afterFullScope,full,'preview full scope');
  evidence.afterSnapshot=await snapshot(call,before);sameSnapshot(evidence.afterSnapshot,baseline);
  evidence.finalContext=await call('revit_context_get');sameContext(evidence.finalContext,before);
  evidence.plan=await call('revit_plan_get',{planId:createdPlan.planId});assert.deepEqual(evidence.plan,createdPlan);
  evidence.unchangedIntent={sameOperations:true,sameWarnings:true,sameOldPosition:true,sameAbsoluteTarget:true,
    sameHistoricalReadScopes:true,currentFullElectricalReadbackBaselineCaptured:true,originalEvidencePreserved:true};
  evidence.status='CURRENT_SESSION_EQUIVALENT_PREVIEW_VERIFIED';
  const file=path.join(runtime,'drawing-move-recovery-pending-'+createdPlan.planId+'.json');
  await fs.writeFile(file,JSON.stringify(evidence,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:evidence.status,file,planId:createdPlan.planId,expiresAtUtc:createdPlan.expiresAtUtc,
    operation:move.operation,oldPosition:move.oldPosition,requestedPosition:move.requestedPosition,
    electricalCount:baseline.items.length,fullScopeCount:full.items.length,confirmationCalls:0},null,2));
}
async function confirm(){
  assert.equal(source.status,'CURRENT_SESSION_EQUIVALENT_PREVIEW_VERIFIED');
  assert.equal(source.confirmationCalls,0);
  for(const value of Object.values(source.unchangedIntent))assert.equal(value,true);
  const planId=evidence.planId=source.plan.planId,move=evidence.move=source.move;
  const attemptFile=path.join(runtime,'drawing-move-recovery-attempt-'+planId+'.json');
  executionFile=path.join(runtime,'drawing-move-recovery-execution-'+planId+'.json');
  await absent(attemptFile);await absent(executionFile);
  evidence.bridge=await callRevit('revit.bridge.info',{});
  assert.equal(evidence.bridge.moduleVersionId,source.bridge.moduleVersionId);
  const before=evidence.before=await call('revit_context_get');sameContext(before,source.finalContext);
  const plan=evidence.plan=await call('revit_plan_get',{planId});assert.deepEqual(plan,source.plan);
  assert.equal(plan.status,'pending');assert.ok(Date.parse(plan.expiresAtUtc)>Date.now());
  evidence.baseline=await snapshot(call,before);sameSnapshot(evidence.baseline,source.baseline);
  const requested=ids(source.beforeFullScope);
  evidence.beforeFullScope=await inspect(requested);
  assertSameInspectionScope(evidence.beforeFullScope,source.beforeFullScope,'confirmed full scope');
  assertRecoveryStart(evidence.beforeFullScope,move);
  sameContext(await call('revit_context_get'),before);
  evidence.chatApproval='User supplied the explicit approval for this exact 30 mm rightward existing-instance move and asked to continue recovery.';
  evidence.status='SUBMISSION_ATTEMPTED';
  await fs.writeFile(executionFile,JSON.stringify(evidence,null,2),{flag:'wx'});
  await fs.writeFile(attemptFile,JSON.stringify({planId,sourceFile,attemptedAt:new Date().toISOString(),
    originalIntentPreserved:source.unchangedIntent,automaticRetryAllowed:false,automaticSave:false},null,2),{flag:'wx'});
  try{evidence.response=await call('revit_plan_confirm',{planId});}
  catch(error){evidence.commitError={code:error.code,message:error.message,details:error.details};}
  await save();
  evidence.observedPlan=await call('revit_plan_get',{planId});
  const receipt=evidence.receipt=evidence.observedPlan.receipt;
  assert.equal(evidence.observedPlan.status,'committed');assert.equal(receipt?.status,'committed');assert.equal(receipt.planId,planId);
  assert.equal(receipt.completedOperationCount,1);assert.equal(receipt.saved,false);assert.equal(receipt.confirmationMode,'chat');
  assert.deepEqual(receipt.createdElementIds,[]);assert.deepEqual(receipt.changedElementIds,[move.operation.placementId]);
  assert.equal(receipt.operationEvidence.length,1);
  const native=receipt.operationEvidence[0];assert.equal(native.operationType,'move_drawing_placement');assert.equal(native.operationIndex,1);
  for(const key of ['placementId','sheetId','viewId'])assert.equal(native.evidence[key],move.operation[key]);
  for(const key of ['placementWritePerformed','nativeReadbackVerified'])assert.equal(native.evidence[key],true);
  assert.equal(native.evidence.noOp,false);assert.equal(native.evidence.outcome,'write_performed');
  assert.deepEqual(native.evidence.oldPosition,move.oldPosition);
  assert.deepEqual(native.evidence.requestedPosition,move.requestedPosition);
  const after=evidence.after=await call('revit_context_get');
  assert.equal(after.document.identity,before.document.identity);assert.equal(after.document.path,before.document.path);
  assert.ok(after.document.revision>before.document.revision);assert.equal(after.document.isModified,true);
  assert.deepEqual(after.counts,before.counts);
  evidence.afterFullScope=await inspect(requested);
  const moved=evidence.afterFullScope.items.find(item=>item.summary.id===move.operation.placementId);
  evidence.expectedAfterFullScope=expectedMovedScope(evidence.beforeFullScope,move,moved.drawing.position);
  assertSameInspectionScope(evidence.afterFullScope,evidence.expectedAfterFullScope,'post-move full scope');
  evidence.afterSnapshot=await snapshot(call,after);sameSnapshot(evidence.afterSnapshot,evidence.baseline);
  const change=receipt.nativeChanges;assert.ok(change);
  assert.equal(change.documentIdentity,before.document.identity);assert.equal(change.startRevision,before.document.revision);
  assert.equal(change.endRevision,after.document.revision);assert.equal(change.executionOutcome,'committed');
  for(const key of ['revisionCoverageComplete','elementEvidenceComplete','captureComplete'])assert.equal(change[key],true);
  for(const key of ['elementIdsTruncated','eventMetadataTruncated'])assert.equal(change[key],false);
  for(const key of ['observedAddedElementIds','observedDeletedElementIds','observedThenDeletedElementIds'])assert.deepEqual(change[key],[]);
  assert.ok(change.observedModifiedElementIds.includes(move.operation.placementId));
  evidence.nativeObservedScope=await inspect(change.observedModifiedElementIds);
  const byId=new Map(evidence.expectedAfterFullScope.items.map(item=>[item.summary.id,item]));
  evidence.extraNativeReviews=change.observedModifiedElementIds.filter(id=>id!==move.operation.placementId).map(id=>{
    const previous=byId.get(id),current=evidence.nativeObservedScope.items.find(item=>item.summary.id===id);
    if(previous)assertSameInspectionScope({items:[current]},{items:[previous]},'additional native changes');
    return {elementId:id,baselineAvailable:!!previous,readableSnapshotUnchanged:!!previous};
  });
  evidence.image=await call('revit_view_export_image',{viewId:move.operation.sheetId,pixelSize:2560});
  assert.equal(evidence.image.documentIdentity,after.document.identity);assert.equal(evidence.image.documentRevision,after.document.revision);
  assert.equal(evidence.image.savedModel,false);assert.equal(evidence.image.modelRevisionUnchanged,true);assert.ok(evidence.image.files.length>0);
  evidence.finalContext=await call('revit_context_get');sameContext(evidence.finalContext,after);
  assert.deepEqual(evidence.finalContext.activeView,before.activeView);assert.deepEqual(evidence.finalContext.selectedElementIds,before.selectedElementIds);
  evidence.status='MOVE_NATIVE_AND_COMPLETE_READ_SCOPES_VERIFIED_PNG_REVIEW_PENDING';
  evidence.manualSaveVerification='pending';evidence.visualVerification='pending';evidence.completedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({status:evidence.status,file:executionFile,planId,confirmationCalls:evidence.confirmationCalls,
    position:moved.drawing.position,revision:after.document.revision,isModified:true,files:evidence.image.files,
    electricalCount:evidence.baseline.items.length,fullScopeCount:requested.length,extraNativeReviews:evidence.extraNativeReviews,automaticSave:false},null,2));
}
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp','revit-custom.mjs')],stderr:'pipe'}));
  await (mode==='preview'?preview():confirm());
}catch(error){
  evidence.error={code:error.code,message:error.message,details:error.details};
  if(createdPlan?.planId){try{evidence.cleanup=await call('revit_plan_cancel',{planId:createdPlan.planId});}catch(cleanup){evidence.cleanup={status:'unknown',message:cleanup.message};}}
  evidence.status=evidence.confirmationCalls?'SUBMITTED_RESULT_NOT_FULLY_VERIFIED_DO_NOT_RETRY':'NOT_SUBMITTED';
  if(executionFile&&evidence.confirmationCalls)await save();
  const failedFile=path.join(runtime,'drawing-move-recovery-failed-'+Date.now()+'.json');
  await fs.writeFile(failedFile,JSON.stringify(evidence,null,2),{flag:'wx'});
  console.error(JSON.stringify({status:evidence.status,failedFile,error:evidence.error,confirmationCalls:evidence.confirmationCalls,
    automaticSave:false,doNotRetry:!!evidence.confirmationCalls},null,2));process.exitCode=1;
}finally{await client.close();}
