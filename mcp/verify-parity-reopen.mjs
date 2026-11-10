import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';

// Local read-only acceptance probe for the one reviewed registration request.
assert.ok(process.argv.includes('--user-reported-reopened'),'Run only after the user reports reopening the saved test copy.');
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const requestId='7db84f94955d4695830d1f9bf132fb47';
const requestFile=path.join(runtime,`registration-switch-request-${requestId}.json`);
const receiptFile=path.join(runtime,`registration-switch-receipt-${requestId}.json`);
const requestSha256='8100B4A85B7301CCC1E9DA0A19B610EFE4C64269BC9437B147A18CA0D7AC0534';
const dllSha256='7414690C75FABC7E75995B406D9E56BF48B3CC8C1C7327D62D5AA88F952A1059';
const moduleVersionId='9516157a-03e1-4cd6-8299-739503b6d877';
const baselineSha256='5C2AE7386FD4060F2A5AF5A68C18AD54ED42E2595795BA711EF869073EAB68B2';
const baselineFile=path.join(runtime,'parity-architecture-copy-predeployment-1791629054042.json');
const dllFile=path.join(root,'v27','bin','Release','net10.0-windows-architecture-copy-final-20261010','RevitAutoV27.dll');
const evidenceFile=path.join(runtime,`parity-architecture-copy-reopen-${Date.now()}.json`);
const record={status:'REOPEN_READBACK_STARTED',checkedAt:new Date().toISOString(),requestFile,receiptFile,baselineFile,
  modelWritesRequested:false,confirmationCalls:0,automaticSave:false,automaticRetry:false,
  allModelSideEffectsVerified:false,typeCopyExecutionAccepted:false,wholeSheetLayoutAccepted:false,negativeZeroCanonicalized:true};

function sha(bytes){return createHash('sha256').update(bytes).digest('hex').toUpperCase();}
async function readJson(file,expectedSha){
  const bytes=await fs.readFile(file);
  if(expectedSha)assert.equal(sha(bytes),expectedSha,'Reviewed evidence hash changed.');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
}
async function savedFile(file){
  const bytes=await fs.readFile(file);
  return {path:file,bytes:bytes.length,sha256:sha(bytes).toLowerCase()};
}
function stableContext(actual,expected,reopened=false){
  assert.equal(actual.active,true,'A project must be active.');
  if(reopened){
    assert.match(actual.document.identity,/^[a-f0-9]{32}$/,'Unknown document session identity.');
    assert.notEqual(actual.document.identity,expected.document.identity,'The saved model has not opened in a new session.');
    assert.equal(actual.document.revision,0,'The reopened model already has a changed revision.');
    assert.deepEqual(actual.document,{...expected.document,identity:actual.document.identity,revision:0},'Reopened document differs from the saved test copy.');
  }else assert.deepEqual(actual.document,expected.document,'Document state changed during the read probe.');
  assert.equal(actual.revitVersion,expected.revitVersion,'Revit version changed.');
  assert.equal(actual.revitBuild,expected.revitBuild,'Revit build changed.');
  for(const key of ['counts','levels','familyTypes','elementTypes','units','pagination'])
    assert.deepEqual(actual[key],expected[key],`${key} changed.`);
  assert.equal(actual.document.isModified,false,'The test copy must remain saved.');
}
function loadedBridge(actual,prior){
  assert.equal(actual.moduleVersionId,moduleVersionId,'The registered architecture-copy DLL has not loaded.');
  assert.ok(Number.isSafeInteger(actual.pid)&&actual.pid>0,'Unknown Revit process ID.');
  assert.notEqual(actual.pid,prior.pid,'The previous Revit process is still running.');
  assert.ok(Array.isArray(actual.features)&&new Set(actual.features).size===actual.features.length,'Invalid bridge feature collection.');
  assert.deepEqual([...actual.features].sort(),[...prior.features,'architecture-type-copy'].sort(),'Unexpected loaded capabilities.');
  assert.deepEqual({...actual,moduleVersionId:prior.moduleVersionId,pid:prior.pid,features:prior.features},prior,'Other bridge fields changed.');
}
async function inspect(ids){
  assert.ok(ids.every(id=>Number.isSafeInteger(id)&&id>0),'Invalid inspection ID.');
  assert.equal(new Set(ids).size,ids.length,'Duplicate inspection ID.');
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),result=await callRevit('revit.inspect',{elementIds:page});
    assert.ok(Array.isArray(result.items),'Missing inspection response.');
    assert.deepEqual(result.items.map(item=>item.summary?.id),page,'Inspection IDs changed or disappeared.');
    items.push(...result.items);
  }
  return {items};
}
async function categoryIds(category,types=false){
  const ids=[];let offset=0;
  while(true){
    const result=await callRevit('revit.search',{category,types,limit:500,offset});
    assert.equal(result.offset,offset,'Search pagination offset differs.');
    assert.equal(result.limit,500,'Search pagination limit differs.');
    assert.equal(typeof result.hasMore,'boolean','Unknown pagination continuation state.');
    assert.ok(Array.isArray(result.items)&&result.items.length<=500,'Invalid search page.');
    for(const item of result.items){assert.ok(Number.isSafeInteger(item.id)&&item.id>0,'Invalid search ID.');ids.push(item.id);}
    if(!result.hasMore)break;
    assert.ok(result.items.length>0&&offset+result.items.length<=100000,'Unexpected search continuation.');
    offset+=result.items.length;
  }
  assert.equal(new Set(ids).size,ids.length,'Duplicate search ID.');
  return ids.sort((a,b)=>a-b);
}
async function memberships(expected,types=false){
  const result={};
  for(const category of Object.keys(expected))result[category]=await categoryIds(category,types);
  assert.deepEqual(result,expected,'Native category/type membership changed.');
  return result;
}
try{
  const request=await readJson(requestFile,requestSha256),receipt=await readJson(receiptFile);
  assert.equal(request.requestId,requestId,'Registration request ID differs.');
  assert.equal(receipt.requestId,requestId,'Registration receipt ID differs.');
  assert.equal(receipt.status,'REGISTERED_MANUAL_RESTART_PENDING','Registration is not in the reviewed completed state.');
  assert.equal(receipt.reviewedRequestSha256,requestSha256,'Registration used a different request hash.');
  assert.equal(request.assemblyPath.toLowerCase(),dllFile.toLowerCase(),'Registered DLL path differs.');
  assert.equal(receipt.selectedAssembly,request.assemblyPath,'Receipt DLL path differs.');
  for(const object of [request,receipt])assert.equal(object.moduleVersionId,moduleVersionId,'Registration MVID differs.');
  assert.equal(request.assemblySha256,dllSha256,'Request DLL hash differs.');
  assert.equal(receipt.selectedAssemblySha256,dllSha256,'Receipt DLL hash differs.');
  assert.equal(sha(await fs.readFile(dllFile)),dllSha256,'Registered DLL bytes changed.');
  assert.equal(sha(await fs.readFile(request.targetManifest)),request.proposedManifestSha256,'Current registration manifest changed.');
  assert.equal(receipt.installedManifestSha256,request.proposedManifestSha256,'Registration receipt manifest hash differs.');
  assert.equal(request.baseline.path.toLowerCase(),baselineFile.toLowerCase(),'Registration baseline path differs.');
  assert.equal(request.baseline.sha256,baselineSha256,'Registration baseline hash differs.');
  const baseline=await readJson(baselineFile,baselineSha256);
  assert.equal(baseline.status,'SAVED_CURRENT_PREDEPLOYMENT_READ_SCOPES_VERIFIED','Registration baseline is not verified.');
  record.bridge=await callRevit('revit.bridge.info');loadedBridge(record.bridge,baseline.afterBridge);
  record.before=await callRevit('revit.context.get');stableContext(record.before,baseline.after,true);
  record.savedFileBefore=await savedFile(record.before.document.path);
  assert.deepEqual(record.savedFileBefore,baseline.savedFileAfter,'Saved RVT bytes changed since registration preparation.');
  record.categoryIds=await memberships(baseline.afterCategoryIds);
  record.typeCategoryIds=await memberships(baseline.afterTypeCategoryIds,true);
  for(const [name,prior] of Object.entries({fullScope:baseline.afterFullScope,architectureScope:baseline.afterArchitectureScope,
    categoryScope:baseline.afterCategoryScope,typeScope:baseline.afterTypeScope})){
    record[name]=await inspect(prior.items.map(item=>item.summary.id));
    assertSameInspectionScope(record[name],prior,`Reopened ${name}`);
  }
  record.afterCategoryIds=await memberships(record.categoryIds);
  record.afterTypeCategoryIds=await memberships(record.typeCategoryIds,true);
  for(const name of ['fullScope','architectureScope','categoryScope','typeScope']){
    const afterName='after'+name[0].toUpperCase()+name.slice(1);
    record[afterName]=await inspect(record[name].items.map(item=>item.summary.id));
    assertSameInspectionScope(record[afterName],record[name],`${name} during reopen verification`);
  }
  record.after=await callRevit('revit.context.get');stableContext(record.after,record.before);
  record.afterBridge=await callRevit('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge,'Loaded plugin changed during verification.');
  record.savedFileAfter=await savedFile(record.after.document.path);
  assert.deepEqual(record.savedFileAfter,record.savedFileBefore,'Saved RVT bytes changed during verification.');
  assert.equal(sha(await fs.readFile(requestFile)),requestSha256,'Registration request changed during verification.');
  assert.equal(sha(await fs.readFile(baselineFile)),baselineSha256,'Registration baseline changed during verification.');
  assert.equal(sha(await fs.readFile(dllFile)),dllSha256,'Registered DLL changed during verification.');
  assert.equal(sha(await fs.readFile(request.targetManifest)),request.proposedManifestSha256,'Registration manifest changed during verification.');
  record.movementPosition=record.afterFullScope.items.find(item=>item.summary.id===2296037)?.drawing?.position;
  assert.deepEqual(record.movementPosition,baseline.movementPosition,'AL1 saved absolute position changed.');
  record.readScopesUnchanged=true;record.savedFileUnchanged=true;record.loadedModuleVerified=true;
  record.status='ARCHITECTURE_COPY_LOADED_SAVED_REOPEN_READ_SCOPES_VERIFIED';
}catch(error){record.status='REOPEN_READBACK_STOPPED';record.error={code:error.code??null,message:error.message};process.exitCode=1;}
finally{
  await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,moduleVersionId:record.bridge?.moduleVersionId,
    document:record.after?.document??record.before?.document,fullScopeCount:record.fullScope?.items.length,
    architectureScopeCount:record.architectureScope?.items.length,categoryScopeCount:record.categoryScope?.items.length,
    typeScopeCount:record.typeScope?.items.length,movementPosition:record.movementPosition,
    modelWritesRequested:false,confirmationCalls:0,automaticSave:false,typeCopyExecutionAccepted:false},null,2));
}
