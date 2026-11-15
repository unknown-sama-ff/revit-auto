const fail=message=>{throw new Error('move_lighting_fixtures: '+message);};
const fields=(value,allowed)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('Unknown fields or non-object input.');
};
const number=(value,name,limit=1e8)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>limit)fail(name+' must be a bounded finite number.');
  return value;
};
const id=(value,name)=>{
  if(!Number.isSafeInteger(value)||value<=0)fail(name+' must be an explicit existing safe positive ID.');
};
function point(value,limit=1e8){
  fields(value,['xMm','yMm','zMm']);
  for(const key of ['xMm','yMm','zMm'])number(value[key],key,limit);
}
export function validateLightingMove(operation){
  fields(operation,['operationType','id','targets','translation','toleranceMm']);
  if(operation.operationType!=='move_lighting_fixtures')fail('Incorrect operationType.');
  if(operation.id!==undefined&&(typeof operation.id!=='string'||!operation.id.trim()||operation.id.length>80))fail('Invalid operation id.');
  if(!Array.isArray(operation.targets)||operation.targets.length<1||operation.targets.length>20)fail('Use 1..20 explicit targets.');
  const seen=new Set();
  for(const target of operation.targets){
    fields(target,['elementId','symbolId','point']);id(target.elementId,'elementId');id(target.symbolId,'symbolId');point(target.point);
    if(seen.has(target.elementId))fail('Target IDs must be distinct.');seen.add(target.elementId);
  }
  point(operation.translation,10000);
  if(operation.translation.zMm!==0)fail('Only explicit XY translation with zMm=0 is supported.');
  const tolerance=number(operation.toleranceMm,'toleranceMm',1);
  if(tolerance<=0)fail('toleranceMm must be positive and at most 1 mm.');
  const distance=Math.hypot(operation.translation.xMm,operation.translation.yMm);
  if(distance>10000)fail('XY translation length must not exceed 10000 mm.');
  if(distance<=2*tolerance)fail('No-op or sub-tolerance movement is refused.');
  for(const target of operation.targets){
    number(target.point.xMm+operation.translation.xMm,'translated xMm');
    number(target.point.yMm+operation.translation.yMm,'translated yMm');
  }
  return operation;
}
