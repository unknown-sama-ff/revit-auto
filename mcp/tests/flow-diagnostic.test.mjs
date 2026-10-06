import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
test('native flow service gathers PipingSystem topology and read-only flow evidence',async()=>{const s=await fs.readFile(path.join(root,'v27/FlowDirectionDiagnostic.cs'),'utf8');assert.match(s,/PipingNetwork/);assert.match(s,/BaseEquipmentConnector/);assert.match(s,/GetFlow/);assert.match(s,/GetStaticPressure/);assert.match(s,/ConnectorData/);assert.match(s,/document_revision_changed/);assert.match(s,/document_changed/);assert.doesNotMatch(s,/new Transaction|SaveAs|\.Set\(/);});
test('MCP flow diagnostic is read-only and old DLL gated',async()=>{const m=await fs.readFile(path.join(root,'mcp/revit-custom.mjs'),'utf8');const b=await fs.readFile(path.join(root,'mcp/bridge.mjs'),'utf8');assert.match(m,/revit\.flow\.diagnose/);assert.match(b,/revit\.flow\.diagnose.*flow-direction-diagnostic/);});
