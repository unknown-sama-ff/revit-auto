import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createExecutionAuthorization } from '../execution-authorization.mjs';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'revit-execution-auth-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('revit-execution-auth-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const model = path.join(root, 'test-copy.rvt'), other = path.join(root, 'other.rvt');
  await fs.writeFile(model, 'fixture only'); await fs.writeFile(other, 'fixture only');
  const policyPath = path.join(root, 'authorization.json');
  const grant = { schemaVersion: 1, mode: 'project-authorization', enabled: true,
    authorizationId: randomUUID().replaceAll('-', ''), grantedBy: 'user-chat',
    grantedAtUtc: '2026-11-15T00:00:00.000Z', userStatement: 'Fixture standing authorization for this test copy.',
    projectRoot: root, allowedDocuments: [{ path: model, canonicalPath: await fs.realpath(model) }],
    allowedActions: ['revit.plan.confirm', 'revit.import.commit'], automaticSave: false, automaticRestart: false,
    ...options.grant };
  if (options.policy !== false) await fs.writeFile(policyPath, JSON.stringify(grant));
  const context = { active: true, document: { identity: 'doc-a', revision: 2, path: model,
    isModified: true, isFamilyDocument: false, isReadOnly: false, isWorkshared: false, ...options.document } };
  const plan = { planId: randomUUID().replaceAll('-', ''), status: 'pending', documentIdentity: 'doc-a', documentRevision: 2,
    expiresAtUtc: '2026-11-15T02:00:00.000Z', operations: [{ operationType: 'set_parameter' }],
    requiresConfirmation: true, confirmationMode: 'chat', confirmation: 'User approval in chat', warnings: [], ...options.plan };
  const calls = [], commits = [];
  const call = async (method, args) => {
    calls.push({ method, args });
    if (method === 'revit.context.get') return structuredClone(context);
    if (method === 'revit.plan.get') return structuredClone(plan);
    if (['revit.plan.confirm', 'revit.import.commit'].includes(method)) {
      commits.push({ method, args });
      if (options.failure) throw Object.assign(new Error('fixture timeout'), { code: 'bridge_timeout' });
      if (options.nativeFailure) throw Object.assign(new Error('fixture native failure'), { code: 'execution_failed',
        details: { planId: plan.planId, status: 'failed', rolledBack: true, causeCode: 'family_types_missing', ...options.nativeFailure } });
      return { planId: plan.planId, status: 'committed', confirmationMode: 'chat', saved: false };
    }
    throw new Error('Unexpected method: ' + method);
  };
  const io = options.revokeOnReserve ? { ...fs, writeFile: async (name, value, flags) => {
    await fs.writeFile(name, value, flags);
    if (flags?.flag === 'wx' && path.dirname(name).endsWith('execution-authorizations')) await fs.writeFile(policyPath + '.revoked', 'stop');
  } } : fs;
  const auth = await createExecutionAuthorization({ repoRoot: root, policyPath, call, io, clock: () => Date.parse('2026-11-15T01:00:00.000Z') });
  return { root, model, other, policyPath, grant, context, plan, calls, commits, auth,
    journal: path.join(root, 'runtime/execution-authorizations', plan.planId + '.json') };
}
const commit = f => f.auth.commit('revit.plan.confirm', { planId: f.plan.planId });

test('missing configuration preserves the existing exact-chat interface', async t => {
  const f = await fixture(t, { policy: false });
  assert.equal(f.auth.summary().mode, 'exact-plan-chat');
  const result = await commit(f);
  assert.equal(result.confirmationMode, 'chat');
  assert.equal(f.calls.length, 1); assert.equal(f.commits.length, 1);
});

test('a separate bridge profile does not inherit the main profile standing grant', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'runtime'));
  await fs.copyFile(f.policyPath, path.join(f.root, 'runtime/execution-authorization.json'));
  const auth = await createExecutionAuthorization({repoRoot:f.root,bridgeConfigPath:path.join(f.root,'another-profile/bridge.json'),call:async() => {throw new Error('discovery must not dispatch');}});
  assert.equal(auth.summary().mode,'exact-plan-chat');
});

test('pending previews disclose standing authorization and preserve native confirmation provenance', async t => {
  const f = await fixture(t);
  const a = await f.auth.present(f.plan), b = await f.auth.present(f.plan);
  assert.deepEqual(a, b); assert.equal(a.requiresSpecificPlanChatApproval, false);
  assert.equal(a.confirmationMode, 'project-authorization'); assert.equal(a.nativeConfirmation.mode, 'chat');
  assert.deepEqual(a.operations, f.plan.operations); assert.deepEqual(a.warnings, f.plan.warnings);
  assert.equal(f.commits.length, 0);
});

const importApprovalNote='Preview only. Chat approval of this exact plan is required; no automatic save.';
test('authorized import notes use agent review while custom review notes and native confirmation stay intact',async t=>{
  const f=await fixture(t),input={status:'preview',plan:f.plan,note:importApprovalNote,reviewNote:'Candidate still requires chat approval.'};
  const result=await f.auth.present(input);
  assert.equal(result.note,'Preview only. Agent review under the active project authorization is required; no automatic save.');
  assert.equal(result.reviewNote,input.reviewNote);
  assert.equal(input.note,importApprovalNote);
  assert.equal(result.plan.nativeConfirmation.text,'User approval in chat');
  assert.equal(result.plan.requiresSpecificPlanChatApproval,false);
  assert.deepEqual(result.plan.operations,f.plan.operations);assert.equal(f.commits.length,0);
});

const registeredReviewNote='这是基于用户明确约束生成的预览，仍需聊天确认。';
const workflowEnvelope=(plan,reviewNote=registeredReviewNote)=>({status:'preview',workflowId:'architecture.build',planningMode:'explicit',
  requiresClarification:false,planCreated:true,reviewNote,plan});

for(const [workflowId,planningMode,reviewNote] of [
  ['architecture.build','explicit',registeredReviewNote],
  ['architecture.build','assisted','这是基于已披露假设生成的候选方案，仍需聊天确认。'],
  ['pump_room.build','explicit','需求来自用户明确约束；仍需审阅预览。'],
  ['pump_room.build','assisted','这是基于当前模型和列出的假设生成的候选方案，不是自动确认的工程设计。']
]) test('known '+workflowId+' '+planningMode+' preview aligns review note with scoped authorization without editing native/user data',async t=>{
  const f=await fixture(t,{plan:{source:`workflow:${workflowId}:${planningMode}`,summary:reviewNote,reviewNote,
    confirmation:reviewNote,warnings:[reviewNote],operations:[{operationType:'set_parameter',value:reviewNote}]}});
  const input={...workflowEnvelope(f.plan,reviewNote),workflowId,planningMode,
    warnings:[reviewNote],assumptions:[reviewNote],payload:{reviewNote,parameterValue:reviewNote}};
  if(workflowId.startsWith('pump_room.'))delete input.status;
  const before=structuredClone(input),result=await f.auth.present(input);
  assert.match(result.reviewNote,/仍需代理审阅/);assert.match(result.reviewNote,/当前项目授权替代逐计划聊天确认/);
  assert.equal(result.requiresSpecificPlanChatApproval,false);assert.equal(result.requiresPreviewAndAgentReview,true);
  assert.equal(result.plan.requiresSpecificPlanChatApproval,false);
  assert.equal(result.plan.nativeConfirmation.text,reviewNote);
  assert.equal(result.plan.nativePreviewSha256,createHash('sha256').update(JSON.stringify(f.plan,null,2)).digest('hex'));
  for(const key of ['source','summary','reviewNote','warnings','operations'])assert.deepEqual(result.plan[key],f.plan[key]);
  for(const key of ['warnings','assumptions','payload'])assert.deepEqual(result[key],input[key]);
  assert.deepEqual(input,before);assert.equal(f.commits.length,0);
});

test('unknown and quoted review notes or unrecognized envelopes are never rewritten',async t=>{
  const f=await fixture(t,{plan:{source:'workflow:architecture.build:explicit'}});
  for(const reviewNote of ['Candidate still requires chat approval.',registeredReviewNote+' 用户自定义补充。']){
    const result=await f.auth.present(workflowEnvelope(f.plan,reviewNote));assert.equal(result.reviewNote,reviewNote);
  }
  for(const overrides of [{planCreated:false},{requiresClarification:true},{workflowId:'custom.workflow'},{planningMode:'ask'}]){
    const result=await f.auth.present({...workflowEnvelope(f.plan),...overrides});assert.equal(result.reviewNote,registeredReviewNote);
    assert.equal(result.requiresSpecificPlanChatApproval,undefined);
  }
  const raw=await f.auth.present(f.plan);assert.equal(raw.reviewNote,undefined);
});

test('workflow review notes retain exact-chat requirements outside scope, on stale plans and in exact-chat mode',async t=>{
  const outside=await fixture(t,{plan:{source:'workflow:architecture.build:explicit'}});outside.context.document.path=outside.other;
  const input=workflowEnvelope(outside.plan);assert.deepEqual(await outside.auth.present(input),input);
  assert.equal(input.plan.confirmationMode,'chat');
  await assert.rejects(commit(outside),{code:'execution_document_not_authorized'});assert.equal(outside.commits.length,0);
  const stale=await fixture(t,{plan:{source:'workflow:architecture.build:explicit',documentRevision:1}});
  const staleInput=workflowEnvelope(stale.plan);assert.deepEqual(await stale.auth.present(staleInput),staleInput);
  const exact=await fixture(t,{policy:false,plan:{source:'workflow:architecture.build:explicit'}});
  const exactInput=workflowEnvelope(exact.plan);assert.deepEqual(await exact.auth.present(exactInput),exactInput);
  assert.equal(exact.calls.length,0);
});

test('exact-plan mode retains the original import approval note',async t=>{
  const f=await fixture(t,{policy:false}),input={status:'preview',plan:f.plan,note:importApprovalNote};
  assert.deepEqual(await f.auth.present(input),input);assert.equal(f.calls.length,0);
});

test('out-of-scope and revoked previews never receive the agent-review note',async t=>{
  const outside=await fixture(t);outside.context.document.path=outside.other;
  const input={status:'preview',plan:outside.plan,note:importApprovalNote};
  assert.deepEqual(await outside.auth.present(input),input);
  const revoked=await fixture(t);await fs.writeFile(revoked.policyPath+'.revoked','stop');
  const result=await revoked.auth.present({status:'preview',plan:revoked.plan,note:importApprovalNote});
  assert.equal(result.note,importApprovalNote);assert.equal(result.executionAuthorization.mode,'blocked');
  assert.equal(result.executionAuthorization.automaticExecutionAllowed,false);
  assert.equal(outside.commits.length+revoked.commits.length,0);
});

for (const method of ['revit.plan.confirm', 'revit.import.commit']) test('authorized unsaved test copy executes once through ' + method, async t => {
  const f = await fixture(t), result = await f.auth.commit(method, { planId: f.plan.planId });
  assert.equal(result.status, 'committed'); assert.equal(result.confirmationMode, 'project-authorization');
  assert.equal(result.executionAuthorization.humanExactPlanApproval, false);
  assert.equal(result.executionAuthorization.approvalSource, 'standing-project-authorization');
  assert.equal(f.commits.length, 1);
  const journal = JSON.parse(await fs.readFile(f.journal, 'utf8'));
  assert.equal(journal.status, 'committed'); assert.equal(journal.confirmCalls, 1);
  assert.equal(journal.saveCalls, 0); assert.equal(journal.restartCalls, 0);
  assert.equal(journal.document.isModified, true);
});

test('a different file is denied without forwarding a commit', async t => {
  const f = await fixture(t); f.context.document.path = f.other;
  await assert.rejects(commit(f), { code: 'execution_document_not_authorized' });
  assert.equal(f.commits.length, 0);
});

for (const [name, document] of [['read-only', { isReadOnly: true }], ['family editor', { isFamilyDocument: true }], ['workshared', { isWorkshared: true }], ['unknown write state', { isReadOnly: undefined }]]) {
  test(name + ' cannot inherit authorization for the test copy', async t => {
    const f = await fixture(t, { document });
    await assert.rejects(commit(f), { code: 'execution_document_not_authorized' });
    assert.equal(f.commits.length, 0);
  });
}

for (const plan of [{ documentIdentity: 'another-session' }, { documentRevision: 1 }]) test('stale plan is not authorized: ' + JSON.stringify(plan), async t => {
  const f = await fixture(t, { plan });
  await assert.rejects(commit(f), { code: 'execution_plan_stale' }); assert.equal(f.commits.length, 0);
});

test('expired preview is rejected without rebuilding a plan', async t => {
  const f = await fixture(t, { plan: { expiresAtUtc: '2026-11-15T00:59:59.000Z' } });
  await assert.rejects(commit(f), { code: 'execution_plan_not_pending' });
  assert.equal(f.commits.length, 0); assert.ok(!f.calls.some(c => c.method === 'revit.plan.create'));
});

test('scope resolution must match the grant-time canonical path', async t => {
  const f = await fixture(t);
  f.grant.allowedDocuments[0].canonicalPath = f.other;
  await fs.writeFile(f.policyPath, JSON.stringify(f.grant));
  const auth = await createExecutionAuthorization({ repoRoot: f.root, policyPath: f.policyPath, call: async () => f.context });
  await assert.rejects(auth.commit('revit.plan.confirm', { planId: f.plan.planId }), { code: 'execution_document_not_authorized' });
});

test('revoking an active grant stops subsequent execution', async t => {
  const f = await fixture(t); await fs.writeFile(f.policyPath + '.revoked', 'stop');
  await assert.rejects(commit(f), { code: 'execution_authorization_changed' }); assert.equal(f.commits.length, 0);
  const status = await f.auth.present(f.plan);
  assert.equal(status.status, 'pending');
  assert.equal(status.executionAuthorization.mode, 'blocked');
  assert.equal(status.executionAuthorization.automaticExecutionAllowed, false);
});

test('revocation after reservation still prevents native dispatch', async t => {
  const f = await fixture(t, { revokeOnReserve: true });
  await assert.rejects(commit(f), { code: 'execution_authorization_changed' });
  assert.equal(f.commits.length, 0); assert.equal(JSON.parse(await fs.readFile(f.journal, 'utf8')).status, 'reserved');
});

test('editing scope does not silently activate a different policy in the running client', async t => {
  const f = await fixture(t); f.grant.allowedDocuments.push({ path: f.other, canonicalPath: f.other });
  await fs.writeFile(f.policyPath, JSON.stringify(f.grant));
  await assert.rejects(commit(f), { code: 'execution_authorization_changed' }); assert.equal(f.commits.length, 0);
});

test('uncertain response is journaled and never retried while the plan remains pending', async t => {
  const f = await fixture(t, { failure: true });
  await assert.rejects(commit(f), { code: 'bridge_timeout' });
  assert.equal(JSON.parse(await fs.readFile(f.journal, 'utf8')).status, 'outcome-unknown');
  await assert.rejects(commit(f), { code: 'execution_already_attempted' });
  assert.equal(f.commits.length, 1);
});

test('concurrent requests cannot both reserve the same native plan', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([commit(f), commit(f)]);
  assert.equal(f.commits.length, 1);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'execution_already_attempted');
});

test('a matching native failure receipt records reported rollback without inventing a timeout', async t => {
  const f = await fixture(t, { nativeFailure: {} });
  await assert.rejects(commit(f), error => {
    assert.equal(error.code, 'execution_failed');
    assert.equal(error.details.planId, f.plan.planId);
    assert.equal(error.details.rolledBack, true);
    assert.equal(error.details.executionAuthorization.status, 'failed');
    assert.equal(error.details.executionAuthorization.humanExactPlanApproval, false);
    assert.equal(error.details.executionAuthorization.confirmCalls, 1);
    assert.equal(error.details.executionAuthorization.auditUpdateFailed, false);
    return true;
  });
  const journal = JSON.parse(await fs.readFile(f.journal, 'utf8'));
  assert.equal(journal.status, 'failed');
  assert.equal(journal.outcomeSource, 'native-failure-receipt');
  assert.equal(journal.causeCode, 'family_types_missing');
  assert.equal(journal.nativeRollbackReported, true);
  assert.equal(journal.automaticRetryAllowed, false);
  assert.equal(journal.saveCalls, 0); assert.equal(journal.restartCalls, 0);
  await assert.rejects(commit(f), { code: 'execution_already_attempted' });
  assert.equal(f.commits.length, 1);
});

for (const details of [{ planId: 'another-plan' }, { status: 'pending' }, { status: 'scope-commit-returned-unverified' }, { rolledBack: false }, { rolledBack: undefined }]) {
  test('an incomplete or unrelated native failure stays outcome-unknown: ' + JSON.stringify(details), async t => {
    const f = await fixture(t, { nativeFailure: details });
    await assert.rejects(commit(f), { code: 'execution_failed' });
    const journal = JSON.parse(await fs.readFile(f.journal, 'utf8'));
    assert.equal(journal.status, 'outcome-unknown');
    assert.equal(journal.nativeRollbackReported, undefined);
    assert.equal(journal.outcomeSource, undefined);
    await assert.rejects(commit(f), { code: 'execution_already_attempted' });
    assert.equal(f.commits.length, 1);
  });
}

test('an existing committed receipt is returned without another native commit', async t => {
  const f = await fixture(t, { plan: { status: 'committed' } });
  assert.deepEqual(await commit(f), f.plan); assert.equal(f.commits.length, 0);
});

test('malformed authorization blocks commits and does not invent chat approval', async t => {
  const f = await fixture(t); await fs.writeFile(f.policyPath, '{invalid');
  const auth = await createExecutionAuthorization({ repoRoot: f.root, policyPath: f.policyPath, call: async () => { throw new Error('must not dispatch'); } });
  assert.equal(auth.summary().mode, 'blocked');
  await assert.rejects(auth.commit('revit.plan.confirm', { planId: f.plan.planId }), { code: 'execution_authorization_blocked' });
});

test('standing authorization cannot invoke lifecycle save/exit/open', async t => {
  const f = await fixture(t);
  await assert.rejects(f.auth.commit('revit.lifecycle.save_once', { planId: f.plan.planId }), { code: 'execution_action_not_authorized' });
  assert.equal(f.commits.length, 0);
});
