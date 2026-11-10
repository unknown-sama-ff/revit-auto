import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';
import {workflowOperations} from './workflows.mjs';
import {readFinalArchitectureCopyVerification,assertCopyContextTypeSample} from './architecture-copy-verification.mjs';

assert.ok(process.argv.includes('--chat-approved'),'Explicit chat approval for this exact type-copy preview is required.');
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const sourceFile=path.join(runtime,'architecture-type-copy-preview-1791636415385.json');
const sourceSha256='77E3FA1E3564D9A1D1F996334BD3402B702D635CB23A1C49969BD323B7052C7F';
const planId='d26bc8dac87a44869546e45b66945c75';
const executionFile=path.join(runtime,`architecture-type-copy-execution-${planId}.json`);
const attemptFile=path.join(runtime,`architecture-type-copy-attempt-${planId}.json`);
const record={status:'PREFLIGHT_STARTED',startedAt:new Date().toISOString(),sourceFile,sourceSha256,planId,
  humanChatApproval:'确认执行柱类型复制测试',confirmationCalls:0,automaticRetry:false,automaticSave:false,
  allModelSideEffectsVerified:false,typeCopyExecutionAccepted:false,manualSaveVerification:'pending',rollbackVerification:'pending'};
const allowed=new Set(['revit.bridge.info','revit.context.get','revit.search','revit.inspect','revit.plan.get','revit.plan.confirm']);
let executionCreated=false,attemptCreated=false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
const save=()=>fs.writeFile(executionFile,JSON.stringify(record,null,2));
async function absent(file){
  try{await fs.access(file);}catch(error){if(error.code==='ENOENT')return;throw error;}
  throw new Error('Existing submission evidence must be reviewed; never retry: '+path.basename(file));
}
async function call(method,args={}){
  assert.ok(allowed.has(method),'Unregistered or unrelated command is forbidden.');
  if(method==='revit.plan.confirm'){
    assert.ok(executionCreated&&attemptCreated,'Independent execution evidence and attempt marker are required.');
    assert.equal(record.confirmationCalls,0,'The single confirmation was already attempted.');
    assert.deepEqual(args,{planId});record.confirmationCalls=1;record.status='SUBMISSION_ATTEMPTED';await save();
  }
  return callRevit(method,args);
}
function stable(actual,expected){
  assert.equal(actual.active,true,'The saved test project must be active.');
  for(const key of ['document','revitVersion','revitBuild','counts','levels','familyTypes','elementTypes','units','pagination'])
    assert.deepEqual(actual[key],expected[key],`${key} changed.`);
}
async function inspect(ids){
  assert.ok(ids.every(id=>Number.isSafeInteger(id)&&id>0));assert.equal(new Set(ids).size,ids.length);
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),result=await call('revit.inspect',{elementIds:page});
    assert.ok(Array.isArray(result.items));assert.deepEqual(result.items.map(item=>item.summary?.id),page,'An inspection ID changed or disappeared.');items.push(...result.items);
  }
  return {items};
}
async function unchanged(prior,label){const result=await inspect(prior.items.map(item=>item.summary.id));assertSameInspectionScope(result,prior,label);return result;}
async function memberships(expected,types=false){
  const result={};
  for(const category of Object.keys(expected)){
    const ids=[];let offset=0;
    while(true){
      const page=await call('revit.search',{category,types,limit:500,offset});
      assert.equal(page.offset,offset);assert.equal(page.limit,500);assert.equal(typeof page.hasMore,'boolean');
      assert.ok(Array.isArray(page.items)&&page.items.length<=500);
      for(const item of page.items){assert.ok(Number.isSafeInteger(item.id)&&item.id>0);ids.push(item.id);}
      if(!page.hasMore)break;
      assert.ok(page.items.length>0&&offset+page.items.length<=100000);offset+=page.items.length;
    }
    assert.equal(new Set(ids).size,ids.length);result[category]=ids.sort((a,b)=>a-b);
  }
  assert.deepEqual(result,expected,'Native instance/type membership differs from the approved scope.');return result;
}
async function savedFile(file){const bytes=await fs.readFile(file);return {path:file,bytes:bytes.length,sha256:hash(bytes).toLowerCase()};}
function near(actual,expected){assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=0.01,'Native dimension differs from the approved value.');}
function nativeCopy(native,operation,preview,newId){
  assert.equal(native.createdTypeId,newId);assert.equal(native.name,operation.name);assert.equal(native.familyId,preview.familyId);
  assert.equal(native.familyName,preview.familyName);assert.equal(native.categoryId,preview.categoryId);
  assert.equal(native.category,operation.category);assert.equal(native.placement,preview.placement);
  assert.equal(typeof native.uniqueId,'string');assert.ok(native.uniqueId.length>0);assert.notEqual(native.uniqueId,preview.sourceSnapshot.uniqueId);
  assert.equal(typeof native.isActive,'boolean');assert.equal(native.isActive,native.initiallyActive);
  for(const key of ['activationChanged','reviewedPlacementActivationAllowed'])assert.equal(native[key],false);
  assert.equal(native.nativeDimensionsVerified,true);assert.equal(native.dimensions.length,2);
  assert.equal(new Set(native.dimensions.map(row=>row.parameterId)).size,2);
  for(const dimension of operation.dimensions){
    const row=native.dimensions.find(item=>item.parameterId===dimension.parameterId);assert.ok(row);
    assert.equal(row.name,dimension.name);assert.equal(row.desiredMm,dimension.valueMm);near(row.actualMm,dimension.valueMm);
    assert.equal(row.storageType,'Double');assert.equal(row.hasValue,true);assert.equal(row.readOnly,false);
    assert.equal(row.spec,preview.dimensions.find(item=>item.parameterId===dimension.parameterId).spec);
  }
}
try{
  await absent(attemptFile);await absent(executionFile);
  const sourceBytes=await fs.readFile(sourceFile);assert.equal(hash(sourceBytes),sourceSha256,'The independently reviewed preview evidence changed.');
  const source=JSON.parse(sourceBytes.toString('utf8'));
  assert.equal(source.status,'TYPE_COPY_PREVIEW_ONLY_COMPLETE_READ_SCOPES_VERIFIED');
  assert.equal(source.planCreationCalls,1);assert.equal(source.confirmationCalls,0);
  assert.equal(source.plan.planId,planId);assert.deepEqual(source.planAfter,source.plan);
  assert.deepEqual(source.plan.operations,workflowOperations('architecture.build',source.input));
  assert.equal(source.plan.operations.length,1);
  const operation=source.plan.operations[0],preview=source.nativeSourcePreview;
  assert.equal(operation.operationType,'duplicate_architecture_type');assert.equal(operation.sourceTypeId,765512);
  assert.equal(operation.name,'AI-PARITY-COLUMN-500x500-TEST');assert.equal(operation.category,'OST_StructuralColumns');
  assert.deepEqual(operation.dimensions,[{parameterId:765248,name:'b',valueMm:500},{parameterId:765218,name:'h',valueMm:500}]);
  record.bridge=await call('revit.bridge.info');assert.deepEqual(record.bridge,source.afterBridge);
  record.before=await call('revit.context.get');stable(record.before,source.after);assert.equal(record.before.document.isModified,false);
  record.planBefore=await call('revit.plan.get',{planId});assert.deepEqual(record.planBefore,source.plan);
  assert.equal(record.planBefore.status,'pending');assert.ok(Date.parse(record.planBefore.expiresAtUtc)>Date.now(),'The approved plan expired.');
  record.savedFileBefore=await savedFile(record.before.document.path);assert.deepEqual(record.savedFileBefore,source.savedFileAfter);
  record.categoryIds=await memberships(source.afterCategoryIds);record.typeCategoryIds=await memberships(source.afterTypeCategoryIds,true);
  for(const name of ['fullScope','architectureScope','categoryScope','typeScope','familyScope'])
    record[name]=await unchanged(source['after'+name[0].toUpperCase()+name.slice(1)],`Preflight ${name}`);
  record.preSubmission=await call('revit.context.get');stable(record.preSubmission,record.before);
  assert.deepEqual(await call('revit.bridge.info'),record.bridge);
  record.planPreSubmission=await call('revit.plan.get',{planId});assert.deepEqual(record.planPreSubmission,record.planBefore);
  assert.ok(Date.parse(record.planPreSubmission.expiresAtUtc)>Date.now(),'The approved plan expired during preflight.');
  record.savedFilePreSubmission=await savedFile(record.preSubmission.document.path);
  assert.deepEqual(record.savedFilePreSubmission,record.savedFileBefore,'The saved RVT bytes changed during preflight.');
  assert.equal(hash(await fs.readFile(sourceFile)),sourceSha256);
  record.status='PREFLIGHT_VERIFIED';
  await fs.writeFile(executionFile,JSON.stringify(record,null,2),{flag:'wx'});executionCreated=true;
  await fs.writeFile(attemptFile,JSON.stringify({status:'CONFIRM_REQUEST_STARTED',planId,sourceFile,sourceSha256,executionFile,
    attemptedAt:new Date().toISOString(),humanChatApproval:record.humanChatApproval,automaticRetryAllowed:false,automaticSave:false,
    document:record.before.document,operations:source.plan.operations},null,2),{flag:'wx'});attemptCreated=true;
  try{record.response=await call('revit.plan.confirm',{planId});}
  catch(error){record.confirmError={code:error.code??null,message:error.message,details:error.details};}
  await save();
  record.observedPlan=await call('revit.plan.get',{planId});record.nativePlanStatus=record.observedPlan.status;record.receipt=record.observedPlan.receipt;await save();
  const receipt=record.receipt;assert.equal(record.nativePlanStatus,'committed');assert.equal(receipt?.status,'committed');assert.equal(receipt.planId,planId);
  assert.deepEqual(record.observedPlan,{...source.plan,status:'committed',receipt},'The submitted plan differs from the approved preview.');
  if(record.response)assert.deepEqual(record.response,receipt,'The confirmation response differs from the stored receipt.');
  assert.equal(receipt.completedOperationCount,1);assert.equal(receipt.saved,false);assert.equal(receipt.confirmationMode,'chat');
  assert.equal(receipt.createdElementIds.length,1);const newId=record.createdTypeId=receipt.createdElementIds[0];
  assert.ok(Number.isSafeInteger(newId)&&newId>0);
  const beforeItems=[...record.fullScope.items,...record.architectureScope.items,...record.categoryScope.items,...record.typeScope.items,...record.familyScope.items];
  assert.equal(beforeItems.some(item=>item.summary.id===newId),false,'The reported new type was already in the baseline.');
  assert.deepEqual(receipt.changedElementIds,[]);assert.deepEqual(receipt.references,{[operation.id]:newId});
  assert.equal(receipt.operationEvidence.length,1);const row=receipt.operationEvidence[0];
  assert.equal(row.operationIndex,1);assert.equal(row.operationType,'duplicate_architecture_type');const evidence=row.evidence;
  assert.equal(evidence.sourceTypeId,operation.sourceTypeId);assert.equal(evidence.createdTypeId,newId);
  assert.deepEqual(evidence.sourceBefore,preview.sourceSnapshot,'The source snapshot changed from the approved preview.');
  assert.deepEqual(evidence.sourceAfter,evidence.sourceBefore,'The source changed during duplication.');
  for(const key of ['sourceParametersComplete','sourceUnchanged','nativeReadbackVerified','finalVerificationRequired'])assert.equal(evidence[key],true);
  for(const key of ['activationPerformed','automaticSave','sideEffectsVerified'])assert.equal(evidence[key],false);
  assert.equal(evidence.dimensionWrites.length,2);assert.equal(new Set(evidence.dimensionWrites.map(item=>item.parameterId)).size,2);
  for(const dimension of operation.dimensions){
    const write=evidence.dimensionWrites.find(item=>item.parameterId===dimension.parameterId);assert.ok(write);
    assert.equal(write.name,dimension.name);assert.equal(write.desiredMm,dimension.valueMm);assert.equal(write.writePerformed,true);
  }
  nativeCopy(evidence.native,operation,preview,newId);assert.equal(evidence.createdTypeInitiallyActive,evidence.native.initiallyActive);
  const final=readFinalArchitectureCopyVerification(receipt.architectureCopyVerification,1,0);
  assert.deepEqual(final.sourceTypeIds,[operation.sourceTypeId]);
  for(const key of ['reviewedCopiesComplete','sourceBaselinesComplete','sourceTypesUnchanged','copiedDimensionsVerified','verifiedBeforeTransactionCommit'])assert.equal(final[key],true);
  assert.equal(final.sideEffectsVerified,false);assert.equal(final.copies.length,1);nativeCopy(final.copies[0],operation,preview,newId);
  assert.deepEqual(final.copies[0],evidence.native,'The final post-Commit copy verification differs from execution.');
  record.after=await call('revit.context.get');
  assert.equal(record.after.active,true);assert.equal(record.after.document.isModified,true);
  assert.ok(Number.isSafeInteger(record.after.document.revision)&&record.after.document.revision>record.before.document.revision);
  assert.deepEqual(record.after.document,{...record.before.document,revision:record.after.document.revision,isModified:true});
  for(const key of ['revitVersion','revitBuild','counts','levels','elementTypes','units','pagination','activeView','selectedElementIds'])assert.deepEqual(record.after[key],record.before[key],`${key} changed during copying.`);
  record.contextTypeSample=assertCopyContextTypeSample(record.after.familyTypes,record.before.familyTypes,newId);
  const addedFamilyTypes=record.after.familyTypes.filter(item=>item.id===newId);
  record.expectedTypeCategoryIds=structuredClone(record.typeCategoryIds);
  record.expectedTypeCategoryIds.OST_StructuralColumns=[...record.typeCategoryIds.OST_StructuralColumns,newId].sort((a,b)=>a-b);
  record.afterCategoryIds=await memberships(record.categoryIds);record.afterTypeCategoryIds=await memberships(record.expectedTypeCategoryIds,true);
  for(const name of ['fullScope','architectureScope','categoryScope','typeScope','familyScope'])
    record['after'+name[0].toUpperCase()+name.slice(1)]=await unchanged(record[name],`Post-copy existing ${name}`);
  record.newTypeScope=await inspect([newId]);const created=record.newTypeScope.items[0];
  assert.equal(created.summary.className,'FamilySymbol');assert.equal(created.summary.name,operation.name);
  assert.equal(created.summary.uniqueId,evidence.native.uniqueId);assert.equal(created.summary.family,preview.familyName);
  assert.equal(created.summary.categoryId,preview.categoryId);assert.equal(created.summary.placement,preview.placement);
  if(record.contextTypeSample.newTypePresent)assert.deepEqual(addedFamilyTypes[0],{id:newId,category:created.summary.category,categoryId:created.summary.categoryId,
    family:preview.familyName,type:operation.name,placement:preview.placement});
  for(const dimension of operation.dimensions){
    const parameters=created.parameters.filter(parameter=>parameter.id===dimension.parameterId&&parameter.name===dimension.name);assert.equal(parameters.length,1);
    const parameter=parameters[0];assert.equal(parameter.storageType,'Double');assert.equal(parameter.hasValue,true);assert.equal(parameter.readOnly,false);assert.equal(parameter.valueSupported,true);near(parameter.value*304.8,dimension.valueMm);
  }
  const native=receipt.nativeChanges;assert.ok(native);record.nativeChanges=native;
  assert.equal(native.documentIdentity,record.before.document.identity);assert.equal(native.startRevision,record.before.document.revision);assert.equal(native.endRevision,record.after.document.revision);
  assert.equal(native.executionOutcome,'committed');assert.equal(native.evidenceKind,'document-changed-event-union');
  for(const key of ['captureComplete','elementEvidenceComplete','revisionCoverageComplete'])assert.equal(native[key],true);
  for(const key of ['elementIdsTruncated','eventMetadataTruncated','netModelDiffVerified','sideEffectsVerified'])assert.equal(native[key],false);
  assert.deepEqual(native.observedAddedElementIds,[newId]);
  for(const key of ['additionalAddedElementIds','observedDeletedElementIds','observedThenDeletedElementIds'])assert.deepEqual(native[key],[]);
  const permittedModified=new Set([newId,preview.familyId]);
  record.unexpectedNativeModifiedIds=native.observedModifiedElementIds.filter(id=>!permittedModified.has(id));
  assert.deepEqual(record.unexpectedNativeModifiedIds,[],'Unexpected native modifications require a separate read-only investigation.');
  assert.deepEqual(native.unreportedModifiedElementIds,native.observedModifiedElementIds.filter(id=>id!==newId));
  record.nativeObservedScope=await inspect([...new Set([...native.observedAddedElementIds,...native.observedModifiedElementIds])].sort((a,b)=>a-b));
  const knownAfter=new Map([...record.afterFamilyScope.items,...record.newTypeScope.items].map(item=>[item.summary.id,item]));
  assertSameInspectionScope(record.nativeObservedScope,{items:record.nativeObservedScope.items.map(item=>knownAfter.get(item.summary.id))},'Independent native observed snapshots');
  record.nativeFamilyModificationObserved=native.observedModifiedElementIds.includes(preview.familyId);
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore,'The RVT file was saved during copying.');
  record.afterBridge=await call('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge);
  record.finalContext=await call('revit.context.get');stable(record.finalContext,record.after);
  assert.deepEqual(record.finalContext.activeView,record.after.activeView);assert.deepEqual(record.finalContext.selectedElementIds,record.after.selectedElementIds);
  record.finalPlan=await call('revit.plan.get',{planId});assert.deepEqual(record.finalPlan,record.observedPlan);
  assert.equal(hash(await fs.readFile(sourceFile)),sourceSha256);
  record.readScopesUnchanged=true;record.newTypeVerified=true;record.sourceTypeUnchanged=true;record.rvtDiskUnchanged=true;
  record.status='COPY_COMMITTED_NATIVE_AND_READ_SCOPES_VERIFIED_MANUAL_SAVE_PENDING';record.completedAt=new Date().toISOString();await save();
}catch(error){
  record.error={code:error.code??null,message:error.message,details:error.details};
  if(record.confirmationCalls){
    record.status='COPY_SUBMITTED_NOT_FULLY_VERIFIED_DO_NOT_RETRY';
    if(!record.observedPlan){try{record.observedPlan=await call('revit.plan.get',{planId});record.nativePlanStatus=record.observedPlan.status;record.receipt=record.observedPlan.receipt;}catch(readError){record.readbackError={code:readError.code??null,message:readError.message};}}
  }else record.status='COPY_NOT_SUBMITTED';
  if(executionCreated)await save();else{record.failureFile=path.join(runtime,`architecture-type-copy-preflight-stopped-${Date.now()}.json`);await fs.writeFile(record.failureFile,JSON.stringify(record,null,2),{flag:'wx'});}
  process.exitCode=1;
}finally{
  console.log(JSON.stringify({status:record.status,executionFile:executionCreated?executionFile:undefined,failureFile:record.failureFile,error:record.error,
    planId,confirmationCalls:record.confirmationCalls,nativePlanStatus:record.nativePlanStatus,createdTypeId:record.createdTypeId,
    revision:record.finalContext?.document.revision,isModified:record.finalContext?.document.isModified,
    nativeFamilyModificationObserved:record.nativeFamilyModificationObserved,newTypeVerified:record.newTypeVerified,
    sourceTypeUnchanged:record.sourceTypeUnchanged,manualSaveVerification:record.manualSaveVerification,
    allModelSideEffectsVerified:false,automaticSave:false,automaticRetry:false},null,2));
}
