import { isDeepStrictEqual } from 'node:util';
import { canonicalInspectionItems } from './acceptance-helpers.mjs';

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TASK_ID = 'architecture.primary-elements';
const OPERATIONS = new Set(['create_wall', 'create_floor', 'create_family_instance']);
// BuiltInCategory values are fixed by the Revit API: OST_Walls -2000011,
// OST_Floors -2000032, OST_Doors -2000023, OST_Windows -2000014. A door is not
// -2000014 and a window is not -2000012; those pairings reject every real
// door/window snapshot even though synthetic fixtures can be made to agree.
const PRIMARY_CATEGORIES = {
  OST_Doors: { id: -2000023, className: 'FamilyInstance' },
  OST_Floors: { id: -2000032, className: 'Floor' },
  OST_Walls: { id: -2000011, className: 'Wall' },
  OST_Windows: { id: -2000014, className: 'FamilyInstance' }
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const revision = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const edgeFields = ['startXmm', 'startYmm', 'startZmm', 'endXmm', 'endYmm', 'endZmm'];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertJson(value, code, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if ((!Array.isArray(value) && !record(value)) || ancestors.has(value)) fail(code, 'Evidence must be finite, complete JSON data.');
  ancestors.add(value);
  for (const child of Object.values(value)) assertJson(child, code, ancestors);
  ancestors.delete(value);
}

function walk(value, inspect) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    inspect(key, child);
    walk(child, inspect);
  }
}

function utcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    fail('evidence_binding_mismatch', 'Every artifact must have a valid ISO UTC capture timestamp.');
  }
  return `${value.slice(0, 19)}.${(value.slice(19, -1).replace('.', '')).padEnd(7, '0')}Z`;
}

function completePrimaryNative(primary, category) {
  if (!record(primary) || primary.supported !== true || !record(primary.native)) return false;
  const native = primary.native;
  if (!positiveId(native.typeId) || !positiveId(native.levelId)) return false;
  const edge = value => record(value) && edgeFields.every(field => finite(value[field]));
  if (category === 'OST_Walls') {
    return finite(native.heightMm) && native.heightMm > 0 && finite(native.offsetMm) &&
      typeof native.flipped === 'boolean' && typeof native.structural === 'boolean' && edge(native.location) &&
      (primary.topConstraintId === -1 || positiveId(primary.topConstraintId));
  }
  if (category === 'OST_Floors') {
    return finite(native.offsetMm) && typeof native.structural === 'boolean' && positiveId(primary.sketchId) &&
      Array.isArray(native.boundary) && native.boundary.length >= 3 && native.boundary.every(edge);
  }
  return positiveId(native.hostId) && native.categoryId === PRIMARY_CATEGORIES[category].id &&
    record(native.placement) && ['xmm', 'ymm', 'zmm', 'rotationRadians'].every(field => finite(native.placement[field]));
}

function assertContext(context) {
  if (!record(context) || context.active !== true || !record(context.document) ||
      typeof context.document.identity !== 'string' || !context.document.identity ||
      typeof context.document.path !== 'string' || !context.document.path ||
      !revision(context.document.revision) || typeof context.document.isModified !== 'boolean' ||
      !record(context.counts) || !record(context.activeView) || !positiveId(context.activeView.id) ||
      !Array.isArray(context.selectedElementIds) || context.selectedElementIds.some(id => !positiveId(id)) ||
      new Set(context.selectedElementIds).size !== context.selectedElementIds.length) {
    fail('evidence_context_mismatch', 'An active document, revision, path, saved state, view and selection are required.');
  }
  assertJson(context, 'evidence_context_mismatch');
}

function assertSnapshot(snapshot, context) {
  if (!record(snapshot) || snapshot.complete !== true || snapshot.truncated !== false ||
      !record(snapshot.categoryIds) || !Array.isArray(snapshot.items) ||
      Object.keys(PRIMARY_CATEGORIES).some(category => !Object.hasOwn(snapshot.categoryIds, category))) {
    fail('incomplete_primary_snapshot', 'Declare complete untruncated wall, floor, door and window snapshots.');
  }
  assertJson(snapshot, 'incomplete_primary_snapshot');
  walk(snapshot, (key, value) => {
    if ((/(?:truncated|hasMore)$/i.test(key) && value !== false) ||
        (/(?:^complete$|captureComplete$|elementEvidenceComplete$|revisionCoverageComplete$)/i.test(key) && value !== true)) {
      fail('incomplete_primary_snapshot', 'Captured evidence contains incomplete or truncated native data.');
    }
  });
  const capturedIds = new Map();
  for (const [category, ids] of Object.entries(snapshot.categoryIds)) {
    if (!Array.isArray(ids) || ids.some(id => !positiveId(id)) ||
        !revision(context.counts[category]) || context.counts[category] !== ids.length) {
      fail('incomplete_primary_snapshot', 'Declared category IDs must cover the full captured native category count.');
    }
    for (const id of ids) {
      if (capturedIds.has(id)) fail('incomplete_primary_snapshot', 'Native category IDs must be unique across the captured scope.');
      capturedIds.set(id, category);
    }
  }
  const inspectedIds = new Set();
  for (const item of snapshot.items) {
    const id = item?.summary?.id;
    if (!record(item) || !record(item.summary) || !positiveId(id) ||
        item.exists === false || !capturedIds.has(id) || inspectedIds.has(id) ||
        !Array.isArray(item.parameters) || !Array.isArray(item.connectors)) {
      fail('incomplete_primary_snapshot', 'Every declared native element must have one complete inspection item.');
    }
    const category = capturedIds.get(id);
    const primary = PRIMARY_CATEGORIES[category];
    if (primary && (item.summary.categoryId !== primary.id || item.summary.className !== primary.className ||
        !completePrimaryNative(item.architecturePrimary, category))) {
      fail('incomplete_primary_snapshot', 'Every primary element needs matching category/class membership and supported native architecture evidence.');
    }
    inspectedIds.add(id);
  }
  if (inspectedIds.size !== capturedIds.size) fail('incomplete_primary_snapshot', 'The native inspection did not cover every declared element.');
}

function comparableContext(context) {
  const result = structuredClone(context);
  delete result.document.revision;
  return result;
}

function comparableSnapshot(snapshot) {
  const result = structuredClone(snapshot);
  result.items = canonicalInspectionItems(snapshot.items);
  for (const ids of Object.values(result.categoryIds)) ids.sort((left, right) => left - right);
  return result;
}

// Pure verification of caller-captured evidence: this function never queries
// Revit, writes files, confirms plans, saves a model or retries execution.
// Equal captured scopes do not establish model-wide, persistence or visual acceptance.
export function verifyArchitecturePrimaryRollback({ runId, taskId, planId, operationType, baseline, execution, readback } = {}) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId) || taskId !== TASK_ID ||
      typeof planId !== 'string' || !planId || planId.trim() !== planId) {
    fail('invalid_run_binding', 'Require a UUIDv7 runId, architecture.primary-elements taskId and explicit planId.');
  }
  if (!OPERATIONS.has(operationType)) fail('invalid_primary_operation', 'Name one explicit wall, floor or family-instance creation operation.');
  const timestamps = [];
  for (const [artifactType, evidence] of Object.entries({ baseline, execution, readback })) {
    if (!record(evidence) || evidence.schemaVersion !== 1 || evidence.artifactType !== artifactType ||
        evidence.runId !== runId || evidence.taskId !== taskId || evidence.planId !== planId || evidence.status !== 'captured' ||
        (Object.hasOwn(evidence, 'validity') && evidence.validity !== 'current')) {
      fail('evidence_binding_mismatch', `The ${artifactType} artifact does not bind the exact reviewed run, task and plan.`);
    }
    timestamps.push(utcTimestamp(evidence.capturedAtUtc));
    assertJson(evidence, artifactType === 'execution' ? 'rollback_execution_unproven' : 'incomplete_primary_snapshot');
    walk(evidence, (key, value) => {
      if (key === 'saved' && value === true) fail('unexpected_saved_evidence', 'Rollback verification cannot accept saved execution evidence.');
      if (key === 'supported' && value === false) fail(artifactType === 'execution' ? 'rollback_execution_unproven' : 'incomplete_primary_snapshot', 'Unsupported native evidence remains unknown and cannot certify the captured scope.');
    });
  }
  if (timestamps[0] > timestamps[1] || timestamps[1] > timestamps[2] || typeof execution.attemptId !== 'string' ||
      !execution.attemptId || execution.attemptId.trim() !== execution.attemptId || !record(execution.receipt) || execution.receipt.planId !== planId) {
    fail('evidence_binding_mismatch', 'Require monotonic capture timestamps, one explicit attempt and a nested receipt for the reviewed plan.');
  }
  const receipt = execution.receipt;
  if (!record(receipt.nativeChanges)) fail('evidence_context_mismatch', 'Native execution document identity and revision evidence are required.');
  const native = receipt.nativeChanges;
  if (execution.operationType !== operationType || receipt.status !== 'failed' || receipt.code !== 'execution_failed' ||
      receipt.rolledBack !== true || !Number.isSafeInteger(receipt.completedOperationCount) || receipt.completedOperationCount < 1 ||
      receipt.failedOperationIndex !== receipt.completedOperationCount + 1 || native.executionOutcome !== 'failed' ||
      typeof native.captureComplete !== 'boolean' || typeof native.elementEvidenceComplete !== 'boolean' || native.revisionCoverageComplete !== true ||
      native.elementIdsTruncated !== false || native.eventMetadataTruncated !== false) {
    fail('rollback_execution_unproven', 'Require a native execution failure after at least one completed operation and a subsequent failed operation.');
  }
  assertContext(baseline.context);
  assertContext(readback.context);
  if (!record(native) || native.documentIdentity !== baseline.context.document.identity ||
      native.documentIdentity !== readback.context.document.identity || !revision(native.startRevision) || !revision(native.endRevision) ||
      native.startRevision !== baseline.context.document.revision || native.endRevision < native.startRevision ||
      native.endRevision > readback.context.document.revision) {
    fail('evidence_context_mismatch', 'Native execution and readback must share the baseline session with a nondecreasing revision chain.');
  }
  assertSnapshot(baseline.snapshot, baseline.context);
  assertSnapshot(readback.snapshot, readback.context);
  if (!isDeepStrictEqual(comparableContext(baseline.context), comparableContext(readback.context))) {
    fail('evidence_context_mismatch', 'Document state, counts, active view, selection or other captured context changed.');
  }
  if (!isDeepStrictEqual(comparableSnapshot(baseline.snapshot), comparableSnapshot(readback.snapshot))) {
    fail('primary_snapshot_changed', 'Native readback did not restore the complete captured snapshot.');
  }
  return {
    runId, taskId, planId, operationType,
    rollbackVerified: true, capturedScopeVerified: true,
    verifiedCategoryIds: Object.keys(baseline.snapshot.categoryIds).sort(),
    verifiedElementCount: baseline.snapshot.items.length,
    nativeCoverage: {
      captureComplete: native.captureComplete, elementEvidenceComplete: native.elementEvidenceComplete,
      revisionCoverageComplete: native.revisionCoverageComplete,
      elementIdsTruncated: native.elementIdsTruncated, eventMetadataTruncated: native.eventMetadataTruncated
    },
    allModelSideEffectsVerified: false, persistenceVerified: false, visualVerified: false
  };
}
