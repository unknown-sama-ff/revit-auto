import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';
import {elementDependenciesResponseSchema} from './element-dependencies.mjs';
import {BOUND_LOADED_EVIDENCE,recipesFromLoadedEvidence} from './local-test-copy-supervisor.mjs';

// A read-only pre-registration probe. It never invokes lifecycle actions,
// creates a plan, confirms an old plan or registers a DLL.
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const sourceFile=path.join(runtime,BOUND_LOADED_EVIDENCE.file);
const evidenceFile=path.join(runtime,`local-test-copy-predeployment-${Date.now()}.json`);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const allowed=new Set(['revit.bridge.info','revit.context.get','revit.search','revit.inspect','revit.element.dependencies']);
const record={status:'LOCAL_TEST_COPY_PREDEPLOYMENT_STARTED',checkedAt:new Date().toISOString(),sourceFile,
  sourceSha256:BOUND_LOADED_EVIDENCE.sha256,modelWritesRequested:false,confirmationCalls:0,planCreationCalls:0,
  automaticSave:false,restartPerformed:false,automaticRetry:false,typeCopyExecutionAccepted:false,
  allModelSideEffectsVerified:false,nativeAdditionalElementClassification:'unresolved'};
async function call(method,args={}){assert.ok(allowed.has(method));return callRevit(method,args);}
async function savedFile(file){const bytes=await fs.readFile(file);return {path:file,bytes:bytes.length,sha256:sha(bytes)};}
async function readBound(){const bytes=await fs.readFile(sourceFile);assert.equal(sha(bytes),BOUND_LOADED_EVIDENCE.sha256);return JSON.parse(bytes.toString('utf8'));}
async function inspect(prior,label){
  const ids=prior.items.map(item=>item.summary.id),items=[];
  assert.equal(new Set(ids).size,ids.length);
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),result=await call('revit.inspect',{elementIds:page});
    assert.deepEqual(result.items.map(item=>item.summary?.id),page);items.push(...result.items);
  }
  const result={items};assertSameInspectionScope(result,prior,label);return result;
}
async function memberships(prior,types){
  const result={};
  for(const [category,expected]of Object.entries(prior)){
    const ids=[];let offset=0;
    for(;;){
      const page=await call('revit.search',{category,types,limit:500,offset});
      assert.equal(page.limit,500);assert.equal(page.offset,offset);assert.equal(typeof page.hasMore,'boolean');
      assert.ok(Array.isArray(page.items)&&page.items.length<=500);ids.push(...page.items.map(item=>item.id));
      if(!page.hasMore)break;assert.ok(page.items.length>0&&offset+page.items.length<=100000);offset+=page.items.length;
    }
    assert.ok(ids.every(id=>Number.isSafeInteger(id)&&id>0));assert.equal(new Set(ids).size,ids.length);
    result[category]=ids.sort((a,b)=>a-b);assert.deepEqual(result[category],expected);
  }
  return result;
}
try{
  const source=await readBound();assert.equal(source.status,'ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED');
  assert.equal(source.loadedModuleVerified,true);assert.equal(source.savedReadScopesVerified,true);assert.equal(source.readScopePersistenceVerified,true);
  record.bridge=await call('revit.bridge.info');assert.deepEqual(record.bridge,source.afterBridge);
  record.before=await call('revit.context.get');assert.deepEqual(record.before,source.after);assert.equal(record.before.document.isModified,false);
  record.savedFileBefore=await savedFile(record.before.document.path);assert.deepEqual(record.savedFileBefore,source.savedFileAfter);
  const names=['fullScope','architectureScope','categoryScope','typeScope','familyScope','newTypeScope','additionalNativeScope','relationScope'];
  record.categoryIds=await memberships(source.categoryIds,false);record.typeCategoryIds=await memberships(source.typeCategoryIds,true);
  for(const name of names)record[name]=await inspect(source[name],`Fresh lifecycle ${name}`);
  const dependencyParams={documentIdentity:record.before.document.identity,expectedRevision:record.before.document.revision,elementIds:source.dependencies.items.map(item=>item.elementId)};
  record.dependencies=elementDependenciesResponseSchema.parse(await call('revit.element.dependencies',dependencyParams));assert.deepEqual(record.dependencies,source.dependencies);
  record.afterCategoryIds=await memberships(record.categoryIds,false);record.afterTypeCategoryIds=await memberships(record.typeCategoryIds,true);
  for(const name of names)record['after'+name[0].toUpperCase()+name.slice(1)]=await inspect(record[name],`Fresh lifecycle ${name} round two`);
  record.dependenciesAfter=elementDependenciesResponseSchema.parse(await call('revit.element.dependencies',dependencyParams));assert.deepEqual(record.dependenciesAfter,record.dependencies);
  record.after=await call('revit.context.get');assert.deepEqual(record.after,record.before);
  record.afterBridge=await call('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge);
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore);
  await readBound();
  const registration={modelPath:record.after.document.path,baselineEvidenceFile:sourceFile,baselineEvidenceSha256:BOUND_LOADED_EVIDENCE.sha256,readRecipes:recipesFromLoadedEvidence(source,record.after.document)};
  assert.ok(registration.readRecipes.every(recipe=>recipe.method!=='revit.element.dependencies'||Object.keys(recipe.params).join(',')==='elementIds'));
  const file=path.join(runtime,'local-test-copy-registration.json');
  try{const existing=JSON.parse((await fs.readFile(file)).toString('utf8'));assert.deepEqual(existing,registration,'Existing fixed registration differs; it must not be overwritten.');}
  catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(file,JSON.stringify(registration,null,2)+'\n',{flag:'wx'});}
  record.registrationFile=file;record.registrationSha256=sha(await fs.readFile(file));record.recipeCount=registration.readRecipes.length;
  record.status='LOCAL_TEST_COPY_PREDEPLOYMENT_READ_SCOPES_AND_FIXED_REGISTRATION_VERIFIED';record.readScopesUnchanged=true;record.savedFileUnchanged=true;record.completedAt=new Date().toISOString();
}catch(error){record.status='LOCAL_TEST_COPY_PREDEPLOYMENT_STOPPED';record.error={code:error.code??null,message:error.message};process.exitCode=1;}
finally{
  await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,document:record.after?.document??record.before?.document,
    recipeCount:record.recipeCount,registrationFile:record.registrationFile,registrationSha256:record.registrationSha256,
    readScopesUnchanged:record.readScopesUnchanged,savedFileUnchanged:record.savedFileUnchanged,modelWritesRequested:false,
    automaticSave:false,restartPerformed:false,allModelSideEffectsVerified:false},null,2));
}
