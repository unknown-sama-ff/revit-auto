import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getWorkflow} from '../workflow-registry.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const matrix=JSON.parse(await fs.readFile(path.join(root,'mcp/legacy-source-matrix.json'),'utf8'));
test('migration source matrix covers every root csx and ModelBuilder exactly once',async()=>{
 const sources=(await fs.readdir(root)).filter(p=>p.endsWith('.csx')).concat('ModelBuilder.cs').sort();
 assert.deepEqual(matrix.sources.map(r=>r.legacyScript).sort(),sources);assert.equal(new Set(matrix.sources.map(r=>r.legacyScript)).size,sources.length);
});
test('each legacy matrix entry has required migration fields and a registered workflow',()=>{
 for(const row of matrix.sources){for(const field of ['legacyFeature','legacyScript','newWorkflow','supportedInputs','generatedOperations','readOnlyQueries','writeCategories','rollbackScope','acceptanceStatus'])assert.ok(Object.hasOwn(row,field),row.legacyScript+' '+field);assert.equal(typeof row.legacyFeature,'string');assert.ok(getWorkflow(row.newWorkflow),row.newWorkflow);assert.ok(Object.hasOwn(matrix.statuses,row.acceptanceStatus));assert.equal(row.runtimeExecutionAllowed,false);}
});
test('migration matrix does not count reference scripts or ModelBuilder Build stub as accepted production',async()=>{
 const stub=matrix.sources.find(r=>r.legacyScript==='ModelBuilder.cs');assert.equal(stub.acceptanceStatus,'legacy-source-needs-redesign');assert.equal(stub.sourceRole,'prototype');
 assert.match(await fs.readFile(path.join(root,'ModelBuilder.cs'),'utf8'),/NotImplementedException/);
 for(const row of matrix.sources.filter(r=>r.sourceRole==='test-reference'))assert.notEqual(row.acceptanceStatus,'implemented-and-accepted');
});
test('legacy openings matrix explicitly maps doors/windows rather than naked wall/shaft openings',()=>{
 const row=matrix.sources.find(r=>r.legacyScript==='openings.csx');assert.deepEqual(row.generatedOperations,['duplicate_type','create_family_instance']);assert.match(row.migrationNotes,/does not implement wall or shaft/);
});
test('legacy SaveAs and external RFA audits cannot silently become active project behavior',()=>{
 assert.equal(matrix.sources.find(r=>r.legacyScript==='save-as.csx').acceptanceStatus,'intentionally-not-exposed');
 for(const name of ['audit-template.csx','audit-windows.csx'])assert.equal(matrix.sources.find(r=>r.legacyScript===name).acceptanceStatus,'legacy-source-needs-redesign');
});
