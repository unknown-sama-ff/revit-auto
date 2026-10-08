import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
test('stair failure never hardcodes rolledBack=true and returns explicit cleanup uncertainty',async()=>{
 const router=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');const stair=router.slice(router.indexOf('private static CommandResult ConfirmStair('),router.indexOf('private sealed class TransactionFailures'));
 assert.doesNotMatch(stair,/rolledBack\s*=\s*true/);assert.match(stair,/rollbackVerified\s*=\s*false/);assert.match(stair,/rollbackStatus/);assert.match(stair,/cleanupEvidence/);
});
test('stair execution checks cancellation before scopes, run/landing batches and both commit boundaries',async()=>{
 const source=await fs.readFile(path.join(root,'v27/ModelExecutor.cs'),'utf8');const stairs=source.slice(source.indexOf('internal OperationReceipt ExecuteStair('),source.indexOf('private sealed class StairFailures'));
 assert.match(stairs,/ExecuteStair\(JsonElement op, CancellationToken cancellation\)/);
 assert.ok([...stairs.matchAll(/cancellation.ThrowIfCancellationRequested\(\)/g)].length>=5);
 assert.ok(stairs.indexOf('cancellation.ThrowIfCancellationRequested()')<stairs.indexOf('scope.Start('));
 assert.match(stairs,/StairExecutionFailure/);assert.doesNotMatch(stairs,/try \{ scope.Cancel\(\); \} catch \{ \}/);
 const router=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');assert.match(router,/ExecuteStair\(operation, cancellation\)/);
});
