import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';

// Run only after a new human report that this committed test copy was saved.
// verification.saved is a registered MCP read workflow, never a native preview.
assert.ok(process.argv.includes('--user-reported-saved'),'Run only after the user reports manually saving the copied-type test model.');
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const planId='d26bc8dac87a44869546e45b66945c75';
const sourceFile=path.join(runtime,'architecture-type-copy-preview-1791636415385.json');
const sourceSha256='77E3FA1E3564D9A1D1F996334BD3402B702D635CB23A1C49969BD323B7052C7F';
const executionFile=path.join(runtime,`architecture-type-copy-execution-${planId}.json`);
const executionSha256='63D0C27002734A9A47FE27A7B176A4AFD43AC38DA7B52FC225ED65A1AF589679';
const readbackFile=path.join(runtime,'architecture-type-copy-readback-1791638159095.json');
const readbackSha256='3A924401F6767D2761B4C3E42DC0B3B8987AF55A98CAF818A520043231FA209F';
const evidenceFile=path.join(runtime,`architecture-type-copy-manual-save-${Date.now()}.json`);
const client=new Client({name:'saved-architecture-copy-readback',version:'0.4.0'});
const allowed=new Set(['revit_context_get','revit_plan_get','revit_inspect','revit_search','revit_workflow_run']);
const record={status:'SAVED_COPY_READBACK_STARTED',checkedAt:new Date().toISOString(),planId,
  sourceFile,sourceSha256,executionFile,executionSha256,readbackFile,readbackSha256,
  userReportedSaved:true,confirmationCalls:0,originalConfirmationCalls:1,modelWritesRequested:false,
  automaticSave:false,automaticRetry:false,planCreationCalls:0,cancellationCalls:0,
  allModelSideEffectsVerified:false,typeCopyExecutionAccepted:false,closeReopenPersistenceVerified:false,
  manualSaveVerification:'pending',rollbackVerification:'pending',nativeAdditionalElementClassification:'unresolved'};
let connected=false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
async function readBound(file,expected){
  const bytes=await fs.readFile(file);assert.equal(hash(bytes),expected,'Bound evidence changed.');
  return JSON.parse(bytes.toString('utf8'));
}
async function savedFile(file){
  const bytes=await fs.readFile(file);
  return {path:file,bytes:bytes.length,sha256:hash(bytes).toLowerCase()};
}
async function call(name,args={}){
  assert.ok(allowed.has(name),'Only the declared read-only MCP tools are allowed.');
  if(name==='revit_workflow_run'){
    assert.equal(args.name,'verification.saved','Only the saved-state read workflow is permitted.');
    assert.equal(args.planningMode,'explicit');
  }
  const response=await client.callTool({name,arguments:args});
  assert.ok(Array.isArray(response.content)&&response.content[0]?.type==='text','MCP returned no JSON text result.');
  const value=JSON.parse(response.content[0].text);
  if(response.isError){const error=new Error(value.message);Object.assign(error,{code:value.code,details:value.details});throw error;}
  return value;
}
// bridge.info has no standalone MCP tool. This fixed native read is the only
// direct bridge call; all model, plan and saved-state reads use the MCP surface.
async function bridge(){return callRevit('revit.bridge.info');}
function stableContext(actual,expected,savedTransition=false){
  assert.equal(actual.active,true,'The reviewed test project must be active.');
  assert.deepEqual(actual.document,savedTransition?{...expected.document,isModified:false}:expected.document,'Saved document state differs.');
  assert.equal(actual.document.identity,'8c1f897788084b91bcb408bb53344085');
  assert.equal(actual.document.revision,1);assert.equal(actual.document.isModified,false);
  for(const key of ['revitVersion','revitBuild','counts','levels','familyTypes','elementTypes','units','pagination','activeView','selectedElementIds'])
    assert.deepEqual(actual[key],expected[key],`${key} changed.`);
}
async function inspectScope(prior,label){
  assert.ok(Array.isArray(prior?.items),'Missing complete inspection baseline.');
  const ids=prior.items.map(item=>item.summary?.id);
  assert.ok(ids.every(id=>Number.isSafeInteger(id)&&id>0),'Invalid baseline inspection ID.');
  assert.equal(new Set(ids).size,ids.length,'Duplicate baseline inspection ID.');
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),response=await call('revit_inspect',{elementIds:page});
    assert.ok(Array.isArray(response.items));
    assert.deepEqual(response.items.map(item=>item.summary?.id),page,'An element is missing or the inspection was incomplete.');
    items.push(...response.items);
  }
  const result={items};assertSameInspectionScope(result,prior,label);return result;
}
async function memberships(expected,types=false){
  const result={};
  for(const category of Object.keys(expected)){
    const ids=[];let offset=0;
    while(true){
      const page=await call('revit_search',{category,types,limit:500,offset});
      assert.equal(page.offset,offset);assert.equal(page.limit,500);assert.equal(typeof page.hasMore,'boolean');
      assert.ok(Array.isArray(page.items)&&page.items.length<=500,'Invalid native search page.');
      for(const item of page.items){assert.ok(Number.isSafeInteger(item.id)&&item.id>0);ids.push(item.id);}
      if(!page.hasMore)break;
      assert.ok(page.items.length>0&&offset+page.items.length<=100000,'Invalid native search continuation.');
      offset+=page.items.length;
    }
    assert.equal(new Set(ids).size,ids.length,'Duplicate native search ID.');result[category]=ids.sort((a,b)=>a-b);
  }
  assert.deepEqual(result,expected,'Native instance/type membership changed after manual save.');return result;
}
function dimensions(scope,id,expected){
  const item=scope.items.find(row=>row.summary.id===id);assert.ok(item,'The exact type is missing.');
  for(const dimension of expected){
    const matching=item.parameters.filter(parameter=>parameter.id===dimension.parameterId&&parameter.name===dimension.name);
    assert.equal(matching.length,1,'A dimension parameter is missing or ambiguous.');
    const parameter=matching[0];assert.equal(parameter.storageType,'Double');assert.equal(parameter.readOnly,false);
    assert.equal(parameter.hasValue,true);assert.equal(parameter.valueSupported,true);
    assert.ok(Number.isFinite(parameter.value)&&Math.abs(parameter.value*304.8-dimension.valueMm)<=0.01,'The saved native dimension differs.');
  }
}
try{
  const source=await readBound(sourceFile,sourceSha256),execution=await readBound(executionFile,executionSha256),readback=await readBound(readbackFile,readbackSha256);
  assert.equal(source.status,'TYPE_COPY_PREVIEW_ONLY_COMPLETE_READ_SCOPES_VERIFIED');assert.equal(source.plan.planId,planId);
  assert.equal(execution.confirmationCalls,1);assert.equal(execution.nativePlanStatus,'committed');assert.equal(execution.receipt.status,'committed');
  assert.equal(readback.status,'COPY_PRIMARY_AND_EXISTING_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED_MANUAL_SAVE_PENDING');
  assert.equal(readback.planId,planId);assert.equal(readback.createdTypeId,2296038);assert.equal(readback.confirmationCalls,0);
  for(const key of ['primaryTypeReadbackVerified','sourceTypeUnchanged','existingReadScopesUnchanged','rvtDiskUnchanged'])assert.equal(readback[key],true);
  for(const key of ['typeCopyExecutionAccepted','allModelSideEffectsVerified','modelWritesRequested','automaticSave'])assert.equal(readback[key],false);
  assert.equal(readback.nativeAdditionalElementClassification,'unresolved');assert.equal(readback.manualSaveVerification,'pending');
  assert.deepEqual(readback.receipt,execution.receipt);assert.deepEqual(readback.planAfter,execution.observedPlan);
  assert.equal(readback.after.document.revision,1);assert.equal(readback.after.document.isModified,true);
  const operation=source.plan.operations[0];
  assert.deepEqual(source.plan.operations,[{sourceTypeId:765512,name:'AI-PARITY-COLUMN-500x500-TEST',category:'OST_StructuralColumns',
    dimensions:[{parameterId:765248,name:'b',valueMm:500},{parameterId:765218,name:'h',valueMm:500}],id:'type1',operationType:'duplicate_architecture_type'}]);
  assert.deepEqual(readback.receipt.nativeChanges.additionalAddedElementIds,[2296039]);
  assert.deepEqual(readback.afterAdditionalNativeScope.items.map(item=>item.summary.id),[2296039]);
  const scopes={fullScope:134,architectureScope:29,categoryScope:236,typeScope:24,familyScope:1,newTypeScope:1,additionalNativeScope:1};
  for(const [name,count] of Object.entries(scopes))assert.equal(readback['after'+name[0].toUpperCase()+name.slice(1)].items.length,count,'Saved baseline scope count differs.');
  record.bridge=await bridge();assert.deepEqual(record.bridge,readback.afterBridge,'The loaded plugin changed.');
  assert.equal(record.bridge.moduleVersionId,'9516157a-03e1-4cd6-8299-739503b6d877');
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp','revit-custom.mjs')],stderr:'pipe'}));connected=true;
  record.before=await call('revit_context_get');stableContext(record.before,readback.after,true);
  record.savedVerification=await call('revit_workflow_run',{name:'verification.saved',planningMode:'explicit',
    documentIdentity:record.before.document.identity,expectedRevision:1,input:{sinceRevision:0,limit:100}});
  assert.equal(record.savedVerification.workflowId,'verification.saved');assert.equal(record.savedVerification.documentIdentity,record.before.document.identity);
  assert.equal(record.savedVerification.revision,1);assert.equal(record.savedVerification.saved,true);assert.equal(record.savedVerification.isModified,false);
  assert.equal(record.savedVerification.saveState,'no_pending_changes');assert.equal(record.savedVerification.automaticSave,false);
  assert.equal(record.savedVerification.planCreated,false);assert.equal(record.savedVerification.persistenceVerified,false);
  assert.equal(record.savedVerification.historyComplete,true);assert.equal(record.savedVerification.historyTruncated,false);
  record.plan=await call('revit_plan_get',{planId});assert.deepEqual(record.plan,readback.planAfter,'The original committed plan or receipt changed.');
  assert.deepEqual(record.plan.operations,source.plan.operations);assert.deepEqual(record.plan.receipt,execution.receipt);
  record.savedFileBefore=await savedFile(record.before.document.path);assert.equal(record.savedFileBefore.path,readback.savedFileAfter.path);
  assert.notEqual(record.savedFileBefore.sha256,readback.savedFileAfter.sha256,'RVT bytes still match the pre-copy saved file.');
  record.categoryIds=await memberships(readback.afterCategoryIds);record.typeCategoryIds=await memberships(readback.afterTypeCategoryIds,true);
  for(const [category,count] of Object.entries(record.before.counts))assert.equal(record.categoryIds[category].length,count,'Native count and membership differ.');
  for(const name of Object.keys(scopes))record[name]=await inspectScope(readback['after'+name[0].toUpperCase()+name.slice(1)],`Saved ${name}`);
  dimensions(record.typeScope,765512,[{parameterId:765248,name:'b',valueMm:300},{parameterId:765218,name:'h',valueMm:450}]);
  dimensions(record.newTypeScope,2296038,operation.dimensions);
  record.additionalNativeReview=structuredClone(readback.additionalNativeReview);
  assert.equal(record.additionalNativeReview.length,1);assert.equal(record.additionalNativeReview[0].elementId,2296039);
  assert.equal(record.additionalNativeReview[0].classification,'unresolved');assert.equal(record.additionalNativeReview[0].relationshipToCopiedTypeVerified,false);
  record.afterCategoryIds=await memberships(record.categoryIds);record.afterTypeCategoryIds=await memberships(record.typeCategoryIds,true);
  for(const name of Object.keys(scopes))record['after'+name[0].toUpperCase()+name.slice(1)]=await inspectScope(record[name],`${name} during saved-state verification`);
  record.movementPosition=record.afterFullScope.items.find(item=>item.summary.id===2296037)?.drawing?.position;
  assert.deepEqual(record.movementPosition,readback.movementPosition,'AL1 absolute paper position changed.');
  record.after=await call('revit_context_get');stableContext(record.after,record.before);
  record.afterBridge=await bridge();assert.deepEqual(record.afterBridge,record.bridge,'The loaded plugin changed during verification.');
  record.planAfter=await call('revit_plan_get',{planId});assert.deepEqual(record.planAfter,record.plan);
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore,'Saved RVT bytes changed during read-only verification.');
  await readBound(sourceFile,sourceSha256);await readBound(executionFile,executionSha256);await readBound(readbackFile,readbackSha256);
  record.manualSaveCurrentSessionVerified=true;record.manualSaveVerification='current-session-verified';
  record.primaryTypeReadbackVerified=true;record.sourceTypeUnchanged=true;record.existingReadScopesUnchanged=true;record.savedFileStable=true;
  record.status='SAVED_CURRENT_SESSION_COPY_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED';record.completedAt=new Date().toISOString();
}catch(error){
  record.status='SAVED_COPY_READBACK_STOPPED';record.error={code:error.code??null,message:error.message,details:error.details};process.exitCode=1;
}finally{
  try{await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});}finally{if(connected)await client.close();}
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,planId,
    document:record.after?.document??record.before?.document,manualSaveVerification:record.manualSaveVerification,
    scopeCounts:Object.fromEntries(['fullScope','architectureScope','categoryScope','typeScope','familyScope','newTypeScope','additionalNativeScope'].map(name=>[name,record[name]?.items.length])),
    savedFileAfter:record.savedFileAfter,additionalNativeReview:record.additionalNativeReview,
    confirmationCalls:0,modelWritesRequested:false,automaticSave:false,closeReopenPersistenceVerified:false,
    typeCopyExecutionAccepted:false,allModelSideEffectsVerified:false},null,2));
}
