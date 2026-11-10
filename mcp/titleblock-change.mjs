import {z} from 'zod';

const existingId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const titleBlockChangeSchema=z.object({titleBlockInstanceId:existingId,sheetId:existingId,targetTypeId:existingId}).strict();
const operationSchema=titleBlockChangeSchema.extend({
  operationType:z.literal('change_titleblock_type'),
  id:z.string().min(1).max(80).refine(value=>value.trim().length>0).optional(),
  dependencies:z.array(z.string().min(1).max(80).refine(value=>value.trim().length>0)).max(1000).optional()
}).strict();
const inputSchema=z.object({titleBlockChanges:z.array(titleBlockChangeSchema).max(1).optional()}).strict();
const titleBlockCategory=-2000280;
function fail(code,message,details){const error=new Error(message);Object.assign(error,{code,details});throw error;}
function distinct(row){
  if(new Set([row.titleBlockInstanceId,row.sheetId,row.targetTypeId]).size!==3)
    fail('titleblock_scope_mismatch','Existing instance, owner sheet and target type must be distinct native elements.');
  return row;
}
export function parseTitleBlockChangeInput(input={}){
  const parsed=inputSchema.parse(input);
  for(const row of parsed.titleBlockChanges??[])distinct(row);
  return parsed;
}
export function titleBlockChangeOperations(input={}){
  return (parseTitleBlockChangeInput(input).titleBlockChanges??[]).map((row,index)=>({...row,operationType:'change_titleblock_type',id:'titleBlockChange'+(index+1)}));
}
export function validateTitleBlockChange(op){return distinct(operationSchema.parse(op));}
export function validateTitleBlockChangePlan(operations){
  const rows=operations.filter(op=>op.operationType==='change_titleblock_type');
  if(rows.length&&(rows.length!==1||operations.length!==1))
    fail('titleblock_change_requires_single_operation','A titleblock type change must be the only operation in its reviewed plan because native type changes may replace the instance.');
  for(const row of rows)validateTitleBlockChange(row);
}
function rows(report,requested){
  if(!Array.isArray(report?.items)||report.items.length!==requested.length)
    fail('titleblock_scope_unknown','Complete native titleblock inspection is required.');
  const wanted=new Set(requested),result=new Map();
  for(const item of report.items){
    const id=item?.summary?.id;
    if(!wanted.has(id)||result.has(id)||item.exists===false||!item.summary)
      fail('titleblock_scope_unknown','Titleblock scope contains missing, duplicate, disappeared or unexpected elements.');
    result.set(id,item);
  }
  return result;
}
function nativeIds(value){
  return Array.isArray(value)&&value.length<=1000&&value.every(id=>Number.isSafeInteger(id)&&id>0)&&new Set(value).size===value.length;
}
function nativePoint(value){return value&&['xMm','yMm','zMm'].every(key=>Number.isFinite(value[key]));}
export async function inspectTitleBlockChangeScope(input={},call,signal){
  signal?.throwIfAborted();input=parseTitleBlockChangeInput(input);
  const changes=input.titleBlockChanges??[];
  if(!changes.length)return null;
  const row=changes[0],requested=[row.titleBlockInstanceId,row.sheetId,row.targetTypeId];
  const inspected=rows(await call('revit.inspect',{elementIds:requested},signal),requested);
  const instance=inspected.get(row.titleBlockInstanceId),sheet=inspected.get(row.sheetId),target=inspected.get(row.targetTypeId);
  const native=instance.titleBlock;
  if(instance.summary.className!=='FamilyInstance'||instance.summary.categoryId!==titleBlockCategory||
    instance.summary.ownerViewId!==row.sheetId||sheet.summary.className!=='ViewSheet'||
    !native||native.instanceId!==row.titleBlockInstanceId||native.sheetId!==row.sheetId||native.typeId!==instance.summary.typeId||native.familyPlacementType!=='ViewBased'||
    !Number.isSafeInteger(native.typeId)||native.typeId<=0)
    fail('titleblock_instance_mismatch','The native titleblock instance, type and owner sheet do not match the explicit scope.');
  if(target.summary.className!=='FamilySymbol'||target.summary.categoryId!==titleBlockCategory||target.summary.placement!=='ViewBased'||
    target.titleBlock?.typeId!==row.targetTypeId||target.titleBlock.categoryId!==titleBlockCategory||target.titleBlock.familyPlacementType!=='ViewBased')
    fail('titleblock_target_mismatch','Target type must be an existing native ViewBased titleblock FamilySymbol.');
  if(native.pinned!==false||native.isReadOnly!==false)
    fail('titleblock_read_only','Pinned, read-only or unknown titleblock write state is refused.');
  if(target.titleBlock.isActive!==true)
    fail('titleblock_target_inactive','Target titleblock symbol must already be active; activation requires a separately reviewed capability.');
  if(!nativePoint(native.position)||!Number.isFinite(native.rotationRadians)||native.dependenciesComplete!==true||
    native.validTypesComplete!==true||native.sheetTitleBlocksComplete!==true||!nativeIds(native.dependentElementIds)||
    !nativeIds(native.validTypeIds)||!nativeIds(native.sheetTitleBlockInstanceIds)||!native.sheetTitleBlockInstanceIds.includes(row.titleBlockInstanceId))
    fail('titleblock_evidence_unknown','Native location, rotation, dependencies, valid types and sheet titleblock membership require complete bounded evidence.');
  if(!native.validTypeIds.includes(row.targetTypeId))
    fail('titleblock_type_invalid','Native titleblock valid-type evidence excludes the requested target.');
  return {
    selectedScopeVerified:true,scope:'one-existing-titleblock-type',requiredNativeFeature:'controlled-titleblock-change',
    inspectedElementIds:requested,inspectedElementCount:requested.length,
    titleBlockChanges:[{...row,oldTypeId:native.typeId,noOp:native.typeId===row.targetTypeId,
      position:{...native.position},rotationRadians:native.rotationRadians,
      dependentElementIds:[...native.dependentElementIds],sheetTitleBlockInstanceIds:[...native.sheetTitleBlockInstanceIds],
      nativeMayReplaceInstance:native.typeId!==row.targetTypeId,replacementElementIdKnown:false,nativeReadbackVerified:false,sideEffectsVerified:false}],
    warnings:['仅更换明确既有图框实例的类型；Revit ChangeTypeId 可能用新实例替代旧实例，依赖与替代ID必须读取原生执行回执。',
      '原位置、旋转和所属图纸保持受控；图框尺寸、字段、视口相交与PNG版面需独立核验。'],
    automaticSave:false,allModelSideEffectsVerified:false
  };
}
