// Native factory adapted from bimwright/rvt-mcp b44ee0b, Apache-2.0.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateWallFoundation(op){
 const allowed=['operationType','id','dependencies','hostElementId','foundationTypeId'];
 if(!object(op)||op.operationType!=='create_wall_foundation'||Object.keys(op).some(key=>!allowed.includes(key)))throw new Error('Wall foundation accepts only an explicit existing hostElementId and foundationTypeId.');
 for(const field of ['hostElementId','foundationTypeId'])if(!Number.isSafeInteger(op[field])||op[field]<=0)throw new Error(field+' must be an existing positive safe native ID; deferred sources are unsupported.');
 if(op.hostElementId===op.foundationTypeId)throw new Error('Host and foundation type must identify distinct elements.');
 return op;
}
export function validateWallFoundationPlan(operations){
 const hosts=new Set(),protectedIds=new Set();
 for(const op of operations.filter(op=>op.operationType==='create_wall_foundation')){
  validateWallFoundation(op);if(hosts.has(op.hostElementId))throw new Error('Only one wall foundation per host wall is allowed in a plan.');
  hosts.add(op.hostElementId);protectedIds.add(op.hostElementId);protectedIds.add(op.foundationTypeId);
 }
 for(const op of operations)if(['set_parameter','delete_element'].includes(op.operationType)&&protectedIds.has(op.elementId))throw new Error('Wall-foundation host/type mutations require a separate reviewed plan.');
}
