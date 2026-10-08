export function validateOpening(op){
 const fields={wall_rectangle:['hostElementId','start','end','hostToleranceMm'],floor_profile:['hostElementId','boundary','cutDirection','hostToleranceMm'],shaft:['baseLevelId','topLevelId','boundary','hostToleranceMm']}[op.openingKind];
 if(!fields)throw new Error('Specify openingKind wall_rectangle, floor_profile or shaft; no kind is guessed.');
 const allowed=['operationType','id','dependencies','openingKind',...fields];
 if(Object.keys(op).some(key=>!allowed.includes(key))||fields.some(key=>!Object.hasOwn(op,key)))throw new Error('Opening inputs require all explicit fields and reject unknown parameters.');
 if(typeof op.hostToleranceMm!=='number'||!Number.isFinite(op.hostToleranceMm)||op.hostToleranceMm<=0||op.hostToleranceMm>100)throw new Error('hostToleranceMm must be explicit in (0,100] mm.');
 const point=p=>{if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==3||Object.keys(p).some(k=>!['xMm','yMm','zMm'].includes(k))||Object.values(p).some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e8))throw new Error('Opening points require full finite xMm/yMm/zMm, no implicit zero.');return [p.xMm,p.yMm,p.zMm]};
 if(op.openingKind==='wall_rectangle'){if(!Number.isSafeInteger(op.hostElementId)||op.hostElementId<=0)throw new Error('Wall opening hostElementId must be an existing positive element id; deferred/new hosts are not supported.');const a=point(op.start),b=point(op.end);if(Math.hypot(b[0]-a[0],b[1]-a[1])<1||b[2]-a[2]<1)throw new Error('Wall corners need >=1 mm horizontal span and lower start/upper end.');return;}
 if(op.openingKind==='floor_profile'&&(!Number.isSafeInteger(op.hostElementId)||op.hostElementId<=0))throw new Error('Floor opening hostElementId must be an existing positive element id.');
 if(op.openingKind==='floor_profile'&&!['vertical','perpendicular'].includes(op.cutDirection))throw new Error('Specify cutDirection vertical or perpendicular.');
 if(op.openingKind==='shaft'&&(!Number.isSafeInteger(op.baseLevelId)||!Number.isSafeInteger(op.topLevelId)||op.baseLevelId<=0||op.topLevelId<=0))throw new Error('Shaft baseLevelId and topLevelId must be existing positive level ids.');
 if(op.openingKind==='shaft'&&op.baseLevelId===op.topLevelId)throw new Error('Shaft base/top levels must differ.');
 validateClosedProfile(op.boundary,op.openingKind==='shaft'||op.cutDirection==='vertical');
}

export function validateClosedProfile(boundary,horizontal=false){
 const point=p=>{if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==3||Object.keys(p).some(k=>!['xMm','yMm','zMm'].includes(k))||Object.values(p).some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e8))throw new Error('Opening points require full finite xMm/yMm/zMm, no implicit zero.');return [p.xMm,p.yMm,p.zMm]};
 if(!Array.isArray(boundary)||boundary.length<3||boundary.length>128)throw new Error('Opening boundary needs 3..128 distinct vertices.');
 const points=boundary.map(point),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 if(horizontal&&points.some(p=>Math.abs(p[2]-points[0][2])>0.01))throw new Error('Vertical/shaft profiles must be horizontal.');
 let normal;for(let i=1;i<points.length-1;i++){const n=cross(sub(points[i],points[0]),sub(points[i+1],points[0]));if(Math.hypot(...n)>0.001){normal=n;break;}}
 if(!normal)throw new Error('Opening profile has no area.');
 if(points.some(p=>Math.abs(sub(p,points[0]).reduce((s,v,i)=>s+v*normal[i],0))/Math.hypot(...normal)>0.01))throw new Error('Opening profile is not planar.');
 const axis=Math.abs(normal[2])>=Math.max(Math.abs(normal[0]),Math.abs(normal[1]))?2:Math.abs(normal[0])>=Math.abs(normal[1])?0:1;
 const xy=points.map(p=>axis===2?[p[0],p[1]]:axis===0?[p[1],p[2]]:[p[0],p[2]]);
 const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const on=(a,b,p)=>Math.abs(orient(a,b,p))<1e-8&&p[0]>=Math.min(a[0],b[0])-1e-8&&p[0]<=Math.max(a[0],b[0])+1e-8&&p[1]>=Math.min(a[1],b[1])-1e-8&&p[1]<=Math.max(a[1],b[1])+1e-8;
 const intersect=(a,b,c,d)=>orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
 let area=0;for(let i=0;i<points.length;i++){const j=(i+1)%points.length;if(Math.hypot(...sub(points[i],points[j]))<1)throw new Error('Opening edges must be >=1 mm with no duplicate or closing point.');if(Math.abs(orient(xy[(i+points.length-1)%points.length],xy[i],xy[j]))<1e-8)throw new Error('Opening profile has redundant collinear points.');area+=xy[i][0]*xy[j][1]-xy[j][0]*xy[i][1];for(let k=i+1;k<points.length;k++){const l=(k+1)%points.length;if(k===j||l===i)continue;if(intersect(xy[i],xy[j],xy[k],xy[l]))throw new Error('Opening polygon intersects or touches itself.');}}
 if(Math.abs(area)/2<1)throw new Error('Opening profile projected area must be >=1 mm².');
}
