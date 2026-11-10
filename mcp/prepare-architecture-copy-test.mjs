import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {previewRegisteredWriteWorkflow} from './registered-planning.mjs';
import {getWorkflow} from './workflow-registry.mjs';
import {workflowOperations} from './workflows.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';

// A proposed acceptance fixture reproduces only the legacy 300x450 -> 500x500
// type-copy intent. It is never a production sizing default or a placement.
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const baselineFile=path.join(runtime,'parity-architecture-copy-reopen-1791635994866.json');
const baselineSha256='50DB398FDED1DDFA019E39212BB4B0B9EBD5790DD59113CF65FFEB56CFB78AC8';
const evidenceFile=path.join(runtime,`architecture-type-copy-preview-${Date.now()}.json`);
const input={typeCopies:[{sourceTypeId:765512,name:'AI-PARITY-COLUMN-500x500-TEST',category:'OST_StructuralColumns',
  dimensions:[{parameterId:765248,name:'b',valueMm:500},{parameterId:765218,name:'h',valueMm:500}]}]};
const sourceFamily='混凝土-矩形-柱',sourceName='300 x 450 mm';
const allowed=new Set(['revit.bridge.info','revit.context.get','revit.search','revit.inspect','revit.plan.create','revit.plan.get','revit.plan.cancel']);
const record={status:'COPY_PREVIEW_STARTED',checkedAt:new Date().toISOString(),baselineFile,input,testFixtureOnly:true,
  modelWritesRequested:false,confirmationCalls:0,planCreationCalls:0,automaticSave:false,automaticRetry:false,
  allModelSideEffectsVerified:false,typeCopyExecutionAccepted:false};
let previewAttemptFile;
async function call(method,args={}){
  assert.ok(allowed.has(method),'This probe cannot submit a model write.');
  if(method==='revit.plan.create'){
    assert.equal(record.planCreationCalls,0,'Only one native preview may be created.');
    const marker={status:'PREVIEW_REQUEST_STARTED',checkedAt:new Date().toISOString(),evidenceFile,input,
      documentIdentity:record.before.document.identity,documentRevision:record.before.document.revision,modelWritesRequested:false,automaticRetry:false};
    await fs.writeFile(previewAttemptFile,JSON.stringify(marker,null,2),{flag:'wx'});
    record.planCreationCalls++;
  }
  return callRevit(method,args);
}
function stable(actual,expected){
  assert.equal(actual.active,true,'The saved test project must be active.');
  for(const key of ['document','revitVersion','revitBuild','counts','levels','familyTypes','elementTypes','units','pagination'])
    assert.deepEqual(actual[key],expected[key],`${key} changed.`);
  assert.equal(actual.document.isModified,false,'The saved test project was modified.');
}
async function inspect(prior,label){
  const ids=prior.items.map(item=>item.summary.id);assert.equal(new Set(ids).size,ids.length,'Duplicate baseline ID.');
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),result=await call('revit.inspect',{elementIds:page});
    assert.deepEqual(result.items.map(item=>item.summary?.id),page,'Inspection response was incomplete.');items.push(...result.items);
  }
  const scope={items};assertSameInspectionScope(scope,prior,label);return scope;
}
async function memberships(expected,types=false){
  const result={};
  for(const category of Object.keys(expected)){
    const ids=[];let offset=0;
    while(true){
      const page=await call('revit.search',{category,types,limit:500,offset});
      assert.equal(page.offset,offset,'Search offset changed.');assert.equal(page.limit,500,'Search limit changed.');
      assert.equal(typeof page.hasMore,'boolean','Unknown search continuation.');
      assert.ok(Array.isArray(page.items)&&page.items.length<=500,'Invalid search page.');
      for(const item of page.items){assert.ok(Number.isSafeInteger(item.id)&&item.id>0,'Invalid native ID.');ids.push(item.id);}
      if(!page.hasMore)break;
      assert.ok(page.items.length>0&&offset+page.items.length<=100000,'Invalid pagination continuation.');offset+=page.items.length;
    }
    assert.equal(new Set(ids).size,ids.length,'Duplicate search ID.');result[category]=ids.sort((a,b)=>a-b);
  }
  assert.deepEqual(result,expected,'Category/type membership changed.');return result;
}
async function savedFile(file){const bytes=await fs.readFile(file);return {path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
function near(a,b){assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=1e-6,'Dimension differs from the explicit test fixture.');}
try{
  const bytes=await fs.readFile(baselineFile);
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),baselineSha256,'Reopened saved baseline evidence changed.');
  const baseline=JSON.parse(bytes.toString('utf8'));
  assert.equal(baseline.status,'ARCHITECTURE_COPY_LOADED_SAVED_REOPEN_READ_SCOPES_VERIFIED','The loaded saved baseline is not verified.');
  record.bridge=await call('revit.bridge.info');assert.deepEqual(record.bridge,baseline.afterBridge,'Loaded bridge changed.');
  record.before=await call('revit.context.get');stable(record.before,baseline.after);
  previewAttemptFile=path.join(runtime,`architecture-copy-preview-request-once-${record.before.document.identity}.json`);
  record.previewAttemptFile=previewAttemptFile;
  record.savedFileBefore=await savedFile(record.before.document.path);assert.deepEqual(record.savedFileBefore,baseline.savedFileAfter,'Saved RVT bytes changed.');
  record.categoryIds=await memberships(baseline.afterCategoryIds);record.typeCategoryIds=await memberships(baseline.afterTypeCategoryIds,true);
  for(const name of ['fullScope','architectureScope','categoryScope','typeScope'])record[name]=await inspect(baseline['after'+name[0].toUpperCase()+name.slice(1)],`Pre-preview ${name}`);
  const source=record.typeScope.items.find(item=>item.summary.id===input.typeCopies[0].sourceTypeId);
  assert.ok(source,'The exact legacy source type is missing.');
  assert.equal(source.summary.family,sourceFamily,'The source family differs from the explicit fixture.');
  assert.equal(source.summary.name,sourceName,'The source name differs from the explicit fixture.');
  assert.equal(source.summary.categoryId,-2001330,'The source category differs.');
  assert.equal(source.summary.placement,'TwoLevelsBased','The source placement differs.');
  assert.equal(record.typeScope.items.filter(item=>item.summary.family===sourceFamily&&item.summary.name===sourceName).length,1,'The source name is ambiguous.');
  assert.equal(record.typeScope.items.some(item=>item.summary.family===sourceFamily&&item.summary.name===input.typeCopies[0].name),false,'The proposed test type already exists.');
  for(const [index,dimension] of input.typeCopies[0].dimensions.entries()){
    const parameters=source.parameters.filter(parameter=>parameter.id===dimension.parameterId&&parameter.name===dimension.name);
    assert.equal(parameters.length,1,'The source dimension parameter is ambiguous.');
    const parameter=parameters[0];assert.equal(parameter.storageType,'Double','The source dimension is not Double.');
    assert.equal(parameter.readOnly,false,'The source dimension is read-only.');assert.equal(parameter.hasValue,true,'The source dimension has no value.');
    assert.equal(parameter.valueSupported,true,'The source dimension value is unknown.');near(parameter.value*304.8,index===0?300:450);
  }
  const args={name:'architecture.build',planningMode:'explicit',documentIdentity:record.before.document.identity,expectedRevision:record.before.document.revision,
    summary:'迁移验收测试提案：仅复制混凝土矩形柱类型为 AI-PARITY-COLUMN-500x500-TEST，b/h=500mm；不放置柱，不修改已有类型',input};
  record.workflowRequest=args;
  record.preview=await previewRegisteredWriteWorkflow(args,getWorkflow(args.name),call);record.plan=record.preview.plan;
  assert.equal(record.preview.planCreated,true,'No native preview was returned.');
  assert.equal(record.plan.status,'pending','The native preview is not pending.');
  assert.deepEqual(record.plan.operations,workflowOperations(args.name,input),'The native operations differ from the test fixture.');
  assert.ok(Date.parse(record.plan.expiresAtUtc)>Date.now(),'The native preview already expired.');
  const prefix='Architecture type-copy source and dimension preview: ',suffix='; copied type IDs are assigned only by native execution; source types are protected and final readback is required.';
  const warnings=record.plan.warnings.filter(warning=>warning.startsWith(prefix));assert.equal(warnings.length,1,'Missing or duplicate native source preview.');
  assert.ok(warnings[0].endsWith(suffix),'The native source preview suffix differs.');
  record.nativeSourcePreview=JSON.parse(warnings[0].slice(prefix.length,-suffix.length));
  const review=record.nativeSourcePreview;
  assert.equal(review.sourceTypeId,source.summary.id,'The native source ID differs.');assert.equal(review.sourceName,sourceName,'The native source name differs.');
  assert.equal(review.familyName,sourceFamily,'The native source family differs.');assert.equal(review.targetName,input.typeCopies[0].name,'The target name differs.');
  assert.equal(review.sourceSnapshotComplete,true,'The native source snapshot is incomplete.');assert.equal(review.sourceMutationRequested,false,'The native preview mutates the source.');
  assert.equal(review.activationRequested,false,'The native preview activates a type.');assert.equal(review.automaticSave,false,'The native preview saves the model.');
  assert.equal(review.sourceParameterCount,source.parameters.length,'The native source parameter scope differs.');
  assert.equal(review.sourceSnapshot.parameters.length,source.parameters.length,'The native source snapshot was truncated.');
  assert.equal(review.sourceSnapshot.typeId,source.summary.id,'The source snapshot type ID differs.');
  assert.equal(review.sourceSnapshot.uniqueId,source.summary.uniqueId,'The source snapshot unique ID differs.');
  assert.equal(review.sourceSnapshot.name,sourceName,'The source snapshot name differs.');
  assert.equal(review.sourceSnapshot.familyName,sourceFamily,'The source snapshot family differs.');
  assert.ok(Number.isSafeInteger(review.familyId)&&review.familyId>0,'Unknown native source family ID.');
  assert.equal(review.sourceSnapshot.familyId,review.familyId,'The source snapshot family ID differs.');
  assert.equal(review.sourceSnapshot.categoryId,source.summary.categoryId,'The source snapshot category differs.');
  assert.equal(review.sourceSnapshot.placement,source.summary.placement,'The source snapshot placement differs.');
  assert.equal(typeof review.sourceSnapshot.isActive,'boolean','Unknown native source activation state.');
  assert.equal(new Set(review.sourceSnapshot.parameters.map(parameter=>parameter.parameterId)).size,source.parameters.length,'The native source snapshot has duplicate parameters.');
  for(const parameter of source.parameters){
    const native=review.sourceSnapshot.parameters.find(row=>row.parameterId===parameter.id);
    assert.ok(native,'A source parameter is missing from the native preview.');
    for(const field of ['name','storageType','hasValue','readOnly'])assert.equal(native[field],parameter[field],'A source parameter differs from the native preview.');
    if(parameter.hasValue)assert.equal(native.value===0?0:native.value,parameter.value===0?0:parameter.value,'A complete source parameter value differs.');
    assert.equal(native.associatedGlobalParameterId,-1,'The source has a global parameter association.');
  }
  assert.equal(review.dimensions.length,2,'The native dimensions differ.');
  for(const [index,dimension] of input.typeCopies[0].dimensions.entries()){
    const native=review.dimensions.find(row=>row.parameterId===dimension.parameterId);assert.ok(native,'The native dimension parameter is missing.');
    assert.equal(native.name,dimension.name,'The native dimension name differs.');near(native.beforeMm,index===0?300:450);near(native.desiredMm,500);
  }
  record.familyScope=await call('revit.inspect',{elementIds:[review.familyId]});
  assert.deepEqual(record.familyScope.items.map(item=>item.summary?.id),[review.familyId],'The source family inspection is incomplete.');
  assert.equal(record.familyScope.items[0].summary.className,'Family','The source family ID is not a native family.');
  assert.equal(record.familyScope.items[0].summary.name,sourceFamily,'The source family identity differs.');
  record.afterCategoryIds=await memberships(record.categoryIds);record.afterTypeCategoryIds=await memberships(record.typeCategoryIds,true);
  for(const name of ['fullScope','architectureScope','categoryScope','typeScope'])record['after'+name[0].toUpperCase()+name.slice(1)]=await inspect(record[name],`Post-preview ${name}`);
  record.afterFamilyScope=await inspect(record.familyScope,'Source family during preview verification');
  record.after=await call('revit.context.get');stable(record.after,record.before);
  record.afterBridge=await call('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge,'Loaded bridge changed during preview.');
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore,'Saved RVT changed during preview.');
  record.planAfter=await call('revit.plan.get',{planId:record.plan.planId});assert.deepEqual(record.planAfter,record.plan,'The pending preview changed.');
  assert.ok(Date.parse(record.planAfter.expiresAtUtc)>Date.now(),'The native preview expired during verification.');
  assert.equal(createHash('sha256').update(await fs.readFile(baselineFile)).digest('hex').toUpperCase(),baselineSha256,'Reopened saved baseline evidence changed during preview.');
  record.readScopesUnchanged=true;record.savedFileUnchanged=true;record.status='TYPE_COPY_PREVIEW_ONLY_COMPLETE_READ_SCOPES_VERIFIED';
}catch(error){record.status='COPY_PREVIEW_STOPPED';record.error={code:error.code??null,message:error.message,details:error.details};process.exitCode=1;}
finally{
  await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,planId:record.plan?.planId,expiresAtUtc:record.plan?.expiresAtUtc,
    input,sourceParameterCount:record.nativeSourcePreview?.sourceParameterCount,planCreationCalls:record.planCreationCalls,
    confirmationCalls:0,modelWritesRequested:false,automaticSave:false},null,2));
}
