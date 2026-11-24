import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperations } from '../workflows.mjs';
import { validateStructuralElement } from '../structural-elements.mjs';

test('create_wall accepts topLevelId + topOffsetMm without heightMm, and validates disallowJoin boolean', () => {
  validateOperations([
    {
      operationType: 'create_wall',
      wallTypeId: 398,
      levelId: 311,
      topLevelId: 312,
      topOffsetMm: 0,
      disallowJoin: true,
      start: { xMm: 0, yMm: 0 },
      end: { xMm: 6000, yMm: 0 }
    }
  ]);

  assert.throws(
    () => validateOperations([
      {
        operationType: 'create_wall',
        wallTypeId: 398,
        levelId: 311,
        heightMm: 4050,
        disallowJoin: 'yes',
        start: { xMm: 0, yMm: 0 },
        end: { xMm: 6000, yMm: 0 }
      }
    ]),
    /disallowJoin/i
  );

  assert.throws(
    () => validateOperations([
      {
        operationType: 'create_wall',
        wallTypeId: 398,
        levelId: 311,
        start: { xMm: 0, yMm: 0 },
        end: { xMm: 6000, yMm: 0 }
      }
    ]),
    /heightMm/i
  );
});

test('create_structural_beam accepts optional boolean disallowJoin and rejects non-boolean or foundation usage', () => {
  validateStructuralElement({
    operationType: 'create_structural_beam',
    symbolId: 10,
    levelId: 20,
    start: { xMm: 0, yMm: 0, zMm: 4000 },
    end: { xMm: 6000, yMm: 0, zMm: 4000 },
    disallowJoin: true
  });

  assert.throws(
    () => validateStructuralElement({
      operationType: 'create_structural_beam',
      symbolId: 10,
      levelId: 20,
      start: { xMm: 0, yMm: 0, zMm: 4000 },
      end: { xMm: 6000, yMm: 0, zMm: 4000 },
      disallowJoin: 'true'
    }),
    /disallowJoin/i
  );

  assert.throws(
    () => validateStructuralElement({
      operationType: 'create_isolated_foundation',
      symbolId: 11,
      levelId: 20,
      point: { xMm: 0, yMm: 0, zMm: -500 },
      disallowJoin: true
    }),
    /unknown fields/i
  );
});
