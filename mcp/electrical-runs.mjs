const metadata = ['operationType', 'id', 'dependencies'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(message) {
  return Object.assign(new Error(message), { code: 'invalid_electrical_run' });
}

function checkId(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw fail(`${field} must be an existing positive safe native element ID.`);
  }
}

function checkMetadataId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80 || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw fail('Operation/dependency IDs must be nonblank strings up to 80 characters without surrounding whitespace or controls.');
  }
}

function checkMetadata(op) {
  if (Object.hasOwn(op, 'id')) checkMetadataId(op.id);
  if (Object.hasOwn(op, 'dependencies')) {
    if (!Array.isArray(op.dependencies) || op.dependencies.length > 1000) {
      throw fail('dependencies must be a bounded array of operation IDs.');
    }
    const seen = new Set();
    for (const dep of op.dependencies) {
      checkMetadataId(dep);
      if (seen.has(dep) || dep === op.id) {
        throw fail('Dependencies must be distinct valid IDs and cannot reference the operation itself.');
      }
      seen.add(dep);
    }
  }
}

function checkPoint(value, field) {
  if (!isObject(value) || Object.keys(value).length !== 3 || !['xMm', 'yMm', 'zMm'].every(k => Object.hasOwn(value, k))) {
    throw fail(`${field} requires exact xMm, yMm, and zMm coordinates.`);
  }
  for (const axis of ['xMm', 'yMm', 'zMm']) {
    const n = value[axis];
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e8) {
      throw fail(`${field}.${axis} must be a finite number with absolute value at most 100000000 mm.`);
    }
  }
}

function checkBoundedPositive(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw fail(`${field} must be a finite number between ${min} and ${max} mm.`);
  }
}

export function validateElectricalRun(op) {
  if (!isObject(op)) throw fail('Electrical run operation must be an object.');
  if (op.operationType === 'create_cable_tray') {
    const allowed = [...metadata, 'cableTrayTypeId', 'levelId', 'start', 'end', 'widthMm', 'heightMm'];
    if (Object.keys(op).some(k => !allowed.includes(k))) {
      throw fail('Unsupported create_cable_tray field.');
    }
    checkMetadata(op);
    checkId(op.cableTrayTypeId, 'cableTrayTypeId');
    checkId(op.levelId, 'levelId');
    checkPoint(op.start, 'start');
    checkPoint(op.end, 'end');
    if (Math.hypot(op.end.xMm - op.start.xMm, op.end.yMm - op.start.yMm, op.end.zMm - op.start.zMm) < 1) {
      throw fail('Cable tray length must be at least 1 mm.');
    }
    checkBoundedPositive(op.widthMm, 'widthMm', 1, 10000);
    checkBoundedPositive(op.heightMm, 'heightMm', 1, 10000);
    return op;
  }
  if (op.operationType === 'create_conduit') {
    const allowed = [...metadata, 'conduitTypeId', 'levelId', 'start', 'end', 'diameterMm'];
    if (Object.keys(op).some(k => !allowed.includes(k))) {
      throw fail('Unsupported create_conduit field.');
    }
    checkMetadata(op);
    checkId(op.conduitTypeId, 'conduitTypeId');
    checkId(op.levelId, 'levelId');
    checkPoint(op.start, 'start');
    checkPoint(op.end, 'end');
    if (Math.hypot(op.end.xMm - op.start.xMm, op.end.yMm - op.start.yMm, op.end.zMm - op.start.zMm) < 1) {
      throw fail('Conduit length must be at least 1 mm.');
    }
    checkBoundedPositive(op.diameterMm, 'diameterMm', 1, 2000);
    return op;
  }
  throw fail('Expected create_cable_tray or create_conduit.');
}

export function validateElectricalRunPlan(operations) {
  const sources = new Set();
  for (const op of operations) {
    if (op?.operationType === 'create_cable_tray' || op?.operationType === 'create_conduit') {
      validateElectricalRun(op);
      sources.add(op.levelId);
      if (op.cableTrayTypeId !== undefined) sources.add(op.cableTrayTypeId);
      if (op.conduitTypeId !== undefined) sources.add(op.conduitTypeId);
    }
  }
  if (!sources.size) return;
  for (const op of operations) {
    if (op.operationType === 'load_family' ||
        (['set_parameter', 'delete_element'].includes(op.operationType) && sources.has(op.elementId))) {
      throw fail('Electrical run type or level changes and family loading require a separate reviewed plan.');
    }
  }
}

export async function requireElectricalRunHostFeature(call, signal) {
  const host = await call('revit.bridge.info', {}, signal);
  if (!Array.isArray(host?.features) || !host.features.includes('controlled-electrical-runs')) {
    throw Object.assign(
      new Error('The loaded Revit add-in does not provide controlled-electrical-runs. This source is staged; load the combined candidate before creating cable trays or conduits.'),
      { code: 'electrical_runs_native_feature_unavailable' }
    );
  }
  return { requiredFeature: 'controlled-electrical-runs', moduleVersionId: host.moduleVersionId, nativeAcceptance: false };
}
