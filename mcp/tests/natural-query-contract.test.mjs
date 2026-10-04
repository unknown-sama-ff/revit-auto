import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
test('natural-language lookup can locate a known Mark or room number rather than requiring memorized element ids',async()=>{
 const query=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/RevitQueryService.cs'),'utf8');const mcp=await fs.readFile(path.resolve(import.meta.dirname,'../revit-custom.mjs'),'utf8');
 assert.match(query,/JsonDefaults.String\(p, "mark"\)/);assert.match(query,/JsonDefaults.String\(p, "number"\)/);assert.match(query,/mark = e\.get_Parameter/);assert.match(query,/viewFamily = e is ViewFamilyType/);assert.match(mcp,/mark:z\.string\(\)\.optional/);assert.match(mcp,/number:z\.string\(\)\.optional/);
});
test('direct plan preview may bind to the exact context revision used by the assistant',async()=>{const mcp=await fs.readFile(path.resolve(import.meta.dirname,'../revit-custom.mjs'),'utf8');assert.match(mcp,/expectedRevision:z\.number\(\)\.int\(\)\.min\(0\)\.optional/);});

test('legacy point placement preserves the exact old overload and verifies the resulting coordinate',async()=>{
 const executor=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/ModelExecutor.cs'),'utf8');
 assert.match(executor,/NewFamilyInstance\(point, symbol, StructuralType.NonStructural\)/);
 assert.match(executor,/legacyLocation\.Point\.DistanceTo\(point\) > Mm\(1\)/);
 assert.match(executor,/Wire\.AreVertexPointsValid\(vertices, c1, c2\)/);
});
test('model inspection includes native type, host, wire peers and drawing relations, not only counts',async()=>{
 const query=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/RevitQueryService.cs'),'utf8');
 for(const evidence of [/typeId = e\.GetTypeId/,/hostId = e is FamilyInstance/,/drawing = DrawingRelations/,/peerReferencesSupported = peers\.Supported/,/panelSchedule\.GetPanel/,/wire\.NumberOfVertices/])assert.match(query,evidence);
});
