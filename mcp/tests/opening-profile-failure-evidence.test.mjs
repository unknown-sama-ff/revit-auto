import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source = name => fs.readFile(new URL(`../../v27/${name}`, import.meta.url), 'utf8');

test('native profile mismatch still checks full3D edges and freezes diagnostics before throwing', async () => {
  const service = await source('OpeningService.cs');
  assert.match(service, /OpeningRules\.EdgesMatch\(expected\.Select\(MmPoint\)/);
  assert.match(service, /throw OpeningProfileFailureDiagnostics\.Create\(op, phase/);
  assert.match(service, /var actualSegments = curves\.Select/);
  assert.match(service, /\(\) => CaptureComparedProfile\(opening, actualSegments, curves\)/);
  assert.match(service, /\(\) => CaptureProfileCoordinateContext\(doc, opening\)/);
  assert.match(service, /PlanRules\.Number\(op,"hostToleranceMm"\)/);
  assert.doesNotMatch(service, /hostToleranceMm"\s*,\s*100/);
  const captured = service.slice(service.indexOf('private static JsonElement CaptureComparedProfile('), service.indexOf('private static JsonElement CaptureProfileCoordinateContext('));
  assert.doesNotMatch(captured, /get_Parameter|BoundaryCurves|\.Regenerate\(|\.Normalize\(/);
  assert.match(captured, /xMm = point\.X, yMm = point\.Y, zMm = point\.Z/);
});
test('profile diagnostic context preserves box and sketch-plane frames with bounded dependency inspection', async () => {
  const service = await source('OpeningService.cs');
  const start = service.indexOf('private static JsonElement CaptureProfileCoordinateContext(');
  const end = service.indexOf('public static object Preview(', start);
  assert.ok(start >= 0 && end > start);
  const body = service.slice(start, end);
  for (const token of ['get_BoundingBox', 'GetPlane()', 'plane.Origin', 'plane.XVec', 'plane.YVec', 'plane.Normal', 'GetDependentElements(null)', 'Take(256)', 'Take(4)', 'NativeReadSnapshot.Freeze'])
    assert.ok(body.includes(token), token);
  assert.doesNotMatch(body, /\.Regenerate\(|new Transaction|\.Save\(|\.SaveAs\(|NewOpening\(/);
});
test('profile failure evidence is advertised and the existing failure receipt forwards causeDetails after rollback', async () => {
  const router = await source('RevitCommandRouter.cs');
  assert.match(router, /"opening-profile-failure-evidence"/);
  assert.match(router, /causeDetails\s*=\s*\(ex as BridgeException\)\?\.Details/);
  assert.match(router, /rolledBack/);
});
