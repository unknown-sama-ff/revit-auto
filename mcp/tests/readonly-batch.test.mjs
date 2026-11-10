import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertRunDirectory, READONLY_TOOLS, runReadonlyBatch as runReadonlyBatchRaw, writeBaselineEvidence } from '../readonly-batch.mjs';

const project = path.resolve('TEST_COPY.rvt');
const runIdentity = { runId: '0199abcd-1234-7abc-8def-0123456789ab', taskId: 'foundation.current-session-readonly-batch' };
const runReadonlyBatch = (options) => runReadonlyBatchRaw({ ...runIdentity, ...options });
const plugin = {
  protocol: 'revit-auto-2027-v2',
  informationalVersion: '0.4.0+readonly-batch-test',
  moduleVersionId: '21f1aeed-467c-4e33-95f6-481933913391',
  features: ['readonly-query-pins'],
  revitVersion: '2027',
  revitBuild: '27.3.0.28',
  pid: 27316
};
const context = {
  active: true,
  document: { identity: 'session-a', revision: 4, path: project, isModified: false },
  counts: { OST_Levels: 3, OST_Grids: 11 }
};
const scopes = [
  { id: 'levels', tool: 'revit_search', args: { category: 'OST_Levels' }, taskIds: ['foundation.current-session-readonly-batch'] },
  { id: 'electrical', tool: 'revit_electrical_audit', args: { maxCircuits: 10 } }
];
const tools = [
  { name: 'revit_context_get', inputSchema: { properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'revit_inspect', inputSchema: { properties: { elementIds: {}, documentIdentity: {}, expectedRevision: {} } }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'revit_search', inputSchema: { properties: { category: {}, documentIdentity: {}, expectedRevision: {} } }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'revit_saved_verify', inputSchema: { properties: { sinceRevision: {}, limit: {}, documentIdentity: {}, expectedRevision: {} } }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'revit_electrical_audit', inputSchema: { properties: { maxCircuits: {}, documentIdentity: {}, expectedRevision: {} } }, annotations: { readOnlyHint: true, destructiveHint: false } }
];

function fixture({ after = context, afterPlugin = plugin, failures = {} } = {}) {
  const calls = [];
  let contextReads = 0;
  let pluginReads = 0;
  return {
    calls,
    bridgeCall: async (method) => {
      calls.push({ kind: 'bridge', method });
      assert.equal(method, 'revit.bridge.info');
      return structuredClone(pluginReads++ === 0 ? plugin : afterPlugin);
    },
    toolCall: async (name, args) => {
      calls.push({ kind: 'tool', name, args });
      if (name === 'revit_context_get') return structuredClone(contextReads++ === 0 ? context : after);
      if (failures[name]) throw Object.assign(new Error(failures[name]), { code: 'fixture_failure' });
      return { readOnly: true, planCreated: false, name, args };
    }
  };
}

test('batch runs explicit read-only scopes serially, pins compatible tools and checks the same host at end', async () => {
  const f = fixture();
  const evidence = await runReadonlyBatch({
    expectedBuild: plugin.informationalVersion,
    project,
    scopes,
    bridgeCall: f.bridgeCall,
    toolCall: f.toolCall,
    tools,
    now: () => '2026-10-14T00:00:00.000Z'
  });
  assert.equal(evidence.status, 'accepted');
  assert.equal(evidence.artifactType, 'baseline');
  assert.equal(evidence.readOnly, true);
  assert.equal(evidence.contract.schemaVersion, 1);
  assert.match(evidence.contract.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(evidence.contract.tools.map((tool) => tool.name), ['revit_context_get', 'revit_search', 'revit_electrical_audit'].sort());
  assert.deepEqual(evidence.sideEffectCounters, { planCreateCalls: 0, confirmCalls: 0, modelWritesRequested: 0, saveCalls: 0, restartCalls: 0, automaticRetries: 0 });
  assert.deepEqual(f.calls.filter((call) => call.kind === 'tool' && call.name !== 'revit_context_get').map((call) => call.name), ['revit_search', 'revit_electrical_audit']);
  const search = f.calls.find((call) => call.name === 'revit_search');
  assert.equal(search.args.documentIdentity, context.document.identity);
  assert.equal(search.args.expectedRevision, context.document.revision);
  assert.equal(f.calls.filter((call) => call.kind === 'bridge').length, 2);
});

test('saved-state verification runs as a pinned read-only scope without requesting a save', async () => {
  const f = fixture();
  const evidence = await runReadonlyBatch({
    expectedBuild: plugin.informationalVersion,
    project,
    scopes: [{ id: 'saved-state', tool: 'revit_saved_verify', args: { sinceRevision: 0, limit: 100 } }],
    bridgeCall: f.bridgeCall,
    toolCall: f.toolCall,
    tools
  });
  assert.equal(evidence.status, 'accepted');
  assert.equal(evidence.scopes[0].status, 'captured');
  const read = f.calls.find(call => call.name === 'revit_saved_verify');
  assert.deepEqual(read.args, { sinceRevision: 0, limit: 100, documentIdentity: context.document.identity, expectedRevision: context.document.revision });
  assert.deepEqual(f.calls.filter(call => call.kind === 'tool').map(call => call.name), ['revit_context_get', 'revit_saved_verify', 'revit_context_get']);
  assert.equal(evidence.sideEffectCounters.saveCalls, 0);
  assert.equal(evidence.sideEffectCounters.modelWritesRequested, 0);
});

test('save and lifecycle actions remain rejected even if a client advertises them as read-only', async () => {
  for (const name of ['revit_save', 'revit_save_once', 'revit_lifecycle_save_once', 'revit_lifecycle_post_exit_once', 'revit_lifecycle_open_saved_copy_once', 'revit_plan_confirm', 'revit_import_commit']) {
    const f = fixture();
    const falseReadOnly = { ...tools.find(tool => tool.name === 'revit_saved_verify'), name };
    await assert.rejects(runReadonlyBatch({
      expectedBuild: plugin.informationalVersion, project, scopes: [{ id: 'write-action', tool: name }],
      bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools: [...tools, falseReadOnly]
    }), error => error.code === 'readonly_tool_not_allowed');
    assert.deepEqual(f.calls, []);
  }
});

test('workflow dispatch, unlisted tools and scopes without both pins are rejected before Revit queries', async () => {
  const f = fixture();
  for (const tool of ['revit_workflow_run', 'revit_plan_create', 'revit_plan_get', 'revit_view_export_images', 'revit_unknown']) {
    await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [{ id: 'bad.scope', tool }], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools }), (error) => error.code === 'readonly_tool_not_allowed');
  }
  const unpinned = tools.map((tool) => tool.name === 'revit_search'
    ? { ...tool, inputSchema: { properties: { category: {} } } }
    : tool);
  await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools: unpinned }), (error) => error.code === 'readonly_tool_not_verified');
  await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: async () => ({ ...plugin, features: [] }), toolCall: f.toolCall, tools }), /does not enforce the read-only query pins/);
  assert.deepEqual(f.calls, []);
});

test('a conflicting pin in any scope stops the batch before executing the first scope', async () => {
  const f = fixture();
  const conflictingScopes = [scopes[0], { ...scopes[1], args: { documentIdentity: 'stale-session' } }];
  await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: conflictingScopes, bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools }), (error) => error.code === 'scope_pin_mismatch');
  assert.equal(f.calls.some((call) => call.kind === 'tool' && call.name === 'revit_search'), false);
});

test('MCP contracts are verified for every scope before the first Revit query', async () => {
  const f = fixture();
  const unsafeTools = tools.map((tool) => tool.name === 'revit_search' ? { ...tool, annotations: { readOnlyHint: false, destructiveHint: true } } : tool);
  await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes, bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools: unsafeTools }), (error) => error.code === 'readonly_tool_not_verified');
  assert.deepEqual(f.calls, []);
});

test('wrong build or project stops before any scope and changed identity/revision or host invalidates batch', async () => {
  let f = fixture();
  await assert.rejects(runReadonlyBatch({ expectedBuild: 'old-build', project, scopes, bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools }), (error) => error.code === 'native_candidate_not_loaded');
  assert.deepEqual(f.calls.map((call) => call.kind), ['bridge']);

  f = fixture();
  await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project: path.resolve('OTHER.rvt'), scopes, bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools }), (error) => error.code === 'native_project_mismatch');
  assert.equal(f.calls.some((call) => call.name === 'revit_search'), false);

  for (const after of [
    { ...context, document: { ...context.document, identity: 'session-b' } },
    { ...context, document: { ...context.document, revision: 5 } },
    { ...context, counts: { ...context.counts, OST_Grids: 12 } }
  ]) {
    f = fixture({ after });
    await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes, bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools }), (error) => error.code === 'native_read_state_changed');
  }
  f = fixture({ afterPlugin: { ...plugin, pid: plugin.pid + 1 } });
  await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes, bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools }), (error) => error.code === 'native_host_changed');
  f = fixture({ afterPlugin: { ...plugin, revitBuild: '27.3.0.29' } });
  await assert.rejects(runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes, bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools }), (error) => error.code === 'native_host_changed');
});

test('an unexpected module version ID stops before any Revit scope query', async () => {
  const f = fixture();
  await assert.rejects(runReadonlyBatch({
    expectedBuild: plugin.informationalVersion,
    expectedMvid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    project,
    scopes,
    bridgeCall: f.bridgeCall,
    toolCall: f.toolCall,
    tools
  }), (error) => error.code === 'native_candidate_not_loaded');
  assert.deepEqual(f.calls.map((call) => call.kind), ['bridge']);
});

test('scope errors are retained independently and later read-only scopes still run without retries', async () => {
  const f = fixture({ failures: { revit_search: 'host mismatch' } });
  const evidence = await runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes, bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools });
  assert.equal(evidence.status, 'unknown');
  assert.equal(evidence.scopes[0].status, 'failed');
  assert.equal(evidence.scopes[1].status, 'captured');
  assert.equal(f.calls.filter((call) => call.name === 'revit_search').length, 1);
  assert.equal(evidence.sideEffectCounters.automaticRetries, 0);
});

test('scope responses with nested write or lifecycle side-effect markers are rejected', async () => {
  for (const result of [
    { readOnly: false },
    { details: { automaticSave: true } },
    { sideEffectCounters: { modelWritesRequested: 1 } },
    { restartCalls: 1 }
  ]) {
    const f = fixture();
    f.toolCall = async (name) => name === 'revit_context_get' ? structuredClone(context) : structuredClone(result);
    const evidence = await runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools });
    assert.equal(evidence.status, 'unknown');
    assert.equal(evidence.scopes[0].status, 'failed');
    assert.equal(evidence.scopes[0].error.code, 'readonly_scope_mutated');
  }
});

test('parameter readOnly metadata does not make an inspection result look like a model write', async () => {
  const f = fixture();
  const inspection = {
    items: [{ summary: { id: 311 }, parameters: [{ name: '标高', value: 'Level 1', readOnly: false }] }],
    readOnly: true,
    modelWritePerformed: false
  };
  f.toolCall = async (name) => name === 'revit_context_get' ? structuredClone(context) : structuredClone(inspection);

  const evidence = await runReadonlyBatch({
    expectedBuild: plugin.informationalVersion,
    project,
    scopes: [{ id: 'inspect-level-311', tool: 'revit_inspect', args: { elementIds: [311] } }],
    bridgeCall: f.bridgeCall,
    toolCall: f.toolCall,
    tools
  });

  assert.equal(evidence.status, 'accepted');
  assert.equal(evidence.scopes[0].status, 'captured');
  assert.equal(evidence.scopes[0].result.items[0].parameters[0].readOnly, false);
});

test('inspection parameter metadata does not hide actual nested write markers', async () => {
  const f = fixture();
  f.toolCall = async (name) => name === 'revit_context_get' ? structuredClone(context) : ({
    items: [{ summary: { id: 311 }, parameters: [{ name: '标高', readOnly: false, modelWritePerformed: true }] }],
    readOnly: true
  });

  const evidence = await runReadonlyBatch({
    expectedBuild: plugin.informationalVersion,
    project,
    scopes: [{ id: 'inspect-level-311', tool: 'revit_inspect', args: { elementIds: [311] } }],
    bridgeCall: f.bridgeCall,
    toolCall: f.toolCall,
    tools
  });

  assert.equal(evidence.status, 'unknown');
  assert.equal(evidence.scopes[0].status, 'failed');
  assert.equal(evidence.scopes[0].error.code, 'readonly_scope_mutated');
});

test('a stable but unsaved document cannot produce an accepted baseline', async () => {
  const dirty = { ...context, document: { ...context.document, isModified: true } };
  const f = fixture({ after: dirty });
  f.toolCall = async (name) => name === 'revit_context_get' ? structuredClone(dirty) : { readOnly: true };
  const evidence = await runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools });
  assert.equal(evidence.status, 'unknown');
  assert.equal(evidence.comparison.documentWasSaved, false);
});

test('baseline is bound to the existing run manifest and refuses overwrite', async (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-readonly-batch-'));
  const runDirectory = path.join(repoRoot, 'acceptance', 'runs', '0199abcd-1234-7abc-8def-0123456789ab');
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(runDirectory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, artifactType: 'manifest', runId: '0199abcd-1234-7abc-8def-0123456789ab', taskId: 'foundation.current-session-readonly-batch', status: 'initialized' }));
  const f = fixture();
  const evidence = await runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools });
  const baselinePath = await writeBaselineEvidence(runDirectory, evidence, repoRoot);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  assert.equal(baseline.runId, manifest.runId);
  assert.equal(baseline.taskId, manifest.taskId);
  assert.equal(manifest.plugin.moduleVersionId, plugin.moduleVersionId);
  assert.equal(manifest.document.identity, context.document.identity);
  await assert.rejects(writeBaselineEvidence(runDirectory, evidence, repoRoot), { code: 'EEXIST' });
  assert.equal(READONLY_TOOLS.has('revit_workflow_run'), false);
});

test('baseline writer derives acceptance from complete scopes and saved state', async (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-readonly-derived-status-'));
  const runDirectory = path.join(repoRoot, 'acceptance', 'runs', runIdentity.runId);
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(runDirectory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, artifactType: 'manifest', ...runIdentity, status: 'initialized' }));
  const f = fixture();
  const evidence = await runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools });

  const withFailedScope = structuredClone(evidence);
  withFailedScope.scopes[0] = { id: 'levels', tool: 'revit_search', taskIds: [], status: 'failed', error: { code: 'fixture_failure', message: 'read failed' } };
  await assert.rejects(writeBaselineEvidence(runDirectory, withFailedScope, repoRoot), { code: 'invalid_evidence_status' });
  assert.equal(fs.existsSync(path.join(runDirectory, 'baseline.json')), false);

  const dirty = structuredClone(evidence);
  dirty.document.isModified = true;
  dirty.before.document.isModified = true;
  dirty.after.document.isModified = true;
  dirty.comparison.documentWasSaved = false;
  await assert.rejects(writeBaselineEvidence(runDirectory, dirty, repoRoot), { code: 'invalid_evidence_status' });
  assert.equal(fs.existsSync(path.join(runDirectory, 'baseline.json')), false);

  const mismatch = structuredClone(evidence);
  mismatch.taskId = 'architecture.rooms';
  await assert.rejects(writeBaselineEvidence(runDirectory, mismatch, repoRoot), { code: 'task_id_mismatch' });
  assert.equal(fs.existsSync(path.join(runDirectory, 'baseline.json')), false);

  await writeBaselineEvidence(runDirectory, evidence, repoRoot);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDirectory, 'baseline.json'), 'utf8')).status, 'accepted');
});

test('baseline writer binds every scope to the captured MCP contract snapshot', async (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-readonly-contract-'));
  const runDirectory = path.join(repoRoot, 'acceptance', 'runs', runIdentity.runId);
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(runDirectory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, artifactType: 'manifest', ...runIdentity, status: 'initialized' }));
  const f = fixture();
  const evidence = await runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools });
  const changedTool = structuredClone(evidence);
  changedTool.scopes[0].tool = 'revit_inspect';
  await assert.rejects(writeBaselineEvidence(runDirectory, changedTool, repoRoot), { code: 'invalid_evidence_contract' });
  assert.equal(fs.existsSync(path.join(runDirectory, 'baseline.json')), false);

  const changedContract = structuredClone(evidence);
  changedContract.contract.tools[1].annotations.readOnlyHint = false;
  await assert.rejects(writeBaselineEvidence(runDirectory, changedContract, repoRoot), { code: 'invalid_evidence_contract' });
  assert.equal(fs.existsSync(path.join(runDirectory, 'baseline.json')), false);
});

test('evidence writer confines writes to a direct real acceptance run directory', async (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-readonly-boundary-'));
  const runsRoot = path.join(repoRoot, 'acceptance', 'runs');
  const runDirectory = path.join(runsRoot, '0199abcd-1234-7abc-8def-0123456789ab');
  const outside = path.join(repoRoot, 'outside');
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.mkdirSync(outside);
  await assert.rejects(writeBaselineEvidence(outside, { artifactType: 'baseline' }, repoRoot), { code: 'invalid_evidence_path' });
  await assert.rejects(assertRunDirectory(path.join(runDirectory, 'nested'), repoRoot), { code: 'invalid_evidence_path' });
  await assert.rejects(assertRunDirectory(path.join(runsRoot, 'not-a-run-id'), repoRoot), { code: 'invalid_evidence_path' });
  await assert.rejects(writeBaselineEvidence(runDirectory, { artifactType: 'baseline' }), { code: 'invalid_evidence_path' });
});

test('invalid manifest is preserved and no partial baseline is created', async (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-readonly-manifest-'));
  const runDirectory = path.join(repoRoot, 'acceptance', 'runs', '0199abcd-1234-7abc-8def-0123456789ab');
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(runDirectory, { recursive: true });
  const original = JSON.stringify({ schemaVersion: 1, artifactType: 'manifest', runId: 'not-a-run-id', taskId: 'foundation.current-session-readonly-batch', status: 'initialized' });
  fs.writeFileSync(path.join(runDirectory, 'manifest.json'), original);
  const f = fixture();
  const evidence = await runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools });
  await assert.rejects(writeBaselineEvidence(runDirectory, evidence, repoRoot), { code: 'invalid_manifest' });
  assert.equal(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(runDirectory, 'baseline.json')), false);
});

test('manifest runId must match the enclosing run directory', async (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-readonly-run-id-'));
  const runDirectory = path.join(repoRoot, 'acceptance', 'runs', '0199abcd-1234-7abc-8def-0123456789ab');
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(runDirectory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, artifactType: 'manifest', runId: '0199abcd-1234-7abc-8def-0123456789ac', taskId: 'foundation.current-session-readonly-batch', status: 'initialized' }));
  const f = fixture();
  const evidence = await runReadonlyBatch({ expectedBuild: plugin.informationalVersion, project, scopes: [scopes[0]], bridgeCall: f.bridgeCall, toolCall: f.toolCall, tools });
  await assert.rejects(writeBaselineEvidence(runDirectory, evidence, repoRoot), { code: 'invalid_manifest' });
  assert.equal(fs.existsSync(path.join(runDirectory, 'baseline.json')), false);
});
