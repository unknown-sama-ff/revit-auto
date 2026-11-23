import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperations, workflowOperations } from '../workflows.mjs';

test('material workflow sends explicit graphics and existing duplicate source', () => {
  const operations = workflowOperations('materials.create', {
    materials: [{ name: 'Concrete shade', color: { red: 9, green: 10, blue: 11 }, transparency: 25 }],
    copies: [{ name: 'Concrete copy', sourceMaterialId: 45 }],
  });
  assert.deepEqual(operations.map(op => op.operationType), ['create_material', 'duplicate_material']);
  assert.equal(operations[1].sourceMaterialId, 45);
  assert.equal(operations[0].color.blue, 11);
});

test('material plans reject partial color, duplicate names and in-plan changes to the source', () => {
  const make = { operationType: 'create_material', name: 'Sample' };
  const copy = { operationType: 'duplicate_material', name: 'New shade', sourceMaterialId: 43 };
  for (const ops of [
    [{ ...make, color: { red: 1, green: 2 } }],
    [{ ...make, transparency: null }],
    [make, { ...copy, name: 'sample' }],
    [copy, { operationType: 'delete_element', elementId: 43 }],
  ]) assert.throws(() => validateOperations(ops), { code: 'invalid_material_creation' });
});

test('assignment may reference an earlier material but rejects a structural reference or duplicate target', () => {
  const assignment = { elementId: 42, parameter: 'BIP:STRUCTURAL_MATERIAL_PARAM', materialId: '@createdMaterial' };
  const operations = workflowOperations('materials.create', {
    materials: [{ name: 'New material', id: 'createdMaterial' }], assignments: [assignment],
  });
  assert.equal(operations[1].operationType, 'assign_material');
  assert.equal(operations[1].materialId, '@createdMaterial');
  assert.throws(() => validateOperations([
    { operationType: 'create_level', id: 'createdMaterial', name: 'Example level', elevationMm: 2000 }, operations[1],
  ]), { code: 'invalid_material_creation' });
  assert.throws(() => validateOperations([...operations, { ...operations[1], id: 'secondAssignment' }]),
    { code: 'invalid_material_creation' });
});
