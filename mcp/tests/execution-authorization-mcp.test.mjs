import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = path.resolve(import.meta.dirname, '../..');

async function fixture(t, outside = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-auth-mcp-'));
  const model = path.join(dir, 'isolated.rvt'), other = path.join(dir, 'other.rvt');
  await fs.writeFile(model, 'test fixture'); await fs.writeFile(other, 'test fixture');
  const id = randomUUID().replaceAll('-', ''), calls = [], sockets = new Set();
  let committed = false;
  const plan = { planId: id, documentIdentity: 'doc-a', documentRevision: 0, status: 'pending',
    expiresAtUtc: new Date(Date.now() + 3600000).toISOString(), operations: [{ operationType: 'set_parameter' }], warnings: [],
    requiresConfirmation: true, confirmationMode: 'chat', confirmation: 'User approval in chat' };
  const context = { active: true, document: { identity: 'doc-a', revision: 0, path: outside ? other : model,
    isModified: false, isFamilyDocument: false, isReadOnly: false, isWorkshared: false } };
  const token = 'fixture-token-not-an-actual-credential'.repeat(2);
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8'); const end = buffer.indexOf(String.fromCharCode(10)); if (end < 0) return;
      const request = JSON.parse(buffer.slice(0, end)); assert.equal(request.token, token); calls.push(request.method);
      let value;
      if (request.method === 'revit.bridge.info') value = { protocol: 'revit-auto-2027-v2', confirmationMode: 'chat', features: [] };
      else if (request.method === 'revit.context.get') value = context;
      else if (request.method === 'revit.search') value = { items: [], hasMore: false };
      else if (request.method === 'revit.plan.create') {
        Object.assign(plan, {source:request.params.source,summary:request.params.summary,operations:request.params.operations}); value=plan;
      }
      else if (request.method === 'revit.plan.get') value = committed ? { planId: id, status: 'committed', confirmationMode: 'chat', saved: false } : plan;
      else if (['revit.plan.confirm', 'revit.import.commit'].includes(request.method)) { committed = true; value = { planId: id, status: 'committed', confirmationMode: 'chat', saved: false }; }
      else throw new Error('Unexpected fixture method: ' + request.method);
      socket.end(JSON.stringify({ protocol: 'revit-auto-2027-v2', ok: true, result: value }) + String.fromCharCode(10));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = path.join(dir, 'bridge.json'), policy = path.join(dir, 'authorization.json');
  await fs.writeFile(config, JSON.stringify({ port: server.address().port, token }));
  await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, mode: 'project-authorization', enabled: true, authorizationId: randomUUID().replaceAll('-', ''), grantedBy: 'user-chat',
    grantedAtUtc: new Date().toISOString(), userStatement: 'Fixture scoped standing user authorization.', projectRoot: root,
    allowedDocuments: [{ path: model, canonicalPath: await fs.realpath(model) }], allowedActions: ['revit.plan.confirm', 'revit.import.commit'], automaticSave: false, automaticRestart: false }));
  const client = new Client({ name: 'execution-authorization-contract', version: '1.0' });
  t.after(async () => {
    await client.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
    // Remove only this fixture's uniquely named journal, never the audit directory.
    await fs.rm(path.join(root, 'runtime/execution-authorizations', id + '.json'), { force: true });
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('revit-auth-mcp-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp/revit-custom.mjs')],
    env: { REVIT_AI_CONFIG: config, REVIT_AI_EXECUTION_AUTHORIZATION: policy }, stderr: 'pipe' }));
  return { client, calls, id, plan };
}
const call = async (f, name) => { const r = await f.client.callTool({ name, arguments: { planId: f.id } }); return { error: r.isError === true, data: JSON.parse(r.content[0].text) }; };

for (const method of ['revit_plan_confirm', 'revit_import_commit']) test('real stdio scoped execution without another approval input: ' + method, async t => {
  const f = await fixture(t), tools = await f.client.listTools();
  const confirm = tools.tools.find(t => t.name === 'revit_plan_confirm');
  assert.match(confirm.description, /project authorization/i); assert.deepEqual(Object.keys(confirm.inputSchema.properties), ['planId']);
  const safety = await f.client.readResource({ uri: 'revit-custom://safety' }); assert.match(safety.contents[0].text, /standing project authorization/i);
  const preview = await call(f, 'revit_plan_get'); assert.equal(preview.data.requiresSpecificPlanChatApproval, false);
  const first = await call(f, method); assert.equal(first.error, false); assert.equal(first.data.status, 'committed');
  assert.equal(first.data.executionAuthorization.humanExactPlanApproval, false);
  const second = await call(f, method); assert.equal(second.data.status, 'committed');
  assert.equal(f.calls.filter(m => ['revit.plan.confirm', 'revit.import.commit'].includes(m)).length, 1);
  assert.ok(!f.calls.some(m => m.includes('lifecycle') || m.includes('save')));
});

test('real stdio outside-scope request is refused before reaching native commit', async t => {
  const f = await fixture(t, true), result = await call(f, 'revit_plan_confirm');
  assert.equal(result.error, true); assert.equal(result.data.code, 'execution_document_not_authorized');
  assert.equal(f.calls.filter(m => m === 'revit.plan.confirm').length, 0);
});

for(const outside of [false,true]) test('real stdio electrical sheet review note follows '+(outside?'outside-scope chat':'scoped project authorization')+' policy',async t=>{
  const f=await fixture(t,outside),userText='这是基于用户明确约束生成的预览，仍需聊天确认。';
  const raw=await f.client.callTool({name:'revit_workflow_run',arguments:{name:'electrical.sheet',documentIdentity:'doc-a',expectedRevision:0,
    planningMode:'explicit',summary:userText,input:{sheets:[{number:'E901',name:userText}]}}});
  const result=JSON.parse(raw.content[0].text);assert.notEqual(raw.isError,true,JSON.stringify(result));
  assert.equal(result.planCreated,true);assert.equal(result.plan.operations[0].name,userText);
  assert.equal(result.plan.summary,f.plan.summary);assert.ok(result.plan.summary.includes(userText));
  if(outside){
    assert.equal(result.reviewNote,userText);assert.equal(result.plan.confirmationMode,'chat');
    assert.equal(result.requiresSpecificPlanChatApproval,undefined);
    const commitResult=await call(f,'revit_plan_confirm');assert.equal(commitResult.error,true);
    assert.equal(commitResult.data.code,'execution_document_not_authorized');
  }else{
    assert.match(result.reviewNote,/当前项目授权替代逐计划聊天确认/);
    assert.equal(result.requiresSpecificPlanChatApproval,false);assert.equal(result.requiresPreviewAndAgentReview,true);
    assert.equal(result.plan.requiresSpecificPlanChatApproval,false);assert.equal(result.plan.nativeConfirmation.text,'User approval in chat');
  }
  assert.equal(f.calls.filter(method=>['revit.plan.confirm','revit.import.commit'].includes(method)).length,0);
});
