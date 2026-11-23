import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { callRevit } from '../bridge.mjs';
import { validateScheduleDataArgs, readScheduleData } from '../schedule-data.mjs';

async function withMockBridge(t, features) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-sched-bridge-'));
  const token = 'schedule-bridge-fixture-token-'.repeat(3);
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

test('schedule data validates explicit scheduleId and pagination bounds', () => {
  const valid = validateScheduleDataArgs({
    documentIdentity: 'doc-1', expectedRevision: 0, scheduleId: 101, startRow: 0, maxRows: 100, includeCellMeta: true
  });
  assert.equal(valid.scheduleId, 101);
  for (const bad of [
    {},
    { documentIdentity: 'doc-1', expectedRevision: 0 },
    { documentIdentity: 'doc-1', expectedRevision: 0, scheduleId: 0 },
    { documentIdentity: 'doc-1', expectedRevision: 0, scheduleId: 101, scheduleName: 'Doors' },
    { documentIdentity: 'doc-1', expectedRevision: 0, scheduleId: 101, startRow: -1 },
    { documentIdentity: 'doc-1', expectedRevision: 0, scheduleId: 101, maxRows: 201 },
    { documentIdentity: 'doc-1', expectedRevision: 0, scheduleId: 101, includeCellMeta: 'yes' }
  ]) {
    assert.throws(() => validateScheduleDataArgs(bad), { code: 'invalid_schedule_data_request' });
  }
});

test('schedule data helper forwards pinned read-only RPC', async () => {
  const calls = [];
  await readScheduleData({ documentIdentity: 'doc-1', expectedRevision: 2, scheduleId: 505 }, async (m, p) => {
    calls.push({ m, p });
    return { readOnly: true };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].m, 'revit.schedule.data');
  assert.equal(calls[0].p.scheduleId, 505);
});

test('bridge gates revit.schedule.data behind readonly-schedule-data feature', async t => {
  const requests = await withMockBridge(t, []);
  await assert.rejects(
    readScheduleData({ documentIdentity: 'doc-1', expectedRevision: 0, scheduleId: 505 }, callRevit),
    err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('readonly-schedule-data')
  );
  assert.deepEqual(requests, ['revit.bridge.info']);
});
