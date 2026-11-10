import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = file => fs.readFile(new URL(`../../v27/${file}`, import.meta.url), 'utf8');

// Rule behavior is exercised by CoreTests. These guards cover the native
// transaction wiring that is unavailable in the Revit-free test process.
test('created grids are re-read before commit and after native failure processing while rollback is available', async () => {
  const router = await source('RevitCommandRouter.cs');
  const before = router.indexOf('executor.VerifyGridCreations("before-transaction-commit")');
  const commit = router.indexOf('if (transaction.Commit()');
  const after = router.indexOf('executor.VerifyGridCreations("after-transaction-commit")');
  const receipt = router.indexOf('object Receipt(NativeChangeEvidence? nativeChanges)');
  const assimilate = router.indexOf('if (group.Assimilate()');
  assert.ok(before >= 0 && before < commit);
  assert.ok(commit < after && after < receipt && receipt < assimilate);
  assert.match(router.slice(receipt, assimilate), /gridCreationVerification/);
  assert.match(router.slice(receipt, assimilate), /PrepareBounded/);
  assert.match(router, /"grid-creation-readback"/);
});

test('final grid checks bind original inputs and native document rather than rebasing from a later snapshot', async () => {
  const executor = await source('ModelExecutor.cs');
  assert.match(executor, /if \(kind == "create_grid"\) return RememberGridCreation\(\(Grid\)created, op\)/);
  assert.match(executor, /var reviewed = operation\.Clone\(\)/);
  assert.match(executor, /gridCreations\.Add\(\(grid\.Id\.Value, reviewed\)\)/);
  assert.match(executor, /gridCreationDocument\.IsValidObject/);
  assert.match(executor, /gridCreationDocument\.Equals\(document\)/);
  assert.match(executor, /document\.GetElement\(new ElementId\(binding\.ElementId\)\) as Grid/);
  assert.match(executor, /ArchitectureService\.VerifyGrid\(grid, binding\.Operation, phase\)/);
});

test('grid readback consumes native name and geometry with conservative independent acceptance gates', async () => {
  const service = await source('ArchitectureService.cs');
  const start = service.indexOf('internal static object VerifyGrid(');
  const body = service.slice(start, service.indexOf('public static object? Snapshot', start));
  assert.match(body, /using var curve = grid\.Curve/);
  assert.match(body, /curve is not Line line \|\| !line\.IsBound/);
  assert.match(body, /line\.GetEndPoint\(0\)/);
  assert.match(body, /line\.GetEndPoint\(1\)/);
  assert.match(body, /grid\.Name, grid\.IsCurved, line\.IsBound/);
  assert.match(body, /GridCreationReadbackRules\.Require\(operation, actual\)/);
  for (const gate of ['sideEffectsVerified', 'persistenceVerified', 'visualVerified', 'engineeringComplianceVerified'])
    assert.ok(body.includes(`${gate} = false`));
});
