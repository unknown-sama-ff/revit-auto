import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');

test('drawing placement writes are tracked and verified before and after transaction commit',async()=>{
  const executor=await fs.readFile(path.join(root,'v27/ModelExecutor.cs'),'utf8');
  const router=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');
  assert.match(executor,/documentationPlacements/);
  assert.match(executor,/VerifyDocumentationPlacements/);
  assert.match(executor,/documentationMetadata/);
  assert.match(executor,/VerifyDocumentationMetadata/);
  assert.match(executor,/documentationTitleBlocks/);
  assert.match(executor,/VerifyDocumentationTitleBlocks/);
  assert.match(router,/executor\.VerifyDocumentationPlacements\("before-transaction-commit"\)/);
  assert.match(router,/executor\.VerifyDocumentationPlacements\("after-transaction-commit"\)/);
  assert.match(router,/documentationVerification/);
  assert.match(router,/documentationMetadataVerification/);
  assert.match(router,/documentationTitleBlockVerification/);
});

test('documentation placement readback keeps persistence and visual gates false',async()=>{
  const rules=await fs.readFile(path.join(root,'v27/DocumentationReadbackRules.cs'),'utf8');
  assert.match(rules,/PersistenceVerified/);assert.match(rules,/VisualVerified/);assert.match(rules,/SideEffectsVerified/);
  assert.match(rules,/invalid_documentation_readback/);
});
