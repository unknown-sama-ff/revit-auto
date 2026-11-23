import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { callRevit } from '../bridge.mjs';
import { validateLinksListArgs, validateLinkElementsArgs, listLinks, readLinkElements } from '../links-read.mjs';

async function withMockBridge(t, features) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-links-bridge-'));
  const token = 'links-bridge-fixture-token-'.repeat(3);
  const requests = [];
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = '';
    socket.on('data', chunk => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx < 0) return;
      const req = JSON.parse(buf.slice(0, idx));
      requests.push(req.method);
      const result = req.method === 'revit.bridge.info'
        ? { protocol: 'revit-auto-2027-v2', version: '0.4.0', confirmationMode: 'chat', features }
        : { readOnly: true };
      socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ok: true, result }) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const cfg = path.join(dir, 'bridge.json');
  await fs.writeFile(cfg, JSON.stringify({ port: server.address().port, token }));
  const prevConfig = process.env.REVIT_AI_CONFIG;
  process.env.REVIT_AI_CONFIG = cfg;
  t.after(async () => {
    if (prevConfig === undefined) delete process.env.REVIT_AI_CONFIG;
    else process.env.REVIT_AI_CONFIG = prevConfig;
    for (const s of sockets) s.destroy();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return requests;
}

test('links list validates explicit pins and refuses empty or malformed filters', () => {
  const valid = validateLinksListArgs({ documentIdentity: 'doc-a', expectedRevision: 0, limit: 50 });
  assert.equal(valid.documentIdentity, 'doc-a');
  for (const bad of [
    {},
    { documentIdentity: 'doc-a' },
    { documentIdentity: 'doc-a', expectedRevision: -1 },
    { documentIdentity: 'doc-a', expectedRevision: 0, includeRevitLinks: false, includeCad: false },
    { documentIdentity: 'doc-a', expectedRevision: 0, includeCad: true, includeCadLinks: false, includeCadImports: false },
    { documentIdentity: 'doc-a', expectedRevision: 0, limit: 201 },
    { documentIdentity: 'doc-a', expectedRevision: 0, unknown: true }
  ]) {
    assert.throws(() => validateLinksListArgs(bad), { code: 'invalid_links_request' });
  }
});

test('link elements validates instance id, category, and pagination', () => {
  const valid = validateLinkElementsArgs({
    documentIdentity: 'doc-a', expectedRevision: 2, linkInstanceId: 4001, category: 'OST_Walls', includeBounds: true
  });
  assert.equal(valid.linkInstanceId, 4001);
  for (const bad of [
    { documentIdentity: 'doc-a', expectedRevision: 2 },
    { documentIdentity: 'doc-a', expectedRevision: 2, linkInstanceId: 0 },
    { documentIdentity: 'doc-a', expectedRevision: 2, linkInstanceId: 4001, category: ' OST_Walls' },
    { documentIdentity: 'doc-a', expectedRevision: 2, linkInstanceId: 4001, limit: 201 }
  ]) {
    assert.throws(() => validateLinkElementsArgs(bad), { code: 'invalid_links_request' });
  }
});

test('links helpers dispatch pinned read-only RPCs without mutating input', async () => {
  const calls = [];
  const call = async (method, params) => { calls.push({ method, params }); return { readOnly: true }; };
  await listLinks({ documentIdentity: 'doc-a', expectedRevision: 1 }, call);
  await readLinkElements({ documentIdentity: 'doc-a', expectedRevision: 1, linkInstanceId: 77 }, call);
  assert.deepEqual(calls.map(c => c.method), ['revit.links.list', 'revit.links.elements']);
  assert.equal(calls[1].params.linkInstanceId, 77);
});

test('bridge gates revit.links.list and revit.links.elements behind readonly-links-audit feature', async t => {
  const requests = await withMockBridge(t, []);
  await assert.rejects(
    listLinks({ documentIdentity: 'doc-a', expectedRevision: 0 }, callRevit),
    err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('readonly-links-audit')
  );
  await assert.rejects(
    readLinkElements({ documentIdentity: 'doc-a', expectedRevision: 0, linkInstanceId: 77 }, callRevit),
    err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('readonly-links-audit')
  );
  assert.deepEqual(requests, ['revit.bridge.info', 'revit.bridge.info']);
});
