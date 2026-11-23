const metadata = ['operationType', 'id', 'dependencies'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(message) {
  return Object.assign(new Error(message), { code: 'invalid_2d_annotation' });
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

function checkText(text) {
  if (typeof text !== 'string' || text.length < 1 || text.length > 4000 || text.trim().length === 0) {
    throw fail('text must be a nonblank string up to 4000 characters.');
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') continue;
    if (ch === '\r' && text[i + 1] === '\n') continue;
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(ch)) {
      throw fail('text may not contain control characters other than \\n or \\r\\n.');
    }
  }
}

export function validateAnnotationCreation(op) {
  if (!isObject(op)) throw fail('2D annotation operation must be an object.');
  if (op.operationType === 'create_text_note') {
    const allowed = [...metadata, 'viewId', 'textTypeId', 'text', 'point', 'widthMm', 'rotationDegrees'];
    if (Object.keys(op).some(k => !allowed.includes(k))) {
      throw fail('Unsupported create_text_note field.');
    }
    checkMetadata(op);
    checkId(op.viewId, 'viewId');
    checkId(op.textTypeId, 'textTypeId');
    checkText(op.text);
    checkPoint(op.point, 'point');
    if (Object.hasOwn(op, 'widthMm')) {
      if (typeof op.widthMm !== 'number' || !Number.isFinite(op.widthMm) || op.widthMm < 1 || op.widthMm > 50000) {
        throw fail('widthMm must be a finite number between 1 and 50000 mm.');
      }
    }
    if (Object.hasOwn(op, 'rotationDegrees')) {
      if (typeof op.rotationDegrees !== 'number' || !Number.isFinite(op.rotationDegrees) || op.rotationDegrees < -360 || op.rotationDegrees > 360) {
        throw fail('rotationDegrees must be a finite number between -360 and 360.');
      }
    }
    return op;
  }
  if (op.operationType === 'create_detail_line') {
    const allowed = [...metadata, 'viewId', 'start', 'end', 'lineStyleId'];
    if (Object.keys(op).some(k => !allowed.includes(k))) {
      throw fail('Unsupported create_detail_line field.');
    }
    checkMetadata(op);
    checkId(op.viewId, 'viewId');
    checkPoint(op.start, 'start');
    checkPoint(op.end, 'end');
    if (Math.hypot(op.end.xMm - op.start.xMm, op.end.yMm - op.start.yMm, op.end.zMm - op.start.zMm) < 1) {
      throw fail('Detail line length must be at least 1 mm.');
    }
    if (Object.hasOwn(op, 'lineStyleId')) checkId(op.lineStyleId, 'lineStyleId');
    return op;
  }
  throw fail('Expected create_text_note or create_detail_line.');
}

export function validateAnnotationCreationPlan(operations) {
  const sources = new Set();
  for (const op of operations) {
    if (op?.operationType === 'create_text_note' || op?.operationType === 'create_detail_line') {
      validateAnnotationCreation(op);
      sources.add(op.viewId);
      if (op.textTypeId !== undefined) sources.add(op.textTypeId);
      if (op.lineStyleId !== undefined) sources.add(op.lineStyleId);
    }
  }
  if (!sources.size) return;
  for (const op of operations) {
    if (op.operationType === 'load_family' ||
        (['set_parameter', 'delete_element'].includes(op.operationType) && sources.has(op.elementId))) {
      throw fail('2D annotation target view, text type, or line style changes and family loading require a separate reviewed plan.');
    }
  }
}

export async function requireAnnotationCreationHostFeature(call, signal) {
  const host = await call('revit.bridge.info', {}, signal);
  if (!Array.isArray(host?.features) || !host.features.includes('controlled-2d-annotations')) {
    throw Object.assign(
      new Error('The loaded Revit add-in does not provide controlled-2d-annotations. This source is staged; load the combined candidate before creating text notes or detail lines.'),
      { code: 'annotation_creation_native_feature_unavailable' }
    );
  }
  return { requiredFeature: 'controlled-2d-annotations', moduleVersionId: host.moduleVersionId, nativeAcceptance: false };
}
