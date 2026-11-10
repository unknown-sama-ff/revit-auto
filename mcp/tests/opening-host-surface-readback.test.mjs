import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source=name=>fs.readFile(new URL(`../../v27/${name}`,import.meta.url),'utf8');
test('floor profile captures original native surface before creating an Opening and carries it through all stages',async()=>{
  const s=await source('ModelExecutor.cs');
  assert.match(s,/OpeningHostSurfaceBinding\? HostSurface/);
  const start=s.indexOf('case "create_opening": created = CreateOpening');
  assert.ok(start>=0);
  assert.ok(s.indexOf('CaptureBeforeCreation')>=0);
  const wrapper=s.slice(s.indexOf('private Opening CreateOpening('),s.indexOf('private CurveLoop FloorLoop('));
  assert.ok(wrapper.indexOf('op.Clone()')<wrapper.indexOf('CaptureBeforeCreation'));
  assert.ok(wrapper.indexOf('CaptureBeforeCreation')<wrapper.indexOf('OpeningService.Create'));
  assert.match(wrapper,/openingCreationDocument\.Equals\(document\)/);
  assert.match(s,/OpeningService\.Verify\(document, opening, binding\.Operation, phase, binding\.HostSurface\)/);
});
test('native host loops are bounded classified and frozen without mutating or projecting output geometry',async()=>{
  const s=await source('OpeningHostSurfaceReadbackService.cs');
  for(const token of ['HostObjectUtils.GetTopFaces','GetEdgesAsCurveLoops','IsCounterclockwise','FaceNormal','NativeReadSnapshot.Freeze','MaxCurves'])assert.ok(s.includes(token),token);
  assert.doesNotMatch(s,/NewOpening|\.Regenerate\(|new Transaction|\.Save\(|\.SaveAs\(/);
});
test('floor raw Opening boundary and actual host cut boundary remain separate and shaft stays fullXYZ',async()=>{
  const s=await source('OpeningService.cs'),router=await source('RevitCommandRouter.cs');
  assert.match(s,/OpeningHostSurfaceReadbackService\.Verify/);
  assert.match(s,/hostSurfaceReadback/);
  assert.match(s,/actualSegments\.Any\(edge=>!FinitePoint\(edge\.Start\)\|\|!FinitePoint\(edge\.End\)\)/);
  assert.match(s,/double\.IsFinite\(p\.Z\)/);
  assert.match(s,/OpeningRules\.EdgesMatch\(expected\.Select\(MmPoint\)/);
  assert.match(router,/"opening-host-surface-readback"/);
  assert.doesNotMatch(s,/\.Z\s*=\s*0|hostToleranceMm"\s*,\s*100/);
});
