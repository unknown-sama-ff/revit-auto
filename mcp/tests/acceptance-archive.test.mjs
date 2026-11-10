import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as archive from '../acceptance-run.mjs';

const runId = '0199abcd-1234-7abc-8def-0123456789ab';
const taskId = 'architecture.primary-elements';
const modelPath = 'D:\\acceptance\\test.rvt';
const planId = 'reviewed-plan';
const mvid = '12345678-1234-1234-1234-123456789abc';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const document = { path: modelPath, identity: 'original-session', revision: 0, isModified: false };

function fixture(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-archive-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const directory = path.join(repoRoot, 'acceptance', 'runs', runId);
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'docs'));
  fs.writeFileSync(path.join(repoRoot, 'docs', 'capability-task-queue.json'), JSON.stringify({
    schemaVersion: 1, tasks: [{ id: taskId, currentState: 'blocked' }]
  }));
  const artifact = type => ({ schemaVersion: 1, artifactType: type, runId, taskId,
    status: 'captured', capturedAtUtc: '2026-10-22T00:00:00Z' });
  const preview = { planId, documentIdentity: document.identity, documentRevision: 0, operations: [{ operationType: 'create_floor' }] };
  const previewSha256 = hash(JSON.stringify(preview, null, 2));
  const plugin = { mvid };
  const reopenedDocument = { ...document, identity: 'reopened-session' };
  const files = JSON.parse(JSON.stringify({
    'manifest.json': { ...artifact('manifest'), document, plugin, planId },
    'baseline.json': { ...artifact('baseline'), document, plugin },
    'preview.json': { ...artifact('preview'), document, plugin, planId, preview, previewSha256 },
    'confirmation.json': { ...artifact('confirmation'), document, planId, confirmCalls: 1, previewSha256 },
    'attempt.json': { ...artifact('execution'), document, planId, attemptId: 'single-attempt', confirmCalls: 1, previewSha256 },
    'execution.json': { ...artifact('execution'), documentBefore: document, planId, attemptId: 'single-attempt',
      receipt: { planId, status: 'committed' }, sideEffectCounters: { confirmCalls: 1 } },
    'readback.json': { ...artifact('readback'), document: { ...document, revision: 1, isModified: true }, plugin, planId },
    'saved.json': { ...artifact('saved'), document: reopenedDocument, manualSaveConfirmed: true,
      verification: { preCloseMachineSaveStateCaptured: false } },
    'reopen.json': { ...artifact('reopen'), planId, previousSession: { documentIdentity: document.identity, path: modelPath, revision: 1 },
      currentSession: { document: reopenedDocument, plugin }, comparison: { persistenceVerified: true },
      inspectionScope: { fullRawReopenedInspectionSnapshotArchived: false } },
    'visual.json': { ...artifact('visual'), document: reopenedDocument, plugin, planId,
      comparison: { sourceBeforeRunId: runId, sourceBeforeDocumentIdentity: document.identity }, images: [] },
    'summary.json': { ...artifact('summary'), currentState: 'blocked',
      acceptance: { confirmCalls: 1, persistenceAccepted: true, visualAccepted: true, allModelSideEffectsVerified: false } }
  }));
  const write = (file, value) => fs.writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2));
  const sync = () => {
    for (const [file, value] of Object.entries(files)) if (file !== 'summary.json') write(file, value);
    files['summary.json'].sourceArtifactHashes = Object.fromEntries(Object.keys(files).filter(file => file !== 'summary.json')
      .map(file => [file, hash(fs.readFileSync(path.join(directory, file)))]));
    write('summary.json', files['summary.json']);
  };
  sync();
  return { repoRoot, directory, files, write, sync, audit: () => archive.auditAcceptanceRun({ repoRoot, runId }) };
}

test('archive audit is offline, preserves bytes and keeps acceptance decisions independent', t => {
  const f = fixture(t);
  const before = fs.readdirSync(f.directory).map(file => [file, hash(fs.readFileSync(path.join(f.directory, file)))]);
  const result = f.audit();
  assert.equal(result.archiveConsistent, true, JSON.stringify(result.findings));
  assert.equal(result.acceptanceStatesChanged, false);
  assert.equal(result.modelWritesRequested, false);
  assert.equal(result.claimedCurrentState, 'blocked');
  assert.ok(result.limitations.some(x => x.code === 'preclose-save-snapshot-missing'));
  assert.ok(result.limitations.some(x => x.code === 'full-reopened-snapshot-missing'));
  assert.deepEqual(fs.readdirSync(f.directory).map(file => [file, hash(fs.readFileSync(path.join(f.directory, file)))]), before);
});

test('matching hashes never hide a mistyped previous-session identity', t => {
  const f = fixture(t);
  f.files['reopen.json'].previousSession.documentIdentity = 'mistyped-original-session';
  f.sync();
  const result = f.audit();
  assert.equal(result.archiveConsistent, false);
  assert.ok(result.findings.some(x => x.code === 'previous-session-identity-mismatch'));
  assert.ok(!result.findings.some(x => x.code === 'source-hash-mismatch'));
});

test('canonical attempt markers keep strict action, count and identity checks', t => {
  const f = fixture(t);
  f.files['attempt.json'].artifactType = 'attempt';
  f.files['attempt.json'].reservedAction = 'revit.plan.confirm';
  f.sync();
  assert.equal(f.audit().archiveConsistent, true);
  f.files['attempt.json'].reservedAction = 'revit.lifecycle.save_once';
  f.sync();
  assert.ok(f.audit().findings.some(x => x.code === 'attempt-action-invalid'));
  delete f.files['attempt.json'].artifactType;
  f.sync();
  assert.ok(f.audit().findings.some(x => x.code === 'artifact-binding-mismatch' && x.file === 'attempt.json'));
});

test('an explicitly different preview digest profile is never silently accepted', t => {
  const f = fixture(t);
  f.files['preview.json'].previewDigestScope = 'complete-artifact-bytes';
  f.sync();
  assert.ok(f.audit().findings.some(x => x.code === 'preview-digest-scope-invalid'));
});

test('an independent saved snapshot keeps the original session before close and reopen', t => {
  const f = fixture(t);
  f.files['saved.json'].document = { ...document, revision: 1, isModified: false };
  f.files['saved.json'].verification.preCloseMachineSaveStateCaptured = true;
  f.sync();
  assert.equal(f.audit().archiveConsistent, true);
});

test('archive audit rejects unexpected saved sessions and malformed visual metadata', t => {
  const f = fixture(t);
  f.files['saved.json'].document.identity = 'unrelated-session';
  f.files['visual.json'].images = { file: 'visual/test.png' };
  f.sync();
  const result = f.audit();
  assert.ok(result.findings.some(x => x.code === 'saved-session-mismatch'));
  assert.ok(result.findings.some(x => x.code === 'visual-metadata-invalid'));
});

test('archive audit rejects inconsistent revisions, receipts, and missing attempt identities', t => {
  const f = fixture(t);
  f.files['reopen.json'].currentSession.document.revision = 4;
  f.files['execution.json'].receipt.status = 'pending';
  delete f.files['attempt.json'].attemptId;
  f.sync();
  const result = f.audit();
  for (const code of ['reopened-session-invalid', 'execution-not-committed', 'attempt-binding-mismatch']) {
    assert.ok(result.findings.some(x => x.code === code), code);
  }
});

test('visual before identity is checked against the named source run rather than the reopened session', t => {
  const f = fixture(t);
  const sourceRun = '0199abcd-1234-7abc-8def-0123456789ac';
  const sourceDirectory = path.join(f.repoRoot, 'acceptance', 'runs', sourceRun);
  fs.mkdirSync(sourceDirectory);
  fs.writeFileSync(path.join(sourceDirectory, 'reopen.json'), JSON.stringify({
    schemaVersion: 1, runId: sourceRun, taskId, currentSession: { document }
  }));
  f.files['visual.json'].comparison.sourceBeforeRunId = sourceRun;
  f.sync();
  assert.equal(f.audit().archiveConsistent, true);
  f.files['visual.json'].comparison.sourceBeforeDocumentIdentity = 'typo';
  f.sync();
  assert.ok(f.audit().findings.some(x => x.code === 'visual-source-identity-mismatch'));
  fs.writeFileSync(path.join(sourceDirectory, 'reopen.json'), JSON.stringify({
    schemaVersion: 1, runId: sourceRun, taskId, currentSession: document
  }));
  f.files['visual.json'].comparison.sourceBeforeDocumentIdentity = document.identity;
  f.sync();
  assert.equal(f.audit().archiveConsistent, true, 'Historical flat currentSession evidence must retain its identity.');
});

test('archive audit detects a stale preview pin, changed MVID and a duplicate confirm', t => {
  const f = fixture(t);
  f.files['preview.json'].preview.documentRevision = 3;
  f.files['readback.json'].plugin = { mvid: 'another-build' };
  f.files['attempt.json'].confirmCalls = 2;
  f.sync();
  const result = f.audit();
  for (const code of ['preview-revision-mismatch', 'plugin-mvid-mismatch', 'confirm-count-mismatch']) {
    assert.ok(result.findings.some(x => x.code === code), code);
  }
});

test('archive audit checks confirmation revision and its historical expiry without comparing to now', t => {
  const f = fixture(t);
  f.files['preview.json'].expiresAtUtc = '2026-10-22T01:00:00Z';
  f.sync();
  assert.equal(f.audit().archiveConsistent, true, 'An expired historical preview remains valid execution evidence.');
  f.files['confirmation.json'].document.revision = 5;
  f.files['confirmation.json'].capturedAtUtc = '2026-10-22T02:00:00Z';
  f.sync();
  const result = f.audit();
  assert.ok(result.findings.some(x => x.code === 'confirmation-revision-mismatch'));
  assert.ok(result.findings.some(x => x.code === 'confirmation-after-expiry'));
});

test('archive audit detects replaced artifacts, images and missing execution receipts', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.directory, 'visual'));
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(10, 16); bytes.writeUInt32BE(20, 20);
  fs.writeFileSync(path.join(f.directory, 'visual', 'test.png'), bytes);
  f.files['visual.json'].images = [{ file: 'visual/test.png', bytes: 24, widthPixels: 10, heightPixels: 20, sha256: hash(bytes) }];
  delete f.files['execution.json'].receipt;
  f.sync();
  fs.appendFileSync(path.join(f.directory, 'baseline.json'), ' ');
  fs.appendFileSync(path.join(f.directory, 'visual', 'test.png'), 'changed');
  const result = f.audit();
  for (const code of ['source-hash-mismatch', 'image-mismatch', 'execution-receipt-missing']) {
    assert.ok(result.findings.some(x => x.code === code), code);
  }
});

test('archive audit fails closed for missing files, invalid JSON and mismatched run bindings', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.directory, 'execution.json'));
  fs.writeFileSync(path.join(f.directory, 'readback.json'), '{broken');
  f.files['saved.json'].runId = 'another-run'; f.write('saved.json', f.files['saved.json']);
  const result = f.audit();
  for (const code of ['artifact-unreadable', 'artifact-binding-mismatch']) {
    assert.ok(result.findings.some(x => x.code === code), code);
  }
});

test('archive audit rejects unsafe run IDs and file references without reading outside the run', t => {
  const f = fixture(t);
  assert.throws(() => archive.auditAcceptanceRun({ repoRoot: f.repoRoot, runId: '../outside' }), /UUIDv7/);
  for (const reference of ['../outside.json', 'C:\\outside.json', '/outside.json', 'visual/../../outside.png', 'visual/test.png:secret']) {
    f.files['summary.json'].sourceArtifactHashes = { [reference]: 'a'.repeat(64) };
    f.write('summary.json', f.files['summary.json']);
    assert.ok(f.audit().findings.some(x => x.code === 'unsafe-artifact-reference'), reference);
  }
});

test('audit CLI rejects unknown arguments before touching any runtime bridge', () => {
  const cli = path.resolve(import.meta.dirname, '..', 'acceptance-run.mjs');
  const result = spawnSync(process.execPath, [cli, 'audit', '../outside'], { encoding: 'utf8', env: { ...process.env, REVIT_AI_CONFIG: 'missing-bridge-config.json' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UUIDv7/);
  assert.doesNotMatch(result.stderr, /bridge|connection/i);
});

test('new run manifests name both the single attempt marker and visual decision JSON', () => {
  assert.ok(archive.EXPECTED_ARTIFACTS.includes('attempt.json'));
  assert.ok(archive.EXPECTED_ARTIFACTS.includes('visual.json'));
});
