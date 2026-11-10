import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWatchedNativeSnapshots } from '../floor-side-effect-diff.mjs';

const watchedIds = [86962, 293247];
const parameter = (id, name, value, extra = {}) => ({
  id, name, storageType: 'Integer', readOnly: true, hasValue: true,
  value, valueSupported: true, formattedValue: String(value), ...extra
});
const item = (id, name, parameters) => ({
  summary: { id, uniqueId: `uid-${id}`, name, className: 'Element', category: null, categoryId: -1, typeId: -1, ownerViewId: -1, levelId: -1 },
  parameters, architecturePrimary: null, connectors: []
});
const snapshot = (revision, isModified, items) => ({
  document: { identity: 'test-copy-session', path: 'floor-copy.rvt', revision, isModified },
  items
});
const before = snapshot(0, false, [
  item(86962, '系统数据', [parameter(-100, 'Count', 1)]),
  item(293247, '自动连接跟踪器图元', [parameter(-101, 'Count', 4)])
]);
const after = snapshot(1, true, [
  item(86962, '系统数据', [parameter(-100, 'Count', 2)]),
  item(293247, '自动连接跟踪器图元', [parameter(-101, 'Count', 4)])
]);

test('reports exact watched native parameter changes without certifying causality or all side effects', () => {
  const result = compareWatchedNativeSnapshots({ before, after, watchIds: watchedIds });
  assert.equal(result.complete, true);
  assert.equal(result.allModelSideEffectsVerified, false);
  assert.equal(result.causalityEstablished, false);
  assert.deepEqual(result.items.map(x => x.elementId), watchedIds);
  assert.deepEqual(result.items[0].changedParameters, [{
    id: -100, name: 'Count', storageType: 'Integer', before: { hasValue: true, value: 1 }, after: { hasValue: true, value: 2 }
  }]);
  assert.deepEqual(result.items[1].changedParameters, []);
});

test('rejects document drift, non-single-revision ranges and saved-state mismatches', () => {
  const cases = [
    { after: { ...after, document: { ...after.document, identity: 'other' } }, code: 'document_changed' },
    { after: { ...after, document: { ...after.document, revision: 2 } }, code: 'document_revision_changed' },
    { after: { ...after, document: { ...after.document, path: 'other.rvt' } }, code: 'document_changed' },
    { before: { ...before, document: { ...before.document, isModified: true } }, code: 'snapshot_context_invalid' },
    { after: { ...after, document: { ...after.document, isModified: false } }, code: 'snapshot_context_invalid' }
  ];
  for (const change of cases) assert.throws(() => compareWatchedNativeSnapshots({ before, after, watchIds: watchedIds, ...change }), { code: change.code });
});

test('rejects incomplete, missing, duplicated or unsupported watched parameter evidence', () => {
  const badBefore = structuredClone(before);
  badBefore.items[0].parameters[0].valueSupported = false;
  const omittedValue = structuredClone(before);
  delete omittedValue.items[0].parameters[0].value;
  const missing = structuredClone(after);
  missing.items.pop();
  const duplicate = structuredClone(after);
  duplicate.items.push(structuredClone(duplicate.items[0]));
  for (const input of [
    { before: badBefore, after },
    { before: omittedValue, after },
    { before, after: missing },
    { before, after: duplicate },
    { before, after, watchIds: [86962, 86962] },
    { before, after, watchIds: [86962, 999999] }
  ]) assert.throws(() => compareWatchedNativeSnapshots({ before, after, watchIds: watchedIds, ...input }), { code: 'incomplete_snapshot' });
});

test('a no-visible-parameter-change result stays explicitly unproven', () => {
  const same = compareWatchedNativeSnapshots({ before, after: snapshot(1, true, structuredClone(before.items)), watchIds: watchedIds });
  assert.equal(same.complete, true);
  assert.equal(same.causalityEstablished, false);
  assert.equal(same.allModelSideEffectsVerified, false);
  assert.equal(same.items.every(x => x.changedParameters.length === 0), true);
});
