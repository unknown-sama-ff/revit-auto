// Explicit reviewed project-axis offsets at the planned rotation.
// Native boxes may include symbols/reference geometry; they are not solids.
const EPS=1e-6;
const finite=(value,name)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e8)
    throw new Error('fixtureFootprint.'+name+' requires finite millimeters/degrees.');
  return value;
};
export function normalizeFixtureFootprint(value,symbolId,rotationDegrees){
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('fixtureFootprint must be explicit reviewed project-axis offsets.');
  if(!Number.isSafeInteger(value.symbolId)||value.symbolId!==symbolId)throw new Error('fixtureFootprint.symbolId must match the requested family type.');
  const footprint={symbolId:value.symbolId};
  for(const key of ['minOffsetXMm','maxOffsetXMm','minOffsetYMm','maxOffsetYMm','rotationDegrees'])footprint[key]=finite(value[key],key);
  if(footprint.maxOffsetXMm<=footprint.minOffsetXMm||footprint.maxOffsetYMm<=footprint.minOffsetYMm)
    throw new Error('fixtureFootprint requires positive ordered X/Y extents.');
  const angle=d=>((d%360)+360)%360;
  const delta=Math.abs(angle(footprint.rotationDegrees)-angle(rotationDegrees));
  if(Math.min(delta,360-delta)>1e-9)
    throw new Error('fixtureFootprint rotation must match the planned rotation; remeasure rather than rotate an axis-aligned native box.');
  return {...footprint,widthMm:footprint.maxOffsetXMm-footprint.minOffsetXMm,
    heightMm:footprint.maxOffsetYMm-footprint.minOffsetYMm,
    centerOffsetXMm:(footprint.minOffsetXMm+footprint.maxOffsetXMm)/2,
    centerOffsetYMm:(footprint.minOffsetYMm+footprint.maxOffsetYMm)/2};
}
export function footprintRectangle(center,footprint){
  return {xmin:center.xMm-footprint.widthMm/2,xmax:center.xMm+footprint.widthMm/2,
    ymin:center.yMm-footprint.heightMm/2,ymax:center.yMm+footprint.heightMm/2};
}
function pointSegmentDistance(p,a,b){
  const dx=b.xMm-a.xMm,dy=b.yMm-a.yMm,n=dx*dx+dy*dy;
  if(n===0)return Math.hypot(p.xMm-a.xMm,p.yMm-a.yMm);
  const t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*dx+(p.yMm-a.yMm)*dy)/n));
  return Math.hypot(p.xMm-a.xMm-t*dx,p.yMm-a.yMm-t*dy);
}
function crosses(a,b,c,d){
  const cross=(p,q,r)=>(q.xMm-p.xMm)*(r.yMm-p.yMm)-(q.yMm-p.yMm)*(r.xMm-p.xMm);
  const within=(p,q,r)=>r.xMm>=Math.min(p.xMm,q.xMm)-EPS&&r.xMm<=Math.max(p.xMm,q.xMm)+EPS&&r.yMm>=Math.min(p.yMm,q.yMm)-EPS&&r.yMm<=Math.max(p.yMm,q.yMm)+EPS;
  const x=cross(a,b,c),y=cross(a,b,d),u=cross(c,d,a),v=cross(c,d,b);
  if(((x>0&&y<0)||(x<0&&y>0))&&((u>0&&v<0)||(u<0&&v>0)))return true;
  return Math.abs(x)<=EPS&&within(a,b,c)||Math.abs(y)<=EPS&&within(a,b,d)||Math.abs(u)<=EPS&&within(c,d,a)||Math.abs(v)<=EPS&&within(c,d,b);
}
export function footprintBoundaryDistance(rect,loops){
  const corners=[{xMm:rect.xmin,yMm:rect.ymin},{xMm:rect.xmax,yMm:rect.ymin},{xMm:rect.xmax,yMm:rect.ymax},{xMm:rect.xmin,yMm:rect.ymax}];
  const contained=p=>p.xMm>=rect.xmin&&p.xMm<=rect.xmax&&p.yMm>=rect.ymin&&p.yMm<=rect.ymax;
  let distance=Infinity;
  for(const loop of loops)for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length];
    if(contained(a)||contained(b))return 0;
    for(let j=0;j<4;j++){
      const c=corners[j],d=corners[(j+1)%4];
      if(crosses(a,b,c,d))return 0;
      distance=Math.min(distance,pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
    }
  }
  return distance;
}
export function footprintsOverlap(a,b){
  return Math.min(a.xmax,b.xmax)-Math.max(a.xmin,b.xmin)>EPS
    &&Math.min(a.ymax,b.ymax)-Math.max(a.ymin,b.ymin)>EPS;
}
