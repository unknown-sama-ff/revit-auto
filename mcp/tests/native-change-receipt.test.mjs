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
 assert.equal([...router.matchAll(/nativeChanges = capture(?:\.Recorder)?\.Snapshot/g)].length,4);
 assert.match(router,/createdElementIds = created\.Distinct\(\)/);
 const rules=await fs.readFile(path.join(root,'v27/NativeChangeReceipt.cs'),'utf8');
 assert.match(rules,/document-changed-event-union/);assert.match(rules,/AdditionalAddedElementIds/);assert.match(rules,/UnreportedModifiedElementIds/);assert.match(rules,/ObservedDeletedElementIds/);assert.match(rules,/NetModelDiffVerified/);assert.match(rules,/SideEffectsVerified/);
 assert.doesNotMatch(rules,/Autodesk\.Revit|Transaction\(|Save\(/);
});
