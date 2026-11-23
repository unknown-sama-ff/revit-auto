import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { callRevit } from '../bridge.mjs';
import { validateMepDisconnectsArgs, readMepDisconnects } from '../mep-disconnects.mjs';

async function withMockBridge(t, features) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-disc-bridge-'));
  const token = 'disconnects-bridge-fixture-token-'.repeat(3);
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

test('mep disconnects validates domain filter, explicit viewId, and pagination bounds', () => {
  const valid = validateMepDisconnectsArgs({
    documentIdentity: 'doc-1', expectedRevision: 0, domain: 'cableTrayConduit', viewId: 770350, offset: 0, limit: 100
  });
  assert.equal(valid.domain, 'cableTrayConduit');
  assert.equal(valid.viewId, 770350);
  for (const bad of [
    {},
    { documentIdentity: 'doc-1' },
    { documentIdentity: 'doc-1', expectedRevision: 0, domain: 'mechanical' },
    { documentIdentity: 'doc-1', expectedRevision: 0, viewId: 0 },
    { documentIdentity: 'doc-1', expectedRevision: 0, viewOnly: true },
    { documentIdentity: 'doc-1', expectedRevision: 0, limit: 201 }
  ]) {
    assert.throws(() => validateMepDisconnectsArgs(bad), { code: 'invalid_mep_disconnects_request' });
  }
});

test('mep disconnects helper dispatches pinned read-only RPC', async () => {
  const calls = [];
  await readMepDisconnects({ documentIdentity: 'doc-1', expectedRevision: 3, domain: 'piping' }, async (m, p) => {
    calls.push({ m, p });
    return { readOnly: true };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].m, 'revit.mep.disconnects');
  assert.equal(calls[0].p.domain, 'piping');
});

test('bridge gates revit.mep.disconnects behind readonly-mep-disconnects feature', async t => {
  const requests = await withMockBridge(t, []);
  await assert.rejects(
    readMepDisconnects({ documentIdentity: 'doc-1', expectedRevision: 0 }, callRevit),
    err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('readonly-mep-disconnects')
  );
  assert.deepEqual(requests, ['revit.bridge.info']);
});
