const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const positiveSafeId = value => Number.isSafeInteger(value) && value > 0;
const finiteJson = (value, seen = new Set()) => {
  if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return true;
  if ((!Array.isArray(value) && !record(value)) || seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every(child => finiteJson(child, seen));
  seen.delete(value);
  return valid;
};

function validateSnapshot(snapshot, phase) {
  if (!record(snapshot) || !record(snapshot.document) || !Array.isArray(snapshot.items) || !finiteJson(snapshot))
    fail('incomplete_snapshot', `${phase} evidence must be finite, complete JSON inspection data.`);
  const document = snapshot.document;
  if (typeof document.identity !== 'string' || !document.identity || typeof document.path !== 'string' || !document.path ||
      !Number.isSafeInteger(document.revision) || document.revision < 0 || typeof document.isModified !== 'boolean')
    fail('snapshot_context_invalid', `${phase} evidence lacks a valid document pin or saved-state flag.`);
  const byId = new Map();
  for (const item of snapshot.items) {
    const summary = item?.summary;
    if (!record(item) || !record(summary) || !positiveSafeId(summary.id) || typeof summary.uniqueId !== 'string' || !summary.uniqueId ||
        !Array.isArray(item.parameters) || byId.has(summary.id) ||
        item.parameters.some(parameter => !record(parameter) || !Number.isSafeInteger(parameter.id) || typeof parameter.name !== 'string' ||
          typeof parameter.storageType !== 'string' || typeof parameter.hasValue !== 'boolean' || parameter.valueSupported !== true ||
          (parameter.hasValue && !Object.hasOwn(parameter, 'value')) ||
          Object.hasOwn(parameter, 'parameterReadStatus') || Object.hasOwn(parameter, 'valueError')) ||
        new Set(item.parameters.map(parameter => parameter.id)).size !== item.parameters.length)
      fail('incomplete_snapshot', `${phase} evidence contains missing, duplicate or unsupported native parameter data.`);
    byId.set(summary.id, item);
  }
  return { document, byId };
}

function parameterState(parameter) {
  return { hasValue: parameter.hasValue, ...(parameter.hasValue ? { value: parameter.value } : {}) };
}

export function compareWatchedNativeSnapshots({ before, after, watchIds } = {}) {
  if (!Array.isArray(watchIds) || watchIds.length < 1 || watchIds.length > 20 ||
      watchIds.some(id => !positiveSafeId(id)) || new Set(watchIds).size !== watchIds.length)
    fail('incomplete_snapshot', 'Provide 1..20 unique positive watched element IDs.');
  const left = validateSnapshot(before, 'Before');
  const right = validateSnapshot(after, 'After');
  if (left.document.identity !== right.document.identity || left.document.path !== right.document.path)
    fail('document_changed', 'Before and after evidence must belong to the same document session and path.');
  if (right.document.revision !== left.document.revision + 1)
    fail('document_revision_changed', 'Exactly one committed document revision must separate before and after evidence.');
  if (left.document.isModified || !right.document.isModified)
    fail('snapshot_context_invalid', 'Before must be saved and after must reflect the single unsaved test transaction.');

  const items = watchIds.map(elementId => {
    const a = left.byId.get(elementId);
    const b = right.byId.get(elementId);
    if (!a || !b || a.summary.uniqueId !== b.summary.uniqueId)
      fail('incomplete_snapshot', `Watched element ${elementId} must exist with stable UniqueId in both snapshots.`);
    const beforeParameters = new Map(a.parameters.map(parameter => [parameter.id, parameter]));
    const afterParameters = new Map(b.parameters.map(parameter => [parameter.id, parameter]));
    if (beforeParameters.size !== afterParameters.size || [...beforeParameters.keys()].some(id => !afterParameters.has(id)))
      fail('incomplete_snapshot', `Watched element ${elementId} parameter membership changed; comparison is incomplete.`);
    const changedParameters = [];
    for (const [id, parameter] of beforeParameters) {
      const current = afterParameters.get(id);
      if (parameter.name !== current.name || parameter.storageType !== current.storageType ||
          JSON.stringify(parameterState(parameter)) !== JSON.stringify(parameterState(current))) {
        changedParameters.push({ id, name: parameter.name, storageType: parameter.storageType,
          before: parameterState(parameter), after: parameterState(current) });
      }
    }
    return { elementId, uniqueId: a.summary.uniqueId, beforeName: a.summary.name, afterName: b.summary.name,
      changedParameters: changedParameters.sort((x, y) => x.id - y.id) };
  });
  return { documentIdentity: left.document.identity, path: left.document.path,
    beforeRevision: left.document.revision, afterRevision: right.document.revision,
    watchedElementIds: [...watchIds].sort((a, b) => a - b), items, complete: true,
    evidenceScope: 'explicit-native-parameter-values-only',
    causalityEstablished: false, allModelSideEffectsVerified: false,
    note: 'This comparison reports native parameter values only for the explicit watched elements. It does not prove causal relationships, cover every Revit side effect, or certify the model transaction.' };
}
