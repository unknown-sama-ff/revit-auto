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

async function auditClient(t, features, payload, contexts = [{active:true,document:{identity:'test-document',revision:0,isModified:false,path:'TEST_COPY.rvt'}}]) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-audit-contract-'));
  const token = 'audit-test-token-'.repeat(4);
  const requests = [];
  let contextIndex=0;
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
        : request.method === 'revit.context.get' ? contexts[Math.min(contextIndex++, contexts.length-1)] : payload;
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
  assert.match(error.message, /restart Revit to load v0\.4\.0/);
  assert.deepEqual(requests, ['revit.bridge.info']);
});

test('unified audit rejects a reviewed document mismatch before native audit (mock)',async t=>{
 const {client,requests}=await auditClient(t,['mechanical-port-audit-tristate'],{documentIdentity:'test-document',warnings:[],warningCount:0});
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'another-reviewed-document',expectedRevision:0,input:{}}});
 assert.equal(result.isError,true);
 assert.equal(JSON.parse(result.content[0].text).code,'document_changed');
 assert.equal(requests.includes('revit.audit.run'),false);
 assert.equal(requests.includes('revit.plan.create'),false);
});

test('unified audit rejects a stale revision before native audit and preserves revision zero (mock)',async t=>{
 const {client,requests}=await auditClient(t,['mechanical-port-audit-tristate'],{documentIdentity:'test-document',warnings:[],warningCount:0});
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'test-document',expectedRevision:1,input:{}}});
 assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,'document_revision_changed');
 assert.equal(requests.includes('revit.audit.run'),false);
});

for(const [name,changed,code] of [
 ['project switch',{identity:'another-document',revision:0,isModified:false,path:'OTHER.rvt'},'document_changed'],
 ['model edit',{identity:'test-document',revision:1,isModified:false,path:'TEST_COPY.rvt'},'document_revision_changed'],
 ['saved state change',{identity:'test-document',revision:0,isModified:true,path:'TEST_COPY.rvt'},'audit_state_changed'],
 ['SaveAs without a revision bump',{identity:'test-document',revision:0,isModified:false,path:'RENAMED.rvt'},'audit_state_changed'],
])test(`unified audit discards results after ${name} without retry (mock)`,async t=>{
 const initial={active:true,document:{identity:'test-document',revision:0,isModified:false,path:'TEST_COPY.rvt'}};
 const {client,requests}=await auditClient(t,['mechanical-port-audit-tristate'],{documentIdentity:'test-document',warnings:[],warningCount:0},[initial,{active:true,document:changed}]);
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'test-document',expectedRevision:0,input:{}}});
 assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,code);
 assert.equal(requests.filter(x=>x==='revit.audit.run').length,1);
 assert.equal(requests.filter(x=>x==='revit.context.get').length,2);
 assert.equal(requests.some(x=>/plan|confirm|import/.test(x)),false);
});

test('unified audit rejects native evidence belonging to a different project (mock)',async t=>{
 const {client,requests}=await auditClient(t,['mechanical-port-audit-tristate'],{documentIdentity:'wrong-native-document',warnings:[],warningCount:0});
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'test-document',expectedRevision:0,input:{}}});
 assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,'audit_scope_mismatch');
 assert.equal(requests.filter(x=>x==='revit.audit.run').length,1);
});

for(const [name,input] of [
 ['conflicting identity',{documentIdentity:'other-document'}],
 ['conflicting revision',{expectedRevision:1}],
 ['unknown script input',{code:'document.Delete(...)'}],
 ['unknown file input',{filePath:'private-script.csx'}],
])test(`unified audit rejects ${name} before native calls (mock)`,async t=>{
 const {client,requests}=await auditClient(t,['mechanical-port-audit-tristate'],{documentIdentity:'test-document',warnings:[],warningCount:0});
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'test-document',expectedRevision:0,input}});
 assert.equal(result.isError,true);assert.deepEqual(requests,[]);
});

for(const [name,context,code] of [
 ['no active document',{active:false},'no_active_document'],
 ['missing revision',{active:true,document:{identity:'test-document'}},'audit_context_invalid'],
 ['unknown revision',{active:true,document:{identity:'test-document',revision:null}},'audit_context_invalid'],
])test(`unified audit rejects ${name} without native audit (mock)`,async t=>{
 const {client,requests}=await auditClient(t,['mechanical-port-audit-tristate'],{documentIdentity:'test-document'},[context]);
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'test-document',input:{}}});
 assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,code);assert.equal(requests.includes('revit.audit.run'),false);
});

test('unified audit binds revision zero and preserves unknown/truncated native evidence without compliance claims (mock)',async t=>{
 const payload={documentIdentity:'test-document',counts:{OST_LightingFixtures:4},warnings:[{description:'Review required',failingElementIds:[10]}],warningCount:3,unknownMechanicalPorts:[{elementId:12,connected:null,connectionStatusSupported:false}],mechanicalPortAudit:{totalCount:5,scannedCount:1,truncated:true}};
 const {client,requests}=await auditClient(t,['mechanical-port-audit-tristate'],payload);
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'test-document',expectedRevision:0,input:{documentIdentity:'test-document',expectedRevision:0}}});
 assert.notEqual(result.isError,true);const data=JSON.parse(result.content[0].text);
 assert.equal(data.documentRevision,0);assert.equal(data.planCreated,false);assert.equal(data.readOnly,true);
 assert.equal(data.status,'read_only_result');assert.equal(data.workflowId,'audit');
 assert.equal(data.auditConsistency.documentRevisionVerified,true);assert.equal(data.auditConsistency.savedStateVerified,true);
 assert.equal(data.warningsTruncated,true);assert.equal(data.engineeringComplianceVerified,false);
 for(const field of Object.keys(payload))assert.deepEqual(data[field],payload[field],field);
 assert.equal(requests.filter(x=>x==='revit.audit.run').length,1);assert.equal(requests.filter(x=>x==='revit.context.get').length,2);
 assert.equal(requests.some(x=>/plan|confirm|import/.test(x)),false);
});

test('unified audit preserves unknown saved/path state instead of certifying it (mock)',async t=>{
 const context={active:true,document:{identity:'test-document',revision:0,isModified:null,path:null}};
 const {client}=await auditClient(t,['mechanical-port-audit-tristate'],{documentIdentity:'test-document'},[context]);
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'test-document',input:{expectedRevision:0}}});
 assert.notEqual(result.isError,true);const data=JSON.parse(result.content[0].text);
 assert.equal(data.documentRevision,0);assert.equal(data.auditConsistency.savedStateVerified,false);assert.equal(data.auditConsistency.pathVerified,false);assert.equal(data.warningsTruncated,null);
});

test('unified audit retains the native capability gate and does not retry an older DLL (mock)',async t=>{
 const {client,requests}=await auditClient(t,[],{documentIdentity:'test-document'});
 const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'audit',documentIdentity:'test-document',expectedRevision:0,input:{}}});
 assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,'feature_not_loaded');
 assert.equal(requests.includes('revit.audit.run'),false);assert.equal(requests.filter(x=>x==='revit.context.get').length,1);
 assert.equal(requests.some(x=>/plan|confirm|import/.test(x)),false);
});
