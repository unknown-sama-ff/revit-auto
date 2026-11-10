import test from 'node:test';
import assert from 'node:assert/strict';
import { pumpAuditInputSchema, pumpCollisionInputSchema, runPumpReadOnlyWorkflow } from '../mep-readonly.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const initial = { active: true, document: { identity: 'doc-a', revision: 0, path: 'pump-room.rvt', isModified: false } };
const auditReport = { documentIdentity: 'doc-a', documentRevision: 0, snapshotPolicy: 'ui-thread-json-v1', warnings: [], equipment: [], complete: true };
const collisionReport = {
  documentIdentity: 'doc-a', documentRevision: 0,
  scope: { targetElementIds: [101], excludeElementIds: [], clearanceMm: 100, toleranceMm: 0.1, truncated: false },
  collisions: [], clearanceCandidates: [], unknown: [],
  diagnostics: { complete: true, truncated: false, exactIntersectionCount: 0, clearanceCandidateCount: 0, unknownCount: 0, candidateCount: 0, scannedCandidateCount: 0 }
};

function fixture({ contexts = [initial], report = collisionReport } = {}) {
  const calls = [];
  let contextIndex = 0;
  const call = async (method, args) => {
    calls.push({ method, args });
    if (method === 'revit.context.get') return structuredClone(contexts[Math.min(contextIndex++, contexts.length - 1)]);
    if (method === 'revit.audit.run') return structuredClone(auditReport);
    if (method === 'revit.collision.check') return structuredClone(report);
    if (method === 'revit.flow.diagnose') return { documentIdentity: 'doc-a', documentRevision: 0, systemId: args.systemId, status: 'unknown' };
    if (method === 'revit.inspect') return { items: [] };
    throw new Error(`Unexpected method ${method}`);
  };
  return { call, calls };
}

test('pump read-only workflows are registered and cannot be operation builders', () => {
  for (const id of ['pump_room.audit', 'pump_room.collision', 'pump_room.clearance']) {
    const workflow = getWorkflow(id);
    assert.equal(workflow.enabled, true);
    assert.equal(workflow.destructiveLevel, 'read-only');
    assert.equal(workflow.operationBuilder, null);
    assert.equal(workflow.readAdapter, id);
  }
});

test('schemas reject executable inputs and allow incomplete ask requests', () => {
  assert.equal(pumpAuditInputSchema.safeParse({ code: 'Document.Delete()' }).success, false);
  assert.equal(pumpCollisionInputSchema.safeParse({ code: 'unsafe' }).success, false);
  assert.equal(pumpCollisionInputSchema.safeParse({}).success, true);
  assert.equal(pumpCollisionInputSchema.safeParse({ targetElementIds: [1, 1] }).success, false);
});

test('collision ask mode returns questions without contacting Revit', async () => {
  const f = fixture();
  const result = await runPumpReadOnlyWorkflow({ name: 'pump_room.collision', documentIdentity: 'doc-a', expectedRevision: 0, planningMode: 'ask', input: {} }, f.call);
  assert.equal(result.requiresClarification, true);
  assert.equal(result.planCreated, false);
  assert.equal(result.readOnly, true);
  assert.ok(result.questions.length);
  assert.deepEqual(f.calls, []);
});

test('explicit collision query pins identity/revision and never creates a plan', async () => {
  const f = fixture();
  const result = await runPumpReadOnlyWorkflow({ name: 'pump_room.collision', documentIdentity: 'doc-a', expectedRevision: 0, planningMode: 'explicit', input: { targetElementIds: [101], clearanceMm: 100 } }, f.call);
  assert.equal(result.workflowId, 'pump_room.collision');
  assert.equal(result.readOnly, true);
  assert.equal(result.planCreated, false);
  assert.equal(result.engineeringComplianceVerified, false);
  assert.deepEqual(f.calls.map(x => x.method), ['revit.context.get', 'revit.collision.check', 'revit.context.get']);
  assert.equal(f.calls[1].args.documentIdentity, 'doc-a');
  assert.equal(f.calls[1].args.expectedRevision, 0);
});

test('clearance requires an explicit positive screening value', async () => {
  const f = fixture();
  const result = await runPumpReadOnlyWorkflow({ name: 'pump_room.clearance', documentIdentity: 'doc-a', planningMode: 'ask', input: { targetElementIds: [101] } }, f.call);
  assert.equal(result.requiresClarification, true);
  assert.deepEqual(f.calls, []);
  await assert.rejects(runPumpReadOnlyWorkflow({ name: 'pump_room.clearance', documentIdentity: 'doc-a', planningMode: 'explicit', input: { targetElementIds: [101] } }, f.call), error => error.code === 'missing_clearance');
});

test('audit can include explicit flow diagnostics and stays read-only', async () => {
  const f = fixture();
  const result = await runPumpReadOnlyWorkflow({ name: 'pump_room.audit', documentIdentity: 'doc-a', expectedRevision: 0, planningMode: 'explicit', input: { systemIds: [201], includeFlow: true, elementIds: [101] } }, f.call);
  assert.equal(result.workflowId, 'pump_room.audit');
  assert.equal(result.readOnly, true);
  assert.equal(result.planCreated, false);
  assert.equal(result.flowDiagnostics[0].systemId, 201);
  assert.deepEqual(f.calls.map(x => x.method), ['revit.context.get', 'revit.audit.run', 'revit.flow.diagnose', 'revit.inspect', 'revit.context.get']);
});

test('changed revision discards read-only evidence and never retries', async () => {
  const f = fixture({ contexts: [initial, { active: true, document: { ...initial.document, revision: 1 } }] });
  await assert.rejects(runPumpReadOnlyWorkflow({ name: 'pump_room.collision', documentIdentity: 'doc-a', expectedRevision: 0, planningMode: 'explicit', input: { targetElementIds: [101] } }, f.call), error => error.code === 'document_revision_changed');
  assert.deepEqual(f.calls.map(x => x.method), ['revit.context.get', 'revit.collision.check', 'revit.context.get']);
});
