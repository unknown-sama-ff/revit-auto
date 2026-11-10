import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyArchitecturePrimaryRollback } from '../architecture-primary-verification.mjs';

const runId = '0199e520-0000-7000-8000-000000000001';
const taskId = 'architecture.primary-elements';
const planId = 'primary-rollback-reviewed-plan';

function primaryNative(category) {
  if (category === 'OST_Walls') return {
    supported: true, native: { typeId: 20, levelId: 30, heightMm: 3000, offsetMm: 0, flipped: false, structural: false, location: { startXmm: 0, startYmm: 0, startZmm: 0, endXmm: 3000, endYmm: 0, endZmm: 0 } }, topConstraintId: -1, sideEffectsVerified: false
  };
  if (category === 'OST_Floors') return {
    supported: true, native: { typeId: 20, levelId: 30, offsetMm: 0, structural: false, boundary: [
      { startXmm: 0, startYmm: 0, startZmm: 0, endXmm: 3000, endYmm: 0, endZmm: 0 },
      { startXmm: 3000, startYmm: 0, startZmm: 0, endXmm: 0, endYmm: 3000, endZmm: 0 },
      { startXmm: 0, startYmm: 3000, startZmm: 0, endXmm: 0, endYmm: 0, endZmm: 0 }
    ] }, sketchId: 50, sideEffectsVerified: false
  };
  return { supported: true, native: { typeId: 20, levelId: 30, hostId: 40, categoryId: category === 'OST_Doors' ? -2000023 : -2000014, placement: { xmm: 1000, ymm: 0, zmm: 900, rotationRadians: 0 } }, sideEffectsVerified: false };
}

function setPrimaryCategory(input, category, categoryId, className) {
  for (const artifact of ['baseline', 'readback']) {
    input[artifact].snapshot.categoryIds.OST_Walls = [];
    input[artifact].context.counts.OST_Walls = 0;
    input[artifact].snapshot.categoryIds[category] = [10];
    input[artifact].context.counts[category] = 1;
    input[artifact].snapshot.items[0].summary.categoryId = categoryId;
    input[artifact].snapshot.items[0].summary.className = className;
    input[artifact].snapshot.items[0].architecturePrimary = primaryNative(category);
  }
}

function fixture(operationType = 'create_wall') {
  const context = {
    active: true,
    document: { identity: 'native-session-a', revision: 3, path: 'D:\\acceptance\\primary.rvt', isModified: false, isReadOnly: false, isFamilyDocument: false },
    counts: { OST_Walls: 1, OST_Floors: 0, OST_Doors: 0, OST_Windows: 0 },
    activeView: { id: 7, name: 'Level 1', viewType: 'FloorPlan', scale: 100 },
    selectedElementIds: [10],
    units: { coordinates: 'mm' }
  };
  const snapshot = {
    complete: true, truncated: false,
    categoryIds: { OST_Walls: [10], OST_Floors: [], OST_Doors: [], OST_Windows: [] },
    items: [{
      summary: { id: 10, className: 'Wall', categoryId: -2000011, location: { start: { xMm: 0, yMm: 0, zMm: 0 }, end: { xMm: 3000, yMm: 0, zMm: 0 } } },
      parameters: [{ id: 2, value: 3000 }, { id: 1, value: 'Existing wall' }],
      connectors: [],
      electrical: null, piping: { applicable: false }, titleBlock: null, drawing: null,
      architecture: { hostId: null, vertices: [{ xMm: 0, yMm: 0 }, { xMm: 3000, yMm: 0 }], supported: true },
      architecturePrimary: primaryNative('OST_Walls'),
      additionalNativeEvidence: { points: [1, 2, 3], supported: true }
    }],
    relatedEvidence: { complete: true, truncated: false, values: [2, 1] }
  };
  const binding = { schemaVersion: 1, runId, taskId, planId, status: 'captured' };
  return {
    runId, taskId, planId, operationType,
    baseline: { ...binding, artifactType: 'baseline', capturedAtUtc: '2026-10-15T00:00:00.000Z', context: structuredClone(context), snapshot: structuredClone(snapshot) },
    execution: {
      ...binding, artifactType: 'execution', capturedAtUtc: '2026-10-15T00:00:01.000Z', operationType, attemptId: 'primary-rollback-attempt-1',
      receipt: { planId,
      status: 'failed', code: 'execution_failed', rolledBack: true,
      completedOperationCount: 1, failedOperationIndex: 2,
      nativeChanges: { documentIdentity: 'native-session-a', startRevision: 3, endRevision: 4, executionOutcome: 'failed', captureComplete: true, elementEvidenceComplete: true, revisionCoverageComplete: true, elementIdsTruncated: false, eventMetadataTruncated: false, sideEffectsVerified: false } }
    },
    readback: { ...binding, artifactType: 'readback', capturedAtUtc: '2026-10-15T00:00:02.000Z', context: { ...structuredClone(context), document: { ...context.document, revision: 4 } }, snapshot: structuredClone(snapshot) }
  };
}

test('verifies rollback only for the complete captured scope after an execution-time failure', () => {
  const input = fixture();
  const before = structuredClone(input);
  assert.deepEqual(verifyArchitecturePrimaryRollback(input), {
    runId, taskId, planId, operationType: 'create_wall',
    rollbackVerified: true, capturedScopeVerified: true,
    verifiedCategoryIds: ['OST_Doors', 'OST_Floors', 'OST_Walls', 'OST_Windows'],
    verifiedElementCount: 1,
    nativeCoverage: { captureComplete: true, elementEvidenceComplete: true, revisionCoverageComplete: true, elementIdsTruncated: false, eventMetadataTruncated: false },
    allModelSideEffectsVerified: false, persistenceVerified: false, visualVerified: false
  });
  assert.deepEqual(input, before);
});

test('supports each explicitly named primary creation operation without inferring an operation', () => {
  for (const operationType of ['create_wall', 'create_floor', 'create_family_instance']) {
    assert.equal(verifyArchitecturePrimaryRollback(fixture(operationType)).operationType, operationType);
  }
  for (const operationType of [undefined, '', 'create_room', ['create_wall', 'create_floor']]) {
    const input = fixture(); input.operationType = operationType;
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'invalid_primary_operation' });
  }
});

test('rejects a non-UUIDv7 run or any task other than architecture primary elements', () => {
  for (const field of ['runId', 'taskId', 'planId']) {
    const input = fixture(); input[field] = '';
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'invalid_run_binding' });
  }
  for (const value of ['0199e520-0000-4000-8000-000000000001', '0199e520-0000-7000-0000-000000000001']) {
    const input = fixture(); input.runId = value;
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'invalid_run_binding' });
  }
  const input = fixture(); input.taskId = 'architecture.rooms';
  assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'invalid_run_binding' });
});

test('rejects missing or stale run task and explicit plan bindings in every artifact', () => {
  for (const artifact of ['baseline', 'execution', 'readback']) {
    for (const field of ['runId', 'taskId', 'planId']) {
      for (const value of [undefined, null, 'stale']) {
        const input = fixture(); input[artifact][field] = value;
        assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'evidence_binding_mismatch' });
      }
    }
    const input = fixture(); input[artifact].artifactType = 'preview';
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'evidence_binding_mismatch' });
  }
});

test('does not certify a preview rejection, early guard failure, or incomplete operation progress', () => {
  for (const mutate of [
    x => { x.execution.receipt.status = 'committed'; },
    x => { x.execution.receipt.code = 'invalid_operation'; },
    x => { x.execution.receipt.completedOperationCount = 0; x.execution.receipt.failedOperationIndex = 1; },
    x => { delete x.execution.receipt.completedOperationCount; },
    x => { x.execution.receipt.completedOperationCount = 1.5; },
    x => { x.execution.receipt.failedOperationIndex = 3; },
    x => { x.execution.receipt.rolledBack = false; },
    x => { x.execution.operationType = 'create_floor'; },
    x => { x.execution.receipt.nativeChanges.executionOutcome = 'committed'; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'rollback_execution_unproven' });
  }
});

test('does not certify a changed document identity or a stale or decreasing revision chain', () => {
  for (const mutate of [
    x => { x.readback.context.document.identity = 'reopened-session'; },
    x => { x.execution.receipt.nativeChanges.documentIdentity = 'another-document'; },
    x => { x.execution.receipt.nativeChanges.startRevision = 2; },
    x => { x.execution.receipt.nativeChanges.endRevision = 2; },
    x => { x.readback.context.document.revision = 3; },
    x => { x.readback.context.document.revision = -1; },
    x => { delete x.execution.receipt.nativeChanges; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'evidence_context_mismatch' });
  }
});

test('preserves the complete active view selection saved state path and other context evidence', () => {
  for (const mutate of [
    x => { x.readback.context.document.path = 'D:\\other.rvt'; },
    x => { x.readback.context.document.isModified = true; },
    x => { x.readback.context.activeView.scale = 50; },
    x => { x.readback.context.selectedElementIds = []; },
    x => { x.readback.context.units.coordinates = 'ft'; },
    x => { x.readback.context.document.unknownNativeFlag = true; },
    x => { delete x.readback.context.activeView; },
    x => { delete x.baseline.context.selectedElementIds; },
    x => { delete x.baseline.context.document.isModified; },
    x => { x.baseline.context.active = false; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'evidence_context_mismatch' });
  }
});

test('rejects saved evidence rather than implying persistence acceptance', () => {
  for (const artifact of ['baseline', 'execution', 'readback']) {
    const input = fixture(); input[artifact].saved = true;
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'unexpected_saved_evidence' });
  }
  const input = fixture(); input.execution.additional = { saved: true };
  assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'unexpected_saved_evidence' });
});

test('requires explicit complete untruncated snapshots including nested evidence', () => {
  for (const artifact of ['baseline', 'readback']) {
    for (const mutate of [
      x => { delete x.snapshot; },
      x => { delete x.snapshot.complete; },
      x => { x.snapshot.complete = false; },
      x => { delete x.snapshot.truncated; },
      x => { x.snapshot.truncated = true; },
      x => { x.snapshot.relatedEvidence.truncated = true; },
      x => { x.snapshot.relatedEvidence.hasMore = true; },
      x => { x.snapshot.items[0].parametersTruncated = true; },
      x => { x.snapshot.items[0].captureComplete = false; }
    ]) {
      const input = fixture(); mutate(input[artifact]);
      assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'incomplete_primary_snapshot' });
    }
  }
});

test('requires declared primary category sets and exact complete inspection coverage', () => {
  for (const mutate of [
    x => { delete x.baseline.snapshot.categoryIds.OST_Windows; },
    x => { x.baseline.snapshot.categoryIds.OST_Walls = []; },
    x => { x.baseline.snapshot.items = []; },
    x => { x.baseline.snapshot.items.push(structuredClone(x.baseline.snapshot.items[0])); },
    x => { x.baseline.snapshot.categoryIds.OST_Walls = [10, 10]; },
    x => { x.baseline.snapshot.items[0] = { id: 10, exists: false }; },
    x => { delete x.baseline.snapshot.items[0].parameters; },
    x => { delete x.baseline.snapshot.items[0].connectors; },
    x => { delete x.baseline.snapshot.items[0].architecturePrimary; },
    x => { x.baseline.snapshot.items[0].parameters = null; },
    x => { x.baseline.snapshot.categoryIds.OST_Floors = [10]; },
    x => { x.baseline.context.counts.OST_Walls = 2; },
    x => { delete x.baseline.context.counts.OST_Walls; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'incomplete_primary_snapshot' });
  }
});

test('accepts native omission of null relationship fields and compares every relationship still present', () => {
  const input = fixture();
  for (const artifact of ['baseline', 'readback']) {
    for (const field of ['electrical', 'architecture', 'titleBlock', 'drawing']) delete input[artifact].snapshot.items[0][field];
  }
  assert.equal(verifyArchitecturePrimaryRollback(input).rollbackVerified, true);
  delete input.readback.snapshot.items[0].piping;
  assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'primary_snapshot_changed' });
});

test('unknown or absent primary native support never proves rollback even when both snapshots agree', () => {
  for (const mutate of [
    item => { delete item.architecturePrimary; },
    item => { item.architecturePrimary = { supported: false, errorType: 'InvalidOperationException' }; },
    item => { item.architecturePrimary.supported = null; },
    item => { delete item.architecturePrimary.native; },
    item => { item.architecturePrimary.native = {}; }
  ]) {
    const input = fixture();
    for (const artifact of ['baseline', 'readback']) mutate(input[artifact].snapshot.items[0]);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'incomplete_primary_snapshot' });
  }
});

test('primary native summary categories and classes must match declared category membership', () => {
  for (const mutate of [
    item => { delete item.summary.categoryId; },
    item => { item.summary.categoryId = -2000032; },
    item => { item.summary.className = 'Floor'; },
    item => { item.summary.className = 'FamilyInstance'; }
  ]) {
    const input = fixture();
    for (const artifact of ['baseline', 'readback']) mutate(input[artifact].snapshot.items[0]);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'incomplete_primary_snapshot' });
  }
  for (const [category, categoryId, className] of [
    ['OST_Walls', -2000011, 'Wall'], ['OST_Floors', -2000032, 'Floor'],
    ['OST_Doors', -2000023, 'FamilyInstance'], ['OST_Windows', -2000014, 'FamilyInstance']
  ]) {
    const input = fixture();
    setPrimaryCategory(input, category, categoryId, className);
    assert.equal(verifyArchitecturePrimaryRollback(input).rollbackVerified, true);
  }
});

test('matching partial native geometry never certifies a complete primary snapshot', () => {
  for (const [category, categoryId, className, fields] of [
    ['OST_Walls', -2000011, 'Wall', ['typeId', 'levelId', 'heightMm', 'offsetMm', 'flipped', 'structural', 'location']],
    ['OST_Floors', -2000032, 'Floor', ['typeId', 'levelId', 'offsetMm', 'structural', 'boundary']],
    ['OST_Doors', -2000023, 'FamilyInstance', ['typeId', 'levelId', 'hostId', 'categoryId', 'placement']],
    ['OST_Windows', -2000014, 'FamilyInstance', ['typeId', 'levelId', 'hostId', 'categoryId', 'placement']]
  ]) {
    for (const field of fields) {
      const input = fixture(); setPrimaryCategory(input, category, categoryId, className);
      for (const artifact of ['baseline', 'readback']) delete input[artifact].snapshot.items[0].architecturePrimary.native[field];
      assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'incomplete_primary_snapshot' });
    }
  }
});

test('rejects null nonfinite malformed and missing nested wall floor and hosted evidence', () => {
  for (const [category, categoryId, className, mutate] of [
    ['OST_Walls', -2000011, 'Wall', p => { p.native.heightMm = 0; }],
    ['OST_Walls', -2000011, 'Wall', p => { p.native.flipped = null; }],
    ['OST_Walls', -2000011, 'Wall', p => { p.native.location.endXmm = null; }],
    ['OST_Walls', -2000011, 'Wall', p => { delete p.native.location.startXmm; }],
    ['OST_Walls', -2000011, 'Wall', p => { p.native.offsetMm = Infinity; }],
    ['OST_Walls', -2000011, 'Wall', p => { delete p.topConstraintId; }],
    ['OST_Walls', -2000011, 'Wall', p => { p.topConstraintId = null; }],
    ['OST_Floors', -2000032, 'Floor', p => { p.native.boundary = p.native.boundary.slice(0, 2); }],
    ['OST_Floors', -2000032, 'Floor', p => { p.native.boundary[0].startZmm = null; }],
    ['OST_Floors', -2000032, 'Floor', p => { delete p.native.boundary[0].endYmm; }],
    ['OST_Floors', -2000032, 'Floor', p => { p.native.structural = null; }],
    ['OST_Floors', -2000032, 'Floor', p => { delete p.sketchId; }],
    ['OST_Floors', -2000032, 'Floor', p => { p.sketchId = -1; }],
    ['OST_Doors', -2000023, 'FamilyInstance', p => { p.native.hostId = 0; }],
    ['OST_Doors', -2000023, 'FamilyInstance', p => { p.native.categoryId = -2000014; }],
    ['OST_Windows', -2000014, 'FamilyInstance', p => { p.native.placement.xmm = null; }],
    ['OST_Windows', -2000014, 'FamilyInstance', p => { delete p.native.placement.rotationRadians; }],
    ['OST_Windows', -2000014, 'FamilyInstance', p => { p.native.placement.rotationRadians = NaN; }]
  ]) {
    const input = fixture(); setPrimaryCategory(input, category, categoryId, className);
    for (const artifact of ['baseline', 'readback']) mutate(input[artifact].snapshot.items[0].architecturePrimary);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'incomplete_primary_snapshot' });
  }
});

test('missing native coverage flags or truncated revision/event evidence cannot certify rollback', () => {
  for (const [field, value] of [
    ['captureComplete', null], ['elementEvidenceComplete', null], ['revisionCoverageComplete', false],
    ['elementIdsTruncated', true], ['eventMetadataTruncated', true]
  ]) {
    for (const missing of [false, true]) {
      const input = fixture();
      if (missing) delete input.execution.receipt.nativeChanges[field];
      else input.execution.receipt.nativeChanges[field] = value;
      assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'rollback_execution_unproven' });
    }
  }
});

// The archived temporary-level guard receipt supplies only this generic native
// failure shape. This offline fixture is not real Revit primary-element acceptance.
test('uncommitted native receipt shape preserves false coverage while equal complete fixture scope verifies', () => {
  const input = fixture();
  input.execution.receipt = {
    planId, status: 'failed', rolledBack: true, completedOperationCount: 1,
    failedOperationIndex: 2, failedOperationType: 'set_parameter', createdElementIds: [],
    nativeChanges: {
      documentIdentity: 'native-session-a', startRevision: 3, endRevision: 4,
      executionOutcome: 'failed', evidenceKind: 'document-changed-event-union', observedEventCount: 1,
      events: [{ revision: 4, operation: 'TransactionRolledBack', transactionNames: ['Native rollback acceptance'], addedCount: 0, modifiedCount: 0, deletedCount: 0, metadataTruncated: false }],
      observedAddedElementIds: [], observedModifiedElementIds: [], observedDeletedElementIds: [],
      additionalAddedElementIds: [], unreportedModifiedElementIds: [], observedThenDeletedElementIds: [],
      elementIdsTruncated: false, eventMetadataTruncated: false, revisionCoverageComplete: true,
      elementEvidenceComplete: false, captureComplete: false, netModelDiffVerified: false, sideEffectsVerified: false
    },
    warnings: [], code: 'execution_failed', causeCode: 'invalid_operation'
  };
  const before = structuredClone(input);
  const result = verifyArchitecturePrimaryRollback(input);
  assert.equal(result.rollbackVerified, true);
  assert.equal(result.capturedScopeVerified, true);
  assert.deepEqual(result.nativeCoverage, { captureComplete: false, elementEvidenceComplete: false, revisionCoverageComplete: true, elementIdsTruncated: false, eventMetadataTruncated: false });
  assert.equal(result.allModelSideEffectsVerified, false);
  assert.deepEqual(input, before);
});

test('requires captured artifacts with valid monotonic UTC timestamps and nested exact native receipt binding', () => {
  for (const artifact of ['baseline', 'execution', 'readback']) {
    for (const value of [undefined, 'unknown', 'expired', 'rejected', 'failed']) {
      const input = fixture(); input[artifact].status = value;
      assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'evidence_binding_mismatch' });
    }
    for (const value of [undefined, '', 'yesterday', '2026-02-30T00:00:00Z', '2026-10-15T00:00:00+08:00']) {
      const input = fixture(); input[artifact].capturedAtUtc = value;
      assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'evidence_binding_mismatch' });
    }
  }
  for (const mutate of [
    x => { x.execution.capturedAtUtc = '2026-10-14T00:00:00Z'; },
    x => { x.readback.capturedAtUtc = '2026-10-15T00:00:00.500Z'; },
    x => { x.execution.receipt.planId = 'stale-plan'; },
    x => { delete x.execution.receipt; },
    x => { delete x.execution.attemptId; },
    x => { x.readback.validity = 'historical'; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'evidence_binding_mismatch' });
  }
});

test('unknown unsupported native evidence is not promoted into accepted captured-scope rollback', () => {
  const input = fixture();
  input.baseline.snapshot.items[0].additionalNativeEvidence.supported = false;
  input.readback.snapshot.items[0].additionalNativeEvidence.supported = false;
  assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'incomplete_primary_snapshot' });
  const unknownExecution = fixture();
  unknownExecution.execution.additionalNativeEvidence = { supported: false };
  assert.throws(() => verifyArchitecturePrimaryRollback(unknownExecution), { code: 'rollback_execution_unproven' });
});

test('compares native geometry support states unknown fields and ordered arrays without discarding them', () => {
  for (const mutate of [
    x => { x.readback.snapshot.items[0].summary.location.end.xMm += 1; },
    x => { x.readback.snapshot.items[0].architecture.vertices.reverse(); },
    x => { delete x.readback.snapshot.items[0].additionalNativeEvidence; },
    x => { x.readback.snapshot.items[0].additionalNativeEvidence.points.reverse(); },
    x => { x.readback.snapshot.relatedEvidence.values.reverse(); },
    x => { x.readback.snapshot.unknownNativeField = 'new'; },
    x => { x.readback.snapshot.items[0].parameters[0].value = 3001; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => verifyArchitecturePrimaryRollback(input), { code: 'primary_snapshot_changed' });
  }
});

test('permits only known unordered native enumeration differences and JSON signed zero', () => {
  const input = fixture();
  input.readback.snapshot.items[0].parameters.reverse();
  input.baseline.snapshot.items[0].summary.location.start.xMm = -0;
  assert.equal(verifyArchitecturePrimaryRollback(input).rollbackVerified, true);
  assert.equal(Object.is(input.baseline.snapshot.items[0].summary.location.start.xMm, -0), true);
});

test('rejects missing malformed and nonfinite snapshot evidence even if both sides match', () => {
  for (const mutate of [
    x => { x.snapshot.items[0].architecture.heightMm = NaN; },
    x => { x.snapshot.items[0].additionalNativeEvidence.value = undefined; },
    x => { x.snapshot.categoryIds.OST_Walls = ['10']; },
    x => { x.context.activeView = null; },
    x => { x.context.selectedElementIds = [null]; },
    x => { x.context.document.identity = ''; }
  ]) {
    const input = fixture(); mutate(input.baseline); mutate(input.readback);
    assert.throws(() => verifyArchitecturePrimaryRollback(input));
  }
});
