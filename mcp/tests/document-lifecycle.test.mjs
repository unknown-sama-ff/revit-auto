import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  lifecyclePrepareSchema, lifecycleRequestSchema, lifecycleVerifyScopeSchema,
  lifecyclePreparedRequestSchema, lifecycleResponseSchema, validateLifecycleResponse,
  prepareLifecycle, getLifecycle, verifyLifecycleScope, saveLifecycleOnce,
  postLifecycleExitOnce, openSavedCopyOnce, stopLifecycle
} from '../document-lifecycle.mjs';

const operationId = '0123456789abcdef0123456789abcdef';
const requestSha256 = 'A'.repeat(64);
const documentIdentity = 'a'.repeat(32);
const timestamp = new Date('2026-10-10T00:00:00.000Z').toISOString();
const expires = new Date(Date.parse(timestamp) + 600000).toISOString();
const recipes = [
  { method: 'revit.context.get', params: {} },
  { method: 'revit.search', params: { category: 'OST_StructuralColumns', types: false, limit: 500, offset: 0 } },
  { method: 'revit.inspect', params: { elementIds: [10, 20] } },
  { method: 'revit.element.dependencies', params: { elementIds: [10, 20] } }
];
const request = {
  schemaVersion: 1, operationId, createdAtUtc: timestamp, expiresAtUtc: expires, registrationSha256: requestSha256,
  registration: { modelPath: 'C:\\test\\copy.rvt', baselineEvidenceFile: 'C:\\runtime\\baseline.json', baselineEvidenceSha256: 'B'.repeat(64), readRecipes: recipes },
  document: { identity: documentIdentity, revision: 0, path: 'C:\\test\\copy.rvt', isModified: false },
  process: { pid: 1234, startTimeUtc: timestamp, exePath: 'C:\\Program Files\\Autodesk\\Revit.exe', exeSha256: 'C'.repeat(64), version: '27.3.0.28', moduleVersionId: '01234567-89ab-cdef-0123-456789abcdef', userSid: 'S-1-5-21-test', sessionId: 1 },
  bridgeConfig: { path: 'C:\\runtime\\bridge.json', sha256: 'D'.repeat(64), aclSddl: 'O:BAG:BAD', port: 8091 },
  savedFile: { path: 'C:\\test\\copy.rvt', bytes: 100, sha256: 'E'.repeat(64), fileIdentity: '12345678:1234567890abcdef' },
  baselineSnapshotFile: 'C:\\runtime\\baseline.json', baselineSnapshotSha256: 'B'.repeat(64), recipeCount: recipes.length
};
const state = (stage, readIndex) => ({ schemaVersion: 1, operationId, requestSha256, sequence: 1, previousSha256: null, stage, atUtc: timestamp, data: { readIndex } });
const response = (stage = 'PREVIEW_READY', readIndex = 0, scope = null) => ({
  operationId, requestSha256, stage, recipeCount: recipes.length, readIndex, readRound: Math.floor(readIndex / recipes.length),
  leaseActive: false, exitPosted: false, modelWritesRequested: false, automaticRetry: false, allModelSideEffectsVerified: false,
  requestFile: 'C:\\runtime\\request.json', request, latestState: state(stage, readIndex), stateSha256: 'F'.repeat(64), eventCount: 0,
  eventTailSha256: null, stopReason: null, scope
});
const clone = value => structuredClone(value);
const nativeSummary = id => ({ id, uniqueId: 'native-' + id, name: 'Element ' + id, className: 'FamilyInstance', levelId: -1, typeId: -1, ownerViewId: -1 });
const contextResult = (identity = documentIdentity, revision = 0) => ({ active: true, document: { identity, revision, path: request.document.path, isModified: false, isReadOnly: false }, activeView: null, selectedElementIds: [], unknownNativeEvidence: { geometry: [0, 2, 1], unavailable: null } });
const unsupportedEvidence = { supported: false, complete: false, ids: [], count: null, truncated: false, reason: 'element_not_found' };
const dependencyResult = (identity = documentIdentity, revision = 0) => ({
  documentIdentity: identity, documentRevision: revision,
  items: [10, 20].map(elementId => ({ elementId, exists: false, summary: null, dependencies: clone(unsupportedEvidence), familySymbols: { applicable: false, ...clone(unsupportedEvidence) } })),
  modelWritesRequested: false, automaticSave: false, relationshipScope: 'native-logical-dependents-and-family-symbol-membership', allModelSideEffectsVerified: false
});
const inspectResult = () => ({ items: [10, 20].map(id => ({ summary: { ...nativeSummary(id), arbitrary: { geometry: [1, 2] } }, parameters: [], connectors: [], piping: { applicable: false } })) });
const scopeResponse = (index, phase = 'SAVE_READBACK_PENDING', identity = documentIdentity, revision = 0) => {
  const results = [contextResult(identity, revision), { items: [{ ...nativeSummary(10), location: { points: [3, 2, 1] } }], offset: 0, limit: 500, hasMore: false }, inspectResult(), dependencyResult(identity, revision)];
  const completed = index + 1 === 2 * recipes.length;
  const stage = completed ? phase === 'SAVE_READBACK_PENDING' ? 'SAVE_VERIFIED' : 'REOPEN_VERIFIED' : phase;
  const value = response(stage, index + 1, { phase, readIndex: index, method: recipes[index % recipes.length].method, documentIdentity: identity, documentRevision: revision, result: results[index % recipes.length], matched: true });
  value.leaseActive = phase === 'SAVE_READBACK_PENDING' || !completed;
  return value;
};

test('lifecycle request and response schemas bind one fixed request, recipe and evidence budget', () => {
  assert.deepEqual(lifecyclePrepareSchema.parse({}), {});
  assert.deepEqual(lifecycleRequestSchema.parse({ operationId, requestSha256 }), { operationId, requestSha256 });
  assert.deepEqual(lifecycleVerifyScopeSchema.parse({ operationId, requestSha256, readIndex: 3 }).readIndex, 3);
  assert.deepEqual(lifecyclePreparedRequestSchema.parse(request), request);
  assert.deepEqual(lifecycleResponseSchema.parse(response()), response());
  for (const input of [
    { operationId: operationId.toUpperCase(), requestSha256 }, { operationId, requestSha256: 'x' },
    { operationId, requestSha256, extra: true }, { operationId, requestSha256, readIndex: -1 }
  ]) assert.throws(() => lifecycleRequestSchema.parse(input));
  assert.throws(() => lifecycleVerifyScopeSchema.parse({ operationId, requestSha256, readIndex: 200 }));
  assert.throws(() => lifecyclePreparedRequestSchema.parse({ ...request, recipeCount: 3 }));
  assert.throws(() => lifecyclePreparedRequestSchema.parse({ ...request, registration: { ...request.registration, readRecipes: [{ method: 'revit.search', params: { category: 'x', types: false, limit: 100, offset: 0 } }] } }));
  assert.throws(() => lifecycleResponseSchema.parse({ ...response(), modelWritesRequested: true }));
});

test('lifecycle wrappers make exactly one native call and never add action parameters or retry', async () => {
  const calls = [];
  const call = async (method, params) => { calls.push({ method, params }); return response(); };
  await prepareLifecycle({}, call);
  await getLifecycle({ operationId, requestSha256 }, call);
  await saveLifecycleOnce({ operationId, requestSha256 }, call);
  await postLifecycleExitOnce({ operationId, requestSha256 }, call);
  await openSavedCopyOnce({ operationId, requestSha256 }, call);
  await stopLifecycle({ operationId, requestSha256 }, call);
  assert.deepEqual(calls.map(item => item.method), ['revit.lifecycle.prepare', 'revit.lifecycle.get', 'revit.lifecycle.save_once', 'revit.lifecycle.post_exit_once', 'revit.lifecycle.open_saved_copy_once', 'revit.lifecycle.stop']);
  assert.deepEqual(calls[1].params, { operationId, requestSha256 });
  const failure = new Error('unknown native result'); let attempts = 0;
  await assert.rejects(saveLifecycleOnce({ operationId, requestSha256 }, async () => { attempts++; throw failure; }), error => error === failure);
  assert.equal(attempts, 1);
});

test('arbitrary lifecycle paths, commands, approval flags and scopes are rejected before dispatch', async () => {
  const wrappers = [getLifecycle, saveLifecycleOnce, postLifecycleExitOnce, openSavedCopyOnce, stopLifecycle];
  let calls = 0;
  for (const wrapper of wrappers) for (const extra of [{ path: 'other.rvt' }, { exePath: 'other.exe' }, { command: 'anything' }, { chatApproved: true }, { expectedRevision: 0 }, { phase: 'SAVE_VERIFIED' }, { reason: 'force_continue' }]) {
    await assert.rejects(wrapper({ operationId, requestSha256, ...extra }, async () => { calls++; return response(); }));
  }
  for (const extra of [{ category: 'OST_Walls' }, { elementIds: [99] }, { method: 'revit.plan.confirm' }, { params: {} }, { phase: 'SAVE_READBACK_PENDING' }]) {
    await assert.rejects(verifyLifecycleScope({ operationId, requestSha256, readIndex: 0, ...extra }, async () => { calls++; return response(); }));
  }
  await assert.rejects(prepareLifecycle({ operationId }, async () => { calls++; return response(); }));
  assert.equal(calls, 0);
});

test('unknown terminal outcomes remain observational and never dispatch a follow-up action', async () => {
  for (const stage of ['SAVE_OUTCOME_UNKNOWN', 'OPEN_OUTCOME_UNKNOWN', 'FAILED', 'STOPPED', 'CANCELLED']) {
    const value = response(stage); value.stopReason = 'native_outcome_unknown';
    const calls = [];
    const result = await getLifecycle({ operationId, requestSha256 }, async (method, params) => { calls.push({ method, params }); return value; });
    assert.equal(result.stage, stage); assert.equal(result.stopReason, value.stopReason); assert.equal(result.allModelSideEffectsVerified, false);
    assert.deepEqual(calls.map(item => item.method), ['revit.lifecycle.get']);
    await assert.rejects(verifyLifecycleScope({ operationId, requestSha256, readIndex: 0 }, async () => value), error => error.code === 'lifecycle_scope_mismatch');
  }
});

test('invalid native request/state/phase evidence cannot return successful lifecycle observations', () => {
  const mutations = [
    value => { value.operationId = 'f'.repeat(32); }, value => { value.requestSha256 = 'F'.repeat(64); },
    value => { value.latestState.operationId = 'f'.repeat(32); }, value => { value.latestState.requestSha256 = 'F'.repeat(64); },
    value => { value.latestState.stage = 'SAVE_STARTED'; }, value => { value.recipeCount++; },
    value => { value.readIndex = 9; }, value => { value.readRound = 1; },
    value => { value.eventCount = 1; }, value => { value.eventTailSha256 = 'F'.repeat(64); },
    value => { value.automaticRetry = true; }, value => { value.allModelSideEffectsVerified = true; },
    value => { value.request.registration.modelPath = 'other.rvt'; }, value => { value.request.savedFile.path = 'other.rvt'; },
    value => { value.request.expiresAtUtc = value.request.createdAtUtc; }, value => { value.request.process.version = '27.4.0.1'; },
    value => { value.request.process.pid = Number.MAX_SAFE_INTEGER + 1; }, value => { value.request.recipeCount = 101; },
    value => { value.request.registration.readRecipes[3].params.expectedRevision = 1; },
    value => { value.request.registration.readRecipes[0].method = 'revit.plan.confirm'; },
    value => { value.request.bridgeConfig.token = 'secret'; }, value => { value.latestState.data.badNumber = Infinity; },
    value => { delete value.scope; }, value => { delete value.stopReason; }, value => { delete value.eventTailSha256; },
    value => { value.unknownCertification = true; }
  ];
  for (const mutate of mutations) { const value = clone(response()); mutate(value); assert.throws(() => validateLifecycleResponse('revit.lifecycle.get', { operationId, requestSha256 }, value)); }
  const foreignRequest = clone(request); foreignRequest.savedFile.bytes++;
  assert.throws(() => validateLifecycleResponse('revit.lifecycle.get', { operationId, requestSha256 }, response(), { request: foreignRequest }), error => error.code === 'lifecycle_request_mismatch');
  assert.throws(() => validateLifecycleResponse('revit.lifecycle.get', { operationId, requestSha256 }, response(), { stage: 'SAVE_VERIFIED' }), error => error.code === 'lifecycle_stage_mismatch');
});

test('lifecycle preview cannot grant a lease, queued exit, read result or progressed phase', () => {
  for (const mutate of [value => { value.leaseActive = true; }, value => { value.exitPosted = true; }, value => { value.readIndex = 1; }, value => { value.stopReason = 'stopped'; }, value => { value.stage = 'SAVE_STARTED'; value.latestState.stage = value.stage; }]) {
    const value = clone(response()); mutate(value);
    assert.throws(() => validateLifecycleResponse('revit.lifecycle.prepare', {}, value), error => error.code === 'lifecycle_response_invalid');
  }
});

test('complete lifecycle responses reject evidence overflow without slicing records', () => {
  const value = response(); value.latestState.data.large = 'x'.repeat(8 * 1024 * 1024);
  assert.throws(() => validateLifecycleResponse('revit.lifecycle.get', { operationId, requestSha256 }, value), error => error.code === 'lifecycle_response_invalid');
});

test('cancelled lifecycle requests never dispatch, and signal is forwarded unchanged', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(saveLifecycleOnce({ operationId, requestSha256 }, async () => { calls++; return response(); }, controller.signal), error => error.name === 'AbortError');
  assert.equal(calls, 0);
  const live = new AbortController();
  await getLifecycle({ operationId, requestSha256 }, async (_method, _params, signal) => { assert.equal(signal, live.signal); return response(); }, live.signal);
});

test('verify_scope accepts only the fixed recipe index and preserves full native result fields', async () => {
  const scopeResult = inspectResult();
  const scope = { phase: 'SAVE_READBACK_PENDING', readIndex: 2, method: 'revit.inspect', documentIdentity, documentRevision: 0, result: scopeResult, matched: true };
  const value = response('SAVE_READBACK_PENDING', 3, scope);
  value.leaseActive = true;
  const result = validateLifecycleResponse('revit.lifecycle.verify_scope', { operationId, requestSha256, readIndex: 2 }, value, { phase: 'SAVE_READBACK_PENDING', documentIdentity, documentRevision: 0 });
  assert.deepEqual(result.scope.result, scopeResult);
  await assert.rejects(verifyLifecycleScope({ operationId, requestSha256, readIndex: 0 }, async () => response('SAVE_READBACK_PENDING', 1, { ...scope, readIndex: 1, method: 'revit.context.get', result: { active: true, document: { identity: documentIdentity, revision: 0, path: 'C:\\test\\copy.rvt', isModified: false, isReadOnly: false } } })), /Lifecycle read response differs/);
});

test('verify_scope validates every fixed recipe through two complete saved and reopened rounds', async () => {
  for (const [phase, identity] of [['SAVE_READBACK_PENDING', documentIdentity], ['OPEN_READBACK_PENDING', 'b'.repeat(32)]]) {
    for (let index = 0; index < 2 * recipes.length; index++) {
      const value = scopeResponse(index, phase, identity);
      const calls = [];
      const validated = await verifyLifecycleScope({ operationId, requestSha256, readIndex: index }, async (method, params) => { calls.push({ method, params }); return value; }, undefined, { request, phase, documentIdentity: identity, documentRevision: 0 });
      assert.deepEqual(validated.scope.result, value.scope.result);
      assert.deepEqual(calls, [{ method: 'revit.lifecycle.verify_scope', params: { operationId, requestSha256, readIndex: index } }]);
      assert.equal(validated.readRound, Math.floor((index + 1) / recipes.length));
    }
  }
});

test('verify_scope rejects unstable context evidence and incorrect lease or stop state', () => {
  for (const mutate of [
    value => { value.scope.result.document.path = 'C:\\\\other\\\\copy.rvt'; },
    value => { value.scope.result.document.isModified = true; },
    value => { value.scope.result.document.isReadOnly = true; },
    value => { value.leaseActive = false; },
    value => { value.stopReason = 'unexpected_stop'; }
  ]) {
    const value = scopeResponse(0); mutate(value);
    assert.throws(() => validateLifecycleResponse('revit.lifecycle.verify_scope', { operationId, requestSha256, readIndex: 0 }, value, { phase: 'SAVE_READBACK_PENDING', documentIdentity, documentRevision: 0 }));
  }
});

test('reopened verification never accepts an old identity, nonzero revision or changed local pin', () => {
  const identity = 'b'.repeat(32);
  const args = { operationId, requestSha256, readIndex: 0 };
  const expected = { phase: 'OPEN_READBACK_PENDING', documentIdentity: identity, documentRevision: 0 };
  for (const [nativeIdentity, revision] of [[documentIdentity, 0], [identity, 1], ['c'.repeat(32), 0]]) {
    assert.throws(() => validateLifecycleResponse('revit.lifecycle.verify_scope', args, scopeResponse(0, 'OPEN_READBACK_PENDING', nativeIdentity, revision), expected));
  }
  assert.throws(() => validateLifecycleResponse('revit.lifecycle.verify_scope', args, scopeResponse(0, 'OPEN_READBACK_PENDING', identity), { ...expected, phase: 'SAVE_READBACK_PENDING' }), error => error.code === 'lifecycle_scope_mismatch');
  assert.throws(() => validateLifecycleResponse('revit.lifecycle.verify_scope', args, scopeResponse(0, 'OPEN_READBACK_PENDING', identity), { ...expected, documentRevision: 2 }), error => error.code === 'document_revision_changed');
  for (const [phase, wrongLease] of [['SAVE_READBACK_PENDING', false], ['OPEN_READBACK_PENDING', true]]) {
    const value = scopeResponse(7, phase, phase.startsWith('OPEN') ? identity : documentIdentity); value.leaseActive = wrongLease;
    assert.throws(() => validateLifecycleResponse('revit.lifecycle.verify_scope', { operationId, requestSha256, readIndex: 7 }, value), error => error.code === 'lifecycle_scope_mismatch');
  }
});

test('fixed search pages reject incomplete, malformed or altered native membership evidence', () => {
  for (const mutate of [
    result => { result.offset = 500; }, result => { result.limit = 100; },
    result => { result.items.push(clone(result.items[0])); }, result => { result.items[0].id = -1; },
    result => { result.items[0].id = 1.5; }, result => { result.items = Array.from({ length: 501 }, (_item, index) => ({ id: index + 1 })); },
    result => { delete result.hasMore; }, result => { result.truncated = true; },
    result => { delete result.items[0].uniqueId; }, result => { result.items[0].levelId = Number.MIN_SAFE_INTEGER - 1; }
  ]) {
    const value = scopeResponse(1); mutate(value.scope.result);
    assert.throws(() => validateLifecycleResponse('revit.lifecycle.verify_scope', { operationId, requestSha256, readIndex: 1 }, value), error => error.code === 'lifecycle_scope_invalid');
  }
});

test('fixed inspection and dependencies reject omitted roots, reordered IDs and false certification', () => {
  for (const [index, mutations] of [
    [2, [result => { result.items.pop(); }, result => { result.items.reverse(); }, result => { result.items[0].exists = false; }, result => { delete result.items[0].summary; }, result => { delete result.items[0].parameters; }, result => { delete result.items[0].connectors; }, result => { delete result.items[0].piping; }, result => { result.items[0].summary.geometry = [1, Infinity]; }]],
    [3, [result => { result.items.pop(); }, result => { result.items.reverse(); }, result => { result.documentIdentity = 'b'.repeat(32); }, result => { result.documentRevision++; }, result => { result.items[0].dependencies.complete = true; }, result => { result.allModelSideEffectsVerified = true; }, result => { result.items[0].dependencies.truncated = true; }]]
  ]) {
    for (const mutate of mutations) {
      const value = scopeResponse(index); mutate(value.scope.result);
      assert.throws(() => validateLifecycleResponse('revit.lifecycle.verify_scope', { operationId, requestSha256, readIndex: index }, value));
    }
  }
});

test('registered dependency membership is session-neutral and cannot hide historical session fields', () => {
  const updated = clone(request); updated.document.identity = 'b'.repeat(32); updated.document.revision = 3;
  assert.deepEqual(lifecyclePreparedRequestSchema.parse(updated), updated);
  for (const mutate of [
    params => { params.documentIdentity = documentIdentity; }, params => { params.expectedRevision = 0; },
    params => { params.elementIds = [10, 10]; }, params => { params.elementIds = Array.from({ length: 21 }, (_item, index) => index + 1); }
  ]) {
    const value = clone(request); mutate(value.registration.readRecipes[3].params);
    assert.throws(() => lifecyclePreparedRequestSchema.parse(value));
  }
});

test('state sequence and read progress cannot contradict the immutable native status', () => {
  for (const mutate of [
    value => { value.latestState.sequence = 0; }, value => { value.latestState.sequence = 2; },
    value => { value.latestState.previousSha256 = '1'.repeat(64); }, value => { delete value.latestState.data.readIndex; },
    value => { value.latestState.data.readIndex = 1; }
  ]) {
    const value = response(); mutate(value);
    assert.throws(() => validateLifecycleResponse('revit.lifecycle.get', { operationId, requestSha256 }, value), error => error.code === 'lifecycle_response_invalid');
  }
  const value = response('SAVE_READBACK_PENDING'); value.latestState.sequence = 2; value.latestState.previousSha256 = '1'.repeat(64);
  assert.doesNotThrow(() => validateLifecycleResponse('revit.lifecycle.get', { operationId, requestSha256: requestSha256.toLowerCase() }, value));
});

test('action replay returns the latest durable phase without claiming a newly executed action', async () => {
  for (const wrapper of [saveLifecycleOnce, postLifecycleExitOnce, openSavedCopyOnce]) for (const stage of ['SAVE_VERIFIED', 'EXIT_POSTED', 'REOPEN_VERIFIED', 'STOPPED', 'SAVE_OUTCOME_UNKNOWN', 'OPEN_OUTCOME_UNKNOWN']) {
    const value = response(stage, stage === 'REOPEN_VERIFIED' ? 8 : 0); let calls = 0;
    const result = await wrapper({ operationId, requestSha256 }, async () => { calls++; return value; });
    assert.equal(calls, 1); assert.deepEqual(result, value); assert.equal(result.allModelSideEffectsVerified, false);
  }
});

async function clientFixture(t, { features = ['local-test-copy-lifecycle'], native = response(), nativeError, disconnectMethods = [] } = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-lifecycle-mcp-'));
  const token = 'lifecycle-test-token-'.repeat(4); const calls = []; const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); let input = '';
    socket.on('data', chunk => { input += chunk.toString('utf8'); const newline = input.indexOf('\n'); if (newline < 0) return;
      const message = JSON.parse(input.slice(0, newline)); calls.push(message); assert.equal(message.token, token);
      const isInfo = message.method === 'revit.bridge.info';
      if (!isInfo && disconnectMethods.includes(message.method)) { socket.end(); return; }
      if (!isInfo && nativeError) { socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ok: false, error: nativeError }) + '\n'); return; }
      const result = isInfo ? { protocol: 'revit-auto-2027-v2', version: '0.4.0', features, confirmationMode: 'chat' } : typeof native === 'function' ? native(message) : clone(native);
      socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ok: true, result }) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = path.join(folder, 'bridge.json'); await fs.writeFile(config, JSON.stringify({ port: server.address().port, token }));
  const client = new Client({ name: 'lifecycle-contract', version: '1.0' }); t.after(() => client.close());
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(folder, { recursive: true, force: true }); });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve(import.meta.dirname, '../revit-custom.mjs')], env: { REVIT_AI_CONFIG: config }, stderr: 'pipe' }));
  return { client, calls };
}

test('lifecycle tools publish strict read-only/action annotations and traverse the SDK without plans', async t => {
  const { client, calls } = await clientFixture(t);
  const tools = (await client.listTools()).tools;
  for (const [name, readOnly, idempotent] of [['revit_lifecycle_prepare', true, false], ['revit_lifecycle_get', true, true], ['revit_lifecycle_verify_scope', true, false], ['revit_lifecycle_save_once', false, false], ['revit_lifecycle_post_exit_once', false, false], ['revit_lifecycle_open_saved_copy_once', false, false], ['revit_lifecycle_stop', false, false]]) {
    const tool = tools.find(item => item.name === name); assert.ok(tool, name); assert.equal(tool.annotations.readOnlyHint, readOnly); assert.equal(tool.annotations.destructiveHint, !readOnly); assert.equal(tool.annotations.idempotentHint, idempotent); assert.equal(tool.inputSchema.additionalProperties, false); assert.equal(tool.outputSchema.additionalProperties, false);
  }
  const result = await client.callTool({ name: 'revit_lifecycle_prepare', arguments: {} });
  assert.ok(!result.isError, result.content[0]?.text); assert.deepEqual(result.structuredContent, JSON.parse(result.content[0].text));
  const action = await client.callTool({ name: 'revit_lifecycle_save_once', arguments: { operationId, requestSha256 } });
  assert.ok(!action.isError, action.content[0]?.text);
  assert.deepEqual(calls.filter(call => call.method !== 'revit.bridge.info').map(call => call.method), ['revit.lifecycle.prepare', 'revit.lifecycle.save_once']);
});

test('old plugins reject every lifecycle route before a native lifecycle request', async t => {
  const { client, calls } = await clientFixture(t, { features: ['bounded-element-dependencies'] });
  for (const action of ['prepare', 'get', 'verify_scope', 'save_once', 'post_exit_once', 'open_saved_copy_once', 'stop']) {
    const arguments_ = action === 'prepare' ? {} : action === 'verify_scope' ? { operationId, requestSha256, readIndex: 0 } : { operationId, requestSha256 };
    const result = await client.callTool({ name: 'revit_lifecycle_' + action, arguments: arguments_ });
    assert.equal(result.isError, true); const error = JSON.parse(result.content[0].text); assert.equal(error.code, 'feature_not_loaded'); assert.deepEqual(error.details.requiredFeatures, ['local-test-copy-lifecycle']);
  }
  assert.deepEqual(calls.map(call => call.method), Array(7).fill('revit.bridge.info'));
});

test('malformed lifecycle arguments never contact the bridge and invalid native fixed evidence cannot return success', async t => {
  const { client, calls } = await clientFixture(t, { native: { ...response(), modelWritesRequested: true } });
  for (const arguments_ of [{ operationId, requestSha256, extra: true }, { operationId, requestSha256: 'x' }, { operationId, requestSha256, readIndex: -1 }]) {
    const toolName = arguments_.readIndex === -1 ? 'revit_lifecycle_verify_scope' : 'revit_lifecycle_get';
    const result = await client.callTool({ name: toolName, arguments: arguments_ }); assert.equal(result.isError, true);
  }
  assert.deepEqual(calls, []);
  const result = await client.callTool({ name: 'revit_lifecycle_get', arguments: { operationId, requestSha256 } });
  assert.equal(result.isError, true); assert.equal(JSON.parse(result.content[0].text).code, 'lifecycle_response_invalid');
});

test('SDK lifecycle actions preserve durable stage replays and never dispatch model plans', async t => {
  const stages = { 'revit.lifecycle.prepare': 'PREVIEW_READY', 'revit.lifecycle.get': 'REOPEN_VERIFIED', 'revit.lifecycle.save_once': 'SAVE_VERIFIED', 'revit.lifecycle.post_exit_once': 'EXIT_POSTED', 'revit.lifecycle.open_saved_copy_once': 'REOPEN_VERIFIED', 'revit.lifecycle.stop': 'STOPPED' };
  const { client, calls } = await clientFixture(t, { native: message => message.method === 'revit.lifecycle.verify_scope' ? scopeResponse(message.params.readIndex) : response(stages[message.method], stages[message.method] === 'REOPEN_VERIFIED' ? 8 : 0) });
  for (const action of ['prepare', 'get', 'verify_scope', 'save_once', 'post_exit_once', 'open_saved_copy_once', 'stop']) {
    const args = action === 'prepare' ? {} : action === 'verify_scope' ? { operationId, requestSha256, readIndex: 0 } : { operationId, requestSha256 };
    const result = await client.callTool({ name: 'revit_lifecycle_' + action, arguments: args });
    assert.ok(!result.isError, result.content[0]?.text);
    assert.equal(result.structuredContent.stage, action === 'verify_scope' ? 'SAVE_READBACK_PENDING' : stages['revit.lifecycle.' + action]);
    assert.equal(result.structuredContent.allModelSideEffectsVerified, false);
  }
  assert.deepEqual(calls.filter(call => call.method !== 'revit.bridge.info').map(call => call.method), ['prepare', 'get', 'verify_scope', 'save_once', 'post_exit_once', 'open_saved_copy_once', 'stop'].map(action => 'revit.lifecycle.' + action));
});

test('SDK lifecycle native errors propagate unchanged once and never trigger another phase', async t => {
  const nativeError = { code: 'lifecycle_save_unverified', message: 'Save event was not verified.', details: { status: 'SAVE_OUTCOME_UNKNOWN', retryAllowed: false } };
  const { client, calls } = await clientFixture(t, { nativeError });
  for (const action of ['save_once', 'post_exit_once', 'open_saved_copy_once', 'verify_scope']) {
    const args = action === 'verify_scope' ? { operationId, requestSha256, readIndex: 0 } : { operationId, requestSha256 };
    const result = await client.callTool({ name: 'revit_lifecycle_' + action, arguments: args });
    assert.equal(result.isError, true); assert.deepEqual(JSON.parse(result.content[0].text), nativeError);
  }
  assert.deepEqual(calls.filter(call => call.method !== 'revit.bridge.info').map(call => call.method), ['revit.lifecycle.save_once', 'revit.lifecycle.post_exit_once', 'revit.lifecycle.open_saved_copy_once', 'revit.lifecycle.verify_scope']);
});

test('SDK lifecycle lost action receipts remain errors without automatic query, retry or fallback', async t => {
  const methods = ['revit.lifecycle.save_once', 'revit.lifecycle.post_exit_once', 'revit.lifecycle.open_saved_copy_once'];
  const { client, calls } = await clientFixture(t, { disconnectMethods: methods });
  for (const method of methods) {
    const result = await client.callTool({ name: method.replaceAll('.', '_'), arguments: { operationId, requestSha256 } });
    assert.equal(result.isError, true); assert.match(JSON.parse(result.content[0].text).message, /closed the connection before returning/);
  }
  assert.deepEqual(calls.filter(call => call.method !== 'revit.bridge.info').map(call => call.method), methods);
});
