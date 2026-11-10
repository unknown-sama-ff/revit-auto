import { createHash } from 'node:crypto';

// Data producers only: no filesystem, bridge, chat approval, execution lease,
// confirmation call, model mutation or acceptance-state promotion happens here.
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TASK_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const MVID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const STATES = new Set(['contract-ready', 'core-tested', 'compiled', 'readonly-accepted', 'preview-accepted', 'write-accepted', 'persistence-accepted', 'visual-accepted', 'blocked']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const digest = value => createHash('sha256').update(JSON.stringify(value, null, 2)).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const safeReference = file => text(file) && !file.includes('\\') && !file.includes(':') && !file.includes('\0') &&
  !file.startsWith('/') && !file.split('/').some(part => !part || part === '.' || part === '..');

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonCopy(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  requireValue((Array.isArray(value) || object(value)) && !ancestors.has(value), 'Evidence must be complete finite JSON without cycles.');
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) requireValue(Object.hasOwn(value, index), 'Evidence arrays must not contain missing entries.');
  }
  ancestors.add(value);
  const copy = Array.isArray(value) ? value.map(item => jsonCopy(item, ancestors))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonCopy(item, ancestors)]));
  ancestors.delete(value);
  return copy;
}

function utc(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), 'Require an explicit valid UTC timestamp.');
  return value;
}

function identity(record, type) {
  requireValue(object(record) && record.schemaVersion === 1 && record.artifactType === type &&
    RUN_ID.test(record.runId) && TASK_ID.test(record.taskId), `Invalid ${type} record identity.`);
  utc(record.capturedAtUtc);
}

function sameRun(left, right) {
  requireValue(left.runId === right.runId && left.taskId === right.taskId, 'Evidence run/task bindings differ.');
}

function pluginRecord(plugin) {
  requireValue(object(plugin), 'Plugin identity is required.');
  const mvid = plugin.mvid ?? plugin.moduleVersionId;
  requireValue(typeof mvid === 'string' && MVID.test(mvid), 'Plugin MVID is required.');
  requireValue(plugin.mvid === undefined || plugin.moduleVersionId === undefined || plugin.mvid.toLowerCase() === plugin.moduleVersionId.toLowerCase(), 'Conflicting plugin MVID fields.');
  return { ...jsonCopy(plugin), mvid };
}

function documentRecord(document) {
  requireValue(object(document) && text(document.identity) && text(document.path) && Number.isSafeInteger(document.revision) && document.revision >= 0 &&
    typeof document.isModified === 'boolean', 'Document path, identity, revision and saved state are required.');
  return jsonCopy(document);
}

function sameDocument(actual, expected) {
  documentRecord(actual); documentRecord(expected);
  for (const field of ['identity', 'revision', 'path', 'isModified']) requireValue(actual[field] === expected[field], `Document ${field} binding differs.`);
}

function stage(type, source, capturedAtUtc) {
  utc(capturedAtUtc);
  requireValue(Date.parse(capturedAtUtc) >= Date.parse(source.capturedAtUtc), 'Stage timestamp precedes its source evidence.');
  return { schemaVersion: 1, artifactType: type, runId: source.runId, taskId: source.taskId, capturedAtUtc, status: 'captured' };
}

function checkedPreview(preview) {
  identity(preview, 'preview');
  requireValue(object(preview.preview) && preview.previewDigestScope === 'native-preview-pretty-json-v1' && preview.previewSha256 === digest(preview.preview), 'Native preview payload or its declared digest differs.');
  requireValue(preview.planId === preview.preview.planId && preview.preview.documentIdentity === preview.document.identity && preview.preview.documentRevision === preview.document.revision, 'Native preview document/plan binding differs.');
  requireValue(preview.expiresAtUtc === preview.preview.expiresAtUtc && preview.preview.status === 'pending', 'Require an unchanged pending native preview.');
  utc(preview.expiresAtUtc); documentRecord(preview.document); pluginRecord(preview.plugin);
}

function beforeExpiry(preview, capturedAtUtc) {
  utc(capturedAtUtc);
  requireValue(Date.parse(capturedAtUtc) < Date.parse(preview.expiresAtUtc), 'Preview had expired at the recorded stage time.');
}

export function createPreviewEvidence({ manifest, baseline, nativePreview, capturedAtUtc = new Date().toISOString() }) {
  identity(manifest, 'manifest'); identity(baseline, 'baseline'); sameRun(manifest, baseline);
  requireValue(baseline.status === 'accepted' && baseline.document?.isModified === false, 'Require an accepted saved read-only baseline.');
  const document = documentRecord(baseline.document), plugin = pluginRecord(baseline.plugin), preview = jsonCopy(nativePreview);
  if (manifest.document !== null && manifest.document !== undefined) sameDocument(manifest.document, document);
  if (manifest.plugin !== null && manifest.plugin !== undefined) requireValue(pluginRecord(manifest.plugin).mvid === plugin.mvid, 'Manifest and baseline modules differ.');
  requireValue(object(preview) && text(preview.planId) && preview.status === 'pending' && Array.isArray(preview.operations) && preview.operations.length > 0 &&
    Array.isArray(preview.warnings), 'Require a complete pending native preview with operations and warnings.');
  requireValue(preview.documentIdentity === document.identity && preview.documentRevision === document.revision, 'Native preview pins differ from the baseline.');
  utc(preview.expiresAtUtc);
  requireValue(manifest.planId === undefined || manifest.planId === preview.planId, 'Manifest already binds a different plan.');
  const record = { ...stage('preview', baseline, capturedAtUtc), document, plugin, planId: preview.planId, expiresAtUtc: preview.expiresAtUtc,
    preview, previewSha256: digest(preview), previewDigestScope: 'native-preview-pretty-json-v1' };
  beforeExpiry(record, capturedAtUtc);
  return { manifest: { ...jsonCopy(manifest), auditProfile: 'committed-write-archive-bindings', document, plugin, planId: preview.planId }, preview: record };
}

export function createConfirmationEvidence({ preview, approvedText, capturedAtUtc = new Date().toISOString() }) {
  checkedPreview(preview); beforeExpiry(preview, capturedAtUtc);
  requireValue(text(approvedText), 'Record the actual human chat approval text; do not infer approval.');
  return { ...stage('confirmation', preview, capturedAtUtc), document: jsonCopy(preview.document), plugin: jsonCopy(preview.plugin), planId: preview.planId,
    previewSha256: preview.previewSha256, previewDigestScope: preview.previewDigestScope, approvedText, confirmCalls: 1 };
}

export function createAttemptEvidence({ preview, confirmation, attemptId, capturedAtUtc = new Date().toISOString() }) {
  checkedPreview(preview); identity(confirmation, 'confirmation'); sameRun(preview, confirmation); beforeExpiry(preview, capturedAtUtc);
  requireValue(text(attemptId) && text(confirmation.approvedText) && confirmation.confirmCalls === 1 && confirmation.planId === preview.planId &&
    confirmation.previewSha256 === preview.previewSha256, 'Attempt requires one matching confirmation and an explicit attempt ID.');
  sameDocument(confirmation.document, preview.document);
  requireValue(pluginRecord(confirmation.plugin).mvid === preview.plugin.mvid, 'Confirmation plugin binding differs.');
  return { ...stage('attempt', confirmation, capturedAtUtc), status: 'initialized', document: jsonCopy(preview.document), plugin: jsonCopy(preview.plugin),
    planId: preview.planId, attemptId, previewSha256: preview.previewSha256, confirmCalls: 1, reservedAction: 'revit.plan.confirm' };
}

export function createExecutionEvidence({ preview, attempt, documentBefore, receipt, capturedAtUtc = new Date().toISOString() }) {
  checkedPreview(preview); identity(attempt, 'attempt'); sameRun(preview, attempt); sameDocument(documentBefore, preview.document);
  requireValue(text(attempt.attemptId) && attempt.planId === preview.planId && attempt.previewSha256 === preview.previewSha256 && attempt.confirmCalls === 1 &&
    attempt.reservedAction === 'revit.plan.confirm', 'Execution must bind the original single attempt.');
  sameDocument(attempt.document, preview.document);
  beforeExpiry(preview, attempt.capturedAtUtc);
  requireValue(pluginRecord(attempt.plugin).mvid === preview.plugin.mvid, 'Attempt plugin binding differs.');
  requireValue(object(receipt) && receipt.planId === preview.planId && ['committed', 'failed'].includes(receipt.status), 'Require the actual native receipt for this exact plan.');
  return { ...stage('execution', attempt, capturedAtUtc), planId: preview.planId, attemptId: attempt.attemptId, documentBefore: jsonCopy(documentBefore),
    plugin: jsonCopy(preview.plugin), receipt: jsonCopy(receipt), sideEffectCounters: { confirmCalls: 1, automaticRetries: 0, saveCalls: 0, restartCalls: 0 } };
}

export function describeEvidencePng({ file, content }) {
  requireValue(safeReference(file), 'PNG evidence reference must stay inside the run.');
  requireValue(Buffer.isBuffer(content) && content.length >= 24 && content.subarray(0, 16).toString('hex') === '89504e470d0a1a0a0000000d49484452', 'Require a complete PNG IHDR header.');
  const widthPixels = content.readUInt32BE(16), heightPixels = content.readUInt32BE(20);
  requireValue(widthPixels > 0 && heightPixels > 0, 'PNG dimensions must be positive.');
  return { file, bytes: content.length, widthPixels, heightPixels, sha256: createHash('sha256').update(content).digest('hex') };
}

export function createSummaryEvidence({ execution, currentState, acceptance, sourceArtifactHashes, capturedAtUtc = new Date().toISOString() }) {
  identity(execution, 'execution');
  requireValue(STATES.has(currentState) && object(acceptance) && object(sourceArtifactHashes) && Object.keys(sourceArtifactHashes).length > 0,
    'Require explicit acceptance decisions and source artifact hashes.');
  requireValue(execution.sideEffectCounters?.confirmCalls === 1 && execution.receipt?.planId === execution.planId && execution.receipt.status === 'committed' && text(execution.attemptId), 'Committed execution single-attempt evidence is required for this summary profile.');
  requireValue(acceptance.confirmCalls === undefined || acceptance.confirmCalls === 1, 'Conflicting acceptance confirmation count.');
  for (const [file, sha256] of Object.entries(sourceArtifactHashes)) requireValue(safeReference(file) && file !== 'summary.json' && typeof sha256 === 'string' && SHA256.test(sha256), 'Invalid source artifact reference or digest.');
  for (const field of ['readonlyAccepted', 'previewAccepted', 'writeAccepted', 'persistenceAccepted', 'visualAccepted', 'allModelSideEffectsVerified']) {
    requireValue(acceptance[field] === undefined || typeof acceptance[field] === 'boolean', `Acceptance ${field} must be an explicit boolean.`);
  }
  return { ...stage('summary', execution, capturedAtUtc), auditProfile: 'committed-write-archive-bindings', currentState,
    planId: execution.planId, acceptance: { ...jsonCopy(acceptance), confirmCalls: 1 }, sideEffectCounters: jsonCopy(execution.sideEffectCounters),
    sourceArtifactHashes: jsonCopy(sourceArtifactHashes) };
}
