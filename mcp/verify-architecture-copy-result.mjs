import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';
import {readFinalArchitectureCopyVerification,assertCopyContextTypeSample} from './architecture-copy-verification.mjs';

// Read-only recovery of the already committed plan. There is no confirmation,
// preview creation, cancellation, save or rollback path in this probe.
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const planId='d26bc8dac87a44869546e45b66945c75';
const sourceFile=path.join(runtime,'architecture-type-copy-preview-1791636415385.json');
const sourceSha256='77E3FA1E3564D9A1D1F996334BD3402B702D635CB23A1C49969BD323B7052C7F';
const executionFile=path.join(runtime,`architecture-type-copy-execution-${planId}.json`);
const executionSha256='63D0C27002734A9A47FE27A7B176A4AFD43AC38DA7B52FC225ED65A1AF589679';
const evidenceFile=path.join(runtime,`architecture-type-copy-readback-${Date.now()}.json`);
const record={status:'COMMITTED_COPY_READBACK_STARTED',checkedAt:new Date().toISOString(),sourceFile,sourceSha256,executionFile,executionSha256,planId,
  confirmationCalls:0,originalConfirmationCalls:1,modelWritesRequested:false,automaticSave:false,automaticRetry:false,
  allModelSideEffectsVerified:false,typeCopyExecutionAccepted:false,rollbackVerification:'pending',manualSaveVerification:'pending',
  nativeAdditionalElementClassification:'unresolved'};
const allowed=new Set(['revit.bridge.info','revit.context.get','revit.search','revit.inspect','revit.plan.get']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
async function read(file,expected){const bytes=await fs.readFile(file);assert.equal(hash(bytes),expected,'Bound evidence changed.');return JSON.parse(bytes.toString('utf8'));}
async function call(method,args={}){assert.ok(allowed.has(method),'Only registered read commands are allowed.');return callRevit(method,args);}
async function inspect(ids){
  assert.ok(ids.every(id=>Number.isSafeInteger(id)&&id>0));assert.equal(new Set(ids).size,ids.length);
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),result=await call('revit.inspect',{elementIds:page});
    assert.ok(Array.isArray(result.items));assert.deepEqual(result.items.map(item=>item.summary?.id),page);items.push(...result.items);
  }
  return {items};
}
async function unchanged(prior,label){const current=await inspect(prior.items.map(item=>item.summary.id));assertSameInspectionScope(current,prior,label);return current;}
async function memberships(expected,types=false){
  const result={};
  for(const category of Object.keys(expected)){
    const ids=[];let offset=0;
    while(true){
      const page=await call('revit.search',{category,types,limit:500,offset});
      assert.equal(page.offset,offset);assert.equal(page.limit,500);assert.equal(typeof page.hasMore,'boolean');assert.ok(Array.isArray(page.items)&&page.items.length<=500);
      for(const item of page.items){assert.ok(Number.isSafeInteger(item.id)&&item.id>0);ids.push(item.id);}
      if(!page.hasMore)break;
      assert.ok(page.items.length>0&&offset+page.items.length<=100000);offset+=page.items.length;
    }
    assert.equal(new Set(ids).size,ids.length);result[category]=ids.sort((a,b)=>a-b);
  }
  assert.deepEqual(result,expected,'Native membership changed beyond the single reviewed type.');return result;
}
async function savedFile(file){const bytes=await fs.readFile(file);return {path:file,bytes:bytes.length,sha256:hash(bytes).toLowerCase()};}
function near(actual,expected){assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=0.01,'Native dimension differs.');}
function contextAfterCopy(actual,before,newId,endRevision){
  assert.equal(actual.active,true);assert.deepEqual(actual.document,{...before.document,revision:endRevision,isModified:true});
  for(const key of ['revitVersion','revitBuild','counts','levels','elementTypes','units','pagination','activeView','selectedElementIds'])assert.deepEqual(actual[key],before[key],key+' changed.');
  return assertCopyContextTypeSample(actual.familyTypes,before.familyTypes,newId);
}
try{
  const source=await read(sourceFile,sourceSha256),execution=await read(executionFile,executionSha256);
  assert.equal(source.status,'TYPE_COPY_PREVIEW_ONLY_COMPLETE_READ_SCOPES_VERIFIED');
  assert.equal(execution.status,'COPY_SUBMITTED_NOT_FULLY_VERIFIED_DO_NOT_RETRY');assert.equal(execution.confirmationCalls,1);assert.equal(execution.nativePlanStatus,'committed');
  assert.equal(execution.error.code,'ERR_ASSERTION');assert.equal(execution.error.message,'Expected values to be strictly equal:\n\nundefined !== 1\n');
  assert.equal(source.plan.planId,planId);assert.equal(execution.planId,planId);
  const operation=source.plan.operations[0],receipt=execution.receipt,preview=source.nativeSourcePreview;
  assert.equal(source.plan.operations.length,1);assert.equal(operation.operationType,'duplicate_architecture_type');
  assert.equal(receipt.status,'committed');assert.equal(receipt.planId,planId);assert.equal(receipt.completedOperationCount,1);assert.equal(receipt.saved,false);assert.equal(receipt.confirmationMode,'chat');
  assert.equal(receipt.createdElementIds.length,1);const newId=record.createdTypeId=receipt.createdElementIds[0];assert.equal(newId,2296038);
  assert.deepEqual(receipt.changedElementIds,[]);assert.deepEqual(receipt.references,{[operation.id]:newId});
  assert.equal(receipt.operationEvidence.length,1);const row=receipt.operationEvidence[0];assert.equal(row.operationIndex,1);assert.equal(row.operationType,operation.operationType);
  const evidence=row.evidence;assert.equal(evidence.sourceTypeId,operation.sourceTypeId);assert.equal(evidence.createdTypeId,newId);
  assert.deepEqual(evidence.sourceBefore,preview.sourceSnapshot);assert.deepEqual(evidence.sourceAfter,evidence.sourceBefore);
  for(const key of ['sourceParametersComplete','sourceUnchanged','nativeReadbackVerified','finalVerificationRequired'])assert.equal(evidence[key],true);
  for(const key of ['activationPerformed','automaticSave','sideEffectsVerified'])assert.equal(evidence[key],false);
  assert.equal(evidence.dimensionWrites.length,2);assert.equal(new Set(evidence.dimensionWrites.map(item=>item.parameterId)).size,2);
  for(const dimension of operation.dimensions){const write=evidence.dimensionWrites.find(item=>item.parameterId===dimension.parameterId);assert.deepEqual(write,{parameterId:dimension.parameterId,name:dimension.name,desiredMm:dimension.valueMm,writePerformed:true});}
  const final=readFinalArchitectureCopyVerification(receipt.architectureCopyVerification,1,0);
  assert.deepEqual(final.sourceTypeIds,[operation.sourceTypeId]);assert.deepEqual(final.copies[0],evidence.native);
  const copied=final.copies[0];assert.equal(copied.createdTypeId,newId);assert.equal(copied.name,operation.name);assert.equal(copied.familyId,preview.familyId);
  assert.equal(copied.familyName,preview.familyName);assert.equal(copied.categoryId,preview.categoryId);assert.equal(copied.category,operation.category);assert.equal(copied.placement,preview.placement);
  assert.equal(copied.isActive,copied.initiallyActive);assert.equal(typeof copied.isActive,'boolean');assert.equal(copied.activationChanged,false);assert.equal(copied.reviewedPlacementActivationAllowed,false);assert.equal(copied.nativeDimensionsVerified,true);
  assert.equal(copied.dimensions.length,2);assert.equal(new Set(copied.dimensions.map(item=>item.parameterId)).size,2);
  for(const dimension of operation.dimensions){
    const actual=copied.dimensions.find(item=>item.parameterId===dimension.parameterId);assert.ok(actual);
    assert.equal(actual.name,dimension.name);assert.equal(actual.desiredMm,dimension.valueMm);near(actual.actualMm,dimension.valueMm);
    assert.equal(actual.storageType,'Double');assert.equal(actual.hasValue,true);assert.equal(actual.readOnly,false);
    assert.equal(actual.spec,preview.dimensions.find(item=>item.parameterId===dimension.parameterId).spec);
  }
  record.receipt=receipt;record.bridge=await call('revit.bridge.info');assert.deepEqual(record.bridge,execution.bridge);
  record.plan=await call('revit.plan.get',{planId});assert.deepEqual(record.plan,execution.observedPlan,'The original committed receipt changed.');
  const native=record.nativeChanges=receipt.nativeChanges;assert.equal(native.documentIdentity,execution.before.document.identity);assert.equal(native.startRevision,execution.before.document.revision);
  assert.equal(native.executionOutcome,'committed');assert.equal(native.evidenceKind,'document-changed-event-union');
  for(const key of ['captureComplete','elementEvidenceComplete','revisionCoverageComplete'])assert.equal(native[key],true);
  for(const key of ['elementIdsTruncated','eventMetadataTruncated','netModelDiffVerified','sideEffectsVerified'])assert.equal(native[key],false);
  for(const key of ['observedModifiedElementIds','unreportedModifiedElementIds','observedDeletedElementIds','observedThenDeletedElementIds'])assert.deepEqual(native[key],[]);
  assert.deepEqual(native.additionalAddedElementIds,[2296039]);assert.deepEqual(native.observedAddedElementIds,[newId,...native.additionalAddedElementIds].sort((a,b)=>a-b));
  const existingItems=['fullScope','architectureScope','categoryScope','typeScope','familyScope'].flatMap(name=>execution[name].items),existingIds=new Set(existingItems.map(item=>item.summary.id));
  assert.ok(native.observedAddedElementIds.every(id=>!existingIds.has(id)),'A reported addition already existed in the captured baseline.');
  record.before=await call('revit.context.get');record.contextTypeSample=contextAfterCopy(record.before,execution.before,newId,native.endRevision);
  record.savedFileBefore=await savedFile(record.before.document.path);assert.deepEqual(record.savedFileBefore,execution.savedFileBefore,'The RVT file was saved or changed.');
  record.expectedTypeCategoryIds=structuredClone(execution.typeCategoryIds);record.expectedTypeCategoryIds.OST_StructuralColumns=[...execution.typeCategoryIds.OST_StructuralColumns,newId].sort((a,b)=>a-b);
  record.categoryIds=await memberships(execution.categoryIds);record.typeCategoryIds=await memberships(record.expectedTypeCategoryIds,true);
  for(const name of ['fullScope','architectureScope','categoryScope','typeScope','familyScope'])record[name]=await unchanged(execution[name],`Existing ${name} after committed copy`);
  record.newTypeScope=await inspect([newId]);const created=record.newTypeScope.items[0];
  for(const [key,expected] of Object.entries({className:'FamilySymbol',name:operation.name,uniqueId:copied.uniqueId,family:preview.familyName,categoryId:preview.categoryId,placement:preview.placement}))assert.equal(created.summary[key],expected);
  if(record.contextTypeSample.newTypePresent)assert.deepEqual(record.before.familyTypes.find(item=>item.id===newId),{id:newId,category:created.summary.category,categoryId:created.summary.categoryId,family:preview.familyName,type:operation.name,placement:preview.placement});
  assert.equal(created.parameters.length,preview.sourceParameterCount);
  for(const dimension of operation.dimensions){
    const matching=created.parameters.filter(item=>item.id===dimension.parameterId&&item.name===dimension.name);assert.equal(matching.length,1);const parameter=matching[0];
    assert.equal(parameter.storageType,'Double');assert.equal(parameter.readOnly,false);assert.equal(parameter.hasValue,true);assert.equal(parameter.valueSupported,true);near(parameter.value*304.8,dimension.valueMm);
  }
  record.additionalNativeScope=await inspect(native.additionalAddedElementIds);
  record.additionalNativeReview=record.additionalNativeScope.items.map(item=>({elementId:item.summary.id,className:item.summary.className,name:item.summary.name,
    categoryKnown:typeof item.summary.categoryId==='number',relationshipToCopiedTypeVerified:false,classification:'unresolved',baselineAvailable:false}));
  record.afterCategoryIds=await memberships(record.categoryIds);record.afterTypeCategoryIds=await memberships(record.typeCategoryIds,true);
  for(const name of ['fullScope','architectureScope','categoryScope','typeScope','familyScope','newTypeScope','additionalNativeScope'])
    record['after'+name[0].toUpperCase()+name.slice(1)]=await unchanged(record[name],`${name} during read-only recovery`);
  record.after=await call('revit.context.get');assert.deepEqual(record.after.document,record.before.document);
  for(const key of ['revitVersion','revitBuild','counts','levels','familyTypes','elementTypes','units','pagination','activeView','selectedElementIds'])assert.deepEqual(record.after[key],record.before[key]);
  record.afterBridge=await call('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge);
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore);
  record.planAfter=await call('revit.plan.get',{planId});assert.deepEqual(record.planAfter,record.plan);
  await read(sourceFile,sourceSha256);await read(executionFile,executionSha256);
  record.movementPosition=record.afterFullScope.items.find(item=>item.summary.id===2296037)?.drawing?.position;
  assert.deepEqual(record.movementPosition,source.afterFullScope.items.find(item=>item.summary.id===2296037).drawing.position);
  record.primaryTypeReadbackVerified=true;record.sourceTypeUnchanged=true;record.existingReadScopesUnchanged=true;record.rvtDiskUnchanged=true;
  record.status='COPY_PRIMARY_AND_EXISTING_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED_MANUAL_SAVE_PENDING';
}catch(error){record.status='COMMITTED_COPY_READBACK_STOPPED';record.error={code:error.code??null,message:error.message};process.exitCode=1;}
finally{
  await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,createdTypeId:record.createdTypeId,
    primaryTypeReadbackVerified:record.primaryTypeReadbackVerified,sourceTypeUnchanged:record.sourceTypeUnchanged,
    existingReadScopesUnchanged:record.existingReadScopesUnchanged,document:record.after?.document??record.before?.document,
    additionalNativeReview:record.additionalNativeReview,originalConfirmationCalls:1,confirmationCalls:0,modelWritesRequested:false,
    automaticSave:false,typeCopyExecutionAccepted:false,manualSaveVerification:'pending'},null,2));
}
