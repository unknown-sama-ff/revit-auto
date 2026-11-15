import {validateOperations} from './workflows.mjs';
import {normalizeFixtureFootprint,footprintRectangle,footprintBoundaryDistance,footprintsOverlap} from './lighting-footprint.mjs';
function finite(value,name,positive=false){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e8||positive&&value<=0)throw new Error(`${name} must be ${positive?'positive ':''}finite millimeters.`);return value;}
function integer(value,name,max=50){if(!Number.isSafeInteger(value)||value<1||value>max)throw new Error(`${name} must be an integer between 1 and ${max}.`);return value;}
function insideLoop(point,loop){let inside=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if((a.yMm>point.yMm)!==(b.yMm>point.yMm)&&point.xMm<(b.xMm-a.xMm)*(point.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)inside=!inside;}return inside;}
function distanceToSegment(point,a,b){const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm;const square=dx*dx+dy*dy;if(square===0)return Math.hypot(point.xMm-a.xMm,point.yMm-a.yMm);const t=Math.max(0,Math.min(1,((point.xMm-a.xMm)*dx+(point.yMm-a.yMm)*dy)/square));return Math.hypot(point.xMm-(a.xMm+t*dx),point.yMm-(a.yMm+t*dy));}
export function buildRoomLighting(room,input){
  if(!room||room.areaM2<=0||room.layoutEligible!==true||!Array.isArray(room.boundaryLoops)||room.boundaryLoops.length===0)throw new Error('The room needs an enclosed, verified straight-segment boundary; curved/invalid rooms require an explicit reviewed layout.');
  const rows=integer(input.rows,'rows');const columns=integer(input.columns,'columns');if(rows*columns>200)throw new Error('A room preview may contain at most 200 fixtures.');
  integer(input.symbolId,'symbolId',Number.MAX_SAFE_INTEGER);integer(room.id,'roomId',Number.MAX_SAFE_INTEGER);integer(room.levelId,'levelId',Number.MAX_SAFE_INTEGER);
  const height=finite(input.heightAboveLevelMm,'heightAboveLevelMm',true);const margin=finite(input.marginMm,'marginMm',true);
  const prefix=input.markPrefix;if(typeof prefix!=='string'||!prefix.trim()||prefix.length>50)throw new Error('Provide an explicit unique markPrefix.');
  const loops=room.boundaryLoops;
  for(const loop of loops){if(!Array.isArray(loop)||loop.length<3)throw new Error('Invalid room loop.');for(const point of loop){finite(point.xMm,'boundary xMm');finite(point.yMm,'boundary yMm');}}
  const points=loops.flat();const xmin=Math.min(...points.map(p=>p.xMm)),xmax=Math.max(...points.map(p=>p.xMm)),ymin=Math.min(...points.map(p=>p.yMm)),ymax=Math.max(...points.map(p=>p.yMm));
  if(xmax-xmin<=2*margin||ymax-ymin<=2*margin)throw new Error('The requested margin leaves no usable room area.');
  const elevation=finite(room.levelElevationMm,'levelElevationMm');const zMm=elevation+height;const rotation=input.rotationDegrees===undefined?0:finite(input.rotationDegrees,'rotationDegrees');const placementMode=input.placementMode; if(placementMode!==undefined&&placementMode!=='legacyPoint')throw new Error('placementMode must be legacyPoint when an inspected WorkPlaneBased family uses legacy point placement.');
  const footprint=normalizeFixtureFootprint(input.fixtureFootprint,input.symbolId,rotation);
  const insetX=margin+(footprint?.widthMm??0)/2,insetY=margin+(footprint?.heightMm??0)/2;
  if(xmax-xmin+1e-6<2*insetX||ymax-ymin+1e-6<2*insetY)throw new Error('The requested fixture footprint and margin leave no usable room area.');
  const operations=[],rectangles=[];
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const point={xMm:columns===1?(xmin+xmax)/2:xmin+insetX+column*(xmax-xmin-2*insetX)/(columns-1),yMm:rows===1?(ymin+ymax)/2:ymin+insetY+row*(ymax-ymin-2*insetY)/(rows-1)};
    const inRoom=loops.reduce((parity,loop)=>parity!==insideLoop(point,loop),false);
    let distance=Infinity;for(const loop of loops)for(let index=0;index<loop.length;index++)distance=Math.min(distance,distanceToSegment(point,loop[index],loop[(index+1)%loop.length]));
    if(!inRoom||distance+1e-6<margin)throw new Error(`Grid point row ${row+1}, column ${column+1} is outside the room or violates the margin. Review explicit coordinates instead of silently dropping fixtures.`);
    const serial=operations.length+1;
    if(footprint){
      const rect=footprintRectangle(point,footprint);
      if(footprintBoundaryDistance(rect,loops)+1e-6<margin)throw new Error('Fixture footprint '+serial+' intersects a room boundary/hole or violates the margin.');
      if(rectangles.some(other=>footprintsOverlap(rect,other)))throw new Error('Fixture footprints overlap; reduce the grid density or explicitly review another layout.');
      rectangles.push(rect);
      point.xMm-=footprint.centerOffsetXMm;point.yMm-=footprint.centerOffsetYMm;
    }
    operations.push({operationType:'create_family_instance',id:`room${room.id}_light${serial}`,symbolId:input.symbolId,levelId:room.levelId,xMm:point.xMm,yMm:point.yMm,zMm,rotationDegrees:rotation,mark:`${prefix}-${String(serial).padStart(2,'0')}`,...(placementMode?{placementMode}: {})});
  }
  return {operations:validateOperations(operations),layout:{roomId:room.id,roomName:room.name,rows,columns,heightAboveLevelMm:height,marginMm:margin,coordinateFrame:'Revit internal origin, absolute Z',method:'axis-aligned grid within room loops',fixtureCount:operations.length,...(footprint?{fixtureFootprint:footprint,gridAnchor:'footprint-center',marginAppliesTo:'reviewed-project-axis-envelope',envelopeSource:'explicit-reviewed-input',footprints:rectangles}: {})},warnings:['This is a geometric placement proposal, not an illuminance, code-compliance, circuit-capacity or ceiling-host design. WorkPlaneBased legacyPoint placement preserves the old point-only workflow and is not a host-attachment claim. Review the preview.',footprint?'Envelope offsets are explicit reviewed input at this exact type and rotation, not a freshly measured native geometry certificate. Z remains level plus installation height.':'Only insertion points and their margins are checked; family symbols or geometry may extend outside the room.']};
}

