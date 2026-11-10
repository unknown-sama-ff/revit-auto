const toleranceMm=0.01;
const positiveId=value=>Number.isSafeInteger(value)&&value>0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function requireEvidence(condition,message){
  if(!condition){const error=new Error(message);error.code='pipe_route_not_verified';throw error;}
}
function distance(first,second){
  const axes=['xMm','yMm','zMm'];
  return axes.every(axis=>finite(first?.[axis])&&finite(second?.[axis]))
    ? Math.hypot(...axes.map(axis=>first[axis]-second[axis])) : Infinity;
}
function connection(port){
  const known=port.connectionStatusSupported===true&&typeof port.connected==='boolean';
  return {known,connected:known?port.connected:null};
}

// Frozen evidence only. Collision, hydraulic design and full-model effects need separate review.
export function verifySinglePipeRouteCreation({plan,receipt,beforeContext,afterContext,pipe,systemType}){
  requireEvidence(Array.isArray(plan?.operations)&&plan.operations.length===1&&plan.operations[0].operationType==='create_pipe',
    'Require exactly one reviewed create_pipe operation.');
  const op=plan.operations[0],before=beforeContext?.document,after=afterContext?.document;
  requireEvidence([op.pipeTypeId,op.systemTypeId,op.levelId].every(positiveId),'Reviewed pipe, system and level IDs must be explicit positive integers.');
  requireEvidence(typeof plan.planId==='string'&&plan.planId.trim()&&receipt?.planId===plan.planId&&
    receipt.status==='committed'&&receipt.completedOperationCount===1&&receipt.saved===false&&receipt.automaticSave!==true,
    'Receipt does not prove this one unsaved pipe commit.');
  const id=receipt.references?.[op.id];
  requireEvidence(typeof op.id==='string'&&op.id.trim()&&positiveId(id)&&Array.isArray(receipt.createdElementIds)&&
    receipt.createdElementIds.length===1&&receipt.createdElementIds[0]===id,'Stable primary pipe reference is missing or ambiguous.');
  requireEvidence(beforeContext?.active===true&&afterContext?.active===true&&typeof before?.identity==='string'&&before.identity&&
    before.identity===plan.documentIdentity&&after?.identity===before.identity&&typeof before.path==='string'&&before.path.trim()&&
    after.path===before.path&&before.isModified===false&&Number.isSafeInteger(before.revision)&&before.revision>=0&&
    before.revision===plan.documentRevision&&Number.isSafeInteger(after.revision)&&after.revision>before.revision,
    'Pipe evidence belongs to a different or unknown document/session.');
  const changes=receipt.nativeChanges;
  requireEvidence(changes?.documentIdentity===before.identity&&changes.startRevision===before.revision&&changes.endRevision===after.revision,
    'Native change envelope does not match the before/after revisions.');
  requireEvidence(pipe?.summary?.id===id&&pipe.summary.className==='Pipe'&&pipe.summary.categoryId===-2008044&&
    pipe.summary.typeId===op.pipeTypeId&&pipe.summary.levelId===op.levelId,'Native pipe type, category or level differs from the reviewed operation.');
  const classification=systemType?.piping?.systemClassification;
  requireEvidence(systemType?.summary?.id===op.systemTypeId&&systemType.summary.className==='PipingSystemType'&&
    systemType.piping.systemTypeId===op.systemTypeId&&typeof classification==='string'&&classification.trim()&&
    !/^(unknown|undefined|invalid)/i.test(classification)&&pipe.piping?.systemTypeId===op.systemTypeId&&
    pipe.piping.systemClassification===classification,'Assigned native piping system type/classification is unknown or mismatched.');
  requireEvidence(finite(op.diameterMm)&&op.diameterMm>0&&finite(pipe.piping.diameterMm)&&pipe.piping.diameterMm>0&&
    Math.abs(pipe.piping.diameterMm-op.diameterMm)<=toleranceMm,'Native diameter differs from the reviewed millimetres.');
  const line=pipe.summary.location;
  requireEvidence(line?.kind==='curve'&&line.curveType==='Line'&&distance(line.start,op.start)<=toleranceMm&&
    distance(line.end,op.end)<=toleranceMm,'Native directed line endpoints differ from the reviewed absolute XYZ.');
  requireEvidence(Array.isArray(pipe.connectors)&&pipe.connectors.every(port=>port&&typeof port==='object'&&!Array.isArray(port)),
    'Native connector records are missing or malformed.');
  const ends=pipe.connectors.filter(port=>port.connectorType==='End');
  requireEvidence(ends.length===2&&new Set(ends.map(port=>port.connectorId)).size===2&&ends.every(port=>
    Number.isSafeInteger(port.connectorId)&&port.connectorId>=0&&port.domainSupported===true&&port.domain==='DomainPiping'&&
    port.shapeSupported===true&&port.shape==='Round'&&port.originSupported===true),'Native physical end-port evidence is incomplete.');
  const starts=ends.filter(port=>distance(port,op.start)<=toleranceMm),finishes=ends.filter(port=>distance(port,op.end)<=toleranceMm);
  requireEvidence(starts.length===1&&finishes.length===1&&starts[0].connectorId!==finishes[0].connectorId,
    'Physical connector origins do not match both reviewed endpoints.');
  const counts=beforeContext.counts,current=afterContext.counts;
  requireEvidence(counts&&current&&!Array.isArray(counts)&&!Array.isArray(current)&&
    Number.isSafeInteger(counts.OST_PipeCurves)&&counts.OST_PipeCurves>=0&&
    Object.values(counts).every(value=>Number.isSafeInteger(value)&&value>=0)&&
    Object.values(current).every(value=>Number.isSafeInteger(value)&&value>=0),'Native model counts are unknown.');
  const expected={...counts,OST_PipeCurves:counts.OST_PipeCurves+1};
  requireEvidence(Object.keys(expected).length===Object.keys(current).length&&Object.entries(expected).every(([key,value])=>current[key]===value),
    'Model counts do not match one added pipe without unrelated category changes.');
  return {status:'SINGLE_PIPE_ROUTE_CREATION_VERIFIED',pipeId:id,pipeTypeId:op.pipeTypeId,systemTypeId:op.systemTypeId,
    systemClassification:classification,levelId:op.levelId,diameterMm:pipe.piping.diameterMm,lengthMm:distance(line.start,line.end),
    connectorIds:{start:starts[0].connectorId,end:finishes[0].connectorId},
    endpointConnections:{start:connection(starts[0]),end:connection(finishes[0])},
    nativeCaptureComplete:typeof changes.captureComplete==='boolean'?changes.captureComplete:null,
    scope:'One native pipe geometry, assigned type/classification, endpoints and category deltas only.',
    automaticSave:false,hydraulicDirectionVerified:false,engineeringComplianceVerified:false,allModelSideEffectsVerified:false};
}
