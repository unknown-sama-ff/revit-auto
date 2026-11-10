import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Pure CoreTests exercise the rule behavior. These guards verify that those
// rules remain on both sides of the real native transaction commit boundary.
test('native room creation is bound to reviewed fields and reverified while rollback remains possible', async () => {
  const executor=await fs.readFile(new URL('../../v27/ModelExecutor.cs',import.meta.url),'utf8');
  const service=await fs.readFile(new URL('../../v27/ArchitecturePrimaryReadbackService.cs',import.meta.url),'utf8');
  const router=await fs.readFile(new URL('../../v27/RevitCommandRouter.cs',import.meta.url),'utf8');
  assert.match(executor,/resolvedPrimary\s*=\s*RoomCreationReadbackRules\.Resolve\(op,\s*roomLevel\.Id\.Value,\s*JsonDefaults\.InternalToMm\(roomLevel\.ProjectElevation\)\)/);
  assert.match(service,/case "create_room" when element is .*Room room:/);
  assert.match(service,/RoomCreationReadbackRules\.Require\(binding\.Resolved,\s*roomState\)/);
  assert.match(service,/BuiltInParameter\.ROOM_NAME,\s*StorageType\.String/);
  assert.match(service,/ReadRoom\(room\)/);
  assert.ok(router.indexOf('executor.VerifyArchitecturePrimary("before-transaction-commit")')<router.indexOf('if (transaction.Commit()'));
  assert.ok(router.indexOf('executor.VerifyArchitecturePrimary("after-transaction-commit")')<router.indexOf('if (group.Assimilate()'));
  assert.match(router,/"room-creation-readback"/);
  assert.match(router,/executor\.PreviewRoomCreation\(op\)/);
  assert.match(executor,/nativeLevelKnownAtPreview\s*=\s*level is not null/);
  assert.match(executor,/input-Z-not-used/);
  for(const phase of ['before-transaction-commit','after-transaction-commit'])assert.ok(router.includes('executor.VerifyArchitecturePrimary("'+phase+'")'));
});

test('room evidence retains all loops and curved segment evidence without claiming persistence or visual acceptance', async () => {
  const service=await fs.readFile(new URL('../../v27/ArchitecturePrimaryReadbackService.cs',import.meta.url),'utf8');
  assert.match(service,/SpatialElementBoundaryLocation\.Finish/);
  assert.match(service,/RoomCreationReadbackRules\.MaxBoundarySegments/);
  assert.match(service,/curve\.Evaluate\(0\.5,\s*true\)/);
  assert.match(service,/boundaryEvidenceScope\s*=[^\r\n]+"finish-boundary-segment-samples-and-lengths"/);
  for(const gate of ['sideEffectsVerified','persistenceVerified','visualVerified','engineeringComplianceVerified'])assert.match(service,new RegExp(gate+' = false'));
});
