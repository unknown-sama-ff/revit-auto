const metadata = ['operationType', 'id', 'dependencies'];
const nativeId = (value, field, allowReference = false) => {
  if (allowReference && typeof value === 'string' && /^@\S{1,80}$/.test(value)) return;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${field} must be an existing positive native ID; preview new types/levels in a separate plan.`);
};
const finite = (value, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e8)
    throw new Error(`${field} must be a finite number in millimeters.`);
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateStructuralColumn(op) {
  const required = ['symbolId', 'baseLevelId', 'topLevelId', 'baseOffsetMm', 'topOffsetMm', 'point'];
  const allowed = [...metadata, ...required, 'rotationDegrees'];
  if (!object(op) || Object.keys(op).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(op, key)))
    throw new Error('Structural columns require explicit symbolId, base/top level IDs, both offsets and point; unknown or guessed fields are rejected.');
  nativeId(op.symbolId, 'symbolId', true);
  for (const field of ['baseLevelId', 'topLevelId']) nativeId(op[field], field);
  if (op.baseLevelId === op.topLevelId) throw new Error('Column base and top levels must be different.');
  finite(op.baseOffsetMm, 'baseOffsetMm');
  finite(op.topOffsetMm, 'topOffsetMm');
  if (!object(op.point) || Object.keys(op.point).length !== 2 || !Object.hasOwn(op.point, 'xMm') || !Object.hasOwn(op.point, 'yMm'))
    throw new Error('Column point accepts only explicit xMm/yMm; Z comes from the reviewed base level and baseOffsetMm.');
  finite(op.point.xMm, 'xMm');
  finite(op.point.yMm, 'yMm');
  if (Object.hasOwn(op, 'rotationDegrees')) {
    finite(op.rotationDegrees, 'rotationDegrees');
    if (Math.abs(op.rotationDegrees) > 360) throw new Error('rotationDegrees must be in [-360,360].');
  }
  return op;
}

export function validateGrid(op) {
  const allowed = [...metadata, 'name', 'start', 'end'];
  if (!object(op) || Object.keys(op).some(key => !allowed.includes(key)))
    throw new Error('Grid creation accepts only an explicit name and straight start/end geometry.');
  if (typeof op.name !== 'string' || !op.name.trim() || op.name.trim() !== op.name || op.name.length > 200)
    throw new Error('Grid name must be explicit, nonempty, and without surrounding whitespace.');
  const point = (value, field) => {
    if (!object(value) || Object.keys(value).some(key => !['xMm', 'yMm', 'zMm'].includes(key)))
      throw new Error(`${field} requires only XY and optional Z coordinates.`);
    finite(value.xMm, 'xMm'); finite(value.yMm, 'yMm');
    if (Object.hasOwn(value, 'zMm')) finite(value.zMm, 'zMm');
    return { ...value, zMm: value.zMm ?? 0 };
  };
  const a = point(op.start, 'start'), b = point(op.end, 'end');
  if (Math.abs(a.zMm - b.zMm) > 0.01) throw new Error('Grid endpoints must be in one horizontal plane within 0.01 mm.');
  if (Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) < 1) throw new Error('Grid endpoints must be at least 1 mm apart.');
  return op;
}
