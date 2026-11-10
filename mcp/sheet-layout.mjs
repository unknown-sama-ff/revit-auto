import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const identity = z.string().min(1).max(200).refine(value => value.trim().length > 0, 'Read the current document identity.');
export const sheetLayoutSchema = z.object({
  documentIdentity: identity,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sheetId: id
}).strict();

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function contextPin(context, input) {
  if (context?.active !== true || typeof context.document?.identity !== 'string' || !Number.isSafeInteger(context.document.revision) || context.document.revision < 0 ||
      typeof context.document.path !== 'string' || typeof context.document.isModified !== 'boolean' || typeof context.document.isReadOnly !== 'boolean')
    fail('sheet_layout_context_invalid', 'Native context lacks a verified project identity or revision.');
  if (context.document.identity !== input.documentIdentity) fail('document_changed', 'The active project differs from the reviewed sheet layout document.');
  if (context.document.revision !== input.expectedRevision) fail('document_revision_changed', 'The project changed since the reviewed sheet layout context.');
}
function number(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('sheet_layout_geometry_invalid', `${label} must be finite.`);
  return value;
}
function bounds(geometry, label) {
  if (!geometry || typeof geometry !== 'object' || geometry.status === 'unknown')
    return { status: 'unknown', error: typeof geometry?.error === 'string' && geometry.error.trim() ? geometry.error : `${label}-unknown` };
  if (geometry.status !== 'known' || !geometry.min || !geometry.max)
    fail('sheet_layout_geometry_invalid', `${label} has an invalid geometry status.`);
  const min = { xMm: number(geometry.min.xMm, `${label}.min.xMm`), yMm: number(geometry.min.yMm, `${label}.min.yMm`) };
  const max = { xMm: number(geometry.max.xMm, `${label}.max.xMm`), yMm: number(geometry.max.yMm, `${label}.max.yMm`) };
  if (min.xMm > max.xMm || min.yMm > max.yMm) fail('sheet_layout_geometry_invalid', `${label} has inverted bounds.`);
  return { status: 'known', min, max };
}
function entity(idValue, kind, geometry, label, ownerViewId, viewId) {
  if (!Number.isSafeInteger(idValue) || idValue <= 0) fail('sheet_layout_scope_unknown', `${label} has an invalid native ID.`);
  if (ownerViewId !== undefined && (!Number.isSafeInteger(ownerViewId) || ownerViewId <= 0)) fail('sheet_layout_scope_unknown', `${label} has an invalid owner view ID.`);
  if (viewId !== undefined && (!Number.isSafeInteger(viewId) || viewId <= 0)) fail('sheet_layout_scope_unknown', `${label} has an invalid source view ID.`);
  return { id: idValue, kind, ownerViewId, viewId, geometry: bounds(geometry, label) };
}
function area(a, b) {
  const value = Math.max(0, Math.min(a.max.xMm, b.max.xMm) - Math.max(a.min.xMm, b.min.xMm)) *
    Math.max(0, Math.min(a.max.yMm, b.max.yMm) - Math.max(a.min.yMm, b.min.yMm));
  if (!Number.isFinite(value)) fail('sheet_layout_geometry_invalid', 'Native overlap area exceeds the finite diagnostic range.');
  return value;
}
function stablePair(a, b) { return a.id < b.id ? [a, b] : [b, a]; }
function overflowSides(geometry, boundary) {
  const sides = [];
  if (geometry.min.xMm < boundary.min.xMm) sides.push('left');
  if (geometry.min.yMm < boundary.min.yMm) sides.push('bottom');
  if (geometry.max.xMm > boundary.max.xMm) sides.push('right');
  if (geometry.max.yMm > boundary.max.yMm) sides.push('top');
  return sides;
}
function placementOrder(a, b) { return a.id - b.id || a.kind.localeCompare(b.kind); }

function titleBlockContainment(rows) {
  const frames = rows.filter(row => row.kind === 'title-block');
  const placements = rows.filter(row => row.kind !== 'title-block').sort(placementOrder);
  const unknownGeometry = placements.filter(row => row.geometry.status === 'unknown')
    .map(row => ({ id: row.id, kind: row.kind, error: row.geometry.error }));
  const frame = frames[0];
  const reason = frames.length === 0 ? 'no-titleblock'
    : frames.length > 1 ? 'multiple-titleblocks'
    : frame.geometry.status !== 'known' ? 'titleblock-bounds-unknown'
    : frame.geometry.min.xMm === frame.geometry.max.xMm || frame.geometry.min.yMm === frame.geometry.max.yMm ? 'titleblock-bounds-degenerate'
    : null;
  if (reason) return {
    schemaVersion: 1, status: 'unknown', boundarySource: null, boundary: null,
    outOfBounds: [], unknownGeometry, complete: false, reason
  };
  // A native titleblock AABB is a comparison boundary, not a printable area.
  const boundary = { titleBlockId: frame.id, min: { ...frame.geometry.min }, max: { ...frame.geometry.max } };
  const outOfBounds = [];
  for (const row of placements) {
    if (row.geometry.status !== 'known') continue;
    const sides = overflowSides(row.geometry, boundary);
    if (sides.length) outOfBounds.push({ id: row.id, kind: row.kind, sides });
  }
  return {
    schemaVersion: 1, status: 'evaluated', boundarySource: 'single-native-titleblock-bounding-box',
    boundary, outOfBounds, unknownGeometry, complete: unknownGeometry.length === 0, reason: null
  };
}

function validateNative(native, input) {
  if (!native || native.documentIdentity !== input.documentIdentity || native.documentRevision !== input.expectedRevision || native.sheetId !== input.sheetId)
    fail('sheet_layout_scope_mismatch', 'Native sheet layout evidence does not match the reviewed document, revision, or sheet.');
  if (!Array.isArray(native.titleBlocks) || !Array.isArray(native.viewports) || !Array.isArray(native.schedulePlacements) || !Array.isArray(native.annotationPlacements))
    fail('sheet_layout_scope_unknown', 'Native sheet layout collections are missing or malformed.');
  if (!native.outline?.min || !native.outline?.max) fail('sheet_layout_scope_unknown', 'The native sheet outline is unavailable.');
  const outline = bounds({status: 'known', min: native.outline.min, max: native.outline.max}, 'outline');
  const rows = [];
  const ids = new Set();
  const nativeIds = new Set();
  const add = item => { const key = `${item.id}:${item.kind}`; if (ids.has(key)) fail('sheet_layout_scope_unknown', `Duplicate native layout element ${item.id} (${item.kind}).`); ids.add(key); rows.push(item); };
  const reserveNativeId = (idValue, label) => {
    if (!Number.isSafeInteger(idValue) || idValue <= 0) fail('sheet_layout_scope_unknown', `${label} has an invalid native ID.`);
    if (nativeIds.has(idValue)) fail('sheet_layout_scope_unknown', `Duplicate native layout element ${idValue}.`);
    nativeIds.add(idValue);
  };
  for (const item of native.titleBlocks) {
    reserveNativeId(item.id, 'Title block');
    if (item.ownerViewId !== input.sheetId) fail('sheet_layout_scope_mismatch', `Title block ${item.id} is not owned by the requested sheet.`);
    add(entity(item.id, 'title-block', item.geometry, `titleBlocks[${item.id}]`, item.ownerViewId));
  }
  for (const item of native.viewports) {
    reserveNativeId(item.id, 'Viewport');
    if (item.ownerViewId !== input.sheetId) fail('sheet_layout_scope_mismatch', `Viewport ${item.id} is not owned by the requested sheet.`);
    add(entity(item.id, 'viewport-content', item.content, `viewports[${item.id}].content`, item.ownerViewId, item.viewId));
    add(entity(item.id, 'viewport-label', item.label, `viewports[${item.id}].label`, item.ownerViewId, item.viewId));
  }
  for (const item of native.schedulePlacements) {
    reserveNativeId(item.id, 'Schedule placement');
    if (item.ownerViewId !== input.sheetId || !['ScheduleSheetInstance','PanelScheduleSheetInstance'].includes(item.className))
      fail('sheet_layout_scope_mismatch', `Schedule placement ${item.id} does not belong to the requested sheet or has an unsupported class.`);
    add(entity(item.id, item.className === 'PanelScheduleSheetInstance' ? 'panel-schedule' : 'schedule', item.geometry, `schedulePlacements[${item.id}]`, item.ownerViewId, item.viewId));
  }
  for (const item of native.annotationPlacements) {
    reserveNativeId(item.id, 'Annotation placement');
    if (item.ownerViewId !== input.sheetId || !['TextNote', 'IndependentTag'].includes(item.className))
      fail('sheet_layout_scope_mismatch', `Annotation placement ${item.id} does not belong to the requested sheet or has an unsupported class.`);
    const expectedKind = item.className === 'TextNote' ? 'text-note' : 'independent-tag';
    if (item.kind !== expectedKind)
      fail('sheet_layout_scope_unknown', `Annotation placement ${item.id} has an invalid kind.`);
    add(entity(item.id, expectedKind, item.geometry, `annotationPlacements[${item.id}]`, item.ownerViewId));
  }
  return { outline, rows };
}

export async function diagnoseSheetLayout(request, call, signal) {
  const input = sheetLayoutSchema.parse(request);
  signal?.throwIfAborted();
  const before = await call('revit.context.get', {}, signal);
  contextPin(before, input);
  const native = await call('revit.sheet.layout', input, signal);
  const { outline, rows } = validateNative(native, input);
  const unknownGeometry = rows.filter(row => row.geometry.status === 'unknown').map(row => ({ id: row.id, kind: row.kind, error: row.geometry.error }));
  const outOfSheet = [];
  for (const row of rows) {
    if (row.geometry.status !== 'known') continue;
    const sides = overflowSides(row.geometry, outline);
    if (sides.length) outOfSheet.push({ id: row.id, kind: row.kind, sides });
  }
  const intersectionCandidates = [];
  const maxCandidates = 5000;
  let intersectionCandidateCount = 0;
  const placements = rows.filter(row => row.kind !== 'title-block').sort((a,b)=>a.id-b.id||a.kind.localeCompare(b.kind));
  for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) {
    const a = placements[i], b = placements[j];
    if (a.geometry.status !== 'known' || b.geometry.status !== 'known') continue;
    const overlapMm2 = area(a.geometry, b.geometry);
    if (overlapMm2 <= 0) continue;
    const [first, second] = stablePair(a, b);
    intersectionCandidateCount++;
    if(intersectionCandidates.length<maxCandidates)intersectionCandidates.push({ firstId: first.id, firstKind: first.kind, secondId: second.id, secondKind: second.kind, areaMm2: overlapMm2 });
  }
  intersectionCandidates.sort((a, b) => a.firstId - b.firstId || a.secondId - b.secondId || a.firstKind.localeCompare(b.firstKind) || a.secondKind.localeCompare(b.secondKind));
  outOfSheet.sort((a, b) => a.id - b.id || a.kind.localeCompare(b.kind));
  const after = await call('revit.context.get', {}, signal);
  contextPin(after, input);
  if (before.document.path !== after.document.path || before.document.isModified !== after.document.isModified || before.document.isReadOnly !== after.document.isReadOnly)
    fail('sheet_layout_state_changed', 'The document path or saved state changed during sheet layout inspection; discard this report.');
  if ((before.counts !== undefined || after.counts !== undefined) && !isDeepStrictEqual(before.counts, after.counts))
    fail('sheet_layout_state_changed', 'The native category counts changed during sheet layout inspection; discard this report.');
  return {
    ...native,
    status: 'read_only_result',
    outOfSheet,
    outOfSheetBoundary: 'native-view-sheet-outline',
    titleBlockContainment: titleBlockContainment(rows),
    intersectionCandidates,
    intersectionCandidateCount,
    intersectionCandidatesTruncated: intersectionCandidateCount>intersectionCandidates.length,
    unknownGeometry,
    complete: unknownGeometry.length === 0 && intersectionCandidateCount===intersectionCandidates.length,
    limitations: ['Native bounds only; text and axis-grid labels may not be represented.', 'Geometric candidates do not certify PNG visual cleanliness; export and inspect the sheet image separately.', 'outOfSheet uses ViewSheet.Outline, which can include content outside a titleblock; complete does not certify titleblock containment.', 'titleBlockContainment compares only one known native axis-aligned titleblock box, not the printable area, usable content area or exact rotated frame.'],
    readOnly: true,
    planCreated: false,
    modelWritesRequested: false,
    automaticSave: false,
    allModelSideEffectsVerified: false
  };
}
