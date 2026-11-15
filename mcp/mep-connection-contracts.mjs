const prefixes=['first','second','third','fourth'];
const fittingCounts={elbow:2,union:2,transition:2,tee:3,cross:4};
export function connectionPrefixes(op){
 if(op.operationType==='connect_elements')return prefixes.slice(0,2);
 const kind=Object.hasOwn(op,'fittingType')?op.fittingType:'elbow';
 if(typeof kind!=='string'||!Object.hasOwn(fittingCounts,kind))throw new Error('create_fitting: fittingType must be elbow, union, transition, tee or cross.');
 return prefixes.slice(0,fittingCounts[kind]);
}
export function validateConnectionTopology(op){
 const active=connectionPrefixes(op);
 for(const side of prefixes.filter(side=>!active.includes(side)))for(const suffix of ['ElementId','ConnectorId','Connector'])
  if(Object.hasOwn(op,side+suffix))throw new Error('Unused endpoint '+side+' is not part of this connection or fitting kind.');
 const owners=active.map(side=>op[side+'ElementId']);
 if(owners.some(v=>v===undefined||v===null||v===''))throw new Error('Every explicit endpoint ElementId is required.');
 if(new Set(owners).size!==owners.length)throw new Error('Fitting or connection endpoint owners must be distinct.');
 if(Object.hasOwn(op,'allowUnassignedEquipmentPort')){
  if(op.operationType!=='connect_elements')throw new Error('allowUnassignedEquipmentPort belongs only to connect_elements.');
  if(typeof op.allowUnassignedEquipmentPort!=='boolean')throw new Error('allowUnassignedEquipmentPort must be an explicit boolean.');
  if(op.allowUnassignedEquipmentPort&&owners.some(id=>!Number.isSafeInteger(id)||id<=0))
   throw new Error('Known-unassigned opt-in requires existing inspected element IDs; deferred elements have no native assignment proof yet.');
 }
 return active;
}
