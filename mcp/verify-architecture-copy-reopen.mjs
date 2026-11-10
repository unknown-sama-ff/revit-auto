import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';

// Read only after the human closes and reopens the same saved test copy.
// The old committed plan is reviewed from immutable evidence, never recreated.
assert.ok(process.argv.includes('--user-reported-reopened'),'Run only after the user reports reopening this saved copied-type test model.');
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const sourceFile=path.join(runtime,'architecture-type-copy-manual-save-1791641393933.json');
const sourceSha256='D4F062DD463D47A41A0D6DE553E9355A1573DA2714A42C48A26C6775E84F5403';
const evidenceFile=path.join(runtime,`architecture-type-copy-saved-reopen-${Date.now()}.json`);
const allowed=new Set(['revit.bridge.info','revit.context.get','revit.inspect','revit.search']);
const record={status:'SAVED_COPY_REOPEN_READBACK_STARTED',checkedAt:new Date().toISOString(),sourceFile,sourceSha256,
  confirmationCalls:0,originalConfirmationCalls:1,planCreationCalls:0,modelWritesRequested:false,
  automaticSave:false,automaticRetry:false,typeCopyExecutionAccepted:false,allModelSideEffectsVerified:false,
  closeReopenPersistenceVerified:false,readScopePersistenceVerified:false,nativeAdditionalElementClassification:'unresolved',
  rollbackVerification:'pending'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
async function readBound(file,expected){
  const bytes=await fs.readFile(file);assert.equal(sha(bytes),expected,'Bound evidence changed.');
  return JSON.parse(bytes.toString('utf8'));
}
async function call(method,args={}){assert.ok(allowed.has(method),'Only declared native reads are allowed.');return callRevit(method,args);}
async function savedFile(file){const bytes=await fs.readFile(file);return {path:file,bytes:bytes.length,sha256:sha(bytes).toLowerCase()};}
function stableContext(actual,expected,reopened=false){
  assert.equal(actual.active,true);assert.equal(actual.document.isModified,false);
  if(reopened){
    assert.match(actual.document.identity,/^[a-f0-9]{32}$/);assert.notEqual(actual.document.identity,expected.document.identity,'The model has not reopened in a new document session.');
    assert.equal(actual.document.revision,0,'The reopened model already contains a changed revision.');
    assert.deepEqual(actual.document,{...expected.document,identity:actual.document.identity,revision:0});
  }else assert.deepEqual(actual.document,expected.document);
  for(const key of ['revitVersion','revitBuild','counts','levels','familyTypes','elementTypes','units','pagination'])assert.deepEqual(actual[key],expected[key],`${key} changed.`);
  // UI restoration may change the active view or selection across sessions.
  // Both must remain stable during this read-only probe.
  if(!reopened)for(const key of ['activeView','selectedElementIds'])assert.deepEqual(actual[key],expected[key]);
}
function loadedBridge(actual,expected){
  assert.ok(Number.isSafeInteger(actual.pid)&&actual.pid>0);
  assert.deepEqual({...actual,pid:expected.pid},expected,'The loaded plugin differs from the saved verification.');
}
async function scope(prior,label){
  assert.ok(Array.isArray(prior?.items));const ids=prior.items.map(item=>item.summary?.id);
  assert.ok(ids.every(id=>Number.isSafeInteger(id)&&id>0));assert.equal(new Set(ids).size,ids.length);
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),response=await call('revit.inspect',{elementIds:page});
    assert.ok(Array.isArray(response.items));assert.deepEqual(response.items.map(item=>item.summary?.id),page);items.push(...response.items);
  }
  const result={items};assertSameInspectionScope(result,prior,label);return result;
}
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
  assert.deepEqual(result,expected,'Reopened instance/type membership changed.');return result;
}
function dimensions(scopeValue,id,desired){
  const item=scopeValue.items.find(row=>row.summary.id===id);assert.ok(item);
  for(const [parameterId,name,mm] of desired){
    const matches=item.parameters.filter(parameter=>parameter.id===parameterId&&parameter.name===name);assert.equal(matches.length,1);
    const parameter=matches[0];assert.equal(parameter.storageType,'Double');assert.equal(parameter.readOnly,false);
    assert.equal(parameter.hasValue,true);assert.equal(parameter.valueSupported,true);
    assert.ok(Number.isFinite(parameter.value)&&Math.abs(parameter.value*304.8-mm)<=0.01);
  }
}
try{
  const source=await readBound(sourceFile,sourceSha256);
  assert.equal(source.status,'SAVED_CURRENT_SESSION_COPY_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED');
  assert.equal(source.manualSaveCurrentSessionVerified,true);assert.equal(source.savedFileStable,true);
  for(const key of ['primaryTypeReadbackVerified','sourceTypeUnchanged','existingReadScopesUnchanged'])assert.equal(source[key],true);
  assert.equal(source.confirmationCalls,0);assert.equal(source.originalConfirmationCalls,1);assert.equal(source.after.document.isModified,false);
  assert.equal(source.typeCopyExecutionAccepted,false);assert.equal(source.allModelSideEffectsVerified,false);
  assert.equal(source.nativeAdditionalElementClassification,'unresolved');assert.equal(source.plan.status,'committed');assert.deepEqual(source.planAfter,source.plan);
  // Preserve the full preview, execution and final recovery evidence chain.
  const preview=await readBound(source.sourceFile,source.sourceSha256),execution=await readBound(source.executionFile,source.executionSha256),readback=await readBound(source.readbackFile,source.readbackSha256);
  assert.equal(execution.confirmationCalls,1);assert.equal(execution.nativePlanStatus,'committed');assert.deepEqual(source.plan,execution.observedPlan);
  assert.deepEqual(source.plan.operations,preview.plan.operations);assert.deepEqual(source.plan.receipt,execution.receipt);assert.deepEqual(source.plan,readback.planAfter);
  record.archivedPlan=source.plan;record.archivedNativeChanges=source.plan.receipt.nativeChanges;
  assert.deepEqual(record.archivedNativeChanges.additionalAddedElementIds,[2296039]);
  const scopes={fullScope:134,architectureScope:29,categoryScope:236,typeScope:24,familyScope:1,newTypeScope:1,additionalNativeScope:1};
  for(const [name,count] of Object.entries(scopes))assert.equal(source['after'+name[0].toUpperCase()+name.slice(1)].items.length,count);
  record.bridge=await call('revit.bridge.info');loadedBridge(record.bridge,source.afterBridge);
  record.before=await call('revit.context.get');stableContext(record.before,source.after,true);
  record.savedFileBefore=await savedFile(record.before.document.path);assert.deepEqual(record.savedFileBefore,source.savedFileAfter,'Reopened RVT file bytes differ from the verified save.');
  record.categoryIds=await memberships(source.afterCategoryIds);record.typeCategoryIds=await memberships(source.afterTypeCategoryIds,true);
  for(const [category,count] of Object.entries(record.before.counts))assert.equal(record.categoryIds[category].length,count);
  for(const name of Object.keys(scopes))record[name]=await scope(source['after'+name[0].toUpperCase()+name.slice(1)],`Reopened ${name}`);
  dimensions(record.typeScope,765512,[[765248,'b',300],[765218,'h',450]]);dimensions(record.newTypeScope,2296038,[[765248,'b',500],[765218,'h',500]]);
  record.additionalNativeReview=structuredClone(source.additionalNativeReview);
  assert.equal(record.additionalNativeReview.length,1);assert.equal(record.additionalNativeReview[0].elementId,2296039);
  assert.equal(record.additionalNativeReview[0].classification,'unresolved');assert.equal(record.additionalNativeReview[0].relationshipToCopiedTypeVerified,false);
  record.afterCategoryIds=await memberships(record.categoryIds);record.afterTypeCategoryIds=await memberships(record.typeCategoryIds,true);
  for(const name of Object.keys(scopes))record['after'+name[0].toUpperCase()+name.slice(1)]=await scope(record[name],`${name} during reopen verification`);
  record.movementPosition=record.afterFullScope.items.find(item=>item.summary.id===2296037)?.drawing?.position;
  assert.deepEqual(record.movementPosition,source.movementPosition,'AL1 absolute paper position changed.');
  record.after=await call('revit.context.get');stableContext(record.after,record.before);
  record.afterBridge=await call('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge);
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore);
  await readBound(sourceFile,sourceSha256);await readBound(source.sourceFile,source.sourceSha256);await readBound(source.executionFile,source.executionSha256);await readBound(source.readbackFile,source.readbackSha256);
  record.primaryTypeReadbackVerified=true;record.sourceTypeUnchanged=true;record.existingReadScopesUnchanged=true;
  record.readScopePersistenceVerified=true;record.savedFileStable=true;
  record.status='SAVED_REOPEN_COPY_READ_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED';record.completedAt=new Date().toISOString();
}catch(error){record.status='SAVED_COPY_REOPEN_READBACK_STOPPED';record.error={code:error.code??null,message:error.message};process.exitCode=1;}
finally{
  await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,document:record.after?.document??record.before?.document,
    readScopePersistenceVerified:record.readScopePersistenceVerified,savedFileAfter:record.savedFileAfter,additionalNativeReview:record.additionalNativeReview,
    confirmationCalls:0,planCreationCalls:0,modelWritesRequested:false,automaticSave:false,
    typeCopyExecutionAccepted:false,allModelSideEffectsVerified:false,closeReopenPersistenceVerified:false},null,2));
}
