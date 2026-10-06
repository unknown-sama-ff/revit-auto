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

import net from 'node:net';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function auditClient(t, features, payload) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-audit-contract-'));
  const token = 'audit-test-token-'.repeat(4);
  const requests = [];
  const sockets = new Set();
  const bridge = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let input = '';
    socket.on('data', chunk => {
      input += chunk.toString('utf8');
      if (!input.includes('\n')) return;
      const request = JSON.parse(input.slice(0, input.indexOf('\n')));
      assert.equal(request.token, token);
      requests.push(request.method);
      const result = request.method === 'revit.bridge.info'
        ? {protocol:'revit-auto-2027-v2', features, confirmationMode:'chat'}
        : payload;
      socket.end(JSON.stringify({protocol:'revit-auto-2027-v2', ok:true, result})+'\n');
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => bridge.close(resolve));
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('revit-audit-contract-'));
    await fs.rm(folder, {recursive:true, force:true});
  });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const config = path.join(folder, 'bridge.json');
  await fs.writeFile(config, JSON.stringify({port:bridge.address().port, token}));
  const client = new Client({name:'audit-contract-test', version:'1.0'});
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command:process.execPath,
    args:[path.join(root, 'mcp/revit-custom.mjs')],
    env:{REVIT_AI_CONFIG:config},
    stderr:'pipe'
  }));
  return {client, requests};
}

test('MCP audit preserves native tri-state evidence and read-only annotations (mock)', async t => {
  const payload = {
    documentIdentity:'test-document',
    warnings:[{description:'Flow direction requires review', failingElementIds:[]}],
    warningCount:1,
    unconnectedMechanicalPorts:[{elementId:10, connectorId:0, connected:false, connectionStatusSupported:true, peers:[]}],
    connectedMechanicalPorts:[{elementId:10, connectorId:3, connected:true, connectionStatusSupported:true, peers:[{elementId:11, connectorId:0}]}],
    unknownMechanicalPorts:[{elementId:12, connectorId:1, connected:null, connectionStatusSupported:false, connectionStatusError:'Unsupported property'}],
    mechanicalPortAudit:{totalCount:3, scannedCount:3, truncated:false, classification:'connected|unconnected|unknown'}
  };
  const {client, requests} = await auditClient(t, ['mechanical-port-audit-tristate'], payload);
  const tools = await client.listTools();
  const audit = tools.tools.find(tool => tool.name === 'revit_audit_run');
  assert.equal(audit.annotations.readOnlyHint, true);
  assert.equal(audit.annotations.destructiveHint, false);
  assert.deepEqual(Object.keys(audit.inputSchema.properties), []);
  const result = await client.callTool({name:'revit_audit_run', arguments:{}});
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), payload);
  assert.deepEqual(requests, ['revit.bridge.info', 'revit.audit.run']);
});

test('MCP audit refuses an old DLL before forwarding a misleading audit (mock)', async t => {
  const {client, requests} = await auditClient(t, [], {unconnectedMechanicalPorts:[{connected:true}]});
  const result = await client.callTool({name:'revit_audit_run', arguments:{}});
  assert.equal(result.isError, true);
  const error = JSON.parse(result.content[0].text);
  assert.equal(error.code, 'feature_not_loaded');
  assert.match(error.message, /restart Revit to load v0\.3\.23/);
  assert.deepEqual(requests, ['revit.bridge.info']);
});
