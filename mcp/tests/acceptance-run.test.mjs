import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRunScaffold, createUuidV7, EXPECTED_ARTIFACTS } from '../acceptance-run.mjs';

const FIXED_RUN_ID = '0199abcd-1234-7abc-8def-0123456789ab';

function fixture(t, taskIds = ['foundation.run-evidence']) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-acceptance-run-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'docs', 'capability-task-queue.json'), JSON.stringify({
    schemaVersion: 1,
    tasks: taskIds.map((id) => ({ id, currentState: 'contract-ready' }))
  }));
  return repoRoot;
}

test('UUIDv7 carries a timestamp, version and RFC variant', () => {
  const runId = createUuidV7(Date.UTC(2026, 9, 14), Buffer.alloc(10, 0x2a));
  assert.match(runId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('run init writes a manifest only and never invents Revit evidence', (t) => {
  const repoRoot = fixture(t);
  const result = createRunScaffold({
    repoRoot,
    taskId: 'foundation.run-evidence',
    clock: () => Date.UTC(2026, 9, 14, 4, 0, 0),
    idFactory: () => FIXED_RUN_ID
  });

  assert.equal(result.runId, FIXED_RUN_ID);
  assert.equal(result.manifest.artifactType, 'manifest');
  assert.equal(result.manifest.status, 'initialized');
  assert.equal(result.manifest.plugin, null);
  assert.equal(result.manifest.document, null);
  assert.deepEqual(result.manifest.expectedArtifacts, EXPECTED_ARTIFACTS);
  assert.deepEqual(result.manifest.policy, {
    modelWritesRequested: false,
    automaticSave: false,
    automaticRestart: false,
    automaticRetries: false
  });
  assert.deepEqual(fs.readdirSync(result.runDirectory), ['manifest.json']);
});

test('run init rejects unknown tasks before creating acceptance directories', (t) => {
  const repoRoot = fixture(t);
  assert.throws(
    () => createRunScaffold({ repoRoot, taskId: 'missing.task', idFactory: () => FIXED_RUN_ID }),
    /Unknown taskId/
  );
  assert.equal(fs.existsSync(path.join(repoRoot, 'acceptance')), false);
});

test('run init refuses to overwrite an existing run directory', (t) => {
  const repoRoot = fixture(t);
  const options = {
    repoRoot,
    taskId: 'foundation.run-evidence',
    clock: () => Date.UTC(2026, 9, 14, 4, 0, 0),
    idFactory: () => FIXED_RUN_ID
  };
  const first = createRunScaffold(options);
  const original = fs.readFileSync(first.manifestPath, 'utf8');

  assert.throws(() => createRunScaffold(options), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(first.manifestPath, 'utf8'), original);
});

test('run ID factory must return UUIDv7', (t) => {
  const repoRoot = fixture(t);
  assert.throws(
    () => createRunScaffold({ repoRoot, taskId: 'foundation.run-evidence', idFactory: () => 'not-a-uuid' }),
    /must return a UUIDv7/
  );
  assert.equal(fs.existsSync(path.join(repoRoot, 'acceptance')), false);
});
