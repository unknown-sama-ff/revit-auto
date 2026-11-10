import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';
import {elementDependenciesResponseSchema} from './element-dependencies.mjs';

assert.ok(process.argv.includes('--user-reported-reopened'),'Run only after the user reports restarting Revit and opening the same saved test copy.');
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const requestId='7320b0a1672c4da3a8b7f4af9f63de75';
const requestFile=path.join(runtime,`registration-switch-request-${requestId}.json`);
const requestSha256='DE26DD532AC38FFA3E760D512588B408DE54BCA907E4AC0C7C7791253A3145CC';
const receiptFile=path.join(runtime,`registration-switch-receipt-${requestId}.json`);
const receiptSha256='A14F90E1A1804520528C39EF0BC07ADF850EBDEFD763E62AAFFB0021198976A2';
const baselineFile=path.join(runtime,'architecture-type-copy-saved-reopen-1791643050618.json');
const baselineSha256='42526C5340C547D6692E5E8767177E01E90616738BA49F06F92FE8E1DD5879D4';
const expectedMvid='0496707c-7164-4a9e-8a75-60c60d00de7e';
const roots=[765512,765131,2296038,2296039];
const evidenceFile=path.join(runtime,`element-dependencies-loaded-${Date.now()}.json`);
const allowed=new Set(['revit.bridge.info','revit.context.get','revit.inspect','revit.search']);
const client=new Client({name:'element-dependencies-loaded-readback',version:'0.4.0'});
let connected=false;
const record={status:'ELEMENT_DEPENDENCIES_LOADED_READBACK_STARTED',checkedAt:new Date().toISOString(),
  requestFile,requestSha256,receiptFile,receiptSha256,baselineFile,baselineSha256,
  modelWritesRequested:false,confirmationCalls:0,planCreationCalls:0,automaticSave:false,automaticRetry:false,
  typeCopyExecutionAccepted:false,allModelSideEffectsVerified:false,closeReopenPersistenceVerified:false,
  nativeAdditionalElementClassification:'unresolved',rollbackVerification:'pending'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
async function read(file,hash){const bytes=await fs.readFile(file);assert.equal(sha(bytes),hash,'Bound evidence changed.');return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}
async function call(method,args={}){assert.ok(allowed.has(method));return callRevit(method,args);}
async function savedFile(file){const bytes=await fs.readFile(file);return {path:file,bytes:bytes.length,sha256:sha(bytes).toLowerCase()};}
function stable(actual,expected,reopened=false){
  assert.equal(actual.active,true);assert.equal(actual.document.isModified,false);
  if(reopened){
    assert.match(actual.document.identity,/^[a-f0-9]{32}$/);assert.notEqual(actual.document.identity,expected.document.identity);
    assert.equal(actual.document.revision,0);assert.deepEqual(actual.document,{...expected.document,identity:actual.document.identity,revision:0});
  }else assert.deepEqual(actual.document,expected.document);
  for(const key of ['revitVersion','revitBuild','counts','levels','familyTypes','elementTypes','units','pagination'])assert.deepEqual(actual[key],expected[key],`${key} changed.`);
  if(!reopened)for(const key of ['activeView','selectedElementIds'])assert.deepEqual(actual[key],expected[key]);
}
async function inspect(ids){
  assert.ok(ids.every(id=>Number.isSafeInteger(id)&&id>0));assert.equal(new Set(ids).size,ids.length);
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),response=await call('revit.inspect',{elementIds:page});
    assert.ok(Array.isArray(response.items));assert.deepEqual(response.items.map(item=>item.summary?.id),page);items.push(...response.items);
  }
  return {items};
}
async function scope(prior,label){const result=await inspect(prior.items.map(item=>item.summary.id));assertSameInspectionScope(result,prior,label);return result;}
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
  assert.deepEqual(result,expected,'Instance/type membership changed.');return result;
}
async function dependencyRead(document){
  const response=await client.callTool({name:'revit_element_dependencies',arguments:{documentIdentity:document.identity,expectedRevision:document.revision,elementIds:roots}});
  const value=JSON.parse(response.content[0].text);
  if(response.isError){const error=new Error(value.message);Object.assign(error,{code:value.code,details:value.details});throw error;}
  assert.deepEqual(response.structuredContent,value,'The SDK structured output differs from its text evidence.');
  const report=elementDependenciesResponseSchema.parse(value);
  assert.equal(report.documentIdentity,document.identity);assert.equal(report.documentRevision,document.revision);assert.deepEqual(report.items.map(item=>item.elementId),roots);
  assert.ok(report.items.every(item=>item.exists));return report;
}
try{
  const request=await read(requestFile,requestSha256),receipt=await read(receiptFile,receiptSha256),baseline=await read(baselineFile,baselineSha256);
  assert.equal(request.requestId,requestId);assert.equal(receipt.requestId,requestId);assert.equal(receipt.status,'REGISTERED_MANUAL_RESTART_PENDING');
  assert.equal(receipt.reviewedRequestSha256,requestSha256);assert.equal(receipt.moduleVersionId,expectedMvid);assert.equal(request.moduleVersionId,expectedMvid);
  assert.equal(request.baseline.sha256,baselineSha256);assert.equal(path.resolve(request.baseline.path),baselineFile);
  assert.equal(baseline.status,'SAVED_REOPEN_COPY_READ_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED');assert.equal(baseline.readScopePersistenceVerified,true);
  assert.equal(sha(await fs.readFile(request.assemblyPath)),request.assemblySha256);assert.equal(request.assemblySha256,receipt.selectedAssemblySha256);
  assert.equal(sha(await fs.readFile(request.targetManifest)),request.proposedManifestSha256);assert.equal(receipt.installedManifestSha256,request.proposedManifestSha256);
  assert.equal(sha(await fs.readFile(receipt.backup)),request.originalManifestSha256);
  record.bridge=await call('revit.bridge.info');assert.equal(record.bridge.moduleVersionId,expectedMvid);
  assert.ok(Number.isSafeInteger(record.bridge.pid)&&record.bridge.pid>0);assert.notEqual(record.bridge.pid,baseline.afterBridge.pid,'The old Revit process is still running.');
  assert.deepEqual(record.bridge.features,[...baseline.afterBridge.features.slice(0,baseline.afterBridge.features.indexOf('native-opening')),'bounded-element-dependencies',...baseline.afterBridge.features.slice(baseline.afterBridge.features.indexOf('native-opening'))]);
  assert.deepEqual({...record.bridge,moduleVersionId:baseline.afterBridge.moduleVersionId,pid:baseline.afterBridge.pid,features:baseline.afterBridge.features},baseline.afterBridge);
  record.before=await call('revit.context.get');stable(record.before,baseline.after,true);
  record.savedFileBefore=await savedFile(record.before.document.path);assert.deepEqual(record.savedFileBefore,baseline.savedFileAfter);
  const scopes={fullScope:134,architectureScope:29,categoryScope:236,typeScope:24,familyScope:1,newTypeScope:1,additionalNativeScope:1};
  record.categoryIds=await memberships(baseline.afterCategoryIds);record.typeCategoryIds=await memberships(baseline.afterTypeCategoryIds,true);
  for(const [name,count] of Object.entries(scopes)){const prior=baseline['after'+name[0].toUpperCase()+name.slice(1)];assert.equal(prior.items.length,count);record[name]=await scope(prior,`Loaded ${name}`);}
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp','revit-custom.mjs')],stderr:'pipe'}));connected=true;
  record.dependencies=await dependencyRead(record.before.document);record.dependenciesAfter=await dependencyRead(record.before.document);assert.deepEqual(record.dependenciesAfter,record.dependencies);
  const relationIds=[...new Set(record.dependencies.items.flatMap(item=>[...item.dependencies.ids,...item.familySymbols.ids]))].sort((a,b)=>a-b);
  assert.ok(relationIds.length<=16384);record.relationScope=await inspect(relationIds);record.afterRelationScope=await scope(record.relationScope,'Native related element snapshots during query');
  const row=id=>record.dependencies.items.find(item=>item.elementId===id);
  const has=(id,target)=>row(id).dependencies.supported&&row(id).dependencies.complete?row(id).dependencies.ids.includes(target):null;
  record.relationshipReview={evidenceScope:record.dependencies.relationshipScope,
    familyIncludesSourceAndCopy:row(765131).familySymbols.supported&&row(765131).familySymbols.complete?roots.filter(id=>[765512,2296038].includes(id)).every(id=>row(765131).familySymbols.ids.includes(id)):null,
    copiedTypeListsAdditionalElement:has(2296038,2296039),additionalElementListsCopiedType:has(2296039,2296038),
    sourceTypeDependentIds:row(765512).dependencies.ids,copiedTypeDependentIds:row(2296038).dependencies.ids,
    additionalElementDependentIds:row(2296039).dependencies.ids,
    dependencyEvidenceComplete:record.dependencies.items.every(item=>item.dependencies.supported&&item.dependencies.complete&&(!item.familySymbols.applicable||(item.familySymbols.supported&&item.familySymbols.complete))),
    nativeRelationshipVerified:has(2296038,2296039)===true,additionalElementPurposeVerified:false,
    baselineAvailable:false,allModelSideEffectsVerified:false,classification:'unresolved'};
  record.afterCategoryIds=await memberships(record.categoryIds);record.afterTypeCategoryIds=await memberships(record.typeCategoryIds,true);
  for(const name of Object.keys(scopes))record['after'+name[0].toUpperCase()+name.slice(1)]=await scope(record[name],`${name} during dependency query`);
  record.movementPosition=record.afterFullScope.items.find(item=>item.summary.id===2296037)?.drawing?.position;assert.deepEqual(record.movementPosition,baseline.movementPosition);
  record.after=await call('revit.context.get');stable(record.after,record.before);record.afterBridge=await call('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge);
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore);
  await read(requestFile,requestSha256);await read(receiptFile,receiptSha256);await read(baselineFile,baselineSha256);
  assert.equal(sha(await fs.readFile(request.assemblyPath)),request.assemblySha256);assert.equal(sha(await fs.readFile(request.targetManifest)),request.proposedManifestSha256);
  record.loadedModuleVerified=true;record.savedReadScopesVerified=true;record.readScopePersistenceVerified=true;
  record.status='ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED';record.completedAt=new Date().toISOString();
}catch(error){record.status='ELEMENT_DEPENDENCIES_LOADED_READBACK_STOPPED';record.error={code:error.code??null,message:error.message};process.exitCode=1;}
finally{
  try{await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});}finally{if(connected)await client.close();}
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,document:record.after?.document??record.before?.document,
    moduleVersionId:record.bridge?.moduleVersionId,loadedModuleVerified:record.loadedModuleVerified,savedReadScopesVerified:record.savedReadScopesVerified,
    relationshipReview:record.relationshipReview,relationScopeCount:record.relationScope?.items.length,
    confirmationCalls:0,modelWritesRequested:false,automaticSave:false,typeCopyExecutionAccepted:false,allModelSideEffectsVerified:false},null,2));
}
