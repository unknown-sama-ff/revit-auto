import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const COMMENTS=-1010106;
const MARK=-1001203;
export const CASE_TARGETS={write:{id:2290242,mark:'OFF1-01',value:'AI_WRITE_TEST'},rollback:{id:2290243,mark:'OFF1-02',value:'AI_ROLLBACK_TEST'}};
export function stableContext(contexts){
  if(contexts.length<5 || contexts.some(c=>!c.active))throw new Error('Five active-document reads are required.');
  const before=contexts[0];
  for(const c of contexts){
    if(c.document.identity!==before.document.identity || c.document.revision!==before.document.revision || c.document.path!==before.document.path || !isDeepStrictEqual(c.counts,before.counts))throw new Error('Document identity/revision/model counts changed during the read-only probe. Do not prepare a write.');
  }
  return before;
}
export function samePath(first,second){return path.resolve(first).toLowerCase()===path.resolve(second).toLowerCase();}
export function assertTestDocument(context,expectedPath,originalPath){
  if(!context.active || !context.document.path)throw new Error('Open the dedicated test copy first.');
  if(samePath(context.document.path,originalPath) || !samePath(context.document.path,expectedPath))throw new Error('The active project is not the explicitly chosen test copy. Original project writes are forbidden.');
  if(context.document.isReadOnly || context.document.isFamilyDocument)throw new Error('Acceptance requires a writable project copy.');
}
export function parameter(item,id){return item.parameters.find(p=>p.id===id);}
export function caseOperations(name,item){
  const target=CASE_TARGETS[name];if(!target)throw new Error('Specify write or rollback.');
  if(item.summary?.id!==target.id || parameter(item,MARK)?.value!==target.mark)throw new Error('Target element ID/mark does not match the reviewed fixture. Stop rather than guessing.');
  const comments=parameter(item,COMMENTS);
  if(!comments || comments.readOnly || comments.storageType!=='String')throw new Error('The target has no writable instance comments parameter.');
  if(comments.value===target.value)throw new Error('The test marker already exists. Restore/review the baseline before running again.');
  const change={operationType:'set_parameter',elementId:target.id,parameter:'BIP:ALL_MODEL_INSTANCE_COMMENTS',value:target.value};
  return name==='write'?[change]:[change,{operationType:'delete_element',elementId:target.id},{...change,value:target.value+'_AFTER_DELETE'}];
}
function sortObjects(list){return [...list].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
export function normalizedItem(item,omitComments=false){
  return {
    summary:item.summary,
    parameters:sortObjects(item.parameters.filter(p=>!omitComments || p.id!==COMMENTS)),
    connectors:sortObjects(item.connectors||[]),electrical:item.electrical||null
  };
}
export function assertRollback(baseline,after,receipt){
  if(receipt.status!=='failed' || receipt.code!=='execution_failed' || receipt.rolledBack!==true || receipt.completedOperationCount!==2 || receipt.failedOperationIndex!==3)throw new Error('No proof of execution-time rollback after the first two operations. A preview rejection is not a rollback pass.');
  if(!isDeepStrictEqual(baseline.counts,after.counts) || !isDeepStrictEqual(baseline.categoryIds,after.categoryIds) || !isDeepStrictEqual(baseline.items,after.items))throw new Error('Rollback did not restore exact baseline elements, comments, circuits and wire/connector state.');
}
export function assertWrite(baseline,after,receipt){
  if(receipt.status!=='committed' || receipt.completedOperationCount!==1)throw new Error('No successful one-operation commit receipt.');
  if(!isDeepStrictEqual(baseline.counts,after.counts) || !isDeepStrictEqual(baseline.categoryIds,after.categoryIds))throw new Error('Parameter write unexpectedly changed model element sets.');
  const before=baseline.items.find(item=>item.summary.id===CASE_TARGETS.write.id);
  const current=after.items.find(item=>item.summary.id===CASE_TARGETS.write.id);
  if(!before || !current || parameter(current,COMMENTS)?.value!==CASE_TARGETS.write.value)throw new Error('Expected comment write not observed.');
  if(!isDeepStrictEqual(normalizedItem(before,true),normalizedItem(current,true)))throw new Error('The write changed target fields beyond instance comments.');
  for(const item of baseline.items.filter(i=>i.summary.id!==CASE_TARGETS.write.id))if(!isDeepStrictEqual(item,after.items.find(i=>i.summary.id===item.summary.id)))throw new Error('Unrelated electrical elements changed.');
}
export async function snapshot(call,context){
  const categoryIds={};
  for(const category of ['OST_LightingFixtures','OST_LightingDevices','OST_ElectricalEquipment','OST_ElectricalCircuit','OST_Wire']){
    const ids=[];let offset=0;let hasMore=true;
    while(hasMore){const page=await call('revit_search',{category,limit:500,offset});ids.push(...page.items.map(e=>e.id));hasMore=page.hasMore;offset+=page.items.length;if(hasMore && (!page.items.length||offset>10000))throw new Error('Unexpected search pagination.');}
    categoryIds[category]=ids.sort((a,b)=>a-b);
  }
  const ids=[...new Set(Object.values(categoryIds).flat())].sort((a,b)=>a-b);const items=[];
  for(let offset=0;offset<ids.length;offset+=100){const result=await call('revit_inspect',{elementIds:ids.slice(offset,offset+100)});for(const item of result.items){if(!item.summary)throw new Error('Snapshot element disappeared.');items.push(normalizedItem(item));}}
  return {counts:context.counts,categoryIds,items:items.sort((a,b)=>a.summary.id-b.summary.id)};
}
