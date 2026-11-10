import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';
import {elementDependenciesResponseSchema} from './element-dependencies.mjs';
import {BOUND_LOADED_EVIDENCE,recipesFromLoadedEvidence} from './local-test-copy-supervisor.mjs';

// Only after the human's first restart and reopening of the saved test copy.
// No lifecycle preview/action, model plan, registration, save or automatic retry.
assert.deepEqual(process.argv.slice(2),['--user-reported-reopened'],
  'Run only after the user reports restarting Revit and opening the same saved test copy; no other arguments are accepted.');
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const requestId='c5374c3f9c184442b30dd57a26fe982c';
const requestFile=path.join(runtime,`registration-switch-request-${requestId}.json`);
const requestSha256='47201BC4B7BB1B29826D3FCEB454D581EF0D3ABD96514FD827DD2C005FE58E98';
const receiptFile=path.join(runtime,`registration-switch-receipt-${requestId}.json`);
const receiptSha256='E85221F94F25BCEE4321317C951A5EA68677716745F5A2D510A3259436CA0881';
const baselineFile=path.join(runtime,'local-test-copy-predeployment-1791650530410.json');
const sourceFile=path.join(runtime,BOUND_LOADED_EVIDENCE.file);
const registrationFile=path.join(runtime,'local-test-copy-registration.json');
const registrationSha256='2730587a225d07309dafa357674ea40d8a858587488b87044c048a8ccccee79f';
const dllFile=path.join(root,'v27','bin','Release','net10.0-windows-lifecycle-final-sharedread-20261011','RevitAutoV27.dll');
const dllSha256='27F3096A0C6B2D1F885DECDB95A91D81A6661519C3A88138327466993C5F0A4F';
const expectedMvid='9f3556c4-bed9-4df9-8232-c7565d2d66f0';
const expectedInformationalVersion='0.4.0+d058358db13efa0ad3a3c9530e4636ba96179b99';
const fixedConfig=path.join(runtime,'bridge.json');
const evidenceFile=path.join(runtime,`local-test-copy-lifecycle-loaded-${Date.now()}-${randomUUID()}.json`);
const allowed=new Set(['revit.bridge.info','revit.context.get','revit.search','revit.inspect','revit.element.dependencies']);
const scopes={fullScope:134,architectureScope:29,categoryScope:236,typeScope:24,familyScope:1,
  newTypeScope:1,additionalNativeScope:1,relationScope:33};
const record={status:'LOCAL_TEST_COPY_LIFECYCLE_LOADED_READBACK_STARTED',checkedAt:new Date().toISOString(),
  requestFile,requestSha256,receiptFile,receiptSha256,baselineFile,sourceFile,sourceSha256:BOUND_LOADED_EVIDENCE.sha256,
  registrationFile,registrationSha256,modelWritesRequested:false,confirmationCalls:0,planCreationCalls:0,
  lifecyclePreviewCalls:0,lifecycleActionCalls:0,automaticSave:false,restartPerformed:false,automaticRetry:false,
  loadedModuleVerified:false,savedReadScopesVerified:false,readScopePersistenceVerified:false,
  typeCopyExecutionAccepted:false,allModelSideEffectsVerified:false,additionalElementPurposeVerified:false,
  nativeAdditionalElementClassification:'unresolved',rollbackVerification:'pending'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const samePath=(first,second)=>path.resolve(first).toLowerCase()===path.resolve(second).toLowerCase();
const afterName=name=>'after'+name[0].toUpperCase()+name.slice(1);
function normalize(value){
  if(typeof value==='number')return Object.is(value,-0)?0:value;
  if(value&&typeof value==='object')for(const key of Object.keys(value))value[key]=normalize(value[key]);
  return value;
}
async function noAliases(file){
  const absolute=path.resolve(file);let cursor=absolute;
  for(;;){assert.equal((await fs.lstat(cursor)).isSymbolicLink(),false,'A bound path contains an alias.');
    const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  assert.ok(samePath(await fs.realpath(absolute),absolute),'A bound final path differs.');return absolute;
}
async function read(file,expectedSha){
  await noAliases(file);const bytes=await fs.readFile(file);
  assert.equal(sha(bytes),expectedSha.toLowerCase(),'A bound evidence digest changed.');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
}
async function requireHash(file,expectedSha){await noAliases(file);assert.equal(sha(await fs.readFile(file)),expectedSha.toLowerCase(),'A bound file digest changed.');}
async function savedFile(file){
  const absolute=await noAliases(file),handle=await fs.open(absolute,'r');
  try{
    const before=await handle.stat({bigint:true});assert.ok(before.isFile()&&before.size>0n);
    const digest=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))digest.update(chunk);
    const after=await handle.stat({bigint:true});
    for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key],'RVT changed during the same-handle read.');
    await noAliases(absolute);const current=await fs.open(absolute,'r');
    try{const now=await current.stat({bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(now[key],before[key],'The RVT path was replaced or changed.');}
    finally{await current.close();}
    assert.ok(before.size<=BigInt(Number.MAX_SAFE_INTEGER));
    return {path:file,bytes:Number(before.size),sha256:digest.digest('hex')};
  }finally{await handle.close();}
}
async function call(method,args={}){assert.ok(allowed.has(method),'Only the five declared native read methods are allowed.');return callRevit(method,args);}
function canonicalContext(value){
  const result=normalize(structuredClone(value));
  for(const name of ['familyTypes','elementTypes','selectedElementIds'])if(Array.isArray(result[name]))result[name].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
}
function stableContext(actual,expected,reopened=false){
  assert.equal(actual.active,true);assert.equal(actual.document.isModified,false);assert.equal(actual.document.isReadOnly,false);
  const wanted=structuredClone(expected);
  if(reopened){
    assert.match(actual.document.identity,/^[a-f0-9]{32}$/);assert.notEqual(actual.document.identity,expected.document.identity,'The old document session remains open.');
    assert.equal(actual.document.revision,0,'The reopened copy already has a changed revision.');
    assert.ok(Object.hasOwn(actual,'activeView')&&Object.hasOwn(actual,'selectedElementIds'),'Reopened UI state is missing.');
    wanted.document.identity=actual.document.identity;wanted.document.revision=0;
    wanted.activeView=actual.activeView;wanted.selectedElementIds=actual.selectedElementIds;
  }
  assert.deepEqual(canonicalContext(actual),canonicalContext(wanted),'Complete context changed outside the explicitly permitted new session and restored UI.');
}
function loadedBridge(actual,prior){
  assert.equal(actual.moduleVersionId,expectedMvid);assert.ok(Number.isSafeInteger(actual.pid)&&actual.pid>0);
  assert.equal(actual.informationalVersion,expectedInformationalVersion,'The approved lifecycle build informationalVersion is not loaded.');
  assert.notEqual(actual.pid,prior.pid,'The previous Revit PID is still serving the bridge.');
  assert.ok(Array.isArray(actual.features)&&new Set(actual.features).size===actual.features.length);
  assert.equal(prior.features.includes('local-test-copy-lifecycle'),false);
  assert.deepEqual([...actual.features].sort(),[...prior.features,'local-test-copy-lifecycle'].sort(),'Capabilities differ beyond the approved lifecycle addition.');
  assert.deepEqual({...actual,informationalVersion:prior.informationalVersion,moduleVersionId:prior.moduleVersionId,pid:prior.pid,features:prior.features},prior,'Other complete bridge fields changed.');
}
async function inspect(prior,label){
  assert.ok(Array.isArray(prior?.items));const ids=prior.items.map(item=>item.summary?.id),items=[];
  assert.ok(ids.every(id=>Number.isSafeInteger(id)&&id>0));assert.equal(new Set(ids).size,ids.length);
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),response=await call('revit.inspect',{elementIds:page});
    assert.deepEqual(Object.keys(response).sort(),['items'],'Unexpected inspect response fields cannot be discarded.');
    assert.deepEqual(response.items.map(item=>item.summary?.id),page,'Inspection membership disappeared or changed.');items.push(...response.items);
  }
  const result={items};assertSameInspectionScope(result,prior,label);return result;
}
async function memberships(expected,types){
  const idsByCategory={},pages={};
  for(const [category,wanted]of Object.entries(expected)){
    assert.ok(Array.isArray(wanted)&&wanted.length<=100000);const ids=[],reads=[];let offset=0;
    for(;;){
      const page=await call('revit.search',{category,types,limit:500,offset});
      assert.equal(page.offset,offset);assert.equal(page.limit,500);assert.equal(typeof page.hasMore,'boolean');
      assert.ok(Array.isArray(page.items)&&page.items.length<=500);
      for(const item of page.items){assert.ok(Number.isSafeInteger(item.id)&&item.id>0);ids.push(item.id);}
      reads.push(page);assert.ok(ids.length<=100000);
      if(!page.hasMore)break;assert.ok(page.items.length>0);offset+=page.items.length;
    }
    assert.equal(new Set(ids).size,ids.length);idsByCategory[category]=ids.sort((a,b)=>a-b);
    assert.deepEqual(idsByCategory[category],wanted,'Complete instance/type membership changed.');pages[category]=reads;
  }
  return {ids:idsByCategory,pages};
}
function comparePages(current,prior){
  const canonical=value=>{const result=normalize(structuredClone(value));for(const pages of Object.values(result))for(const page of pages)page.items.sort((a,b)=>a.id-b.id);return result;};
  assert.deepEqual(canonical(current),canonical(prior),'Full search pages changed during the read-only probe.');
}
async function dependencies(document,prior){
  const elementIds=prior.items.map(item=>item.elementId);
  const result=await call('revit.element.dependencies',{documentIdentity:document.identity,expectedRevision:document.revision,elementIds});
  elementDependenciesResponseSchema.parse(result);assert.equal(result.documentIdentity,document.identity);assert.equal(result.documentRevision,0);
  assert.deepEqual(result.items.map(item=>item.elementId),elementIds);assert.ok(result.items.every(item=>item.exists));
  const expected={...structuredClone(prior),documentIdentity:document.identity,documentRevision:document.revision};
  assert.deepEqual(result,expected,'Complete dependency evidence changed beyond the explicitly rebound session.');return result;
}
try{
  assert.ok(!process.env.REVIT_AI_CONFIG||samePath(process.env.REVIT_AI_CONFIG,fixedConfig),'Bridge config overrides are forbidden.');
  const request=await read(requestFile,requestSha256),receipt=await read(receiptFile,receiptSha256);
  assert.equal(request.requestId,requestId);assert.equal(receipt.requestId,requestId);assert.equal(request.status,'PREPARED');
  assert.equal(receipt.status,'REGISTERED_MANUAL_RESTART_PENDING');assert.equal(receipt.reviewedRequestSha256,requestSha256);
  assert.equal(request.moduleVersionId,expectedMvid);assert.equal(receipt.moduleVersionId,expectedMvid);
  assert.ok(samePath(request.assemblyPath,dllFile));assert.equal(receipt.selectedAssembly,request.assemblyPath);
  assert.equal(request.assemblySha256,dllSha256);assert.equal(receipt.selectedAssemblySha256,dllSha256);
  assert.equal(receipt.targetManifest,request.targetManifest);assert.equal(receipt.installedManifestSha256,request.proposedManifestSha256);
  for(const key of ['backupVerified','baselineUnchanged','protectedSnapshotUnchanged'])assert.equal(receipt[key],true);
  for(const key of ['modelWritesRequested','automaticSave','restartPerformed','automaticRetryAllowed'])assert.equal(receipt[key],false);
  assert.ok(samePath(request.baseline.path,baselineFile));record.baselineSha256=request.baseline.sha256;
  const baseline=await read(baselineFile,record.baselineSha256),source=await read(sourceFile,BOUND_LOADED_EVIDENCE.sha256);
  assert.equal(baseline.status,'LOCAL_TEST_COPY_PREDEPLOYMENT_READ_SCOPES_AND_FIXED_REGISTRATION_VERIFIED');
  assert.equal(baseline.readScopesUnchanged,true);assert.equal(baseline.savedFileUnchanged,true);
  assert.equal(baseline.typeCopyExecutionAccepted,false);assert.equal(baseline.allModelSideEffectsVerified,false);
  assert.equal(baseline.nativeAdditionalElementClassification,'unresolved');assert.equal(baseline.recipeCount,29);
  assert.ok(samePath(baseline.sourceFile,sourceFile));assert.equal(baseline.sourceSha256,BOUND_LOADED_EVIDENCE.sha256);
  assert.equal(source.status,'ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED');
  for(const key of ['loadedModuleVerified','savedReadScopesVerified','readScopePersistenceVerified'])assert.equal(source[key],true);
  assert.deepEqual(baseline.savedFileAfter,source.savedFileAfter);assert.deepEqual(baseline.savedFileAfter,baseline.savedFileBefore);
  assert.deepEqual(baseline.after,baseline.before);assert.deepEqual(baseline.afterBridge,baseline.bridge);
  assert.deepEqual(request.baseline.documentState,baseline.after.document);
  assert.ok(samePath(baseline.registrationFile,registrationFile));assert.equal(baseline.registrationSha256,registrationSha256);
  const registration=await read(registrationFile,registrationSha256);
  const expectedRegistration={modelPath:baseline.after.document.path,baselineEvidenceFile:sourceFile,
    baselineEvidenceSha256:BOUND_LOADED_EVIDENCE.sha256,readRecipes:recipesFromLoadedEvidence(source)};
  assert.deepEqual(registration,expectedRegistration);assert.equal(registration.readRecipes.length,29);
  for(const recipe of registration.readRecipes)if(recipe.method==='revit.element.dependencies')assert.deepEqual(Object.keys(recipe.params),['elementIds']);
  for(const [name,count]of Object.entries(scopes)){
    assert.equal(baseline[name].items.length,count);assertSameInspectionScope(baseline[afterName(name)],baseline[name],`Bound ${name} rounds`);
    assertSameInspectionScope(baseline[name],source[name],`Bound source ${name}`);
  }
  assert.deepEqual(baseline.afterCategoryIds,baseline.categoryIds);assert.deepEqual(baseline.afterTypeCategoryIds,baseline.typeCategoryIds);
  assert.deepEqual(baseline.categoryIds,source.categoryIds);assert.deepEqual(baseline.typeCategoryIds,source.typeCategoryIds);
  assert.deepEqual(baseline.dependenciesAfter,baseline.dependencies);assert.deepEqual(baseline.dependencies,source.dependencies);
  const verifyFiles=async()=>{
    await read(requestFile,requestSha256);await read(receiptFile,receiptSha256);await read(baselineFile,record.baselineSha256);
    await read(sourceFile,BOUND_LOADED_EVIDENCE.sha256);await read(registrationFile,registrationSha256);
    await requireHash(dllFile,dllSha256);await requireHash(request.targetManifest,request.proposedManifestSha256);
    await requireHash(receipt.backup,request.originalManifestSha256);
    assert.ok(samePath(request.protectedSnapshot.bridgePath,fixedConfig));await requireHash(fixedConfig,request.protectedSnapshot.bridgeSha256);
  };
  await verifyFiles();record.bridge=await call('revit.bridge.info');loadedBridge(record.bridge,baseline.afterBridge);
  record.before=await call('revit.context.get');stableContext(record.before,baseline.after,true);
  record.savedFileBefore=await savedFile(record.before.document.path);assert.deepEqual(record.savedFileBefore,baseline.savedFileAfter);
  const firstInstances=await memberships(baseline.categoryIds,false),firstTypes=await memberships(baseline.typeCategoryIds,true);
  record.categoryIds=firstInstances.ids;record.categoryPages=firstInstances.pages;record.typeCategoryIds=firstTypes.ids;record.typeCategoryPages=firstTypes.pages;
  for(const name of Object.keys(scopes))record[name]=await inspect(baseline[afterName(name)],`Loaded ${name}`);
  record.dependencies=await dependencies(record.before.document,baseline.dependenciesAfter);
  const secondInstances=await memberships(record.categoryIds,false),secondTypes=await memberships(record.typeCategoryIds,true);
  record.afterCategoryIds=secondInstances.ids;record.afterCategoryPages=secondInstances.pages;
  record.afterTypeCategoryIds=secondTypes.ids;record.afterTypeCategoryPages=secondTypes.pages;
  comparePages(record.afterCategoryPages,record.categoryPages);comparePages(record.afterTypeCategoryPages,record.typeCategoryPages);
  for(const name of Object.keys(scopes))record[afterName(name)]=await inspect(record[name],`Loaded ${name} round two`);
  record.dependenciesAfter=await dependencies(record.before.document,record.dependencies);assert.deepEqual(record.dependenciesAfter,record.dependencies);
  record.after=await call('revit.context.get');stableContext(record.after,record.before);
  record.afterBridge=await call('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge);
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore);await verifyFiles();
  record.loadedModuleVerified=true;record.savedReadScopesVerified=true;record.readScopePersistenceVerified=true;
  record.readScopesUnchanged=true;record.savedFileUnchanged=true;record.fixedRegistrationVerified=true;record.recipeCount=29;
  record.status='LOCAL_TEST_COPY_LIFECYCLE_LOADED_SAVED_READ_SCOPES_VERIFIED';record.completedAt=new Date().toISOString();
}catch(error){record.status='LOCAL_TEST_COPY_LIFECYCLE_LOADED_READBACK_STOPPED';record.error={code:error.code??null,message:error.message};process.exitCode=1;}
finally{
  await fs.writeFile(evidenceFile,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,moduleVersionId:record.bridge?.moduleVersionId,
    loadedModuleVerified:record.loadedModuleVerified,savedReadScopesVerified:record.savedReadScopesVerified,
    readScopePersistenceVerified:record.readScopePersistenceVerified,fixedRegistrationVerified:record.fixedRegistrationVerified,
    recipeCount:record.recipeCount,modelWritesRequested:false,confirmationCalls:0,planCreationCalls:0,
    lifecyclePreviewCalls:0,lifecycleActionCalls:0,automaticSave:false,restartPerformed:false,automaticRetry:false,
    typeCopyExecutionAccepted:false,allModelSideEffectsVerified:false,additionalElementPurposeVerified:false,
    nativeAdditionalElementClassification:'unresolved',rollbackVerification:'pending'},null,2));
}
