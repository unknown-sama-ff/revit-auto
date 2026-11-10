import { z } from 'zod';

const elementId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const name=z.string().trim().min(1).max(200);
const positiveIds=z.array(elementId).min(1).max(500).refine(ids=>new Set(ids).size===ids.length,'Element IDs must be unique.');
const operationId=z.string().trim().min(1).max(80);
const parameterChange=z.discriminatedUnion('parameter',[
  z.object({elementId,parameter:z.literal('BIP:RBS_ELEC_CIRCUIT_NAME'),value:name}).strict(),
  z.object({elementId,parameter:z.literal('BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM'),value:elementId}).strict()
]);
const circuit=z.object({
  id:z.string().trim().min(1).max(80).optional(),
  elementIds:positiveIds,
  panelId:elementId,
  switchIds:z.array(elementId).max(100).refine(ids=>new Set(ids).size===ids.length,'Switch IDs must be unique.').optional(),
  name:name.optional()
}).strict().superRefine((row,ctx)=>{
  if(row.elementIds.includes(row.panelId))ctx.addIssue({code:'custom',path:['panelId'],message:'Panel cannot also be a circuit load.'});
  if((row.switchIds??[]).some(id=>row.elementIds.includes(id)||id===row.panelId))ctx.addIssue({code:'custom',path:['switchIds'],message:'Switch IDs must be separate from circuit load and panel IDs.'});
});
export const electricalCircuitInputSchema=z.object({
  documentIdentity:z.string().trim().min(1).max(200).optional(),expectedRevision:revision.optional(),
  circuits:z.array(circuit).max(500).optional(),
  panelDistributionSystems:z.array(z.object({panelId:elementId,distributionSystemId:elementId}).strict()).max(100).optional(),
  parameterChanges:z.array(parameterChange).max(500).optional(),
  panelSchedules:z.array(z.object({id:operationId.optional(),panelId:elementId,name:name.optional()}).strict()).max(1000).optional(),
  tags:z.array(z.record(z.string(),z.unknown())).max(1000).optional(),
  dimensions:z.array(z.record(z.string(),z.unknown())).max(1000).optional()
}).strict();

function fail(code,message,details){const error=new Error(message);error.code=code;if(details!==undefined)error.details=details;throw error;}
export function parseElectricalCircuitInput(input={}){
  const parsed=electricalCircuitInputSchema.parse(input);
  const targetIds=[];
  for(const row of [...(parsed.panelDistributionSystems??[]),...(parsed.parameterChanges??[])])targetIds.push(row.panelId??row.elementId);
  if(new Set(targetIds).size!==targetIds.length)fail('duplicate_circuit_parameter_target','A panel or circuit parameter target may appear only once in a single reviewed circuit plan.');
  const names=new Set(),reserved=new Set();
  const panelIds=new Set((parsed.circuits??[]).map(row=>row.panelId));
  for(const [index,row] of (parsed.circuits??[]).entries()){
    const id=row.id??'circuit'+(index+1);
    if(names.has(id))fail('duplicate_circuit_operation_id','Circuit operation IDs must be unique, including generated IDs.');
    names.add(id);
    for(const member of [...row.elementIds,...(row.switchIds??[])]){
      if(reserved.has(member)||panelIds.has(member))fail('duplicate_circuit_member','Loads and switches must be reserved to exactly one circuit and cannot also be panels.',{elementId:member});
      reserved.add(member);
    }
  }
  return parsed;
}

export function electricalCircuitOperations(input){
  const parsed=parseElectricalCircuitInput(input);
  return [
    ...(parsed.panelDistributionSystems??[]).map((row,index)=>({operationType:'set_parameter',id:'panelDistribution'+(index+1),elementId:row.panelId,parameter:'BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM',value:row.distributionSystemId})),
    ...(parsed.parameterChanges??[]).map((row,index)=>({operationType:'set_parameter',id:'circuitParameter'+(index+1),...row})),
    ...(parsed.circuits??[]).map((row,index)=>({...row,operationType:'create_circuit',id:row.id??'circuit'+(index+1)})),
    ...(parsed.panelSchedules??[]).map((row,index)=>({...row,operationType:'create_panel_schedule',id:row.id??'panelSchedule'+(index+1)}))
  ];
}

function inspectRows(report,ids){
  if(!Array.isArray(report?.items)||report.items.length!==ids.length)fail('circuit_scope_unknown','Native inspection did not return the complete requested circuit scope.');
  const map=new Map();const requested=new Set(ids);
  for(const item of report.items){
    const id=item?.summary?.id??item?.id;
    if(!requested.has(id)||map.has(id)||item.exists===false||!item.summary)fail('circuit_scope_unknown','Missing, duplicate or unexpected element in native circuit inspection.',{elementId:id});
    map.set(id,item);
  }
  return map;
}
function hasElectricalConnector(item){
  return (item.connectors??[]).some(connector=>connector.domainSupported===true&&connector.domain==='DomainElectrical');
}
function requireFamilyInstance(item,id,role){
  if(item?.summary?.className!=='FamilyInstance')fail('circuit_scope_mismatch',`${role} ${id} must be an existing family instance.`,{elementId:id});
}
function requireUnassigned(item,id){
  const systems=item.electrical?.systemIds;
  if(!Array.isArray(systems)||systems.some(value=>!Number.isSafeInteger(value)||value<=0)||new Set(systems).size!==systems.length)fail('circuit_membership_unknown','Circuit membership must be a verified native list; unknown is not unassigned.',{elementId:id});
  if(systems.length)fail('circuit_member_already_assigned','A circuit load or switch already belongs to an electrical system; do not silently reassign it.',{elementId:id,systemIds:systems});
}
function requirePanel(item,id){
  requireFamilyInstance(item,id,'Panel');
  if(item.summary.categoryId!==-2001040)fail('circuit_panel_mismatch','Panel must be an ElectricalEquipment family instance.',{elementId:id});
}
function parameterReview(target,row){
  const distribution=row.parameter==='BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM';
  const parameters=(target.parameters??[]).filter(item=>item.id===(distribution?-1140064:-1140089));
  const p=parameters[0];
  if(parameters.length!==1||p.storageType!==(distribution?'ElementId':'String')||p.readOnly!==false||p.valueSupported!==true||typeof p.hasValue!=='boolean'||(p.hasValue&&(distribution?!Number.isSafeInteger(p.value):typeof p.value!=='string')))fail(distribution?'distribution_parameter_unknown':'circuit_name_parameter_unknown','Parameter baseline is missing, ambiguous, unsupported or not writable.',{elementId:row.elementId});
  const before=p.hasValue?p.value:null;
  return {...row,before,beforeHasValue:p.hasValue,after:row.value,noOp:p.hasValue&&before===row.value};
}
export async function inspectElectricalCircuitScope(input,call,signal){
  input=parseElectricalCircuitInput(input);
  const ids=new Set();
  for(const row of input.circuits??[]){ids.add(row.panelId);row.elementIds.forEach(id=>ids.add(id));(row.switchIds??[]).forEach(id=>ids.add(id));}
  for(const row of input.panelDistributionSystems??[]){ids.add(row.panelId);ids.add(row.distributionSystemId);}
  for(const row of input.parameterChanges??[]){ids.add(row.elementId);if(row.parameter==='BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM')ids.add(row.value);}
  for(const row of input.panelSchedules??[])ids.add(row.panelId);
  const requested=[...ids];if(!requested.length)return null;
  const inspected=new Map();
  for(let offset=0;offset<requested.length;offset+=100){
    signal?.throwIfAborted();const batch=requested.slice(offset,offset+100);const map=inspectRows(await call('revit.inspect',{elementIds:batch},signal),batch);for(const [id,item] of map)inspected.set(id,item);
  }
  const distributionReview=(panelId,distributionSystemId)=>{
    const panel=inspected.get(panelId),distribution=inspected.get(distributionSystemId);
    requirePanel(panel,panelId);
    if(distribution.summary.className!=='DistributionSysType'||distribution.summary.categoryId!==-2008041)fail('distribution_system_mismatch','distributionSystemId must identify an existing native DistributionSysType.',{elementId:distributionSystemId});
    return parameterReview(panel,{elementId:panelId,parameter:'BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM',value:distributionSystemId});
  };
  const panelDistributionSystems=(input.panelDistributionSystems??[]).map(row=>({...row,...distributionReview(row.panelId,row.distributionSystemId)}));
  const parameterChanges=[];
  for(const row of input.parameterChanges??[]){
    const target=inspected.get(row.elementId);
    if(row.parameter==='BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM'){
      parameterChanges.push(distributionReview(row.elementId,row.value));
    }else{
      if(target.summary.className!=='ElectricalSystem')fail('circuit_name_target_mismatch','Circuit name parameter may target only an existing ElectricalSystem.',{elementId:row.elementId});
      parameterChanges.push(parameterReview(target,row));
    }
  }
  for(const row of input.circuits??[]){
    const panel=inspected.get(row.panelId);requirePanel(panel,row.panelId);
    for(const id of row.elementIds){const member=inspected.get(id);requireFamilyInstance(member,id,'Circuit load');if(!hasElectricalConnector(member))fail('circuit_member_connector_unknown','Each circuit load must expose a verified electrical connector.',{elementId:id});requireUnassigned(member,id);}
    for(const id of row.switchIds??[]){const sw=inspected.get(id);requireFamilyInstance(sw,id,'Switch');if(sw.summary.categoryId!==-2008087)fail('circuit_switch_mismatch','Switch must be a LightingDevices family instance.',{elementId:id});if(!hasElectricalConnector(sw))fail('circuit_switch_connector_unknown','Each switch must expose a verified electrical connector.',{elementId:id});requireUnassigned(sw,id);}
  }
  for(const row of input.panelSchedules??[])requirePanel(inspected.get(row.panelId),row.panelId);
  return {selectedScopeVerified:true,inspectedElementCount:inspected.size,circuits:input.circuits??[],panelDistributionSystems,parameterChanges,warnings:['回路成员和配电箱只按当前明确 ID 检查；不按标记、数量、样板或旧脚本固定规则猜测。','已读电气连接器不等于 PowerCircuit 分类、电压或容量设计已核定；原生执行仍须校验。']};
}
