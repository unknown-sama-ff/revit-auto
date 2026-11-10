import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseDrawingPlacementInput, drawingPlacementOperations, inspectDrawingPlacementScope } from '../drawing-placement.mjs';
import { validateOperations } from '../workflows.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const label = { viewportId: 10, sheetId: 20, viewId: 30, labelOffsetXMm: -15, labelOffsetYMm: 25 };
const operation = { ...label, operationType: 'move_viewport_label', id: 'labelMove1' };

function fixture(kind = 'ViewPlan', patch = {}) {
  const items = [
    { summary: { id: 10, className: 'Viewport', ownerViewId: 20, pinned: false, isReadOnly: false }, drawing: {
      sheetId: 20, viewId: 30, position: { xMm: 400, yMm: 200, zMm: 0 },
      labelOffsetSupported: true, labelOffset: { xMm: 4, yMm: 5, zMm: 0 }, labelLineLengthMm: 30,
      rotation: 'None', pinned: false, isReadOnly: false, geometrySupported: true,
      labelMin: { xMm: 405, yMm: 205, zMm: 0 }, labelMax: { xMm: 505, yMm: 255, zMm: 0 }
    } },
    { summary: { id: 20, className: 'ViewSheet' } },
    { summary: { id: 30, className: kind, isViewTemplate: false } }
  ];
  for (const [index, update] of Object.entries(patch)) {
    const current = items[Number(index)];
    items[Number(index)] = {
      ...current,
      ...update,
      ...(update.summary ? { summary: { ...current.summary, ...update.summary } } : {}),
      ...(update.drawing ? { drawing: { ...current.drawing, ...update.drawing } } : {})
    };
  }
  const calls = [];
  const call = async (method, args) => {
    calls.push({ method, args });
    assert.equal(method, 'revit.inspect');
    return { items: args.elementIds.map(id => items.find(item => item.summary.id === id)) };
  };
  return { items, calls, call };
}

test('viewport label builder emits one explicit operation and preserves optional line length', () => {
  const operations = drawingPlacementOperations({ viewportLabelMoves: [label] });
  assert.deepEqual(operations, [{ ...label, operationType: 'move_viewport_label', id: 'viewportLabelMove1' }]);
  assert.deepEqual(Object.keys(operations[0]).sort(), ['id', 'labelOffsetXMm', 'labelOffsetYMm', 'operationType', 'sheetId', 'viewId', 'viewportId'].sort());
  assert.deepEqual(drawingPlacementOperations({ viewportLabelMoves: [{ ...label, labelLineLengthMm: -12.5 }] }), [{ ...label, labelLineLengthMm: -12.5, operationType: 'move_viewport_label', id: 'viewportLabelMove1' }]);
  assert.deepEqual(parseDrawingPlacementInput({ viewportLabelMoves: [label] }).viewportLabelMoves, [label]);
});

test('viewport label input is strict, bounded, signed and requires three distinct existing ids', () => {
  assert.doesNotThrow(() => parseDrawingPlacementInput({ viewportLabelMoves: [{ ...label, labelOffsetXMm: -1e8, labelOffsetYMm: 1e8, labelOffsetZMm: 0, labelLineLengthMm: -1e8 }] }));
  for (const patch of [
    { rotation: 'None' }, { code: 'unsafe' }, { parameters: {} }, { labelOffsetZMm: 1 }, { labelOffsetZMm: -0.1 },
    { labelOffsetXMm: Infinity }, { labelOffsetYMm: -1e8 - 1 }, { labelLineLengthMm: 1e8 + 1 }, { labelLineLengthMm: NaN },
    { viewportId: 20 }, { sheetId: 10 }, { viewId: 10 }, { viewportId: '@newViewport' }
  ]) assert.throws(() => parseDrawingPlacementInput({ viewportLabelMoves: [{ ...label, ...patch }] }));
  assert.throws(() => parseDrawingPlacementInput({ viewportLabelMoves: [label, label] }));
  assert.throws(() => parseDrawingPlacementInput({ viewportLabelMoves: [label], placementMoves: [{ placementId: 10, sheetId: 20, viewId: 30, xMm: 1, yMm: 2 }] }));
});

test('native viewport label inspection requires complete supported geometry and reports before/after evidence', async () => {
  const f = fixture();
  const review = await inspectDrawingPlacementScope({ viewportLabelMoves: [{ ...label, labelOffsetXMm: 10, labelOffsetYMm: -20, labelLineLengthMm: -12.5 }] }, f.call);
  assert.equal(review.requiredNativeFeature, 'viewport-label-offset');
  assert.equal(review.inspectedElementCount, 3);
  assert.deepEqual(f.calls, [{ method: 'revit.inspect', args: { elementIds: [10, 20, 30] } }]);
  assert.deepEqual(review.viewportLabelMoves[0].before, { xMm: 4, yMm: 5, zMm: 0 });
  assert.deepEqual(review.viewportLabelMoves[0].after, { xMm: 10, yMm: -20, zMm: 0 });
  assert.equal(review.viewportLabelMoves[0].beforeLineLengthMm, 30);
  assert.equal(review.viewportLabelMoves[0].afterLineLengthMm, -12.5);
  assert.equal(review.viewportLabelMoves[0].rotation, 'None');
  assert.deepEqual(review.inspectedElementIds, [10, 20, 30]);
  assert.equal(review.viewportLabelMoves[0].pinStateVerified, true);
  assert.deepEqual(review.viewportLabelMoves[0].labelBounds, {
    min: { xMm: 405, yMm: 205, zMm: 0 },
    max: { xMm: 505, yMm: 255, zMm: 0 }
  });
  assert.equal(review.viewportLabelMoves[0].documentWriteabilityVerified, true);
  assert.equal(review.automaticSave, false);
});

test('viewport label inspection marks an unchanged offset and line length as a no-op', async () => {
  const review = await inspectDrawingPlacementScope({ viewportLabelMoves: [{ ...label, labelOffsetXMm: 4, labelOffsetYMm: 5, labelLineLengthMm: 30 }] }, fixture().call);
  assert.equal(review.viewportLabelMoves[0].noOp, true);
  assert.equal(review.nativeMovementAccepted, false);
});

test('viewport label inspection fails closed for owner, rotation, support, bounds and writeability uncertainty', async () => {
  const cases = [
    [{ 0: { summary: { ownerViewId: 99 } } }, 'drawing_placement_relationship_mismatch'],
    [{ 0: { drawing: { rotation: '90' } } }, 'drawing_placement_label_rotation'],
    [{ 0: { drawing: { labelOffsetSupported: false } } }, 'drawing_placement_label_unknown'],
    [{ 0: { drawing: null } }, 'drawing_placement_label_unknown'],
    [{ 0: { drawing: { labelLineLengthMm: NaN } } }, 'drawing_placement_label_unknown'],
    [{ 0: { drawing: { geometrySupported: false } } }, 'drawing_placement_label_unknown'],
    [{ 0: { drawing: { position: { xMm: Infinity, yMm: 200, zMm: 0 } } } }, 'drawing_placement_label_unknown'],
    [{ 0: { drawing: { labelMin: { xMm: NaN, yMm: 205, zMm: 0 } } } }, 'drawing_placement_label_unknown'],
    [{ 0: { drawing: { labelMax: { xMm: 505, yMm: Infinity, zMm: 0 } } } }, 'drawing_placement_label_unknown'],
    [{ 0: { drawing: { labelMin: { xMm: 5, yMm: 5, zMm: 0 }, labelMax: { xMm: 5, yMm: 5, zMm: 0 } } } }, 'drawing_placement_label_unknown'],
    [{ 0: { summary: { pinned: true } } }, 'drawing_placement_read_only'],
    [{ 0: { drawing: { pinned: undefined } } }, 'drawing_placement_label_unknown'],
    [{ 2: { summary: { className: 'ViewSchedule' } } }, 'drawing_placement_view_mismatch']
  ];
  for (const [patch, code] of cases) await assert.rejects(inspectDrawingPlacementScope({ viewportLabelMoves: [label] }, fixture('ViewPlan', patch).call), error => error.code === code);
});

test('viewport label plan is a single isolated operation and cannot mix with any other write', () => {
  assert.doesNotThrow(() => validateOperations([operation]));
  for (const other of [
    { operationType: 'set_parameter', elementId: 99, parameter: 'Comments', value: 'x' },
    { operationType: 'move_drawing_placement', placementId: 11, sheetId: 20, viewId: 30, xMm: 1, yMm: 2 },
    { operationType: 'configure_view', viewId: 30, referenceViewId: 31, settings: ['crop'], viewportId: 11, paperPoint: { xMm: 1, yMm: 2 } }
  ]) {
    assert.throws(() => validateOperations([operation, other]));
    assert.throws(() => validateOperations([other, operation]));
  }
  assert.throws(() => validateOperations([operation, { ...operation, id: 'labelMove2', labelOffsetXMm: 1 }]));
});

async function sdkFixture(t, features) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewport-label-mcp-'));
  const token = 'viewport-label-contract-'.repeat(3); const calls = []; const sockets = new Set();
  const bridge = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); let buffer = '';
    socket.on('data', data => {
      buffer += data.toString('utf8'); const i = buffer.indexOf('\n'); if (i < 0) return;
      const request = JSON.parse(buffer.slice(0, i)); calls.push(request);
      const result = request.method === 'revit.bridge.info' ? { protocol: 'revit-auto-2027-v2', features, confirmationMode: 'chat' } : { planId: 'label-plan', status: 'pending', documentIdentity: request.params.documentIdentity, documentRevision: request.params.expectedRevision, operations: request.params.operations };
      socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ok: true, result }) + '\n');
    });
  });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => bridge.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const config = path.join(dir, 'bridge.json'); await fs.writeFile(config, JSON.stringify({ port: bridge.address().port, token }));
  const client = new Client({ name: 'viewport-label-contract', version: '1.0' }); t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp/revit-custom.mjs')], env: { REVIT_AI_CONFIG: config }, stderr: 'pipe' }));
  return { client, calls };
}

test('SDK old host lacking viewport-label-offset refuses before forwarding a native plan', async t => {
  const { client, calls } = await sdkFixture(t, ['drawing-placement-move']);
  const response = await client.callTool({ name: 'revit_plan_create', arguments: { documentIdentity: 'doc-a', expectedRevision: 0, summary: 'label preview', operations: [operation] } });
  assert.equal(response.isError, true);
  assert.equal(JSON.parse(response.content[0].text).code, 'feature_not_loaded');
  assert.deepEqual(calls.map(row => row.method), ['revit.bridge.info']);
});

test('SDK capable host forwards exactly one viewport label preview without confirmation or save', async t => {
  const { client, calls } = await sdkFixture(t, ['viewport-label-offset']);
  const response = await client.callTool({ name: 'revit_plan_create', arguments: { documentIdentity: 'doc-a', expectedRevision: 0, summary: 'label preview', operations: [operation] } });
  assert.equal(response.isError, undefined);
  const preview = JSON.parse(response.content[0].text);
  assert.equal(preview.status, 'pending');
  assert.deepEqual(preview.operations, [operation]);
  assert.deepEqual(calls.map(row => row.method), ['revit.bridge.info', 'revit.plan.create']);
  assert.equal(calls.some(row => ['revit.plan.confirm', 'revit.import.commit', 'revit.save', 'revit.lifecycle.save_once'].includes(row.method)), false);
});
