import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
test('audit contract exposes tri-state mechanical-port results',async()=>{
  const source=await fs.readFile(path.join(root,'v27/RevitQueryService.cs'),'utf8');
  assert.match(source,/connectedMechanicalPorts/);
  assert.match(source,/unknownMechanicalPorts/);
  assert.match(source,/mechanicalPortAudit/);
  assert.match(source,/MechanicalPortAuditClassification\.Classify/);
});
test('audit MCP tool documents connected, unconnected and unknown states',async()=>{
  const source=await fs.readFile(path.join(root,'mcp/revit-custom.mjs'),'utf8');
  assert.match(source,/tri-state equipment-port audit/);
  assert.match(source,/revit\.audit\.run/);
});
