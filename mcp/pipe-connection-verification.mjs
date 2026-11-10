import {isDeepStrictEqual} from 'node:util';

const toleranceMm = 0.01;
const id = value => Number.isSafeInteger(value) && value > 0;
const portId = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textValue = value => typeof value === 'string' && value.trim().length > 0;
const ids = value => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
const sorted = values => [...values].sort((a,b) => a-b);
function requireEvidence(condition,message) {
  if (!condition) throw Object.assign(new Error(message),{code:'pipe_connection_not_verified'});
}
function distance(a,b) {
  return ['xMm','yMm','zMm'].every(axis => finite(a?.[axis]) && finite(b?.[axis]))
    ? Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm) : Infinity;
}
function peersEqual(a,b) {
  const valid = peers => Array.isArray(peers) && peers.every(p => id(p?.elementId) && portId(p.connectorId));
  const keys = peers => peers.map(p => p.elementId+':'+p.connectorId).sort();
  return valid(a) && valid(b) && isDeepStrictEqual(keys(a),keys(b));
}
function document(context) {
  const doc = context?.document;
  requireEvidence(context?.active === true && textValue(doc?.identity) && textValue(doc.path) &&
    Number.isSafeInteger(doc.revision) && doc.revision >= 0 && typeof doc.isModified === 'boolean',
  'Native context lacks a known active identity, path, revision or saved state.');
  return doc;
}
function selection(op,side) {
  const idKey = side+'ConnectorId', criteriaKey = side+'Connector';
  const hasId = Object.hasOwn(op,idKey), hasCriteria = Object.hasOwn(op,criteriaKey);
  requireEvidence(hasId !== hasCriteria,'Require exactly one connector ID or criteria for '+side+'.');
  if (hasId) {
    requireEvidence(portId(op[idKey]),'Invalid reviewed connector ID.');
    return {id:op[idKey]};
  }
  const c = op[criteriaKey];
  requireEvidence(record(c) && Object.keys(c).length === 4 &&
    Object.keys(c).every(key => ['domain','shape','point','toleranceMm'].includes(key)) &&
    c.domain === 'DomainPiping' && c.shape === 'Round' && record(c.point) &&
    Object.keys(c.point).length === 3 && ['xMm','yMm','zMm'].every(axis => finite(c.point[axis])) &&
    finite(c.toleranceMm) && c.toleranceMm > 0 && c.toleranceMm <= 10000,
  'Reviewed connector criteria are incomplete or unsupported.');
  return {criteria:c};
}
function operation(plan) {
  requireEvidence(textValue(plan?.planId) && textValue(plan.documentIdentity) &&
    Number.isSafeInteger(plan.documentRevision) && plan.documentRevision >= 0 &&
    Array.isArray(plan.operations) && plan.operations.length === 1 &&
    plan.operations[0]?.operationType === 'connect_elements',
  'Require one reviewed connect_elements operation with its original document pin.');
  const op = plan.operations[0];
  requireEvidence(['supply','return','neutral'].includes(op.flowIntent) &&
    id(op.firstElementId) && id(op.secondElementId) && op.firstElementId !== op.secondElementId,
  'Require explicit intent and two distinct pipe IDs.');
  return {op,first:selection(op,'first'),second:selection(op,'second')};
}
function ends(pipe,expectedId) {
  const s = pipe?.summary, p = pipe?.piping, line = s?.location;
  requireEvidence(s?.id === expectedId && textValue(s.uniqueId) && s.className === 'Pipe' &&
    s.categoryId === -2008044 && id(s.typeId) && id(s.levelId) &&
    line?.kind === 'curve' && line.curveType === 'Line' &&
    finite(distance(line.start,line.end)) && distance(line.start,line.end) > toleranceMm &&
    id(p?.systemTypeId) && textValue(p.systemClassification) &&
    !/^(unknown|undefined|invalid)/i.test(p.systemClassification) && finite(p.diameterMm) && p.diameterMm > 0,
  'Native pipe identity, type, level, geometry or assigned system evidence is incomplete.');
  requireEvidence(Array.isArray(pipe.connectors) && pipe.connectors.every(record),'Malformed native connector records.');
  const ports = pipe.connectors.filter(c => c.connectorType === 'End');
  requireEvidence(ports.length === 2 && new Set(ports.map(c => c.connectorId)).size === 2 &&
    ports.every(c => c.elementId === expectedId && portId(c.connectorId) &&
      c.domainSupported === true && c.domain === 'DomainPiping' &&
      c.shapeSupported === true && c.shape === 'Round' && c.originSupported === true &&
      finite(distance(c,line.start)) && c.connectionStatusSupported === true && typeof c.connected === 'boolean' &&
      c.peerReferencesSupported === true && peersEqual(c.peers,c.peers) && c.connected === (c.peers.length > 0)),
  'Both physical endpoints require known origin, connection state and valid peer records.');
  requireEvidence(ports.filter(c => distance(c,line.start) <= toleranceMm).length === 1 &&
    ports.filter(c => distance(c,line.end) <= toleranceMm).length === 1,
  'Physical connector origins do not match both native line endpoints.');
  return ports;
}
function select(ports,selector) {
  const matches = ports.filter(c => selector.id !== undefined ? c.connectorId === selector.id :
    distance(c,selector.criteria.point) <= selector.criteria.toleranceMm);
  requireEvidence(matches.length === 1,'Native connector selection is missing or ambiguous.');
  return matches[0];
}
function samePipe(a,b) {
  return a.summary.uniqueId === b.summary.uniqueId && a.summary.typeId === b.summary.typeId &&
    a.summary.levelId === b.summary.levelId &&
    distance(a.summary.location.start,b.summary.location.start) <= toleranceMm &&
    distance(a.summary.location.end,b.summary.location.end) <= toleranceMm &&
    a.piping.systemTypeId === b.piping.systemTypeId && a.piping.systemClassification === b.piping.systemClassification &&
    Math.abs(a.piping.diameterMm-b.piping.diameterMm) <= toleranceMm;
}
function relation(plan,firstPipe,secondPipe,diagnostic,doc) {
  const reviewed = operation(plan), {op} = reviewed;
  const a = select(ends(firstPipe,op.firstElementId),reviewed.first);
  const b = select(ends(secondPipe,op.secondElementId),reviewed.second);
  requireEvidence(a.connected && b.connected &&
    peersEqual(a.peers,[{elementId:op.secondElementId,connectorId:b.connectorId}]) &&
    peersEqual(b.peers,[{elementId:op.firstElementId,connectorId:a.connectorId}]),
  'Connection requires reciprocal native peer evidence.');
  requireEvidence(distance(a,b) <= toleranceMm &&
    firstPipe.piping.systemTypeId === secondPipe.piping.systemTypeId &&
    firstPipe.piping.systemClassification === secondPipe.piping.systemClassification &&
    Math.abs(firstPipe.piping.diameterMm-secondPipe.piping.diameterMm) <= toleranceMm,
  'Connected ports disagree on position, diameter or assigned system.');
  const system = diagnostic?.system, element = system?.element, members = diagnostic?.members;
  requireEvidence(diagnostic?.documentIdentity === doc.identity && diagnostic.documentRevision === doc.revision &&
    element?.className === 'PipingSystem' && id(element.id) && element.typeId === firstPipe.piping.systemTypeId &&
    system.networkSupported === true && ids(system.memberIds) && system.memberCount === system.memberIds.length &&
    Array.isArray(members) && ids(members.map(m => m?.element?.id)) &&
    isDeepStrictEqual(sorted(system.memberIds),sorted(members.map(m => m.element.id))),
  'Require a complete native system diagnostic pinned to the readback document/revision.');
  for (const [pipe,port] of [[firstPipe,a],[secondPipe,b]]) {
    const member = members.find(m => m.element.id === pipe.summary.id);
    requireEvidence(member?.element?.className === 'Pipe' && member.element.typeId === pipe.summary.typeId &&
      member.element.uniqueId === pipe.summary.uniqueId &&
      distance(member.location?.start,pipe.summary.location.start) <= toleranceMm &&
      distance(member.location?.end,pipe.summary.location.end) <= toleranceMm && Array.isArray(member.connectors),
    'Both pipes must occur in the pinned native system network with matching geometry.');
    const matches = member.connectors.filter(c => c?.connectorId === port.connectorId);
    requireEvidence(matches.length === 1 && matches[0].elementId === pipe.summary.id &&
      matches[0].connected === true && matches[0].peersSupported === true && peersEqual(matches[0].peers,port.peers),
    'System diagnostic and inspection disagree about the reviewed connection.');
  }
  return {connectedElementIds:[op.firstElementId,op.secondElementId],connectorIds:{first:a.connectorId,second:b.connectorId},
    reciprocalPeersVerified:true,systemId:element.id,systemTypeId:element.typeId,systemMemberIds:sorted(system.memberIds),
    sideEffectsVerified:false,hydraulicDirectionVerified:false,engineeringComplianceVerified:false,automaticSave:false};
}

// Frozen native evidence only. Reported event IDs never certify complete model side effects.
export function verifySinglePipeConnection({plan,receipt,beforeContext,afterContext,
  beforeFirstPipe,beforeSecondPipe,firstPipe,secondPipe,systemDiagnostic}) {
  const reviewed = operation(plan), {op} = reviewed;
  const before = document(beforeContext), after = document(afterContext);
  requireEvidence(before.identity === plan.documentIdentity && after.identity === before.identity &&
    before.path === after.path && before.revision === plan.documentRevision && before.isModified === false &&
    after.revision > before.revision,'Connection evidence belongs to a different session or revision.');
  requireEvidence(receipt?.planId === plan.planId && receipt.status === 'committed' && receipt.completedOperationCount === 1 &&
    receipt.saved === false && receipt.automaticSave !== true &&
    Array.isArray(receipt.createdElementIds) && receipt.createdElementIds.length === 0,'Invalid single connection commit receipt.');
  const changes = receipt.nativeChanges;
  requireEvidence(changes?.documentIdentity === before.identity && changes.startRevision === before.revision &&
    changes.endRevision === after.revision && changes.executionOutcome === 'committed' &&
    ids(changes.observedAddedElementIds) && ids(changes.observedModifiedElementIds) && ids(changes.observedDeletedElementIds) &&
    [op.firstElementId,op.secondElementId].every(value => changes.observedModifiedElementIds.includes(value) &&
      !changes.observedAddedElementIds.includes(value) && !changes.observedDeletedElementIds.includes(value)),
  'Native change envelope does not match the committed connection.');
  const prior = [select(ends(beforeFirstPipe,op.firstElementId),reviewed.first),
    select(ends(beforeSecondPipe,op.secondElementId),reviewed.second)];
  const result = relation(plan,firstPipe,secondPipe,systemDiagnostic,after);
  requireEvidence(prior.every(c => !c.connected && c.peers.length === 0),'Both prewrite endpoints must be known unconnected.');
  requireEvidence(prior[0].connectorId === result.connectorIds.first && prior[1].connectorId === result.connectorIds.second &&
    samePipe(beforeFirstPipe,firstPipe) && samePipe(beforeSecondPipe,secondPipe),
  'Pipe identity, type, level, geometry or selected connector identity changed.');
  for (const [a,b,selected] of [[beforeFirstPipe,firstPipe,prior[0]],[beforeSecondPipe,secondPipe,prior[1]]]) {
    const old = a.connectors.find(c => c.connectorType === 'End' && c.connectorId !== selected.connectorId);
    const now = b.connectors.find(c => c.connectorType === 'End' && c.connectorId === old.connectorId);
    requireEvidence(old.connected === now?.connected && peersEqual(old.peers,now?.peers),'An unselected endpoint changed.');
  }
  return {...result,status:'SINGLE_PIPE_CONNECTION_NATIVE_VERIFIED',planId:plan.planId,
    geometryAndAssignedPipeStateUnchanged:true,persistenceVerified:false,
    nativeChanges:{addedElementIds:[...changes.observedAddedElementIds],modifiedElementIds:[...changes.observedModifiedElementIds],
      deletedElementIds:[...changes.observedDeletedElementIds],captureComplete:typeof changes.captureComplete === 'boolean' ? changes.captureComplete : null,
      netModelDiffVerified:false,noAddedElementsObserved:changes.observedAddedElementIds.length === 0},
    scope:'One direct pipe connection, unchanged primary pipe state and pinned system network only.'};
}

// Separately verifies the captured relation after reopen; cannot reconstruct missing historical prewrite snapshots.
export function verifyPipeConnectionPersistence({plan,savedDocument,savedConnection,beforeContext,afterContext,
  firstPipe,secondPipe,systemDiagnostic}) {
  operation(plan);
  const before = document(beforeContext), after = document(afterContext);
  requireEvidence(before.identity === after.identity && before.path === after.path && before.revision === after.revision &&
    before.isModified === after.isModified,'Document changed during the read-only persistence capture.');
  requireEvidence(textValue(savedDocument?.identity) && savedDocument.identity === plan.documentIdentity &&
    savedDocument.path === after.path && savedDocument.isModified === false && Number.isSafeInteger(savedDocument.revision) &&
    savedDocument.revision > plan.documentRevision && after.identity !== savedDocument.identity &&
    after.revision === 0 && after.isModified === false,'Require a distinct unmodified reopened session at the saved path.');
  const result = relation(plan,firstPipe,secondPipe,systemDiagnostic,after);
  const pair = result.connectedElementIds, ports = result.connectorIds;
  requireEvidence(savedConnection?.firstElementId === pair[0] && savedConnection.secondElementId === pair[1] &&
    savedConnection.firstConnectorId === ports.first && savedConnection.secondConnectorId === ports.second &&
    savedConnection.firstConnected === true && savedConnection.secondConnected === true &&
    peersEqual(savedConnection.firstPeers,[{elementId:pair[1],connectorId:ports.second}]) &&
    peersEqual(savedConnection.secondPeers,[{elementId:pair[0],connectorId:ports.first}]),
  'Reopened relation differs from the captured saved connection.');
  return {...result,status:'PIPE_CONNECTION_RELATION_PERSISTENCE_VERIFIED',planId:plan.planId,
    documentIdentity:after.identity,documentRevision:after.revision,persistenceVerified:true,
    fullSnapshotPersistenceVerified:false,scope:'Only the captured connector relation persisted; current pinned system network independently read.'};
}
