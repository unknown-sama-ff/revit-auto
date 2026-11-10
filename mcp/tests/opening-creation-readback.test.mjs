import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = file => fs.readFile(new URL(`../../v27/${file}`, import.meta.url), 'utf8');

test('wall opening host uses the actual native Vertical enum and rejects unknown cross-section parameters', async () => {
  const service = await source('OpeningService.cs');
  const start = service.indexOf('public static void Validate(');
  const body = service.slice(start, service.indexOf('private static CurveArray Profile', start));
  // Revit 2027.3 metadata: Vertical=1, SingleSlanted=0, Tapered=2.
  // The native enum, rather than an assumed zero value, must drive admission.
  assert.match(body, /crossSection\.AsInteger\(\)\s*!=\s*\(int\)WallCrossSection\.Vertical/);
  assert.match(body, /crossSection\.StorageType\s*!=\s*StorageType\.Integer/);
  assert.match(body, /!crossSection\.HasValue/);
  assert.match(body, /crossSection is null/);
  assert.doesNotMatch(body, /WALL_CROSS_SECTION\)\?\.AsInteger\(\)\s*!=\s*0/);
});

// CoreTests exercise numeric behavior. These guards cover the native Revit
// transaction seam, which cannot be run in the Revit-free test process.
test('openings are rechecked before Commit and after native processing while the group can roll back', async () => {
  const router = await source('RevitCommandRouter.cs');
  const before = router.indexOf('executor.VerifyOpeningCreations("before-transaction-commit")');
  const commit = router.indexOf('if (transaction.Commit()');
  const after = router.indexOf('executor.VerifyOpeningCreations("after-transaction-commit")');
  const receipt = router.indexOf('object Receipt(NativeChangeEvidence? nativeChanges)');
  const assimilate = router.indexOf('if (group.Assimilate()');
  assert.ok(before >= 0 && before < commit);
  assert.ok(commit < after && after < receipt && receipt < assimilate);
  assert.match(router.slice(receipt, assimilate), /openingCreationVerification/);
  assert.match(router.slice(receipt, assimilate), /PrepareBounded/);
  assert.match(router, /"opening-creation-readback"/);
});

test('final opening checks bind the original native document, element and cloned reviewed operation', async () => {
  const executor = await source('ModelExecutor.cs');
  assert.match(executor, /RememberOpeningCreation\(\(Opening\)created,\s*op,\s*openingHostSurface\)/);
  const start = executor.indexOf('internal object VerifyOpeningCreations(');
  const end = executor.indexOf('private OperationReceipt RememberOpeningCreation(', start);
  assert.ok(start >= 0 && end > start);
  const body = executor.slice(start, end);
  assert.match(body, /openingCreationDocument\.IsValidObject/);
  assert.match(body, /openingCreationDocument\.Equals\(document\)/);
  assert.match(body, /document\.GetElement\(new ElementId\(binding\.ElementId\)\) as Opening/);
  assert.match(body, /OpeningService\.Verify\(document, opening, binding\.Operation, phase, binding\.HostSurface\)/);
  const remember = executor.slice(end, executor.indexOf('internal object ', end + 1));
  assert.match(remember, /operation\.Clone\(\)/);
  assert.match(remember, /document\.Regenerate\(\)/);
  assert.match(remember, /openingCreations\.Add\(\(opening\.Id\.Value, reviewed, hostSurface\)\)/);
});

test('unknown, wrong-storage and nonfinite native offsets remain unknown and both shaft offsets are checked', async () => {
  const service = await source('OpeningService.cs');
  const start = service.indexOf('private static double? ReadOffset(');
  const end = service.indexOf('private static object JsonPoint', start);
  assert.ok(start >= 0 && end > start);
  const body = service.slice(start, end);
  assert.match(body, /HasValue/);
  assert.match(body, /StorageType\.Double/);
  assert.match(body, /double\.IsFinite/);
  assert.match(body, /return null/);
  assert.match(service, /OpeningRules\.RequireZeroNativeOffset\(ReadOffset\(opening,\s*BuiltInParameter\.WALL_BASE_OFFSET\)/);
  assert.match(service, /OpeningRules\.RequireZeroNativeOffset\(ReadOffset\(opening,\s*BuiltInParameter\.WALL_TOP_OFFSET\)/);
  assert.doesNotMatch(service, /Math\.Abs\(ReadOffset\(/);
});

test('opening verification keeps native host and geometry reads and independent acceptance gates', async () => {
  const service = await source('OpeningService.cs');
  const start = service.indexOf('public static OperationReceipt Verify(');
  const body = service.slice(start, service.indexOf('public static object Preview', start));
  assert.match(body, /opening\.Host/);
  assert.match(body, /opening\.BoundaryRect/);
  assert.match(body, /opening\.BoundaryCurves/);
  assert.match(body, /OpeningRules\.EdgesMatch/);
  assert.doesNotMatch(body, /doc\.Regenerate\(/, 'Commit has already closed the transaction; final verification must only read.');
  assert.match(body, /verificationPhase\s*=\s*phase/);
  assert.match(body, /nativeReadbackVerified\s*=\s*true/);
  for (const gate of ['sideEffectsVerified', 'persistenceVerified', 'visualVerified', 'engineeringComplianceVerified'])
    assert.match(body, new RegExp(`${gate}\\s*=\\s*false`));
  assert.match(body, /cutDirectionIndependentlyVerified\s*=\s*false/);
});
