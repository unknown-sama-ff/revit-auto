import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { auditAcceptanceRun } from '../acceptance-archive.mjs';
import { createRunScaffold } from '../acceptance-run.mjs';
import {
  createPreviewEvidence, createConfirmationEvidence, createAttemptEvidence,
  createExecutionEvidence, describeEvidencePng, createSummaryEvidence
} from '../acceptance-evidence.mjs';

const runId = '0199abcd-1234-7abc-8def-0123456789ab';
const taskId = 'architecture.rooms-enclosure-fixture';
const identity = { runId, taskId };
const capturedAtUtc = '2026-10-24T00:00:00.000Z';
const document = { path: 'D:\\acceptance\\isolated.rvt', identity: 'before-session', revision: 0, isModified: false };
const plugin = { moduleVersionId: '12345678-1234-1234-1234-123456789abc', pid: 12345 };
const stage = type => ({ schemaVersion: 1, artifactType: type, ...identity, capturedAtUtc, status: 'captured' });
const baseline = { ...stage('baseline'), status: 'accepted', document, plugin };
const manifest = { ...stage('manifest'), document, plugin, status: 'initialized' };
const nativePreview = { planId: 'native-plan', documentIdentity: document.identity, documentRevision: 0,
  status: 'pending', expiresAtUtc: '2026-10-24T02:00:00.000Z', operations: [{ operationType: 'create_wall' }], warnings: [] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const schema = JSON.parse(fs.readFileSync(new URL('../run-evidence.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateRecord = ajv.compile(schema);
const previewInput = () => ({ manifest: structuredClone(manifest), baseline: structuredClone(baseline), nativePreview: structuredClone(nativePreview), capturedAtUtc });
const confirmationFor = preview => createConfirmationEvidence({ preview, approvedText: '批准执行 native-plan', capturedAtUtc: '2026-10-24T00:01:00.000Z' });

test('shared producers create a complete archive that passes the unchanged binding checks', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-evidence-producer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs/capability-task-queue.json'), JSON.stringify({ schemaVersion: 1, tasks: [{ id: taskId, currentState: 'blocked' }] }));
  const scaffold = createRunScaffold({ repoRoot: root, taskId, clock: () => Date.parse(capturedAtUtc), idFactory: () => runId });
  const dir = scaffold.runDirectory;
  fs.mkdirSync(path.join(dir, 'visual'));
  const bound = createPreviewEvidence({ ...previewInput(), manifest: scaffold.manifest });
  const confirmation = confirmationFor(bound.preview);
  const attempt = createAttemptEvidence({ preview: bound.preview, confirmation, attemptId: 'exclusive-attempt', capturedAtUtc: '2026-10-24T00:01:01.000Z' });
  const execution = createExecutionEvidence({ preview: bound.preview, attempt, documentBefore: document,
    receipt: { planId: 'native-plan', status: 'committed' }, capturedAtUtc: '2026-10-24T00:01:02.000Z' });
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(png);
  png.writeUInt32BE(10, 16); png.writeUInt32BE(20, 20);
  fs.writeFileSync(path.join(dir, 'visual/test.png'), png);
  const image = describeEvidencePng({ file: 'visual/test.png', content: png });
  const reopened = { ...document, identity: 'reopened-session' };
  const after = { ...document, revision: 1, isModified: true };
  const files = {
    'manifest.json': bound.manifest, 'baseline.json': baseline, 'preview.json': bound.preview,
    'confirmation.json': confirmation, 'attempt.json': attempt, 'execution.json': execution,
    'readback.json': { ...stage('readback'), planId: 'native-plan', document: after, plugin, comparison: {} },
    'saved.json': { ...stage('saved'), manualSaveConfirmed: true, document: { ...after, isModified: false } },
    'reopen.json': { ...stage('reopen'), planId: 'native-plan', previousSession: { documentIdentity: document.identity, path: document.path, revision: 1 }, currentSession: { document: reopened, plugin }, comparison: {} },
    'visual.json': { ...stage('visual'), planId: 'native-plan', document: reopened, plugin, images: [image], reviewerDecision: 'accepted' }
  };
  files['baseline.json'] = { ...baseline, contract: {
    schemaVersion: 1,
    tools: [{ name: 'revit_search', annotations: { readOnlyHint: true, destructiveHint: false }, inputSchema: { type: 'object', properties: { documentIdentity: { type: 'string' }, expectedRevision: { type: 'integer' } } } }],
    sha256: hash('synthetic-contract-for-record-format-test')
  } };
  for (const [file, record] of Object.entries(files)) assert.equal(validateRecord(record), true, file + ': ' + JSON.stringify(validateRecord.errors));
  for (const [file, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
  const sourceArtifactHashes = Object.fromEntries(Object.keys(files).map(file => [file, hash(fs.readFileSync(path.join(dir, file)))]));
  const summary = createSummaryEvidence({ execution, currentState: 'blocked', acceptance: { allModelSideEffectsVerified: false, persistenceAccepted: true, visualAccepted: true }, sourceArtifactHashes, capturedAtUtc: '2026-10-24T00:02:00.000Z' });
  assert.equal(validateRecord(summary), true, JSON.stringify(validateRecord.errors));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  const before = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, hash(fs.readFileSync(path.join(dir, f)))]);
  const report = auditAcceptanceRun({ repoRoot: root, runId });
  assert.equal(report.archiveConsistent, true, JSON.stringify(report.findings));
  assert.equal(report.claimedCurrentState, 'blocked');
  assert.equal(report.acceptanceStatesChanged, false);
  assert.equal(summary.acceptance.allModelSideEffectsVerified, false);
  assert.equal(image.bytes, png.length);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, hash(fs.readFileSync(path.join(dir, f)))]), before);
});

test('preview digest has one explicit native-payload meaning and input objects are preserved', () => {
  const input = previewInput(), original = structuredClone(input);
  const result = createPreviewEvidence(input);
  assert.deepEqual(input, original);
  assert.deepEqual(result.preview.preview, nativePreview);
  assert.equal(result.preview.previewSha256, hash(JSON.stringify(nativePreview, null, 2)));
  assert.equal(result.preview.previewDigestScope, 'native-preview-pretty-json-v1');
  assert.equal(result.manifest.planId, nativePreview.planId);
});

test('stale native preview pins, module identity and mismatched manifest are rejected', () => {
  for (const mutate of [
    x => { x.nativePreview.documentIdentity = 'stale'; },
    x => { x.nativePreview.documentRevision++; },
    x => { x.nativePreview.status = 'committed'; },
    x => { x.manifest.taskId = 'other.task'; },
    x => { x.manifest.plugin.moduleVersionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; }
  ]) {
    const input = previewInput(); mutate(input);
    assert.throws(() => createPreviewEvidence(input));
  }
});

test('confirmation and attempts reject expired or altered previews and conflicting bindings', () => {
  const { preview } = createPreviewEvidence(previewInput());
  assert.throws(() => createConfirmationEvidence({ preview, approvedText: '批准', capturedAtUtc: nativePreview.expiresAtUtc }));
  const changed = structuredClone(preview); changed.preview.operations.push({ operationType: 'delete_element' });
  assert.throws(() => confirmationFor(changed));
  const confirmation = confirmationFor(preview);
  assert.throws(() => createAttemptEvidence({ preview, confirmation: { ...confirmation, planId: 'another-plan' }, attemptId: 'single', capturedAtUtc: '2026-10-24T00:01:01.000Z' }));
  assert.throws(() => createAttemptEvidence({ preview, confirmation: { ...confirmation, confirmCalls: 2 }, attemptId: 'single', capturedAtUtc: '2026-10-24T00:01:01.000Z' }));
});

test('execution rejects the wrong receipt or before-document and preserves a real failed receipt', () => {
  const { preview } = createPreviewEvidence(previewInput());
  const attempt = createAttemptEvidence({ preview, confirmation: confirmationFor(preview), attemptId: 'single', capturedAtUtc: '2026-10-24T00:01:01.000Z' });
  const input = { preview, attempt, documentBefore: document, receipt: { planId: 'native-plan', status: 'failed', rolledBack: true }, capturedAtUtc: '2026-10-24T00:01:02.000Z' };
  assert.equal(createExecutionEvidence(input).receipt.status, 'failed');
  assert.throws(() => createExecutionEvidence({ ...input, receipt: { planId: 'other', status: 'committed' } }));
  assert.throws(() => createExecutionEvidence({ ...input, documentBefore: { ...document, revision: 1 } }));
});

test('PNG metadata comes from bytes and rejects unsafe references or incomplete headers', () => {
  assert.throws(() => describeEvidencePng({ file: '../private.png', content: Buffer.alloc(24) }));
  assert.throws(() => describeEvidencePng({ file: 'visual/test.png', content: Buffer.alloc(24) }));
  assert.throws(() => describeEvidencePng({ file: 'visual/test.png', content: Buffer.from('89504e470d0a1a0a', 'hex') }));
});

test('schema names the attempt phase and the canonical fields consumed by strict audit', () => {
  assert.ok(schema.properties.artifactType.enum.includes('attempt'));
  const requirement = type => schema.allOf.find(rule => rule.if.properties.artifactType.const === type).then.required;
  assert.ok(requirement('preview').includes('preview'));
  assert.ok(requirement('preview').includes('previewSha256'));
  assert.ok(requirement('execution').includes('documentBefore'));
  assert.ok(requirement('execution').includes('sideEffectCounters'));
  assert.ok(requirement('attempt').includes('confirmCalls'));
  assert.deepEqual(schema.properties.images.items.required.sort(), ['file', 'bytes', 'sha256', 'widthPixels', 'heightPixels'].sort());
});

test('schema rejects the field omissions responsible for the real archive mismatch', () => {
  const { preview, manifest: boundManifest } = createPreviewEvidence(previewInput());
  const confirmation = confirmationFor(preview);
  const attempt = createAttemptEvidence({ preview, confirmation, attemptId: 'single', capturedAtUtc: '2026-10-24T00:01:01.000Z' });
  const execution = createExecutionEvidence({ preview, attempt, documentBefore: document, receipt: { planId: 'native-plan', status: 'committed' }, capturedAtUtc: '2026-10-24T00:01:02.000Z' });
  const summary = createSummaryEvidence({ execution, currentState: 'blocked', acceptance: { allModelSideEffectsVerified: false }, sourceArtifactHashes: { 'execution.json': 'a'.repeat(64) }, capturedAtUtc: '2026-10-24T00:02:00.000Z' });
  for (const [source, fields] of [[boundManifest, ['planId']], [preview, ['preview', 'previewSha256', 'previewDigestScope']], [attempt, ['artifactType', 'attemptId', 'confirmCalls']], [execution, ['documentBefore', 'sideEffectCounters']]]) {
    for (const field of fields) {
      const record = structuredClone(source); delete record[field];
      assert.equal(validateRecord(record), false, `Missing ${field} must fail schema validation.`);
    }
  }
  delete summary.acceptance.confirmCalls;
  assert.equal(validateRecord(summary), false, 'Missing summary confirmation count must fail schema validation.');
  const visual = { ...stage('visual'), reviewerDecision: 'accepted', images: [{ file: 'visual/test.png', sha256: 'a'.repeat(64), widthPixels: 10, heightPixels: 20 }] };
  assert.equal(validateRecord(visual), false, 'Missing PNG byte length must fail schema validation.');
});

test('unknown or unsaved baselines, nonfinite JSON and absent plugin identity are rejected', () => {
  for (const mutate of [
    x => { x.baseline.status = 'unknown'; },
    x => { x.baseline.document.isModified = true; },
    x => { x.baseline.plugin = {}; },
    x => { x.nativePreview.operations[0].heightMm = Infinity; },
    x => { x.nativePreview.expiresAtUtc = '2026-02-30T00:00:00Z'; },
    x => { x.nativePreview.operations[0].reference = x.nativePreview; },
    x => { x.nativePreview.operations = new Array(1); }
  ]) { const input = previewInput(); mutate(input); assert.throws(() => createPreviewEvidence(input)); }
});

test('confirmation text, module changes and out-of-order timestamps are never inferred away', () => {
  const { preview } = createPreviewEvidence(previewInput());
  assert.throws(() => createConfirmationEvidence({ preview, approvedText: '   ', capturedAtUtc }));
  const confirmation = confirmationFor(preview);
  const input = { preview, confirmation, attemptId: 'single', capturedAtUtc: '2026-10-24T00:01:01.000Z' };
  const otherModule = { ...confirmation, plugin: { mvid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } };
  assert.throws(() => createAttemptEvidence({ ...input, confirmation: otherModule }));
  assert.throws(() => createAttemptEvidence({ ...input, capturedAtUtc: '2026-10-24T00:00:30.000Z' }));
  const attempt = createAttemptEvidence(input);
  assert.throws(() => createExecutionEvidence({ preview, attempt: { ...attempt, plugin: otherModule.plugin }, documentBefore: document,
    receipt: { planId: 'native-plan', status: 'committed' }, capturedAtUtc: '2026-10-24T00:01:02.000Z' }));
});

test('committed-archive summaries preserve decisions and reject failed receipts or duplicate confirmations', () => {
  const { preview } = createPreviewEvidence(previewInput());
  const attempt = createAttemptEvidence({ preview, confirmation: confirmationFor(preview), attemptId: 'single', capturedAtUtc: '2026-10-24T00:01:01.000Z' });
  const execution = createExecutionEvidence({ preview, attempt, documentBefore: document, receipt: { planId: 'native-plan', status: 'committed' }, capturedAtUtc: '2026-10-24T00:01:02.000Z' });
  const input = { execution, currentState: 'blocked', acceptance: { writeAccepted: false, allModelSideEffectsVerified: false }, sourceArtifactHashes: { 'execution.json': 'a'.repeat(64) }, capturedAtUtc: '2026-10-24T00:02:00.000Z' };
  const original = structuredClone(input);
  const summary = createSummaryEvidence(input);
  assert.deepEqual(input, original);
  assert.equal(summary.currentState, 'blocked');
  assert.equal(summary.acceptance.writeAccepted, false);
  assert.throws(() => createSummaryEvidence({ ...input, acceptance: { ...input.acceptance, confirmCalls: 2 } }));
  assert.throws(() => createSummaryEvidence({ ...input, execution: { ...execution, receipt: { ...execution.receipt, status: 'failed' } } }));
  assert.throws(() => createSummaryEvidence({ ...input, currentState: 'complete' }));
  assert.throws(() => createSummaryEvidence({ ...input, sourceArtifactHashes: { '../private.json': 'a'.repeat(64) } }));
  assert.throws(() => createSummaryEvidence({ ...input, sourceArtifactHashes: { 'summary.json': 'a'.repeat(64) } }));
  assert.throws(() => createSummaryEvidence({ ...input, acceptance: { allModelSideEffectsVerified: 'yes' } }));
});
