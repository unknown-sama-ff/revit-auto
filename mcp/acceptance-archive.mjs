import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TYPES = ['manifest', 'baseline', 'preview', 'confirmation', 'attempt', 'execution', 'readback', 'saved', 'reopen', 'visual', 'summary'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mvid = plugin => plugin?.mvid ?? plugin?.moduleVersionId;
const sessionDocument = session => session?.document ?? session;

// This checks archived bindings and bytes only. No bridge imports, repairs,
// model queries or promotion of the archive's claimed acceptance decisions.
export function auditAcceptanceRun({ repoRoot, runId }) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new Error('runId must be a UUIDv7.');
  const runsRoot = path.resolve(repoRoot, 'acceptance', 'runs');
  const directory = path.join(runsRoot, runId);
  const findings = [], limitations = [], artifactHashes = {}, artifacts = {};
  const issue = (code, file, message) => findings.push({ code, file, message });
  const limited = (code, message) => limitations.push({ code, message });
  function safeFile(root, reference) {
    if (typeof reference !== 'string' || !reference || reference.includes('\\') || reference.includes(':') ||
        reference.includes('\0') || reference.startsWith('/') || reference.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('unsafe-artifact-reference');
    }
    const candidate = path.resolve(root, reference);
    const resolvedRoot = fs.realpathSync(root);
    const resolved = fs.realpathSync(candidate);
    const relative = path.relative(resolvedRoot, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('unsafe-artifact-reference');
    if (!fs.statSync(resolved).isFile()) throw new Error('artifact-not-a-file');
    return resolved;
  }
  function bytes(root, file) {
    try { return fs.readFileSync(safeFile(root, file)); }
    catch (error) {
      issue(error.message === 'unsafe-artifact-reference' ? error.message : 'artifact-unreadable', file,
        error.code ?? error.message);
      return null;
    }
  }
  // A linked run directory must not redirect the audit into private runtime data.
  const realRuns = fs.realpathSync(runsRoot);
  const realRun = fs.realpathSync(directory);
  if (path.dirname(realRun) !== realRuns) throw new Error('Run directory escaped acceptance/runs.');
  for (const type of TYPES) {
    const file = `${type}.json`, content = bytes(directory, file);
    if (!content) continue;
    artifactHashes[file] = hash(content);
    try {
      const value = JSON.parse(content.toString('utf8'));
      if (!object(value)) throw new Error('Artifact must be a JSON object.');
      artifacts[type] = value;
      // Older attempt markers used artifactType=execution. The explicit
      // attempt phase is canonical now; both still require every binding.
      const typeMatches = type === 'attempt' ? ['attempt', 'execution'].includes(value.artifactType) : value.artifactType === type;
      if (value.schemaVersion !== 1 || value.runId !== runId || !typeMatches) {
        issue('artifact-binding-mismatch', file, 'schemaVersion, runId or artifactType differs from this run.');
      }
    } catch (error) { issue('artifact-unreadable', file, error.message); }
  }
  const { manifest, baseline, preview, confirmation, attempt, execution, readback, saved, reopen, visual, summary } = artifacts;
  const taskId = manifest?.taskId;
  for (const [type, value] of Object.entries(artifacts)) {
    if (typeof taskId !== 'string' || !taskId || value.taskId !== taskId) issue('artifact-binding-mismatch', `${type}.json`, 'taskId differs from the manifest.');
    if (type !== 'attempt' && (typeof value.capturedAtUtc !== 'string' || !Number.isFinite(Date.parse(value.capturedAtUtc)) || !value.capturedAtUtc.endsWith('Z'))) {
      issue('artifact-time-invalid', `${type}.json`, 'A finite UTC capture timestamp is required.');
    }
  }
  const sourceHashes = summary?.sourceArtifactHashes;
  if (!object(sourceHashes)) issue('source-hashes-missing', 'summary.json', 'Source artifact hashes are required.');
  else {
    for (const [reference, expected] of Object.entries(sourceHashes)) {
      const content = bytes(directory, reference);
      if (content && (!SHA256.test(expected) || hash(content) !== expected)) issue('source-hash-mismatch', reference, 'Current file bytes differ from the summary digest.');
    }
    for (const file of Object.keys(artifactHashes).filter(file => file !== 'summary.json')) {
      if (!Object.hasOwn(sourceHashes, file)) issue('source-hash-missing', file, 'Summary does not bind this artifact by hash.');
    }
  }
  const equal = (actual, expected, code, file, field) => {
    if (actual === undefined || expected === undefined || actual !== expected) issue(code, file, `${field} differs from its source artifact.`);
  };
  const planId = preview?.planId;
  if (typeof planId !== 'string' || !planId) issue('plan-binding-mismatch', 'preview.json', 'An explicit planId is required.');
  for (const type of ['manifest', 'confirmation', 'attempt', 'execution', 'readback', 'reopen', 'visual']) {
    equal(artifacts[type]?.planId, planId, 'plan-binding-mismatch', `${type}.json`, 'planId');
  }
  if (!object(execution?.receipt)) issue('execution-receipt-missing', 'execution.json', 'A native receipt is required.');
  else {
    equal(execution.receipt.planId, planId, 'plan-binding-mismatch', 'execution.json', 'receipt.planId');
    if (execution.receipt.status !== 'committed') issue('execution-not-committed', 'execution.json', 'This audit profile requires a committed single write run.');
  }
  equal(execution?.attemptId, attempt?.attemptId, 'attempt-binding-mismatch', 'execution.json', 'attemptId');
  if (attempt?.artifactType === 'attempt' && attempt.reservedAction !== 'revit.plan.confirm') {
    issue('attempt-action-invalid', 'attempt.json', 'Canonical attempt must reserve exactly revit.plan.confirm.');
  }
  for (const [file, count] of [['confirmation.json', confirmation?.confirmCalls], ['attempt.json', attempt?.confirmCalls],
    ['execution.json', execution?.sideEffectCounters?.confirmCalls], ['summary.json', summary?.acceptance?.confirmCalls]]) {
    if (count !== 1) issue('confirm-count-mismatch', file, 'Committed write acceptance requires exactly one recorded confirmation.');
  }
  if (object(preview?.preview)) {
    if (preview.previewDigestScope !== undefined && preview.previewDigestScope !== 'native-preview-pretty-json-v1') {
      issue('preview-digest-scope-invalid', 'preview.json', 'Declared preview digest scope is not the native payload profile.');
    }
    const digest = hash(JSON.stringify(preview.preview, null, 2));
    for (const [file, value] of [['preview.json', preview], ['confirmation.json', confirmation], ['attempt.json', attempt]]) {
      equal(value?.previewSha256, digest, 'preview-hash-mismatch', file, 'previewSha256');
    }
    equal(preview.preview.planId, planId, 'plan-binding-mismatch', 'preview.json', 'preview.planId');
    equal(preview.preview.documentIdentity, baseline?.document?.identity, 'preview-identity-mismatch', 'preview.json', 'preview.documentIdentity');
    equal(preview.preview.documentRevision, baseline?.document?.revision, 'preview-revision-mismatch', 'preview.json', 'preview.documentRevision');
  } else issue('preview-missing', 'preview.json', 'The complete native preview is required.');
  const origin = baseline?.document;
  for (const [file, document] of [['preview.json', preview?.document], ['confirmation.json', confirmation?.document],
    ['attempt.json', attempt?.document], ['execution.json', execution?.documentBefore]]) {
    equal(document?.revision, origin?.revision, file === 'confirmation.json' ? 'confirmation-revision-mismatch' : 'preview-revision-mismatch', file, 'document.revision');
  }
  const expiry = preview?.expiresAtUtc ?? preview?.preview?.expiresAtUtc;
  if (expiry !== undefined) {
    const expiresAt = Date.parse(expiry), confirmedAt = Date.parse(confirmation?.capturedAtUtc);
    if (!Number.isFinite(expiresAt) || typeof expiry !== 'string' || !expiry.endsWith('Z')) issue('preview-expiry-invalid', 'preview.json', 'Historical expiry must be an explicit UTC timestamp.');
    else if (Number.isFinite(confirmedAt) && confirmedAt >= expiresAt) issue('confirmation-after-expiry', 'confirmation.json', 'Recorded confirmation occurred after the original preview expiry.');
  }
  for (const [file, document] of [['baseline.json', origin], ['manifest.json', manifest?.document], ['preview.json', preview?.document],
    ['confirmation.json', confirmation?.document], ['attempt.json', attempt?.document], ['execution.json', execution?.documentBefore], ['readback.json', readback?.document]]) {
    equal(document?.identity, origin?.identity, 'document-identity-mismatch', file, 'document.identity');
    equal(document?.path, origin?.path, 'document-path-mismatch', file, 'document.path');
    if (!Number.isSafeInteger(document?.revision) || document.revision < 0) issue('document-revision-invalid', file, 'A nonnegative revision is required.');
  }
  equal(reopen?.previousSession?.documentIdentity, readback?.document?.identity, 'previous-session-identity-mismatch', 'reopen.json', 'previousSession.documentIdentity');
  equal(reopen?.previousSession?.revision, readback?.document?.revision, 'previous-session-revision-mismatch', 'reopen.json', 'previousSession.revision');
  equal(reopen?.previousSession?.path, origin?.path, 'document-path-mismatch', 'reopen.json', 'previousSession.path');
  const reopened = sessionDocument(reopen?.currentSession);
  for (const [file, document] of [['reopen.json', reopened], ['visual.json', visual?.document]]) {
    equal(document?.path, origin?.path, 'document-path-mismatch', file, 'reopened document.path');
    if (typeof document?.identity !== 'string' || !document.identity || document.identity === origin?.identity) issue('reopened-session-invalid', file, 'Reopen requires a new nonblank session identity.');
    if (document?.isModified !== false) issue('reopened-session-invalid', file, 'Reopened saved-state evidence is missing or modified.');
    if (document?.revision !== 0) issue('reopened-session-invalid', file, 'The first clean reopened snapshot must have revision zero.');
  }
  equal(saved?.document?.path, origin?.path, 'document-path-mismatch', 'saved.json', 'document.path');
  if (![origin?.identity, reopened?.identity].filter(Boolean).includes(saved?.document?.identity)) {
    issue('saved-session-mismatch', 'saved.json', 'Saved evidence belongs to neither the execution session nor its reopened session.');
  }
  if (saved?.manualSaveConfirmed !== true || saved?.document?.isModified !== false) issue('saved-state-invalid', 'saved.json', 'Manual save confirmation and an unmodified snapshot are required.');
  equal(saved?.document?.revision, saved?.document?.identity === origin?.identity ? readback?.document?.revision : reopened?.revision,
    'saved-revision-mismatch', 'saved.json', 'document.revision');
  equal(visual?.document?.identity, reopened?.identity, 'visual-session-mismatch', 'visual.json', 'document.identity');
  const expectedMvid = mvid(baseline?.plugin);
  if (typeof expectedMvid !== 'string' || !expectedMvid) issue('plugin-mvid-missing', 'baseline.json', 'A plugin MVID is required.');
  for (const [file, plugin] of [['manifest.json', manifest?.plugin], ['preview.json', preview?.plugin], ['readback.json', readback?.plugin],
    ['reopen.json', reopen?.currentSession?.plugin ?? reopen?.currentSession], ['visual.json', visual?.plugin]]) {
    equal(mvid(plugin), expectedMvid, 'plugin-mvid-mismatch', file, 'plugin MVID');
  }
  const beforeRun = visual?.comparison?.sourceBeforeRunId;
  if (beforeRun !== undefined) {
    if (!RUN_ID.test(beforeRun)) issue('visual-source-run-invalid', 'visual.json', 'Visual source must name a UUIDv7 run.');
    else if (beforeRun === runId) equal(visual.comparison.sourceBeforeDocumentIdentity, origin?.identity, 'visual-source-identity-mismatch', 'visual.json', 'comparison.sourceBeforeDocumentIdentity');
    else {
      const content = bytes(runsRoot, `${beforeRun}/reopen.json`);
      try {
        const source = content && JSON.parse(content.toString('utf8'));
        if (!source || source.runId !== beforeRun || source.taskId !== taskId) throw new Error('Visual source run binding is invalid.');
        const sourceDocument = sessionDocument(source.currentSession);
        equal(sourceDocument?.path, origin?.path, 'document-path-mismatch', 'visual.json', 'source run document.path');
        equal(visual.comparison.sourceBeforeDocumentIdentity, sourceDocument?.identity, 'visual-source-identity-mismatch', 'visual.json', 'comparison.sourceBeforeDocumentIdentity');
      } catch (error) { issue('visual-source-unreadable', 'visual.json', error.message); }
    }
  }
  if (!Array.isArray(visual?.images)) issue('visual-metadata-invalid', 'visual.json', 'images must be an explicit array.');
  for (const image of Array.isArray(visual?.images) ? visual.images : []) {
    const content = bytes(directory, image?.file);
    if (content && (hash(content) !== image.sha256 || content.length !== image.bytes || content.length < 24 ||
        content.subarray(0, 16).toString('hex') !== '89504e470d0a1a0a0000000d49484452' ||
        content.readUInt32BE(16) !== image.widthPixels || content.readUInt32BE(20) !== image.heightPixels)) {
      issue('image-mismatch', image.file, 'PNG hash, size, signature or dimensions differ from the visual record.');
    }
  }
  if (saved?.verification?.preCloseMachineSaveStateCaptured === false) limited('preclose-save-snapshot-missing', 'User save confirmation and reopened state do not supply an independent machine snapshot before closing.');
  if (reopen?.inspectionScope?.fullRawReopenedInspectionSnapshotArchived === false) limited('full-reopened-snapshot-missing', 'The reported full native comparison cannot be rerun without the raw reopened snapshot.');
  if (!visual?.images?.length) limited('visual-files-empty', 'No visual image files are available to audit.');
  limited('archive-only', 'Bindings and PNG headers are checked offline; this does not inspect Revit, decode PNG pixels, prove model side effects, validate current plan eligibility or upgrade acceptance.');
  return { schemaVersion: 1, auditProfile: 'committed-write-archive-bindings', runId, taskId, archiveConsistent: findings.length === 0, findings, limitations, artifactHashes,
    claimedCurrentState: summary?.currentState ?? null, acceptanceStatesChanged: false, modelWritesRequested: false,
    automaticSave: false, automaticRestart: false };
}
