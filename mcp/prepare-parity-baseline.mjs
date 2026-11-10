import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';

const root=path.resolve(import.meta.dirname,'..');
const priorFile=path.join(root,'runtime','parity-batch-export-1791628307673.json');
const evidenceFile=path.join(root,'runtime',`parity-architecture-copy-predeployment-${Date.now()}.json`);
const record={status:'READ_BASELINE_STARTED',checkedAt:new Date().toISOString(),priorFile,
  modelWritesRequested:false,confirmationCalls:0,automaticSave:false,
  allModelSideEffectsVerified:false,negativeZeroCanonicalized:true};
function stable(actual,expected){
  assert.equal(actual.active,true);
  assert.deepEqual(actual.document,expected.document);
  assert.equal(actual.revitVersion,expected.revitVersion);assert.equal(actual.revitBuild,expected.revitBuild);
  for(const key of ['counts','levels','familyTypes','elementTypes'])assert.deepEqual(actual[key],expected[key],key+' changed.');
}
async function inspect(ids){
  assert.equal(new Set(ids).size,ids.length);
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const page=ids.slice(offset,offset+100),result=await callRevit('revit.inspect',{elementIds:page});
    assert.equal(result.items.length,page.length);assert.deepEqual(result.items.map(item=>item.summary?.id),page);
    items.push(...result.items);
  }
  return {items};
}
async function categoryIds(category,types=false){
  const ids=[];let offset=0;
  while(true){
    const result=await callRevit('revit.search',{category,types,limit:500,offset});
    ids.push(...result.items.map(item=>item.id));
    if(!result.hasMore)break;
    assert.ok(result.items.length>0&&offset<100000);offset+=result.items.length;
  }
  assert.equal(new Set(ids).size,ids.length);return ids.sort((a,b)=>a-b);
}
async function savedFile(file){const bytes=await fs.readFile(file);return {path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
try{
  const prior=JSON.parse(await fs.readFile(priorFile,'utf8'));
  assert.equal(prior.status,'BATCH_PNG_EXPORTED_READ_SCOPES_AND_SAVED_FILE_VERIFIED_VISUAL_PENDING');
  record.bridge=await callRevit('revit.bridge.info');assert.deepEqual(record.bridge,prior.afterBridge);
  record.before=await callRevit('revit.context.get');stable(record.before,prior.after);
  assert.equal(record.before.document.isModified,false);
  record.savedFileBefore=await savedFile(record.before.document.path);
  assert.deepEqual(record.savedFileBefore,prior.savedFileAfter);
  record.fullScope=await inspect(prior.afterFullScope.items.map(item=>item.summary.id));
  record.architectureScope=await inspect(prior.afterArchitectureScope.items.map(item=>item.summary.id));
  assertSameInspectionScope(record.fullScope,prior.afterFullScope,'Saved full baseline');
  assertSameInspectionScope(record.architectureScope,prior.afterArchitectureScope,'Saved architecture baseline');
  record.categoryIds={};
  for(const category of [...Object.keys(record.before.counts),'OST_TitleBlocks']){
    record.categoryIds[category]=await categoryIds(category);
    if(Object.hasOwn(record.before.counts,category))assert.equal(record.categoryIds[category].length,record.before.counts[category],category+' count differs.');
  }
  record.categoryScope=await inspect([...new Set(Object.values(record.categoryIds).flat())].sort((a,b)=>a-b));
  record.typeCategoryIds={};
  for(const category of ['OST_StructuralColumns','OST_Doors','OST_Windows','OST_TitleBlocks'])record.typeCategoryIds[category]=await categoryIds(category,true);
  record.typeScope=await inspect([...new Set(Object.values(record.typeCategoryIds).flat())].sort((a,b)=>a-b));
  record.afterCategoryIds={};
  for(const category of Object.keys(record.categoryIds))record.afterCategoryIds[category]=await categoryIds(category);
  assert.deepEqual(record.afterCategoryIds,record.categoryIds,'Native category membership changed.');
  record.afterTypeCategoryIds={};
  for(const category of Object.keys(record.typeCategoryIds))record.afterTypeCategoryIds[category]=await categoryIds(category,true);
  assert.deepEqual(record.afterTypeCategoryIds,record.typeCategoryIds,'Native type membership changed.');
  record.afterCategoryScope=await inspect(record.categoryScope.items.map(item=>item.summary.id));
  record.afterTypeScope=await inspect(record.typeScope.items.map(item=>item.summary.id));
  assertSameInspectionScope(record.afterCategoryScope,record.categoryScope,'Category baseline during read');
  assertSameInspectionScope(record.afterTypeScope,record.typeScope,'Type baseline during read');
  record.afterFullScope=await inspect(record.fullScope.items.map(item=>item.summary.id));
  assertSameInspectionScope(record.afterFullScope,record.fullScope,'Historical full scope during read');
  record.afterArchitectureScope=await inspect(record.architectureScope.items.map(item=>item.summary.id));
  assertSameInspectionScope(record.afterArchitectureScope,record.architectureScope,'Historical architecture scope during read');
  record.after=await callRevit('revit.context.get');stable(record.after,record.before);
  record.afterBridge=await callRevit('revit.bridge.info');assert.deepEqual(record.afterBridge,record.bridge);
  record.savedFileAfter=await savedFile(record.after.document.path);assert.deepEqual(record.savedFileAfter,record.savedFileBefore);
  record.movementPosition=record.afterFullScope.items.find(item=>item.summary.id===2296037).drawing.position;
  assert.deepEqual(record.movementPosition,prior.movementPosition);
  record.readScopesUnchanged=true;record.savedFileUnchanged=true;
  record.status='SAVED_CURRENT_PREDEPLOYMENT_READ_SCOPES_VERIFIED';
}catch(error){record.status='READ_BASELINE_STOPPED';record.error={code:error.code??null,message:error.message};process.exitCode=1;}
finally{
  await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,
    document:record.after?.document??record.before?.document,
    fullScopeCount:record.fullScope?.items.length,architectureScopeCount:record.architectureScope?.items.length,
    categoryScopeCount:record.categoryScope?.items.length,typeScopeCount:record.typeScope?.items.length,
    typeCategoryCounts:Object.fromEntries(Object.entries(record.typeCategoryIds??{}).map(([key,value])=>[key,value.length])),
    movementPosition:record.movementPosition,modelWritesRequested:false,automaticSave:false},null,2));
}
