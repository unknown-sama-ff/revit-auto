import { z } from 'zod';

const elementId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const coordinate=z.number().finite().min(-1e8).max(1e8);
const row=z.record(z.string(),z.unknown());
const wireSchema=z.object({
  id:z.string().trim().min(1).max(80).optional(),
  firstElementId:elementId,secondElementId:elementId,viewId:elementId,wireTypeId:elementId,
  firstConnectorId:z.number().int().min(0).max(2147483647).optional(),
  secondConnectorId:z.number().int().min(0).max(2147483647).optional(),
  // Revit projects bends onto the second connector's Z. Do not accept an ignored Z.
  bends:z.array(z.object({xMm:coordinate,yMm:coordinate}).strict()).max(100).optional()
}).strict().refine(wire=>wire.firstElementId!==wire.secondElementId,'Wire endpoints must be distinct instances.');
export const electricalWireInputSchema=z.object({
  documentIdentity:z.string().trim().min(1).max(200).optional(),expectedRevision:revision.optional(),
  wires:z.array(wireSchema).max(1000).optional(),
  wireDeletions:z.array(z.object({elementId,viewId:elementId}).strict()).max(1000).optional(),
  switchControls:z.array(z.object({elementId,controlId:z.string().min(1).max(200).refine(value=>value.trim().length>0,'Control ID must not be blank.')}).strict()).max(1000).optional(),
  tags:z.array(row).max(1000).optional(),dimensions:z.array(row).max(1000).optional()
}).strict();

function fail(code,message,details){const error=new Error(message);error.code=code;if(details!==undefined)error.details=details;throw error;}
export function parseElectricalWireInput(input={}){
  const parsed=electricalWireInputSchema.parse(input);
  for(const key of ['wireDeletions','switchControls']){
    const ids=(parsed[key]??[]).map(item=>item.elementId);
    if(new Set(ids).size!==ids.length)fail('duplicate_wire_scope',key+' must list each existing element once.');
  }
  const replacementViews=new Set((parsed.wires??[]).map(item=>item.viewId));
  for(const deletion of parsed.wireDeletions??[]){
    if(!replacementViews.has(deletion.viewId))fail('replacement_wires_required','Each selected deletion view must have explicitly supplied replacement wires. This workflow is not a bulk wire-clear tool.');
  }
  return parsed;
}

export function electricalWireOperations(input){
  const parsed=parseElectricalWireInput(input);
  return [
    ...(parsed.wireDeletions??[]).map((item,index)=>({operationType:'delete_element',id:'wireDelete'+(index+1),elementId:item.elementId})),
    ...(parsed.wires??[]).map((item,index)=>({...item,operationType:'create_wire',id:item.id??'wire'+(index+1)})),
    ...(parsed.switchControls??[]).map((item,index)=>({operationType:'set_parameter',id:'switchControl'+(index+1),elementId:item.elementId,parameter:'BIP:RBS_ELEC_SWITCH_ID_PARAM',value:item.controlId}))
  ];
}

export async function inspectElectricalWireScope(input,call,signal){
  const deletions=input.wireDeletions??[],controls=input.switchControls??[];
  if(!deletions.length&&!controls.length)return null;
  const ids=[...new Set([...deletions.map(item=>item.elementId),...controls.map(item=>item.elementId),...deletions.map(item=>item.viewId)])];
  const inspected=new Map();
  // Native inspect is capped at 100; never silently truncate a replacement scope.
  for(let offset=0;offset<ids.length;offset+=100){
    signal?.throwIfAborted();
    const batch=ids.slice(offset,offset+100),requested=new Set(batch);
    const report=await call('revit.inspect',{elementIds:batch},signal);
    if(!Array.isArray(report?.items)||report.items.length!==batch.length)fail('wire_scope_unknown','Native inspection did not return the complete requested wire/control scope.');
    for(const item of report.items){
      const id=item?.summary?.id??item?.id;
      if(!requested.has(id)||inspected.has(id)||item.exists===false||!item.summary)fail('wire_scope_unknown','Missing, duplicate or unexpected element in native wire/control inspection.',{elementId:id});
      inspected.set(id,item);
    }
  }
  const wireDeletions=deletions.map(item=>{
    const summary=inspected.get(item.elementId).summary;
    if(summary.className!=='Wire'||summary.ownerViewId!==item.viewId)fail('wire_scope_mismatch','Selected deletion is not a native Wire in the explicitly reviewed view.',{elementId:item.elementId,viewId:item.viewId});
    const view=inspected.get(item.viewId).summary;
    if(view.className!=='ViewPlan'||view.isViewTemplate!==false)fail('wire_view_invalid','Wire replacement requires an existing non-template plan view.');
    return {elementId:item.elementId,viewId:item.viewId,wireTypeId:summary.typeId,uniqueId:summary.uniqueId};
  });
  const switchControls=controls.map(item=>{
    const native=inspected.get(item.elementId);
    if(native.summary.className!=='FamilyInstance'||native.summary.categoryId!==-2008087)fail('switch_scope_mismatch','Control labels may only target existing LightingDevices family instances.',{elementId:item.elementId});
    // Same installed built-in ID used by lighting-verification.mjs.
    const parameters=(native.parameters??[]).filter(parameter=>parameter.id===-1140110);
    if(parameters.length!==1)fail('switch_parameter_unknown','Switch control parameter is missing or ambiguous.');
    const parameter=parameters[0];
    if(parameter.storageType!=='String'||parameter.readOnly!==false||parameter.valueSupported!==true||!(typeof parameter.value==='string'||parameter.value===null&&parameter.hasValue===false))fail('switch_parameter_unknown','Switch control parameter is read-only or its current value cannot be verified.');
    return {elementId:item.elementId,mark:native.summary.mark,before:parameter.value,after:item.controlId,noChange:parameter.value===item.controlId};
  });
  return {
    wireDeletions,switchControls,
    selectedScopeVerified:true,exactDeletionCascadeVerified:false,
    warnings:wireDeletions.length?['仅明确列出的导线被直接删除；原生预览的依赖警告必须一并审阅。警告中的依赖 ID 可能截断，不能据此保证无连带删除或无副作用。']:[]
  };
}
