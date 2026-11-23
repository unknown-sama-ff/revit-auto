import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { callRevit } from '../bridge.mjs';
import { validateAnnotationCreation, requireAnnotationCreationHostFeature } from '../annotation-creation.mjs';
import { validateOperations, workflowOperations } from '../workflows.mjs';
import { previewRegisteredWriteWorkflow } from '../registered-planning.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const textNote = () => ({
  operationType: 'create_text_note',
  viewId: 101,
  textTypeId: 201,
  text: 'Pump room note\nCheck clearance',
  point: { xMm: 1000, yMm: 2000, zMm: 0 },
  widthMm: 150,
  rotationDegrees: 0
});

const detailLine = () => ({
  operationType: 'create_detail_line',
  viewId: 101,
  start: { xMm: 0, yMm: 0, zMm: 0 },
  end: { xMm: 1500, yMm: 0, zMm: 0 },
  lineStyleId: 301
});

async function withMockBridge(t, features) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-ann-bridge-'));
  const token = 'annotation-bridge-fixture-token-'.repeat(3);
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

test('2D annotations preserve explicit inputs and workflow expansion', () => {
  for (const op of [textNote(), detailLine()]) {
    assert.equal(validateAnnotationCreation(op), op);
    assert.equal(validateOperations([op])[0], op);
  }
  const { operationType: _t, ...tn } = textNote();
  const { operationType: _l, ...dl } = detailLine();
  const ops = workflowOperations('documentation.annotations', { textNotes: [tn], detailLines: [dl] });
  assert.deepEqual(ops.map(o => o.operationType), ['create_text_note', 'create_detail_line']);
  assert.deepEqual(ops.map(o => o.id), ['textNote1', 'detailLine1']);
});

test('2D annotations reject invalid coordinates, blank/control text, short lines, and same-plan source changes', () => {
  for (const bad of [
    { ...textNote(), text: '   ' },
    { ...textNote(), text: 'a\u0007b' },
    { ...textNote(), point: { xMm: 0, yMm: 0 } },
    { ...textNote(), widthMm: 0.5 },
    { ...textNote(), rotationDegrees: 365 },
    { ...detailLine(), end: { xMm: 0.5, yMm: 0, zMm: 0 } }
  ]) {
    assert.throws(() => validateOperations([bad]), { code: 'invalid_2d_annotation' });
  }
  assert.throws(() => validateAnnotationCreation({ ...detailLine(), lineStyleId: 0 }), { code: 'invalid_2d_annotation' });
  assert.throws(() => validateOperations([{ ...detailLine(), lineStyleId: 0 }]), /Invalid lineStyleId/);
  assert.throws(() => validateOperations([textNote(), { operationType: 'delete_element', elementId: 201 }]), { code: 'invalid_2d_annotation' });
  assert.throws(() => validateOperations([detailLine(), { operationType: 'delete_element', elementId: 301 }]), { code: 'invalid_2d_annotation' });
  assert.throws(() => validateOperations([textNote(), { operationType: 'load_family', familyKey: 'k', sha256: 'a'.repeat(64), catalogSha256: 'b'.repeat(64), expectedFamilyName: 'SampleFamily', expectedCategoryId: -2000150, requiredTypes: ['Default'], conflictPolicy: 'reject', overwriteTypeParameters: false }]), { code: 'invalid_2d_annotation' });
});

test('documentation.annotations workflow requires controlled-2d-annotations before sending a plan', async () => {
  const { operationType: _t, ...tn } = textNote();
  const calls = [];
  await assert.rejects(
    requireAnnotationCreationHostFeature(async m => { calls.push(m); return { features: [] }; }),
    { code: 'annotation_creation_native_feature_unavailable' }
  );
  assert.deepEqual(calls, ['revit.bridge.info']);

  calls.length = 0;
  await assert.rejects(
    previewRegisteredWriteWorkflow(
      { name: 'documentation.annotations', documentIdentity: 'doc', expectedRevision: 0, input: { textNotes: [tn] } },
      getWorkflow('documentation.annotations'),
      async m => {
        calls.push(m);
        if (m === 'revit.context.get') return { active: true, document: { identity: 'doc', revision: 0, path: 'a.rvt', isFamilyDocument: false, isReadOnly: false, isModified: false } };
        if (m === 'revit.bridge.info') return { features: [] };
        throw new Error('Plan should not be sent.');
      }
    ),
    { code: 'annotation_creation_native_feature_unavailable' }
  );
  assert.deepEqual(calls, ['revit.context.get', 'revit.bridge.info']);
});

test('bridge gates create_text_note and create_detail_line behind controlled-2d-annotations feature', async t => {
  const requests = await withMockBridge(t, []);
  for (const op of [textNote(), detailLine()]) {
    await assert.rejects(
      callRevit('revit.plan.create', { documentIdentity: 'doc', expectedRevision: 0, summary: 'ann', operations: [op] }),
      err => err.code === 'feature_not_loaded' && err.details?.requiredFeatures?.includes('controlled-2d-annotations')
    );
  }
  assert.deepEqual(requests, ['revit.bridge.info', 'revit.bridge.info']);
});
