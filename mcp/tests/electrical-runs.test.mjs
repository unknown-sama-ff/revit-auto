import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { callRevit } from '../bridge.mjs';
import { validateElectricalRun, requireElectricalRunHostFeature } from '../electrical-runs.mjs';
import { validateOperations, workflowOperations } from '../workflows.mjs';
import { previewRegisteredWriteWorkflow } from '../registered-planning.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const cableTray = () => ({
  operationType: 'create_cable_tray',
  cableTrayTypeId: 101,
  levelId: 311,
  start: { xMm: 0, yMm: 0, zMm: 3200 },
  end: { xMm: 4000, yMm: 0, zMm: 3200 },
  widthMm: 300,
  heightMm: 100
});

const conduit = () => ({
  operationType: 'create_conduit',
  conduitTypeId: 102,
  levelId: 311,
  start: { xMm: 0, yMm: 500, zMm: 3000 },
  end: { xMm: 0, yMm: 3500, zMm: 3000 },
  diameterMm: 25
});

async function withMockBridge(t, features) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-elec-bridge-'));
  const token = 'electrical-bridge-fixture-token-'.repeat(3);
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
        : { ok: true };
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

test('electrical runs preserve explicit geometry, dimensions, and workflow expansion', () => {
  for (const op of [cableTray(), conduit()]) {
    assert.equal(validateElectricalRun(op), op);
    assert.equal(validateOperations([op])[0], op);
  }
  const { operationType: _t, ...tray } = cableTray();
  const { operationType: _c, ...cond } = conduit();
  const ops = workflowOperations('mep.electrical_runs', { cableTrays: [tray], conduits: [cond] });
  assert.deepEqual(ops.map(o => o.operationType), ['create_cable_tray', 'create_conduit']);
  assert.deepEqual(ops.map(o => o.id), ['cableTray1', 'conduit1']);
});

test('electrical runs reject missing dimensions, short segments, and same-plan source edits', () => {
  for (const bad of [
    { ...cableTray(), widthMm: 0 },
    { ...cableTray(), heightMm: 10001 },
    { ...cableTray(), end: { xMm: 0.5, yMm: 0, zMm: 3200 } },
    { ...conduit(), diameterMm: 2001 },
    { ...conduit(), start: { xMm: 0, yMm: 0 } }
  ]) {
    assert.throws(() => validateOperations([bad]), { code: 'invalid_electrical_run' });
  }
  assert.throws(() => validateElectricalRun({ ...conduit(), levelId: 0 }), { code: 'invalid_electrical_run' });
  assert.throws(() => validateOperations([{ ...conduit(), levelId: 0 }]), /Invalid levelId/);
  assert.throws(() => validateOperations([cableTray(), { operationType: 'delete_element', elementId: 101 }]), { code: 'invalid_electrical_run' });
  assert.throws(() => validateOperations([conduit(), { operationType: 'set_parameter', elementId: 311, parameter: 'Elevation', value: { value: 0, unit: 'mm' } }]), { code: 'invalid_electrical_run' });
  assert.throws(() => validateOperations([conduit(), { operationType: 'load_family', familyKey: 'k', sha256: 'a'.repeat(64), catalogSha256: 'b'.repeat(64), expectedFamilyName: 'SampleFamily', expectedCategoryId: -2000150, requiredTypes: ['Default'], conflictPolicy: 'reject', overwriteTypeParameters: false }]), { code: 'invalid_electrical_run' });
});

test('mep.electrical_runs workflow requires controlled-electrical-runs before sending a plan', async () => {
  const { operationType: _c, ...cond } = conduit();
  const calls = [];
  await assert.rejects(
    requireElectricalRunHostFeature(async m => { calls.push(m); return { features: [] }; }),
    { code: 'electrical_runs_native_feature_unavailable' }
  );
  assert.deepEqual(calls, ['revit.bridge.info']);

  calls.length = 0;
  await assert.rejects(
    previewRegisteredWriteWorkflow(
      { name: 'mep.electrical_runs', documentIdentity: 'doc', expectedRevision: 0, input: { conduits: [cond] } },
      getWorkflow('mep.electrical_runs'),
      async m => {
        calls.push(m);
        if (m === 'revit.context.get') return { active: true, document: { identity: 'doc', revision: 0, path: 'a.rvt', isFamilyDocument: false, isReadOnly: false, isModified: false } };
        if (m === 'revit.bridge.info') return { features: [] };
        throw new Error('Plan should not be sent.');
      }
    ),
    { code: 'electrical_runs_native_feature_unavailable' }
  );
  assert.deepEqual(calls, ['revit.context.get', 'revit.bridge.info']);
});

test('bridge gates create_cable_tray and create_conduit behind controlled-electrical-runs feature', async t => {
  const requests = await withMockBridge(t, []);
  for (const op of [cableTray(), conduit()]) {
    await assert.rejects(
      callRevit('revit.plan.create', { documentIdentity: 'doc', expectedRevision: 0, summary: 'elec', operations: [op] }),
      err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('controlled-electrical-runs')
    );
  }
  assert.deepEqual(requests, ['revit.bridge.info', 'revit.bridge.info']);
});
