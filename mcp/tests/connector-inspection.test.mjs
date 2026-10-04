import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizedItem} from '../acceptance-helpers.mjs';
test('connector inspection probes connection-status capability instead of directly throwing',async()=>{
  const source=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/RevitQueryService.cs'),'utf8');
  assert.match(source,/ConnectorReadPolicy\.ConnectionStatus/);
  assert.doesNotMatch(source,/connected = c\.IsConnected/);
  assert.match(source,/connectionStatusSupported/);
  assert.match(source,/ConnectorReadPolicy\.TryRead/);
  assert.match(source,/originSupported/);
  assert.doesNotMatch(source,/xMm = JsonDefaults\.InternalToMm\(c\.Origin/);
  assert.match(source,/connectorType/);
});
test('connector manager failures are returned as read-only diagnostics instead of killing bridge inspection',async()=>{
  const source=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/RevitQueryService.cs'),'utf8');
  assert.match(source,/ConnectorSet\? connectorSet = null/);
  assert.match(source,/connectorsSupported = false/);
  assert.match(source,/TryConnectorId/);
  assert.match(source,/catch \(Exception exception\)/);
});
test('full pipe inspection uses nonfinite parameter diagnostics instead of suppressing connectors',async()=>{
 const source=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/RevitQueryService.cs'),'utf8');
 assert.match(source,/ParameterReadPolicy\.Normalize/);
 assert.match(source,/valueSupported = read\.Supported/);
 assert.doesNotMatch(source,/pipe-safe-minimal|pipe-safe-fallback/);
});
test('acceptance preserves unsupported connector fields instead of dropping the panel',()=>{
  const item={summary:{id:2290301,uniqueId:'panel'},parameters:[{id:1,value:'AL1'}],connectors:[{connectorId:1,connectorType:'Reference',connectionStatusSupported:false,connected:null,connectionStatusError:'Not supported',originSupported:false,originError:'Origin is not available'}],electrical:{systemIds:[7]}};
  const normalized=normalizedItem(item);
  assert.equal(normalized.summary.id,2290301);
  assert.equal(normalized.connectors[0].connectionStatusSupported,false);
  assert.equal(normalized.connectors[0].connected,null);
  assert.equal(normalized.connectors[0].originSupported,false);
  assert.equal(normalized.connectors[0].xMm,undefined);
  assert.equal(normalized.parameters[0].value,'AL1');
});

test('connector resolution is guarded as a read-only native capability',async()=>{
 const source=await fs.readFile(path.resolve(import.meta.dirname,'../bridge.mjs'),'utf8');
 assert.match(source,/revit\.connector\.resolve.*connector-resolution/);
 const server=await fs.readFile(path.resolve(import.meta.dirname,'../revit-custom.mjs'),'utf8');
 assert.match(server,/revit\.connector\.resolve/);
});

test('connector resolver uses bounded Pipe lookup rather than unstable ConnectorSet enumeration',async()=>{const source=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/ConnectorResolutionService.cs'),'utf8');assert.match(source,/element is Pipe/);assert.match(source,/manager\.Lookup\(id\)/);assert.doesNotMatch(source,/if\(element is Pipe\)\s*\{\s*\/\/ Revit 2027.3[\\s\\S]*?manager\.Connectors/);});
