import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
test('stale plan diagnostics carry actual transaction history without disabling revision safety',async()=>{
  const router=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/RevitCommandRouter.cs'),'utf8');
  const app=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/App.cs'),'utf8');
  const mcp=await fs.readFile(path.resolve(import.meta.dirname,'../revit-custom.mjs'),'utf8');
  assert.match(router,/GetTransactionNames/); assert.match(router,/GetAddedElementIds/); assert.match(router,/GetModifiedElementIds/); assert.match(router,/GetDeletedElementIds/);
  assert.match(router,/previewRevision=plan.DocumentRevision/); assert.match(router,/currentRevision=Revision\(doc\)/);
  assert.match(router,/plan.DocumentRevision != Revision\(doc\)/); assert.match(router,/return StalePlan/);
  assert.match(app,/RevitCommandRouter.Changed\(e\)/); assert.match(mcp,/revit\.changes\.get/);
  assert.match(router,/currentRevision = Revision\(doc\)/);
  assert.match(router,/documentIdentity = Identity\(doc\), currentRevision, history/);
});
test('change history has a stable named response for empty history and no-op revisions',async()=>{
  const journal=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/DocumentChangeJournal.cs'),'utf8');
  assert.match(journal,/internal sealed record DocumentChangeHistory/);
  assert.match(journal,/new DocumentChangeHistory\(/);
  for(const field of ['SinceRevision','CurrentRevision','HistoryComplete','Changes','HasMore','RetainedFromRevision','Note'])
    assert.match(journal,new RegExp(`\\b${field}\\b`));
});
test('failed operation receipts identify the actual step and target',async()=>{
  const router=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/RevitCommandRouter.cs'),'utf8');
  assert.match(router,/failedOperationType/); assert.match(router,/failedElementId/); assert.match(router,/failedOperationIndex = progress.FailedOperationIndex/);
  assert.match(router,/rolledBack/); assert.match(router,/completedOperationCount/);
});
