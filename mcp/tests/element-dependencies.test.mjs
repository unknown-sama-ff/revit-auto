import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { elementDependenciesRequestSchema, elementDependenciesResponseSchema, readElementDependencies } from '../element-dependencies.mjs';

const request = { documentIdentity: 'reviewed-session', expectedRevision: 3, elementIds: [20, 10, 30] };
const context = { active: true, document: { identity: 'reviewed-session', revision: 3, path: 'fixture.rvt', isModified: false, isReadOnly: false } };
const unknown = reason => ({ supported: false, complete: false, ids: [], count: null, truncated: false, reason });
const known = ids => ({ supported: true, complete: true, ids, count: ids.length, truncated: false });
const summary = (id, className = 'FamilySymbol') => ({ id, uniqueId: 'native-' + id, name: '', className, category: null, categoryId: null, typeId: -1, ownerViewId: -1, levelId: -1 });
const existing = (id, className = 'FamilySymbol', dependencies = known([]), familySymbols = className === 'Family' ? { applicable: true, ...known([]) } : { applicable: false, ...unknown('not_family') }) => ({ elementId: id, exists: true, summary: summary(id, className), dependencies, familySymbols });
const missing = id => ({ elementId: id, exists: false, summary: null, dependencies: unknown('element_not_found'), familySymbols: { applicable: false, ...unknown('element_not_found') } });
const report = (items = [existing(20, 'Family', known([21]), { applicable: true, ...known([10, 11]) }), existing(10), missing(30)]) => ({
  documentIdentity: request.documentIdentity, documentRevision: request.expectedRevision, items,
  modelWritesRequested: false, automaticSave: false,
  relationshipScope: 'native-logical-dependents-and-family-symbol-membership', allModelSideEffectsVerified: false
});
const clone = value => structuredClone(value);
const mutate = (value, change) => { const result = clone(value); change(result); return result; };

function nativeFixture({ before = context, after = context, response = report(), failure, onCall } = {}) {
  const calls = [];
  let contexts = 0;
  return {
    calls,
    call: async (method, params, signal) => {
      calls.push({ method, params, signal });
      onCall?.(method);
      if (method === 'revit.context.get') return clone(contexts++ === 0 ? before : after);
      assert.equal(method, 'revit.element.dependencies', 'No plan, mutation or save operation is allowed.');
      if (failure) throw failure;
      return clone(response);
    }
  };
}

test('dependency request rejects arbitrary fields, duplicates, coercion and unsafe or unbounded IDs before native reads', async () => {
  const invalid = [
    { ...request, documentIdentity: undefined }, { ...request, documentIdentity: '' }, { ...request, documentIdentity: ' ' },
    { ...request, documentIdentity: 'x'.repeat(201) },
    { ...request, expectedRevision: undefined }, { ...request, expectedRevision: -1 }, { ...request, expectedRevision: 0.5 },
    { ...request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...request, expectedRevision: '3' },
    { ...request, elementIds: [] }, { ...request, elementIds: [10, 10] }, { ...request, elementIds: ['10'] },
    { ...request, elementIds: [0] }, { ...request, elementIds: [-1] }, { ...request, elementIds: [1.5] },
    { ...request, elementIds: [Infinity] }, { ...request, elementIds: [Number.MAX_SAFE_INTEGER + 1] },
    { ...request, elementIds: Array.from({ length: 21 }, (_, i) => i + 1) },
    { ...request, script: 'anything.csx' }, { ...request, delete: true }, { ...request, planId: 'unreviewed' }
  ];
  const fixture = nativeFixture();
  for (const input of invalid) await assert.rejects(readElementDependencies(input, fixture.call));
  assert.deepEqual(fixture.calls, []);
  const boundary = { ...request, expectedRevision: Number.MAX_SAFE_INTEGER, elementIds: Array.from({ length: 20 }, (_, i) => Number.MAX_SAFE_INTEGER - i) };
  assert.deepEqual(elementDependenciesRequestSchema.parse(boundary), boundary);
});

test('relationship query retains null, absent category, native invalid IDs, known-empty and unknown evidence without certification', async () => {
  const response = report();
  delete response.items[1].summary.category;
  delete response.items[1].summary.categoryId;
  response.items[1].dependencies = unknown('native_api_not_supported');
  const fixture = nativeFixture({ response });
  const result = await readElementDependencies(request, fixture.call);
  assert.deepEqual(result, response);
  assert.equal(result.items[0].summary.typeId, -1);
  assert.equal(result.items[0].summary.category, null);
  assert.equal(Object.hasOwn(result.items[1].summary, 'category'), false);
  assert.equal(result.items[0].familySymbols.count, 2);
  assert.equal(result.items[1].dependencies.count, null);
  assert.equal(result.items[1].familySymbols.supported, false);
  assert.equal(result.items[2].summary, null);
  assert.equal(result.allModelSideEffectsVerified, false);
  assert.deepEqual(fixture.calls.map(call => call.method), ['revit.context.get', 'revit.element.dependencies', 'revit.context.get']);
  assert.deepEqual(fixture.calls[1].params, request);
  const empty = elementDependenciesResponseSchema.parse(report([existing(10)])).items[0].dependencies;
  assert.equal(empty.supported, true);
  assert.equal(empty.complete, true);
  assert.equal(empty.count, 0);
});

test('strict dependency response rejects omitted nulls, invented summaries, unsafe metadata, unknown fields and false certification', () => {
  const invalid = [
    response => { delete response.items[2].summary; }, response => { delete response.items[2].dependencies.count; },
    response => { response.items[0].summary.typeId = null; }, response => { response.items[0].summary.typeId = Number.MIN_SAFE_INTEGER - 1; },
    response => { response.items[0].summary.ownerViewId = '10'; }, response => { response.items[0].summary.levelId = 1.5; },
    response => { response.items[0].summary.uniqueId = ' '; }, response => { response.items[0].summary.className = ''; },
    response => { response.items[0].summary.category = false; }, response => { response.items[0].summary.categoryId = 'unknown'; },
    response => { response.items[0].summary.extra = 'guessed'; }, response => { response.items[0].extra = true; },
    response => { response.items[0].dependencies.extra = true; }, response => { response.plan = {}; },
    response => { response.modelWritesRequested = true; }, response => { response.automaticSave = true; },
    response => { response.allModelSideEffectsVerified = true; }, response => { response.relationshipScope = 'all-model-changes'; },
    response => { response.items[0].dependencies.truncated = true; }, response => { delete response.allModelSideEffectsVerified; }
  ];
  for (const change of invalid) assert.equal(elementDependenciesResponseSchema.safeParse(mutate(report(), change)).success, false);
});

test('evidence status cannot represent unsupported data as known-empty or accept partial lists as complete', () => {
  const invalid = [
    response => { response.items[0].dependencies.complete = false; }, response => { response.items[0].dependencies.count = 0; },
    response => { response.items[1].dependencies = { ...unknown('native_api_not_supported'), count: 0 }; },
    response => { response.items[1].dependencies = { ...unknown('native_api_not_supported'), complete: true }; },
    response => { response.items[1].dependencies = { ...unknown('native_api_not_supported'), ids: [10] }; },
    response => { response.items[1].dependencies = unknown(' '); }, response => { delete response.items[1].familySymbols.reason; },
    response => { response.items[1].familySymbols.supported = true; },
    response => { response.items[0].familySymbols = { applicable: false, ...unknown('not_family') }; },
    response => { response.items[1].familySymbols = { applicable: true, ...known([]) }; },
    response => { response.items[1].familySymbols.reason = 'native_api_not_supported'; },
    response => { response.items[2].summary = summary(30); }, response => { response.items[2].dependencies = known([]); },
    response => { response.items[2].familySymbols.reason = 'not_family'; },
    response => { response.items[2].familySymbols.applicable = true; },
    response => { response.items[0].summary.id = 99; }, response => { response.items[0].summary = null; },
    response => { response.items.push(clone(response.items[0])); }
  ];
  for (const change of invalid) assert.equal(elementDependenciesResponseSchema.safeParse(mutate(report(), change)).success, false);
});

test('sorted unique positive ID lists allow their precise budget and reject overflow rather than truncate', () => {
  const ids = Array.from({ length: 4096 }, (_, i) => i + 1);
  const exact = report(Array.from({ length: 4 }, (_, i) => existing(i + 1, 'FamilySymbol', known(ids))));
  assert.equal(elementDependenciesResponseSchema.safeParse(exact).success, true);
  const overTotal = report([...exact.items, existing(5, 'FamilySymbol', known([1]))]);
  assert.equal(elementDependenciesResponseSchema.safeParse(overTotal).success, false);
  const overList = report([existing(1, 'FamilySymbol', known([...ids, 4097]))]);
  assert.equal(elementDependenciesResponseSchema.safeParse(overList).success, false);
  const exactMixed = report([existing(1, 'Family', known(ids), { applicable: true, ...known(ids) }), existing(2, 'Family', known(ids), { applicable: true, ...known(ids) })]);
  assert.equal(elementDependenciesResponseSchema.safeParse(exactMixed).success, true);
  for (const list of [[2, 1], [1, 1], [0], [-1], [1.1], [Number.MAX_SAFE_INTEGER + 1]]) {
    assert.equal(elementDependenciesResponseSchema.safeParse(report([existing(1, 'FamilySymbol', known(list))])).success, false);
    assert.equal(elementDependenciesResponseSchema.safeParse(report([existing(1, 'Family', known([]), { applicable: true, ...known(list) })])).success, false);
  }
  assert.equal(elementDependenciesResponseSchema.safeParse(report([])).success, false);
  assert.equal(elementDependenciesResponseSchema.safeParse(report(Array.from({ length: 21 }, (_, i) => missing(i + 1)))).success, false);
});

test('unreviewed or incomplete context blocks the dependency request before dispatch', async () => {
  const cases = [
    [{ active: false }, 'no_active_document'],
    [mutate(context, value => { value.document.identity = 'other'; }), 'document_changed'],
    [mutate(context, value => { value.document.revision++; }), 'document_revision_changed'],
    [mutate(context, value => { delete value.document.path; }), 'element_dependencies_context_invalid'],
    [mutate(context, value => { delete value.document.isReadOnly; }), 'element_dependencies_context_invalid'],
    [mutate(context, value => { value.document.isModified = null; }), 'element_dependencies_context_invalid'],
    [mutate(context, value => { value.document.revision = Number.MAX_SAFE_INTEGER + 1; }), 'element_dependencies_context_invalid']
  ];
  for (const [before, code] of cases) {
    const fixture = nativeFixture({ before });
    await assert.rejects(readElementDependencies(request, fixture.call), error => error.code === code);
    assert.deepEqual(fixture.calls.map(call => call.method), ['revit.context.get']);
  }
});

test('native evidence must identify the same document, revision and exact requested element set', async () => {
  const cases = [
    [mutate(report(), value => { value.documentIdentity = 'other'; }), 'document_changed'],
    [mutate(report(), value => { value.documentRevision++; }), 'document_revision_changed'],
    [report([existing(10)]), 'element_dependencies_scope_mismatch'],
    [report([existing(20), existing(10), missing(99)]), 'element_dependencies_scope_mismatch'],
    [report(report().items.reverse()), 'element_dependencies_scope_mismatch'],
    [mutate(report(), value => { value.items[0].dependencies.complete = false; }), 'element_dependencies_response_invalid']
  ];
  for (const [response, code] of cases) {
    const fixture = nativeFixture({ response });
    await assert.rejects(readElementDependencies(request, fixture.call), error => error.code === code);
    assert.deepEqual(fixture.calls.map(call => call.method), ['revit.context.get', 'revit.element.dependencies']);
  }
});

test('post-read document identity, revision, path, modified and read-only changes discard evidence', async () => {
  const cases = [
    ['identity', 'other', 'document_changed'], ['revision', 4, 'document_revision_changed'],
    ['path', 'other.rvt', 'element_dependencies_state_changed'], ['isModified', true, 'element_dependencies_state_changed'],
    ['isReadOnly', true, 'element_dependencies_state_changed']
  ];
  for (const [field, value, code] of cases) {
    const fixture = nativeFixture({ after: mutate(context, after => { after.document[field] = value; }) });
    await assert.rejects(readElementDependencies(request, fixture.call), error => error.code === code);
    assert.equal(fixture.calls.length, 3);
  }
  const unchanged = mutate(context, value => { value.document.isModified = true; value.document.isReadOnly = true; value.document.path = ''; });
  const fixture = nativeFixture({ before: unchanged, after: unchanged });
  assert.equal((await readElementDependencies(request, fixture.call)).automaticSave, false);
});

test('dependency reads do not retry native errors, create plans, delete elements or save', async () => {
  const failure = Object.assign(new Error('Native evidence exceeds budget'), { code: 'element_dependencies_limit_exceeded' });
  const fixture = nativeFixture({ failure });
  await assert.rejects(readElementDependencies(request, fixture.call), error => error === failure);
  assert.deepEqual(fixture.calls.map(call => call.method), ['revit.context.get', 'revit.element.dependencies']);
});

test('cancellation before or between dependency reads prevents subsequent dispatch', async () => {
  for (const cancelAt of ['start', 'revit.context.get', 'revit.element.dependencies']) {
    const controller = new AbortController();
    if (cancelAt === 'start') controller.abort();
    const fixture = nativeFixture({ onCall: method => { if (method === cancelAt) controller.abort(); } });
    await assert.rejects(readElementDependencies(request, fixture.call, controller.signal), error => error.name === 'AbortError');
    const expected = cancelAt === 'start' ? [] : cancelAt === 'revit.context.get' ? ['revit.context.get'] : ['revit.context.get', 'revit.element.dependencies'];
    assert.deepEqual(fixture.calls.map(call => call.method), expected);
  }
});

async function clientFixture(t, { features = ['bounded-element-dependencies'], response = report(), nativeFailure } = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-dependencies-mcp-'));
  const calls = [], sockets = new Set();
  const token = 'dependency-fixture-token-'.repeat(4);
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const message = JSON.parse(buffer.slice(0, newline));
      assert.equal(message.token, token);
      calls.push(message);
      let result;
      if (message.method === 'revit.bridge.info') result = { protocol: 'revit-auto-2027-v2', version: '0.4.0', features, confirmationMode: 'chat' };
      else if (message.method === 'revit.context.get') result = context;
      else { assert.equal(message.method, 'revit.element.dependencies'); result = response; }
      const payload = message.method === 'revit.element.dependencies' && nativeFailure ? { ok: false, error: nativeFailure } : { ok: true, result };
      socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ...payload }) + '\n');
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('revit-dependencies-mcp-'));
    await fs.rm(folder, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = path.join(folder, 'bridge.json');
  await fs.writeFile(config, JSON.stringify({ port: server.address().port, token }));
  const client = new Client({ name: 'element-dependencies-contract', version: '1.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve(import.meta.dirname, '../revit-custom.mjs')], env: { REVIT_AI_CONFIG: config }, stderr: 'pipe' }));
  return { client, calls };
}

test('element dependencies publishes strict pinned read-only MCP schemas and makes one native query between context reads (mock)', async t => {
  const { client, calls } = await clientFixture(t);
  const tool = (await client.listTools()).tools.find(item => item.name === 'revit_element_dependencies');
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.annotations.idempotentHint, true);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(new Set(tool.inputSchema.required), new Set(['documentIdentity', 'expectedRevision', 'elementIds']));
  assert.equal(tool.inputSchema.properties.elementIds.maxItems, 20);
  assert.equal(tool.outputSchema.additionalProperties, false);
  assert.equal(tool.outputSchema.properties.allModelSideEffectsVerified.const, false);
  const result = await client.callTool({ name: tool.name, arguments: request });
  assert.ok(!result.isError, result.content[0].text);
  assert.deepEqual(JSON.parse(result.content[0].text), report());
  assert.deepEqual(result.structuredContent, report());
  assert.deepEqual(calls.filter(call => call.method !== 'revit.bridge.info').map(call => call.method), ['revit.context.get', 'revit.element.dependencies', 'revit.context.get']);
  assert.deepEqual(calls.find(call => call.method === 'revit.element.dependencies').params, request);
});

test('old plugins cannot receive a dependency query even when other read capabilities are loaded (mock)', async t => {
  const { client, calls } = await clientFixture(t, { features: ['document-change-history'] });
  const result = await client.callTool({ name: 'revit_element_dependencies', arguments: request });
  assert.equal(result.isError, true);
  const error = JSON.parse(result.content[0].text);
  assert.equal(error.code, 'feature_not_loaded');
  assert.deepEqual(error.details.requiredFeatures, ['bounded-element-dependencies']);
  assert.equal(calls.filter(call => call.method === 'revit.element.dependencies').length, 0);
});

test('MCP rejects arbitrary input before any bridge access and invalid native evidence before returning success (mock)', async t => {
  const { client, calls } = await clientFixture(t, { response: mutate(report(), value => { value.allModelSideEffectsVerified = true; }) });
  for (const input of [{ ...request, elementIds: [10, 10] }, { ...request, expectedRevision: undefined }, { ...request, script: 'unrestricted.csx' }]) {
    const result = await client.callTool({ name: 'revit_element_dependencies', arguments: input });
    assert.equal(result.isError, true);
  }
  assert.deepEqual(calls, []);
  const result = await client.callTool({ name: 'revit_element_dependencies', arguments: request });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).code, 'element_dependencies_response_invalid');
  assert.equal(result.structuredContent, undefined);
  assert.equal(calls.filter(call => call.method === 'revit.element.dependencies').length, 1);
});

test('native dependency error is exposed unchanged once without fallback, plans or automatic retry (mock)', async t => {
  const failure = { code: 'element_dependencies_limit_exceeded', message: 'Native evidence exceeds budget', details: { maxIdsPerList: 4096 } };
  const { client, calls } = await clientFixture(t, { nativeFailure: failure });
  const result = await client.callTool({ name: 'revit_element_dependencies', arguments: request });
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), failure);
  assert.deepEqual(calls.filter(call => call.method !== 'revit.bridge.info').map(call => call.method), ['revit.context.get', 'revit.element.dependencies']);
});
