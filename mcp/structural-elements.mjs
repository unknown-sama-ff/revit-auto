// Adapted from bimwright/rvt-mcp b44ee0b (Apache-2.0); see THIRD_PARTY_NOTICES.md.
// The native host owns symbol/category/placement validation and all transactions.
const metadata=['operationType','id','dependencies'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=(value,field)=>{if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e8)throw new Error(`${field} must be a bounded finite number in millimeters.`);};
function point(value,field){
 if(!object(value)||Object.keys(value).length!==3||!['xMm','yMm','zMm'].every(key=>Object.hasOwn(value,key)))throw new Error(`${field} requires explicit xMm/yMm/zMm; source elevation is never inferred.`);
 for(const key of ['xMm','yMm','zMm'])finite(value[key],field+'.'+key);
}
export function validateStructuralElement(op){
 const beam=op?.operationType==='create_structural_beam';
 if(!beam&&op?.operationType!=='create_isolated_foundation')throw new Error('Unsupported structural element operation.');
 const required=['symbolId','levelId',...(beam?['start','end']:['point'])];
 const allowed=[...metadata,...required,'rotationDegrees',...(beam?['disallowJoin']:[])];
 if(!object(op)||Object.keys(op).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(op,key)))throw new Error('Structural creation requires existing symbolId/levelId and complete geometry; unknown fields are refused.');
 for(const field of ['symbolId','levelId'])if(!Number.isSafeInteger(op[field])||op[field]<=0)throw new Error(`${field} must identify an existing native element; deferred types and levels require a separate preview.`);
 if(beam){
  point(op.start,'start');point(op.end,'end');
  if(Math.hypot(op.end.xMm-op.start.xMm,op.end.yMm-op.start.yMm)<1)throw new Error('A beam requires at least 1 mm horizontal span; vertical members use the column adapter.');
  if(Object.hasOwn(op,'disallowJoin')&&typeof op.disallowJoin!=='boolean')throw new Error('disallowJoin must be a boolean.');
 }else point(op.point,'point');
 if(Object.hasOwn(op,'rotationDegrees')){finite(op.rotationDegrees,'rotationDegrees');if(Math.abs(op.rotationDegrees)>360)throw new Error('rotationDegrees must be in [-360,360].');}
 return op;
}

export async function requireStructuralHostFeature(call,signal,additionalFeatures=[]){
 const host=await call('revit.bridge.info',{},signal);
 const requiredFeatures=['controlled-structural-elements',...additionalFeatures];
 if(!Array.isArray(host?.features)||requiredFeatures.some(feature=>!host.features.includes(feature))){
  const error=new Error('The loaded Revit add-in does not provide '+requiredFeatures.join(', ')+'. This source is staged; no structural plan was requested. Load the combined candidate when needed.');
  error.code='structural_native_feature_unavailable';throw error;
 }
 return{requiredFeature:'controlled-structural-elements',requiredFeatures,moduleVersionId:host.moduleVersionId,nativeAcceptance:false};
}
