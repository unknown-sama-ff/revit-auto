import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperations, workflowOperations } from '../workflows.mjs';

const boundary = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]].map(([xMm, yMm]) => ({ xMm, yMm, zMm: 4600 }));
const roof = { roofTypeId: 41, levelId: 12, boundary, edgeSlopes: [0.5, 0, 0.25, 0] };

test('roof workflow preserves the explicit absolute footprint and per-edge native ratios', () => {
  assert.deepEqual(workflowOperations('architecture.roofs', { roofs: [roof] }),
    [{ ...roof, id: 'roof1', operationType: 'create_footprint_roof' }]);
});

test('roof rejects a nonhorizontal profile, missing slope or modification of its reviewed level', () => {
  const operationType = 'create_footprint_roof';
  const raised = boundary.map((point, index) => index === 1 ? { ...point, zMm: 5000 } : point);
  assert.throws(() => validateOperations([{ ...roof, operationType, boundary: raised }]), { code: 'invalid_roof_creation' });
  assert.throws(() => validateOperations([{ ...roof, operationType, edgeSlopes: [0, 0, 0] }]), { code: 'invalid_roof_creation' });
  assert.throws(() => validateOperations([{ ...roof, operationType }, { operationType: 'delete_element', elementId: 12 }]),
    { code: 'invalid_roof_creation' });
});
