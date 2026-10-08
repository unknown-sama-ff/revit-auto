import {validateOperations} from './workflows.mjs';
import {validateClosedProfile} from './opening-rules.mjs';
export const CANDIDATE_TYPES=['create_wall','create_floor','create_grid','create_family_instance','create_pipe','create_duct'];
const operationFields={create_wall:['wallTypeId','heightMm','mark'],create_floor:['floorTypeId','mark'],create_grid:['name'],create_family_instance:['symbolId','family','type','mark'],create_pipe:['pipeTypeId','systemTypeId','diameterMm','mark'],create_duct:['ductTypeId','systemTypeId','diameterMm','widthMm','heightMm','mark']};
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(label+' must be an object.');}
function exact(value,keys,label){object(value,label);if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new Error(label+' requires only '+keys.join(', '));}
function finite(value,label){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e8)throw new Error(label+' must be a bounded finite number, not an inferred/default value.');return value;}
export function validateCalibration(calibration){
 object(calibration,'calibration');const allowed=['scaleMmPerUnit','origin','offsetMm','rotationDegrees','levelId','sourcePlaneZ','sourceYAxis'];
 if(Object.keys(calibration).some(key=>!allowed.includes(key)))throw new Error('Unknown calibration fields.');
 const c=calibration;finite(c.scaleMmPerUnit,'scaleMmPerUnit');if(c.scaleMmPerUnit<=0)throw new Error('scaleMmPerUnit must be positive.');exact(c.origin,['x','y'],'origin');exact(c.offsetMm,['x','y','z'],'offsetMm');
 for(const [key,value] of Object.entries(c.origin))finite(value,'origin.'+key);for(const [key,value] of Object.entries(c.offsetMm))finite(value,'offsetMm.'+key);finite(c.rotationDegrees,'rotationDegrees');
 if(!Number.isSafeInteger(c.levelId)||c.levelId<=0)throw new Error('Calibration needs an explicit existing levelId.');if(c.sourcePlaneZ!==undefined)finite(c.sourcePlaneZ,'sourcePlaneZ');if(c.sourceYAxis!==undefined&&!['up','down'].includes(c.sourceYAxis))throw new Error('sourceYAxis must be explicitly up or down.');return c;
}
export function validateLayerMapping(mapping={}){
 object(mapping,'layerMapping');if(Object.keys(mapping).length>200)throw new Error('Candidate layer mappings exceed 200 layers.');
 for(const [layer,template] of Object.entries(mapping)){
  if(!layer||layer.length>256)throw new Error('Layer name must be explicit and bounded.');object(template,'Layer '+layer);
  if(!CANDIDATE_TYPES.includes(template.operationType))throw new Error('Layer '+layer+' may only use controlled candidate creation operations; delete/set/load/script operations are unsupported.');
  if(Object.keys(template).some(key=>key!=='operationType'&&!operationFields[template.operationType].includes(key)))throw new Error('Layer '+layer+' has unsupported candidate fields. No parameters, paths, script, host or inferred geometry can be injected.');
  for(const [key,value] of Object.entries(template)){
   if(key.endsWith('Id')&&(!Number.isSafeInteger(value)||value<=0))throw new Error('Candidate '+key+' must be an explicit existing positive native ID.');
   if(['heightMm','widthMm','diameterMm'].includes(key)&&(finite(value,key)<=0))throw new Error('Candidate '+key+' must be explicitly positive.');
   if(['family','type','mark','name'].includes(key)&&(typeof value!=='string'||!value.trim()||value.length>2048))throw new Error('Candidate '+key+' must be an explicit bounded string.');
  }
 }
 return mapping;
}
export function drawingCandidates(data,calibration,layerMapping={}){
 const c=validateCalibration(calibration),mapping=validateLayerMapping(layerMapping);const entities=Array.isArray(data)?data:data?.entities;if(!Array.isArray(entities)||entities.length>10000)throw new Error('Drawing data needs an entities array with at most 10,000 rows.');
 const angle=c.rotationDegrees*Math.PI/180;
 const transform=p=>{
  object(p,'Source point');if(Object.keys(p).some(key=>!['x','y','z'].includes(key)))throw new Error('Source point accepts only x/y/z.');const x=(finite(p.x,'source x')-c.origin.x)*c.scaleMmPerUnit,y=(finite(p.y,'source y')-c.origin.y)*c.scaleMmPerUnit*(c.sourceYAxis==='down'?-1:1);
  const z=p.z===undefined?c.sourcePlaneZ:p.z;if(z===undefined)throw new Error('Source Z is unknown; provide z or explicit calibration.sourcePlaneZ for reviewed 2D geometry.');finite(z,'source z');
  return{xMm:finite(c.offsetMm.x+x*Math.cos(angle)-y*Math.sin(angle),'transformed xMm'),yMm:finite(c.offsetMm.y+x*Math.sin(angle)+y*Math.cos(angle),'transformed yMm'),zMm:finite(c.offsetMm.z+z*c.scaleMmPerUnit,'transformed zMm')};
 };
 const operations=[],issues=[],text=[],provenance=[];let unmapped=0,textCount=0;
 entities.forEach((entity,index)=>{
  if(!entity||typeof entity!=='object'||Array.isArray(entity)){issues.push({entityIndex:index,message:'Source entity must be an object.'});return;}
  if(typeof entity.text==='string'){textCount++;if(text.length<100)text.push({entityIndex:index,layer:entity.layer??null,text:entity.text.slice(0,2000),truncated:entity.text.length>2000,untrustedSourceData:true});}
  const template=Object.hasOwn(mapping,entity.layer)?mapping[entity.layer]:null;if(!template){unmapped++;return;}
  try{
   if(entity.nonPlanar===true||entity.geometryUnknown===true)throw new Error('Unknown source geometry is not converted to default coordinates.');
   if(entity.bulges!==undefined&&(!Array.isArray(entity.bulges)||entity.bulges.some(value=>typeof value!=='number'||!Number.isFinite(value))))throw new Error('Polyline curvature evidence is invalid.');
   if(entity.bulges?.some(value=>value!==0))throw new Error('Curved polyline bulges need manual interpretation; no straight segment guess.');
   let operation={...template,levelId:c.levelId};
   if(entity.start&&entity.end){if(!['create_wall','create_grid','create_pipe','create_duct'].includes(template.operationType))throw new Error('Line geometry cannot map to this candidate operation type.');operation={...operation,start:transform(entity.start),end:transform(entity.end)};}
   else if(entity.insertion&&(entity.objectName?.includes('Block')||entity.name)){
    if(template.operationType!=='create_family_instance')throw new Error('Block geometry requires an explicit family-instance mapping.');
    if(!entity.normal&&entity.coordinateSpace!=='reviewed-source-xy')throw new Error('Block orientation is unknown; provide normal or explicit reviewed-source-xy declaration.');
    if(!Number.isFinite(entity.rotation))throw new Error('Source block rotation is unknown; provide explicit radians, including zero.');
    if(entity.normal&&(!Number.isFinite(entity.normal.x)||!Number.isFinite(entity.normal.y)||entity.normal.x!==0||entity.normal.y!==0||entity.normal.z!==1))throw new Error('Non-XY block orientation requires a different reviewed placement adapter.');
    if(!entity.scaleFactors)throw new Error('Block scale is unknown; provide native unit scale factors, never assume unscaled.');
    if(entity.scaleFactors&&(!Number.isFinite(entity.scaleFactors.x)||!Number.isFinite(entity.scaleFactors.y)||!Number.isFinite(entity.scaleFactors.z)||entity.scaleFactors.x!==1||entity.scaleFactors.y!==1||entity.scaleFactors.z!==1))throw new Error('Scaled/mirrored blocks cannot be converted to an unscaled Revit family without reviewed type geometry.');
    operation={...operation,...transform(entity.insertion),rotationDegrees:finite(entity.rotation*180/Math.PI*(c.sourceYAxis==='down'?-1:1)+c.rotationDegrees,'block rotationDegrees')};
   }else if(entity.closed===true&&Array.isArray(entity.coordinates)&&template.operationType==='create_floor'){
    const stride=entity.coordinateStride??(entity.objectName?.includes('2d')||entity.objectName?.includes('3d')?3:entity.objectName==='AcDbPolyline'?2:null);
    if(![2,3].includes(stride)||entity.coordinates.length%stride!==0||entity.coordinates.length/stride<3||entity.coordinates.length/stride>128)throw new Error('Polyline stride/closed profile is invalid or unknown.');
    if(!entity.normal&&entity.coordinateSpace!=='reviewed-source-xy'&&entity.objectName!=='AcDb3dPolyline')throw new Error('Polyline source coordinate plane is unknown; supply normal or reviewed-source-xy declaration.');
    if(entity.normal&&(entity.normal.x!==0||entity.normal.y!==0||entity.normal.z!==1))throw new Error('Non-world-XY polyline coordinate system cannot be inferred.');
    if(entity.objectName!=='AcDb3dPolyline'&&(!Array.isArray(entity.bulges)||entity.bulges.length!==entity.coordinates.length/stride))throw new Error('Polyline curvature evidence is unknown or incomplete; no straight-segment assumption.');
    if(entity.objectName==='AcDb2dPolyline'&&entity.elevation===undefined)throw new Error('2D polyline native elevation is missing; its coordinate Z values are not height evidence.');
    const boundary=[];for(let i=0;i<entity.coordinates.length;i+=stride)boundary.push(transform({x:entity.coordinates[i],y:entity.coordinates[i+1],...(entity.objectName==='AcDb2dPolyline'?{z:entity.elevation}:stride===3?{z:entity.coordinates[i+2]}:entity.elevation!==undefined?{z:entity.elevation}:{})}));validateClosedProfile(boundary,true);operation={...operation,boundary};
   }else throw new Error('Mapped entity geometry requires manual interpretation; arcs, hatches, text and unsupported polylines are not guessed.');
   validateOperations([operation]);if(operations.length>=1000)throw new Error('Candidate operation budget exceeds 1000; restrict layers.');operations.push(operation);provenance.push({operationIndex:operations.length-1,entityIndex:index,handle:typeof entity.handle==='string'?entity.handle.slice(0,200):null,layer:entity.layer});
  }catch(error){issues.push({entityIndex:index,handle:typeof entity.handle==='string'?entity.handle.slice(0,200):null,layer:entity.layer??null,message:error.message,sourceReadError:typeof entity.readError==='string'?entity.readError.slice(0,400):null});}
 });
 return{operations,issues,text,provenance,candidateOnly:true,sourceGeometryCount:entities.length,unmappedEntityCount:unmapped,textCount,textTruncated:textCount>text.length,complete:entities.length>0&&issues.length===0&&unmapped===0,engineeringComplianceVerified:false};
}
