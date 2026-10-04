import {validateOperations} from './workflows.mjs';
const SETTINGS=['viewRange','crop','discipline','lightingCategories','displayStyle','detailLevel','partsVisibility'];
function equal(actual,expected){
 if(typeof expected==='number')return typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<=1e-5;
 if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((value,index)=>equal(actual[index],value));
 if(expected&&typeof expected==='object')return actual&&Object.entries(expected).every(([key,value])=>Object.hasOwn(actual,key)&&equal(actual[key],value));
 return actual===expected;
}
export function referenceViewOperation({viewId,referenceViewId,discipline='Electrical',viewportId,paperPoint,cropBounds,settings=SETTINGS}){
 return validateOperations([{operationType:'configure_view',viewId,referenceViewId,settings:[...settings],...(settings.includes('discipline')?{discipline}:{}),...(cropBounds!==undefined?{cropBounds}:{}),...(viewportId!==undefined?{viewportId,paperPoint}: {})}])[0];
}
export function verifyViewConfiguration(op,reference,target,viewport){
 if(!reference||!target)throw new Error('Native reference/target view settings are required.');
 if(reference.viewId!==op.referenceViewId||target.viewId!==op.viewId)throw new Error('Native view identities differ from the reviewed operation.');
 for(const setting of op.settings){
  if(setting==='discipline'){if(target.discipline!==(op.discipline??reference.discipline))throw new Error('Native discipline differs from the reviewed setting.');}
  else if(setting==='crop'&&Object.hasOwn(op,'cropBounds')){
   validateOperations([op]);
   const crop=target.crop;
   if(target.viewType!=='FloorPlan'||!crop||crop.active!==true||crop.visible!==false)throw new Error('Explicit crop requires an active hidden-boundary FloorPlan crop.');
   for(const [key,basis] of Object.entries({basisX:{x:1,y:0,z:0},basisY:{x:0,y:1,z:0},basisZ:{x:0,y:0,z:1}}))if(!equal(crop[key],basis))throw new Error('Explicit crop frame is rotated/reflected or incomplete.');
   for(const bound of ['min','max'])for(const axis of ['xMm','yMm']){
    const local=crop[bound]?.[axis],origin=crop.origin?.[axis];
    if(!Number.isFinite(local)||!Number.isFinite(origin)||!equal(local+origin,op.cropBounds[bound][axis]))throw new Error('Explicit crop '+bound+' '+axis+' differs from approved project bounds.');
   }
  }
  else if(setting==='crop'){
   for(const key of ['active','visible','origin','basisX','basisY','basisZ'])if(!equal(target.crop?.[key],reference.crop?.[key]))throw new Error('Native crop '+key+' differs from the reference.');
   const planXY=reference.viewType===target.viewType&&['FloorPlan','CeilingPlan','EngineeringPlan','AreaPlan'].includes(target.viewType);
   // Autodesk documents CropBox.Z as not meaningful for plan views. Preserve it in the
   // native capture; verify paper/model-plane crop XY separately from actual viewRange heights.
   for(const bound of ['min','max']){
    if(planXY){for(const axis of ['xMm','yMm'])if(!equal(target.crop?.[bound]?.[axis],reference.crop?.[bound]?.[axis]))throw new Error('Native crop '+bound+' '+axis+' differs from the reference.');}
    else if(!equal(target.crop?.[bound],reference.crop?.[bound]))throw new Error('Native crop '+bound+' differs from the reference.');
   }
  }else if(setting==='lightingCategories'){
   if(!Array.isArray(reference.lightingCategories)||reference.lightingCategories.length!==4)throw new Error('Explicit reference lighting category evidence is incomplete.');
   for(const expected of reference.lightingCategories){const actual=target.lightingCategories?.find(row=>row.categoryId===expected.categoryId);if(!expected.hiddenSupported||!actual?.hiddenSupported||!equal(actual.hidden,expected.hidden)||!equal(actual.graphics,expected.graphics))throw new Error('Native visibility/graphics differ for '+expected.category+'.');}
  }else if(!equal(target[setting],reference[setting]))throw new Error('Native '+setting+' differs from the reference.');
 }
 if(op.viewportId!==undefined){
  const p=viewport?.position,w=op.paperPoint;
  if(!p||!w||Math.abs(p.xMm-w.xMm)>1||Math.abs(p.yMm-w.yMm)>1||viewport.viewId!==target.viewId)throw new Error('Viewport relationship or paper XY differs from the reviewed placement.');
 }
 return {status:'PASS_NATIVE_SETTINGS',viewId:target.viewId,referenceViewId:reference.viewId,settingsChecked:op.settings,visualStatus:'REQUIRES_IMAGE_REVIEW'};
}
