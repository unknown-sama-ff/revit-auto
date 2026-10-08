import {validateClosedProfile} from './opening-rules.mjs';
export function validateStair(op){
 const allowed=['operationType','id','dependencies','stairTypeId','baseLevelId','topLevelId','desiredRisersNumber','treadDepthMm','geometryToleranceMm','landingMode','runs','landings'];
 if(Object.keys(op).some(key=>!allowed.includes(key)))throw new Error('Unknown stair operation field; hidden parameter maps or defaults are not accepted.');
 for(const field of ['stairTypeId','baseLevelId','topLevelId'])if(!Number.isSafeInteger(op[field])||op[field]<=0)throw new Error('Provide explicit existing '+field+', never a deferred reference or default.');
 if(op.baseLevelId===op.topLevelId)throw new Error('Stair base/top must differ.');
 const count=(value,field)=>{if(!Number.isSafeInteger(value)||value<1||value>1000)throw new Error(field+' requires explicit integer in [1,1000].');return value};
 count(op.desiredRisersNumber,'desiredRisersNumber');if(typeof op.treadDepthMm!=='number'||!Number.isFinite(op.treadDepthMm)||op.treadDepthMm<=0||op.treadDepthMm>1e8)throw new Error('Explicit treadDepthMm must be positive.');
 if(typeof op.geometryToleranceMm!=='number'||!Number.isFinite(op.geometryToleranceMm)||op.geometryToleranceMm<=0||op.geometryToleranceMm>100)throw new Error('Explicit geometryToleranceMm must be in (0,100].');
 if(!['none','automaticBetweenRuns','sketched'].includes(op.landingMode))throw new Error('Specify none, automaticBetweenRuns or sketched landingMode.');
 if(!Array.isArray(op.runs)||op.runs.length<1||op.runs.length>8)throw new Error('A stair requires 1..8 explicit straight runs.');
 if(op.landingMode==='automaticBetweenRuns'&&op.runs.length<2)throw new Error('automaticBetweenRuns needs at least two runs.');
 const point=p=>{if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==3||Object.keys(p).some(k=>!['xMm','yMm','zMm'].includes(k))||Object.values(p).some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e8))throw new Error('Stair points require only full finite project xMm/yMm/zMm.');};
 let sum=0;for(const run of op.runs){if(!run||typeof run!=='object'||Object.keys(run).length!==4||Object.keys(run).some(key=>!['start','end','widthMm','risersNumber'].includes(key)))throw new Error('Each run requires exactly start/end/widthMm/risersNumber.');point(run.start);point(run.end);if(Math.abs(run.start.zMm-run.end.zMm)>0.01)throw new Error('Straight stair paths are horizontal at the explicit absolute Z, not slope lines.');if(Math.hypot(run.end.xMm-run.start.xMm,run.end.yMm-run.start.yMm)<1||typeof run.widthMm!=='number'||!Number.isFinite(run.widthMm)||run.widthMm<=0||run.widthMm>1e8)throw new Error('Stair path/width must be positive.');sum+=count(run.risersNumber,'risersNumber');}
 if(sum!==op.desiredRisersNumber)throw new Error('Per-run riser sum must match desiredRisersNumber.');
 if(op.landingMode==='sketched'){
  if(!Array.isArray(op.landings)||op.landings.length<1||op.landings.length>8)throw new Error('Sketched stairs require 1..8 explicit landing profiles.');
  for(const landing of op.landings){if(!landing||typeof landing!=='object'||Object.keys(landing).length!==2||!Object.hasOwn(landing,'boundary')||!Object.hasOwn(landing,'elevationMm')||typeof landing.elevationMm!=='number'||!Number.isFinite(landing.elevationMm))throw new Error('Landing needs exactly elevationMm and boundary.');validateClosedProfile(landing.boundary,true);if(landing.boundary.some(p=>Math.abs(p.zMm-landing.elevationMm)>0.01))throw new Error('Landing boundary must match its explicit absolute elevation.');}
 }else if(Object.hasOwn(op,'landings'))throw new Error('landings input is only valid with sketched mode.');
}
