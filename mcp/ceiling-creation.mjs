// Ceiling.Create/CurveLoop adaptation boundary: bimwright/rvt-mcp b44ee0b, Apache-2.0.
// Native document validation, transactions and original-Sketch readback belong to the host.
const metadata=['operationType','id','dependencies'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const toleranceMm=0.01;
function fail(message){const error=new Error(message);error.code='invalid_ceiling_creation';throw error;}
function operationId(value){if(typeof value!=='string'||value.length<1||value.length>80||value.trim()!==value||/[\u0000-\u001f\u007f-\u009f]/.test(value))fail('Operation/dependency IDs must be exact nonblank strings of at most 80 characters without controls.');}
function point(value){
 if(!object(value)||Object.keys(value).length!==3||!['xMm','yMm','zMm'].every(key=>Object.hasOwn(value,key)))fail('Ceiling vertices require only full explicit xMm/yMm/zMm; Z is absolute, not level relative.');
 for(const key of ['xMm','yMm','zMm'])if(typeof value[key]!=='number'||!Number.isFinite(value[key])||Math.abs(value[key])>1e8)fail('Ceiling coordinates must be finite numbers with absolute value at most 100000000 mm.');
}
const orient=(a,b,c)=>(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm);
const on=(a,b,p)=>Math.abs(orient(a,b,p))<1e-8&&p.xMm>=Math.min(a.xMm,b.xMm)-1e-8&&p.xMm<=Math.max(a.xMm,b.xMm)+1e-8&&p.yMm>=Math.min(a.yMm,b.yMm)-1e-8&&p.yMm<=Math.max(a.yMm,b.yMm)+1e-8;
const intersects=(a,b,c,d)=>orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
export function validateCeilingCreation(op){
 if(!object(op)||op.operationType!=='create_ceiling')fail('Specify an explicit create_ceiling operation.');
 if(Object.keys(op).some(key=>![...metadata,'ceilingTypeId','levelId','boundary'].includes(key)))fail('Unsupported ceiling field; defaults, arbitrary offsets, holes and curves are not accepted.');
 for(const field of ['ceilingTypeId','levelId'])if(!Number.isSafeInteger(op[field])||op[field]<=0)fail(`${field} must be an existing positive safe native ID; new/deferred types and levels need a subsequent reviewed plan.`);
 if(Object.hasOwn(op,'id'))operationId(op.id);
 if(Object.hasOwn(op,'dependencies')){
  if(!Array.isArray(op.dependencies)||op.dependencies.length>1000)fail('dependencies must be a bounded array of explicit operation IDs.');
  for(const id of op.dependencies)operationId(id);
  if(new Set(op.dependencies).size!==op.dependencies.length||op.dependencies.includes(op.id))fail('Dependencies must be distinct and cannot reference the operation itself.');
 }
 validateHorizontalProfile(op.boundary);
 return op;
}

export function validateHorizontalProfile(p){
 if(!Array.isArray(p)||p.length<3||p.length>128)fail('Ceiling boundary requires 3..128 full XYZ vertices in one loop, without a repeated closing point.');
 p.forEach(point);
 if(p.some(v=>Math.abs(v.zMm-p[0].zMm)>toleranceMm))fail('Ceiling boundary must be horizontal within 0.01 mm.');
 let twiceArea=0;const origin=p[0];
 for(let i=0;i<p.length;i++){
  const j=(i+1)%p.length,a=p[i],b=p[j];
  if(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm)<1)fail('Ceiling edges must be at least 1 mm; duplicate and repeated closing vertices are forbidden.');
  if(Math.abs(orient(p[(i+p.length-1)%p.length],a,b))<1e-8)fail('Ceiling polygon contains a redundant collinear vertex or a degenerate turn.');
  twiceArea+=(a.xMm-origin.xMm)*(b.yMm-origin.yMm)-(b.xMm-origin.xMm)*(a.yMm-origin.yMm);
  for(let k=i+1;k<p.length;k++){const l=(k+1)%p.length;if(k===j||l===i)continue;if(intersects(a,b,p[k],p[l]))fail('Ceiling polygon intersects or touches itself.');}
 }
 if(!Number.isFinite(twiceArea)||Math.abs(twiceArea)/2<1)fail('Ceiling profile area must be at least 1 mm².');
 return p;
}

export async function requireCeilingHostFeature(call,signal){
 const host=await call('revit.bridge.info',{},signal);
 if(!Array.isArray(host?.features)||!host.features.includes('controlled-ceiling-creation')){
  const error=new Error('The loaded Revit add-in does not provide controlled-ceiling-creation. This source is staged; no ceiling plan was requested. Load the combined candidate when needed.');
  error.code='ceiling_native_feature_unavailable';throw error;
 }
 return{requiredFeature:'controlled-ceiling-creation',moduleVersionId:host.moduleVersionId,nativeAcceptance:false};
}
export function validateCeilingPlan(operations){
 const sources=new Set();
 for(const op of operations.filter(op=>op.operationType==='create_ceiling')){validateCeilingCreation(op);sources.add(op.ceilingTypeId);sources.add(op.levelId);}
 if(!sources.size)return;
 for(const op of operations)if(op.operationType==='load_family'||['set_parameter','delete_element'].includes(op.operationType)&&sources.has(op.elementId))fail('Ceiling source type/level changes and family loading require a separate reviewed plan.');
}
