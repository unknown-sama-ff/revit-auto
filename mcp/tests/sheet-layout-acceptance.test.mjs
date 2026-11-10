import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_READ_METHODS,
  REQUIRED_FEATURE,
  prepareSheetLayoutAcceptance,
  validateBridgeInfo,
  validateContext,
  verifySheetLayoutAcceptance
} from '../sheet-layout-acceptance.mjs';

const project = 'C:/src/revit-auto/acceptance/models/sample-lighting-model-验收-v031.rvt';
const plugin = {
  protocol: 'revit-auto-2027-v2',
  version: '0.4.0',
  informationalVersion: '0.4.0+sheet-layout-test',
  moduleVersionId: '9f3556c4-bed9-4df9-8232-c7565d2d66f0',
  features: [REQUIRED_FEATURE],
  confirmationMode: 'chat',
  requiresRevitConfirmation: false
};
const context = identity => ({
  active: true,
  document: { identity, revision: 0, path: project, isModified: false, isReadOnly: false, isFamilyDocument: false },
  counts: { OST_Sheets: 2 },
  activeView: { id: 10 },
  selectedElementIds: []
});
const sheet = (identity, revision) => ({
  documentIdentity: identity,
  documentRevision: revision,
  sheetId: 20,
  outline: { min: { xMm: 0, yMm: 0 }, max: { xMm: 841, yMm: 594 } },
  titleBlocks: [],
  viewports: [],
  schedulePlacements: [],
  annotationPlacements: [],
  modelWritesRequested: false,
  automaticSave: false,
  allModelSideEffectsVerified: false
});

function fixture(ids = [20, 21]) {
  const calls = [];
  const native = async (method, args = {}) => {
    calls.push({ method, args });
    if (method === 'revit.bridge.info') return structuredClone(plugin);
    if (method === 'revit.context.get') return structuredClone(context(native.identity || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    if (method === 'revit.search') return { offset: 0, limit: 500, hasMore: false, items: ids.map(id => ({ id })) };
    if (method === 'revit.sheet.layout') return native.layout || sheet(native.identity || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0);
    throw new Error(`unexpected method ${method}`);
  };
  native.identity = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  return { native, calls };
}

test('read-only acceptance exposes a narrow native method allowlist', () => {
  assert.deepEqual([...NATIVE_READ_METHODS], ['revit.bridge.info', 'revit.context.get', 'revit.search', 'revit.sheet.layout']);
  assert.equal(validateBridgeInfo(plugin).features.includes(REQUIRED_FEATURE), true);
});

test('prepare records category scope and sheet diagnostics without plans or writes', async () => {
  const f = fixture();
  const record = await prepareSheetLayoutAcceptance({ project, sheetId: 20, categories: 'OST_Sheets' }, f.native);
  assert.equal(record.baseline.categoryScope.OST_Sheets.count, 2);
  assert.deepEqual(record.baseline.categoryScope.OST_Sheets.ids, [20, 21]);
  assert.equal(record.baseline.diagnostic.complete, true);
  assert.equal(record.modelWritesRequested, false);
  assert.equal(record.planCreated, false);
  assert.deepEqual(f.calls.map(call => call.method), ['revit.bridge.info', 'revit.context.get', 'revit.search', 'revit.context.get', 'revit.sheet.layout', 'revit.context.get', 'revit.context.get', 'revit.bridge.info']);
});

test('verify accepts a reopened native session identity while preserving path, revision and category IDs', async () => {
  const prepared = fixture();
  const record = await prepareSheetLayoutAcceptance({ project, sheetId: 20, categories: 'OST_Sheets' }, prepared.native);
  const calls = [];
  const reopened = async (method, args = {}) => {
    calls.push({ method, args });
    if (method === 'revit.bridge.info') return structuredClone(plugin);
    if (method === 'revit.context.get') return structuredClone(context('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
    if (method === 'revit.search') return { offset: 0, limit: 500, hasMore: false, items: [{ id: 20 }, { id: 21 }] };
    if (method === 'revit.sheet.layout') return sheet('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 0);
    throw new Error(`unexpected method ${method}`);
  };
  const verified = await verifySheetLayoutAcceptance(record, reopened);
  assert.equal(verified.status, 'PASS_SHEET_LAYOUT_READ_ONLY_REOPEN');
  assert.equal(verified.identityChangedAfterReopen, true);
  assert.equal(verified.verification.pathVerified, true);
  assert.equal(verified.verification.revisionVerified, true);
  assert.equal(verified.verification.categoryScopeVerified, true);
  assert.equal(verified.verification.moduleVersionVerified, true);
  assert.equal(verified.modelWritesRequested, false);
  assert.deepEqual(calls.map(call => call.method), ['revit.bridge.info', 'revit.context.get', 'revit.search', 'revit.context.get', 'revit.sheet.layout', 'revit.context.get', 'revit.context.get', 'revit.bridge.info']);
});

test('context and plugin gates fail closed', () => {
  assert.throws(() => validateBridgeInfo({ ...plugin, features: [] }), error => error.code === 'feature_not_loaded');
  assert.throws(() => validateContext({ ...context('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), document: { ...context('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').document, isModified: true } }, project), error => error.code === 'sheet_acceptance_unsaved');
});

test('same-session verify reports current-session readback and never claims reopen', async () => {
  const f = fixture();
  const record = await prepareSheetLayoutAcceptance({ project, sheetId: 20 }, f.native);
  const verified = await verifySheetLayoutAcceptance(record, f.native);
  assert.equal(verified.status, 'PASS_SHEET_LAYOUT_READ_ONLY_CURRENT_SESSION');
  assert.equal(verified.identityChangedAfterReopen, false);
  assert.equal(verified.verification.reopenVerified, false);
});

test('changed category membership and MVID reject the readback before a sheet read', async () => {
  const prepared = fixture();
  const record = await prepareSheetLayoutAcceptance({ project, sheetId: 20 }, prepared.native);
  const changed = fixture([20, 22]);
  await assert.rejects(verifySheetLayoutAcceptance(record, changed.native), error => error.code === 'sheet_acceptance_category_changed');
  assert.equal(changed.calls.some(call => call.method === 'revit.sheet.layout'), false);
  await assert.rejects(verifySheetLayoutAcceptance(record, async method => method === 'revit.bridge.info' ? { ...plugin, moduleVersionId: '11111111-1111-1111-1111-111111111111' } : null), error => error.code === 'sheet_acceptance_plugin_mismatch');
});

test('changed native geometry rejects readback while session fields are rebound', async () => {
  const prepared = fixture();
  const record = await prepareSheetLayoutAcceptance({ project, sheetId: 20, categories: 'OST_Sheets' }, prepared.native);
  const changed = fixture();
  changed.native.identity = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  changed.native.layout = sheet(changed.native.identity, 0);
  changed.native.layout.viewports = [{ id: 55, ownerViewId: 20, viewId: 80, content: { status: 'unknown', min: null, max: null, error: 'bbox' }, label: { status: 'unknown', min: null, max: null, error: 'bbox' } }];
  await assert.rejects(verifySheetLayoutAcceptance(record, changed.native), error => error.code === 'sheet_acceptance_layout_changed');
});

test('a changed document session during one pass discards the report', async () => {
  const f = fixture();
  let contextReads = 0;
  await assert.rejects(prepareSheetLayoutAcceptance({ project, sheetId: 20 }, async (method, args) => {
    if (method === 'revit.context.get' && ++contextReads === 4) f.native.identity = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    return f.native(method, args);
  }), error => error.code === 'sheet_acceptance_document_changed');
});

test('an absolute test-copy path is required before any native read', async () => {
  const f = fixture();
  await assert.rejects(prepareSheetLayoutAcceptance({ project: undefined, sheetId: 20 }, f.native), error => error.code === 'sheet_acceptance_project_invalid');
  assert.deepEqual(f.calls, []);
});

test('malformed raw native sheet payload fails closed before derived acceptance', async () => {
  const f = fixture();
  const malformed = async (method, args) => method === 'revit.sheet.layout' ? { modelWritesRequested: false, automaticSave: false, allModelSideEffectsVerified: false } : f.native(method, args);
  await assert.rejects(prepareSheetLayoutAcceptance({ project, sheetId: 20, categories: 'OST_Sheets' }, malformed), error => error.code === 'sheet_layout_scope_mismatch');
});

test('the final context count read is part of the acceptance boundary', async () => {
  const f = fixture();
  let contextReads = 0;
  const drift = async (method, args) => {
    if (method !== 'revit.context.get') return f.native(method, args);
    contextReads++;
    const value = await f.native(method, args);
    if (contextReads >= 3) value.counts.OST_Sheets = 3;
    return value;
  };
  await assert.rejects(prepareSheetLayoutAcceptance({ project, sheetId: 20, categories: 'OST_Sheets' }, drift), error => ['sheet_layout_state_changed', 'sheet_acceptance_state_changed', 'sheet_acceptance_counts_changed'].includes(error.code) || error.message.includes('native category counts changed'));
});
