import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { discoverElectricalCircuitCandidates } from '../circuit-candidates.mjs';

const sourcePath = path.resolve(import.meta.dirname, '../electrical-circuit-acceptance.mjs');

test('existing-member circuit acceptance runner never confirms, commits, saves or restarts', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  assert.doesNotMatch(source, /call\(['"]revit_(plan_confirm|import_commit)/);
  assert.doesNotMatch(source, /revit\.(lifecycle|save|open|exit)/);
  assert.match(source, /verifyExistingElectricalCircuitCreation/);
  assert.match(source, /acceptance: 'existing-member-circuit'/);
  assert.match(source, /planCreated/);
  assert.match(source, /modelWritesRequested: 0/);
});

test('existing-member circuit acceptance runner pins a dedicated test copy and one circuit operation', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  assert.match(source, /assertTestDocument\(before, project, originalProject\)/);
  assert.match(source, /exactly one existing-member circuit/);
  assert.match(source, /name: 'electrical\.circuit'/);
  assert.match(source, /expectedRevision: before\.document\.revision/);
});

test('existing-member circuit acceptance runner exposes read-only candidate discovery', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  const discovery = await fs.readFile(path.resolve(import.meta.dirname, '../circuit-candidates.mjs'), 'utf8');
  assert.match(source, /command === 'discover'/);
  assert.match(discovery, /READ_ONLY_CIRCUIT_CANDIDATES/);
  assert.match(discovery, /revit_search/);
  assert.match(source, /modelWritesRequested: 0/);
  assert.match(source, /Usage: discover --project TEST_COPY\.rvt/);
});

test('candidate discovery paginates searches, batches inspection, and retains unknown memberships', async () => {
  const calls = [];
  const categories = { OST_LightingFixtures: -2001120, OST_LightingDevices: -2008087, OST_ElectricalEquipment: -2001040 };
  const makeItem = (id, categoryId, systemIds, connectors = [{ connectorId: 0, domain: 'DomainElectrical', domainSupported: true }]) => ({
    summary: { id, className: 'FamilyInstance', categoryId, family: 'F', type: 'T', mark: `M${id}` },
    electrical: systemIds === undefined ? undefined : { systemIds }, connectors
  });
  const native = new Map([
    [1, makeItem(1, categories.OST_LightingFixtures, [])],
    [2, makeItem(2, categories.OST_LightingFixtures, undefined)],
    [3, makeItem(3, categories.OST_LightingDevices, [])],
    [4, makeItem(4, categories.OST_ElectricalEquipment, [])]
  ]);
  const call = async (method, args) => {
    calls.push({ method, args });
    if (method === 'revit_search') {
      const ids = args.category === 'OST_LightingFixtures' ? [1, 2] : args.category === 'OST_LightingDevices' ? [3] : [4];
      const items = ids.slice(args.offset, args.offset + args.limit).map(id => ({ ...native.get(id).summary }));
      return { items, limit: args.limit, offset: args.offset, hasMore: args.offset + items.length < ids.length };
    }
    return { items: args.elementIds.map(id => native.get(id)) };
  };
  const result = await discoverElectricalCircuitCandidates(call);
  assert.deepEqual(result.fixtures.map(row => row.id), [1]);
  assert.deepEqual(result.switches.map(row => row.id), [3]);
  assert.deepEqual(result.excludedFixtures.map(row => row.id), [2]);
  assert.deepEqual(result.panels.map(row => row.id), [4]);
  assert.equal(result.modelWritesRequested, false);
  assert.equal(result.planCreationRequested, false);
  assert.deepEqual(result.scannedCounts, { lightingFixtures: 2, lightingDevices: 1, electricalEquipment: 1 });
  assert.deepEqual(result.availableCounts, { fixtures: 1, switches: 1, panels: 1 });
  assert.deepEqual(calls.filter(item => item.method === 'revit_inspect').map(item => item.args.elementIds), [[1, 2, 3, 4]]);
});

test('candidate discovery scans large scopes in native-sized batches and fails on malformed paging', async () => {
  const ids = Array.from({ length: 201 }, (_, index) => index + 1);
  const call = async (method, args) => {
    if (method === 'revit_search') {
      const isFixture = args.category === 'OST_LightingFixtures';
      const items = isFixture ? ids.slice(args.offset, args.offset + args.limit).map(id => ({ id, className: 'FamilyInstance', categoryId: -2001120 })) : [];
      return { items, limit: args.limit, offset: args.offset, hasMore: isFixture && args.offset + items.length < ids.length };
    }
    return { items: args.elementIds.map(id => ({ summary: { id, className: 'FamilyInstance', categoryId: -2001120 }, electrical: { systemIds: [] }, connectors: [{ connectorId: 0, domain: 'DomainElectrical', domainSupported: true }] })) };
  };
  await discoverElectricalCircuitCandidates(call);
  const batches = [];
  const capture = async (method, args) => { if (method === 'revit_inspect') batches.push(args.elementIds.length); return call(method, args); };
  await discoverElectricalCircuitCandidates(capture);
  assert.deepEqual(batches, [100, 100, 1]);
  await assert.rejects(discoverElectricalCircuitCandidates(async (method, args) => method === 'revit_search' ? { items: [], offset: args.offset, hasMore: true } : { items: [] }), error => error.code === 'circuit_candidate_scope_unknown');
});

test('candidate paging visits the next native page and rejects partial or repeated membership', async () => {
  const searchedOffsets = [];
  const native = Array.from({ length: 501 }, (_, index) => ({ id: index + 1, className: 'FamilyInstance', categoryId: -2001120 }));
  const call = async (method, args) => {
    if (method === 'revit_search') {
      const rows = args.category === 'OST_LightingFixtures' ? native : [];
      searchedOffsets.push([args.category, args.offset]);
      return { items: rows.slice(args.offset, args.offset + 500), offset: args.offset, limit: 500, hasMore: args.offset + 500 < rows.length };
    }
    assert.equal(method, 'revit_inspect');
    return { items: args.elementIds.map(id => ({ summary: native[id - 1], electrical: { systemIds: [] }, connectors: [{ connectorId: 0, domainSupported: true, domain: 'DomainElectrical' }] })) };
  };
  const result = await discoverElectricalCircuitCandidates(call);
  assert.equal(result.fixtures.length, 501);
  assert.deepEqual(searchedOffsets, [['OST_LightingFixtures', 0], ['OST_LightingFixtures', 500], ['OST_LightingDevices', 0], ['OST_ElectricalEquipment', 0]]);
  for (const invalid of [
    { items: [], offset: 0, limit: 1, hasMore: false },
    { items: [], offset: 0, limit: 500, hasMore: false, truncated: true },
    { items: [], offset: 0, limit: 500, hasMore: false, complete: false },
    { items: [native[0], native[0]], offset: 0, limit: 500, hasMore: false }
  ]) await assert.rejects(discoverElectricalCircuitCandidates(async () => invalid), { code: 'circuit_candidate_scope_unknown' });
});

test('candidate membership and connector uncertainty excludes fixtures and panels without dropping diagnostics', async () => {
  const baseline = { summary: { id: 1, className: 'FamilyInstance', categoryId: -2001120 }, electrical: { systemIds: [] }, connectors: [{ elementId: 1, connectorId: 0, domainSupported: true, domain: 'DomainElectrical' }] };
  for (const patch of [
    { electrical: { systemIds: [0] } },
    { electrical: { systemIds: [7, 7] } },
    { connectors: [{ domainSupported: true, domain: 'DomainElectrical' }] },
    { connectors: [baseline.connectors[0], baseline.connectors[0]] },
    { connectors: [{ ...baseline.connectors[0], elementId: 2 }] },
    { connectors: [baseline.connectors[0], { connectorsSupported: false, connectorsError: 'enumeration-failed' }] },
    { connectors: 'unknown' },
    { summary: { ...baseline.summary, className: 'Element' } }
  ]) {
    const item = { ...structuredClone(baseline), ...patch };
    const call = async (method, args) => method === 'revit_search'
      ? { items: args.category === 'OST_LightingFixtures' ? [item.summary] : [], offset: args.offset, limit: 500, hasMore: false }
      : { items: [item] };
    const result = await discoverElectricalCircuitCandidates(call);
    assert.deepEqual(result.fixtures, []);
    assert.equal(result.excludedFixtures.length, 1);
    assert.ok(result.excludedFixtures[0].exclusionReasons.length > 0);
  }
  const panel = { summary: { id: 2, className: 'FamilyInstance', categoryId: -2001040 }, electrical: null, connectors: [] };
  const result = await discoverElectricalCircuitCandidates(async (method, args) => method === 'revit_search'
    ? { items: args.category === 'OST_ElectricalEquipment' ? [panel.summary] : [], offset: args.offset, limit: 500, hasMore: false }
    : { items: [panel] });
  assert.equal(result.availableCounts.panels, 0);
  assert.equal(result.excludedPanels[0].membershipState, 'unknown');
});

test('verified empty candidate categories never invoke inspection and cancellation prevents any native read', async () => {
  const calls = [];
  const result = await discoverElectricalCircuitCandidates(async (method, args) => {
    calls.push(method);
    assert.equal(method, 'revit_search');
    return { items: [], offset: args.offset, limit: 500, hasMore: false };
  }, undefined, { OST_LightingFixtures: 0, OST_LightingDevices: 0, OST_ElectricalEquipment: 0 });
  assert.equal(result.categoryCountsVerified, true);
  assert.deepEqual(result.scannedCounts, { lightingFixtures: 0, lightingDevices: 0, electricalEquipment: 0 });
  assert.deepEqual(calls, Array(3).fill('revit_search'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverElectricalCircuitCandidates(async () => { throw new Error('unexpected native read'); }, controller.signal), { name: 'AbortError' });
});

async function discoverCliFixture(testContext, { changeDocument, changeAtRead = 6, reportedCounts } = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'circuit-discover-cli-'));
  const project = path.join(folder, '只读验收副本.rvt');
  const config = path.join(folder, 'bridge.json');
  const guard = path.join(folder, 'guard.mjs');
  const token = 'isolated-cli-bridge-token-'.repeat(3);
  const requests = [];
  const violations = [];
  const sockets = new Set();
  const categories = { OST_LightingFixtures: -2001120, OST_LightingDevices: -2008087, OST_ElectricalEquipment: -2001040 };
  const nativeItem = (id, category, systemIds) => ({
    exists: true,
    summary: { id, className: 'FamilyInstance', categoryId: categories[category], family: 'CLI 验收族', type: 'T', mark: `M${id}` },
    electrical: systemIds === undefined ? undefined : { systemIds },
    connectors: [{ connectorId: 0, domain: 'DomainElectrical', domainSupported: true }]
  });
  const native = new Map([
    [101, nativeItem(101, 'OST_LightingFixtures', [])],
    [102, nativeItem(102, 'OST_LightingFixtures', [901])],
    [103, nativeItem(103, 'OST_LightingFixtures', undefined)],
    [201, nativeItem(201, 'OST_LightingDevices', [])],
    [301, nativeItem(301, 'OST_ElectricalEquipment', [])]
  ]);
  const context = {
    active: true,
    document: {
      title: '只读验收副本', path: project, identity: 'isolated-cli-session', revision: 0,
      isWorkshared: false, isReadOnly: false, isModified: false, isFamilyDocument: false
    },
    counts: reportedCounts ?? { OST_LightingFixtures: 3, OST_LightingDevices: 1, OST_ElectricalEquipment: 1 }
  };
  let contextReads = 0;
  const allowedMethods = new Set(['revit.bridge.info', 'revit.context.get', 'revit.search', 'revit.inspect']);
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    let handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      try {
        const request = JSON.parse(buffer.slice(0, newline));
        requests.push({ method: request.method, params: request.params });
        assert.equal(request.token, token);
        assert.ok(allowedMethods.has(request.method), `Unexpected bridge method: ${request.method}`);
        let result;
        if (request.method === 'revit.bridge.info') {
          result = { protocol: 'revit-auto-2027-v2', version: '0.4.0', features: [], confirmationMode: 'chat', requiresRevitConfirmation: false };
        } else if (request.method === 'revit.context.get') {
          assert.deepEqual(request.params, {});
          result = structuredClone(context);
          contextReads += 1;
          if (changeDocument && contextReads >= changeAtRead) changeDocument(result.document);
        } else if (request.method === 'revit.search') {
          assert.ok(Object.hasOwn(categories, request.params.category));
          assert.deepEqual(request.params, { category: request.params.category, limit: 500, offset: 0 });
          const items = [...native.values()].filter(item => item.summary.categoryId === categories[request.params.category]).map(item => item.summary);
          result = { items, offset: 0, limit: 500, hasMore: false };
        } else {
          assert.deepEqual(request.params, { elementIds: [101, 102, 103, 201, 301] });
          result = { items: request.params.elementIds.map(id => native.get(id)) };
        }
        socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ok: true, result }) + '\n');
      } catch (error) {
        violations.push(error.message);
        socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ok: false, error: { code: 'mock_method_rejected', message: error.message } }) + '\n');
      }
    });
  });
  testContext.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('circuit-discover-cli-'));
    await fs.rm(folder, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await fs.writeFile(project, 'isolated test fixture; not a Revit model', { flag: 'wx' });
  await fs.writeFile(config, JSON.stringify({ port: server.address().port, token }), { flag: 'wx' });
  await fs.writeFile(guard, `import { StdioClientTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/client/stdio.js'))};
const originalStart = StdioClientTransport.prototype.start;
StdioClientTransport.prototype.start = function () {
  if (this._serverParams.env?.REVIT_AI_CONFIG !== process.env.REVIT_AI_CONFIG)
    throw new Error('Isolated CLI tests require the MCP server to use only their mock bridge.');
  return originalStart.call(this);
};
`, { flag: 'wx' });
  const child = spawn(process.execPath, ['--import', pathToFileURL(guard).href, sourcePath, 'discover', '--project', project], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, REVIT_AI_CONFIG: config, REVIT_AI_TIMEOUT_MS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  testContext.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const output = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated discover CLI did not terminate.')); }, 15000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal, stdout, stderr }); });
  });
  assert.deepEqual(violations, [], output.stderr);
  assert.equal(output.signal, null);
  return { ...output, requests, contextReads, project };
}

test('discover CLI traverses registered MCP search and inspect tools through an isolated read-only bridge', { timeout: 20000 }, async testContext => {
  const result = await discoverCliFixture(testContext);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'READ_ONLY_CIRCUIT_CANDIDATES');
  assert.equal(report.document.path, result.project);
  assert.deepEqual(report.fixtures.map(item => item.id), [101]);
  assert.deepEqual(report.switches.map(item => item.id), [201]);
  assert.deepEqual(report.panels.map(item => item.id), [301]);
  assert.deepEqual(report.excludedFixtures.map(item => item.id), [102, 103]);
  assert.deepEqual(report.availableCounts, { fixtures: 1, switches: 1, panels: 1 });
  assert.deepEqual(report.scannedCounts, { lightingFixtures: 3, lightingDevices: 1, electricalEquipment: 1 });
  assert.equal(report.modelWritesRequested, false);
  assert.equal(report.planCreationRequested, false);
  assert.equal(result.contextReads, 6);
  assert.deepEqual(result.requests.filter(request => request.method !== 'revit.bridge.info').map(request => request.method), [
    ...Array(5).fill('revit.context.get'), ...Array(3).fill('revit.search'), 'revit.inspect', 'revit.context.get'
  ]);
});

test('discover CLI rejects a stable context count that exceeds its native candidate search scope', { timeout: 20000 }, async testContext => {
  const result = await discoverCliFixture(testContext, { reportedCounts: { OST_LightingFixtures: 4, OST_LightingDevices: 1, OST_ElectricalEquipment: 1 } });
  assert.equal(result.exitCode, 1, result.stdout || result.stderr);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.status, 'NOT_VERIFIED');
  assert.match(error.code, /circuit_candidate_scope/);
});

for (const [field, changedValue] of [['identity', 'different-session'], ['revision', 1], ['path', path.resolve(os.tmpdir(), 'different-test-copy.rvt')], ['isModified', true], ['isReadOnly', true], ['isFamilyDocument', true], ['isWorkshared', true]]) {
  for (const changeAtRead of [3, 6]) {
    test(`discover CLI rejects ${field} changes at context read ${changeAtRead} without requesting any model action`, { timeout: 20000 }, async testContext => {
      const result = await discoverCliFixture(testContext, { changeAtRead, changeDocument: document => { document[field] = changedValue; } });
      assert.equal(result.exitCode, 1, result.stdout || result.stderr);
      assert.equal(result.stdout, '');
      const error = JSON.parse(result.stderr);
      assert.equal(error.status, 'NOT_VERIFIED');
      assert.equal(result.contextReads, changeAtRead === 3 ? 5 : 6);
      const expectedReads = changeAtRead === 3 ? Array(5).fill('revit.context.get') : [
        ...Array(5).fill('revit.context.get'), ...Array(3).fill('revit.search'), 'revit.inspect', 'revit.context.get'
      ];
      assert.deepEqual(result.requests.filter(request => request.method !== 'revit.bridge.info').map(request => request.method), expectedReads);
    });
  }
}
