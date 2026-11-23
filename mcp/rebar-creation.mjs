// Selectively adapted from bimwright/rvt-mcp b44ee0b8032f0603f8e52656bc05ab43aa599263
// (Apache-2.0). Native factories live in RebarCreationService; no native calls here.
const MAX=1e8,UNIT_TOLERANCE=1e-9;
const invalid=message=>Object.assign(new Error(message),{code:'invalid_rebar_creation'});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function shape(value,allowed){
 if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw invalid('An explicit rebar object with only declared fields is required.');
}
function number(value,field){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>MAX)throw invalid(`${field} requires a finite explicit number bounded by 100000000.`);return value;}
function point(value,field){shape(value,['xMm','yMm','zMm']);for(const axis of ['xMm','yMm','zMm'])number(value[axis],`${field}.${axis}`);return[value.xMm,value.yMm,value.zMm];}
function vector(value,field){shape(value,['x','y','z']);const result=['x','y','z'].map(axis=>number(value[axis],`${field}.${axis}`));if(Math.abs(Math.hypot(...result)-1)>UNIT_TOLERANCE)throw invalid(`${field} must already be near-unit; no silent normalization is performed.`);return result;}
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
function boolean(value,field){if(typeof value!=='boolean')throw invalid(`${field} requires an explicit boolean.`);return value;}
function layout(value){
 const rule=value?.rule;
 if(rule==='Single'){shape(value,['rule']);return;}
 if(rule!=='FixedNumber'&&rule!=='MaximumSpacing')throw invalid('layout.rule must be exactly Single, FixedNumber or MaximumSpacing.');
 shape(value,['rule',rule==='FixedNumber'?'quantity':'spacingMm','arrayLengthMm','barsOnNormalSide','includeFirstBar','includeLastBar']);
 const length=number(value.arrayLengthMm,'layout.arrayLengthMm');if(length<=0)throw invalid('layout.arrayLengthMm must be positive.');
 boolean(value.barsOnNormalSide,'layout.barsOnNormalSide');boolean(value.includeFirstBar,'layout.includeFirstBar');boolean(value.includeLastBar,'layout.includeLastBar');
 let positions;
 if(rule==='FixedNumber'){positions=value.quantity;if(!Number.isInteger(positions)||positions<2||positions>1000)throw invalid('FixedNumber.quantity must be an integer from 2 through 1000 potential positions.');}
 else{const spacing=number(value.spacingMm,'layout.spacingMm');if(spacing<=0)throw invalid('layout.spacingMm must be positive.');positions=Math.ceil(length/spacing)+1;if(!Number.isFinite(positions)||positions<2||positions>1000)throw invalid('MaximumSpacing requires 2 through 1000 potential positions.');}
 if(positions-Number(!value.includeFirstBar)-Number(!value.includeLastBar)<1)throw invalid('Explicit endpoint exclusions would remove every bar.');
}
function metadata(op){
 const text=value=>{if(typeof value!=='string'||!value.length||value.length>80||value!==value.trim()||/[\u0000-\u001f\u007f-\u009f]/u.test(value))throw invalid('Metadata requires nonblank, unpadded strings of at most 80 characters.');return value;};
 if(Object.hasOwn(op,'id'))text(op.id);
 if(!Object.hasOwn(op,'dependencies'))return;
 if(!Array.isArray(op.dependencies)||op.dependencies.length>1000)throw invalid('dependencies must be a bounded explicit array.');
 const seen=new Set();for(const value of op.dependencies){const id=text(value);if(seen.has(id)||id===op.id)throw invalid('Duplicate or self dependencies are refused.');seen.add(id);}
}
export function validateRebarCreation(op){
 const straight=op?.operationType==='create_rebar_set';
 if(!straight&&op?.operationType!=='create_rebar_stirrup')throw invalid('Unsupported rebar operationType.');
 const fields=straight?['start','end','normal','allowNewShape']:['shapeId','origin','xDirection','yDirection'];
 shape(op,['operationType','id','dependencies','hostElementId','barTypeId','layout',...fields]);metadata(op);
 for(const field of ['hostElementId','barTypeId',...(straight?[]:['shapeId'])])if(!Number.isSafeInteger(op[field])||op[field]<=0)throw invalid(`${field} requires an existing positive safe native ID; deferred IDs are refused.`);
 layout(op.layout);
 if(straight){
  if(Object.hasOwn(op,'allowNewShape'))boolean(op.allowNewShape,'allowNewShape');
  const start=point(op.start,'start'),end=point(op.end,'end'),normal=vector(op.normal,'normal'),direction=end.map((value,index)=>value-start[index]),length=Math.hypot(...direction);
  if(length<1)throw invalid('Straight rebar endpoints must be at least 1 mm apart in complete XYZ.');
  if(Math.abs(dot(direction,normal))/length>UNIT_TOLERANCE)throw invalid('normal must be explicitly perpendicular to the complete XYZ line.');
 }else{point(op.origin,'origin');const x=vector(op.xDirection,'xDirection'),y=vector(op.yDirection,'yDirection');if(Math.abs(dot(x,y))>UNIT_TOLERANCE)throw invalid('xDirection and yDirection must be orthogonal near-unit vectors.');}
 return op;
}
export async function requireRebarHostFeature(call,signal){
 const host=await call('revit.bridge.info',{},signal);
 if(!Array.isArray(host?.features)||!host.features.includes('controlled-rebar-creation')){
  const error=new Error('The loaded Revit add-in does not provide controlled-rebar-creation. The source is staged; load the combined candidate only when native acceptance is scheduled.');
  error.code='rebar_native_feature_unavailable';throw error;
 }
 return{requiredFeature:'controlled-rebar-creation',moduleVersionId:host.moduleVersionId,nativeAcceptance:false};
}
export function validateRebarPlan(operations){
 const sources=new Set();
 for(const op of operations.filter(op=>['create_rebar_set','create_rebar_stirrup'].includes(op.operationType))){
  validateRebarCreation(op);sources.add(op.hostElementId);sources.add(op.barTypeId);if(op.shapeId!==undefined)sources.add(op.shapeId);
 }
 if(!sources.size)return;
 for(const op of operations)if(op.operationType==='load_family'||['set_parameter','delete_element'].includes(op.operationType)&&sources.has(op.elementId))throw invalid('Rebar host/bar-type/shape changes and family loading require a separate reviewed plan.');
}
