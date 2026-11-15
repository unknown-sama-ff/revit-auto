import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source=async file=>fs.readFile(new URL('../../v27/'+file,import.meta.url),'utf8');
test('both new native readbacks run before commit and after commit while the transaction group can roll back',async()=>{
 const router=await source('RevitCommandRouter.cs');
 for(const name of ['VerifyMultiportFittingCreations','VerifyUnassignedConnections']){
  assert.ok(router.indexOf(name+'("before-transaction-commit")')<router.indexOf('transaction.Commit()'));
  const after=router.indexOf(name+'("after-transaction-commit")');assert.ok(after>router.indexOf('transaction.Commit()'));assert.ok(after<router.indexOf('group.Assimilate()'));
 }
 assert.match(router,/multiportFittingCreationVerification, unassignedConnectionVerification/);
});
test('multiport native factories preserve declared connector order and reserve every endpoint',async()=>{
 const executor=await source('ModelExecutor.cs'),reservations=await source('ConnectionPortReservationRules.cs');
 assert.match(executor,/NewTeeFitting\(ports\[0\],ports\[1\],ports\[2\]\)/);
 assert.match(executor,/NewCrossFitting\(ports\[0\],ports\[1\],ports\[2\],ports\[3\]\)/);
 assert.match(reservations,/foreach\(var prefix in MepConnectionInputRules.Prefixes\(op\)\)/);
 assert.match(executor,/multiportFittingCreations.Remember\(Doc, expectedMultiport\)/);
});
test('unassigned native capture uses selected-port system and only explicit actual pipe parameter fallback',async()=>{
 const native=await source('UnassignedEquipmentConnectionService.cs');
 assert.match(native,/var system = connector.MEPSystem/);assert.match(native,/else if \(owner is Pipe\)/);
 assert.match(native,/new\(false, null, null, null, PipingAssignmentReadSource.Unknown/);
 assert.doesNotMatch(native,/expectedSystemTypeId|ConnectTo\(/);
 assert.match(native,/first.IsConnectedTo\(second\), second.IsConnectedTo\(first\)/);
 assert.match(native,/RequireReadback\(expected, actual\)/);
});
