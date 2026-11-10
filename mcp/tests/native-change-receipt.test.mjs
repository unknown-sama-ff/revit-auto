import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
test('native event capture receives raw ids before the bounded journal and announces receipt capability',async()=>{
 const router=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');
 const method=router.slice(router.indexOf('internal static void Changed'),router.indexOf('private static object ChangeDetails'));
 assert.ok(method.indexOf('activeReceiptCapture?.Record')>=0);assert.ok(method.indexOf('activeReceiptCapture?.Record')<method.indexOf('journal.Record'));
 assert.match(router,/"native-change-receipts"/);
});
test('capture lifetime starts after stale check, includes stairs, and is disposed through scoped using',async()=>{
 const router=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');
 const confirm=router.slice(router.indexOf('private static CommandResult Confirm('),router.indexOf('private static CommandResult ConfirmStair('));
 const capture=confirm.indexOf('using var capture = new ReceiptCaptureScope(doc);');
 assert.ok(capture>confirm.indexOf('if (!Documents.Same'));assert.ok(capture<confirm.indexOf('return ConfirmStair'));assert.ok(capture<confirm.indexOf('group.Start()'));
 assert.match(router,/ReferenceEquals\(activeReceiptCapture, Recorder\).*activeReceiptCapture = null/);
 assert.ok(confirm.indexOf('if (plan.Status == "committed")')<capture,'idempotent receipt branch must not start another capture');
});
test('both ordinary and stair success/failure receipts disclose nativeChanges rather than only primary ids',async()=>{
 const router=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');
 const ordinary=router.slice(router.indexOf('private static CommandResult Confirm('),router.indexOf('private static CommandResult ConfirmStair('));
 const stair=router.slice(router.indexOf('private static CommandResult ConfirmStair('),router.indexOf('private sealed class TransactionFailures'));
 assert.match(ordinary,/object Receipt\(NativeChangeEvidence\? nativeChanges\)\s*=>\s*new\s*\{[^;]*\bnativeChanges,/, 'ordinary receipt factory must include native evidence');
 assert.match(ordinary,/plan\.Receipt = Receipt\(capture\.Recorder\.Snapshot\(Revision\(doc\), "committed", created, changed\)\);/, 'ordinary success must use the completed native capture');
 const assimilate=ordinary.indexOf('group.Assimilate()');
 assert.ok(assimilate>=0&&ordinary.indexOf('plan.Receipt = Receipt(capture.Recorder.Snapshot')>assimilate, 'ordinary success capture must include group assimilation');
 assert.match(ordinary,/plan\.Receipt = new\s*\{[^;]*nativeChanges = capture\.Recorder\.Snapshot\(Revision\(doc\), "failed", created, changed\)/, 'ordinary failure must disclose native events');
 assert.match(stair,/plan\.Receipt = new\s*\{[^;]*nativeChanges = capture\.Snapshot\(Revision\(doc\), "committed", receipt\.Created, receipt\.Changed\)/, 'stair success must disclose native events');
 assert.match(stair,/plan\.Receipt = new\s*\{[^;]*nativeChanges = capture\.Snapshot\(Revision\(doc\), "failed", \[\], \[\]\)/, 'stair failure must disclose native events even without primary IDs');
 assert.match(ordinary,/createdIds = created\.Distinct\(\)\.ToArray\(\)/);
 assert.match(ordinary,/createdElementIds = createdIds/);
 assert.match(stair,/createdElementIds = receipt\.Created\.Distinct\(\)/);
 const rules=await fs.readFile(path.join(root,'v27/NativeChangeReceipt.cs'),'utf8');
 assert.match(rules,/document-changed-event-union/);assert.match(rules,/AdditionalAddedElementIds/);assert.match(rules,/UnreportedModifiedElementIds/);assert.match(rules,/ObservedDeletedElementIds/);assert.match(rules,/NetModelDiffVerified/);assert.match(rules,/SideEffectsVerified/);
 assert.doesNotMatch(rules,/Autodesk\.Revit|Transaction\(|Save\(/);
});
