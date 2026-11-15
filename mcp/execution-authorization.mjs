import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const action = z.enum(['revit.plan.confirm', 'revit.import.commit']);
const grantSchema = z.object({
  schemaVersion: z.literal(1), mode: z.literal('project-authorization'), enabled: z.boolean(),
  authorizationId: z.string().regex(/^[a-f0-9]{32}$/), grantedBy: z.enum(['user-chat','user-installation']),
  grantedAtUtc: z.string().datetime(), userStatement: z.string().min(1).max(8192),
  projectRoot: z.string().min(1),
  allowedDocuments: z.array(z.object({ path: z.string().min(1), canonicalPath: z.string().min(1) }).strict()).min(1).max(20),
  allowedActions: z.array(action).min(1).max(2),
  automaticSave: z.literal(false), automaticRestart: z.literal(false)
}).strict();
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
async function exists(io, file) {
  try { await io.access(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

// The native host already trusts its MCP client. This is a scoped client policy,
// not a new native bypass or proof that a human approved each individual plan.
export async function createExecutionAuthorization({ repoRoot, call, policyPath, bridgeConfigPath = process.env.REVIT_AI_CONFIG, io = fs, clock = Date.now }) {
  const root = await io.realpath(repoRoot);
  const profileDirectory = bridgeConfigPath ? path.dirname(path.resolve(bridgeConfigPath)) : path.join(root, 'runtime');
  const file = path.resolve(policyPath || process.env.REVIT_AI_EXECUTION_AUTHORIZATION || path.join(profileDirectory, 'execution-authorization.json'));
  const auditRoot = path.join(root, 'runtime/execution-authorizations');
  async function load() {
    let bytes;
    try { bytes = await io.readFile(file); }
    catch (e) { if (e.code === 'ENOENT') return { mode: 'exact-plan-chat', fingerprint: 'absent' }; throw e; }
    const fingerprint = sha(bytes);
    try {
      if (bytes.length > 32768) throw new Error('oversized');
      const text = bytes.toString('utf8');
      const grant = grantSchema.parse(JSON.parse(text.charCodeAt(0) === 65279 ? text.slice(1) : text));
      if (!path.isAbsolute(grant.projectRoot) || normalize(await io.realpath(grant.projectRoot)) !== normalize(root)) throw new Error('wrong project');
      for (const target of grant.allowedDocuments) {
        if (!path.isAbsolute(target.path) || !path.isAbsolute(target.canonicalPath)) throw new Error('relative scope');
      }
      const revoked = await exists(io, file + '.revoked');
      return { mode: revoked ? 'revoked' : grant.enabled ? 'project-authorization' : 'exact-plan-chat', grant, fingerprint: fingerprint + (revoked ? ':revoked' : '') };
    } catch { return { mode: 'blocked', fingerprint, reason: 'Invalid execution authorization; model commits are blocked.' }; }
  }
  const startup = await load();
  async function current() {
    const policy = await load();
    if (policy.fingerprint !== startup.fingerprint) fail('execution_authorization_changed', 'Execution authorization changed or was revoked. No commit was sent; reload MCP to activate the new policy.');
    if (['blocked', 'revoked'].includes(policy.mode)) fail('execution_authorization_blocked', 'Execution authorization is invalid or revoked. Read-only tools remain available; no commit was sent.');
    return policy;
  }
  function summary(policy = startup) {
    return { mode: policy.mode, authorizationId: policy.grant?.authorizationId ?? null,
      requiresSpecificPlanChatApproval: policy.mode !== 'project-authorization', requiresPreviewAndAgentReview: true,
      allowedDocumentPaths: policy.grant?.allowedDocuments.map(d => d.path) ?? [],
      automaticSave: false, automaticRestart: false };
  }
  async function inScope(policy, context) {
    const doc = context?.document;
    if (context?.active !== true || !doc || doc.isFamilyDocument !== false || doc.isReadOnly !== false || doc.isWorkshared !== false || !doc.path) return false;
    const actual = normalize(await io.realpath(doc.path));
    for (const target of policy.grant.allowedDocuments) {
      // Pin both the declared path and its grant-time resolution: changing a
      // junction/symlink must not silently extend the authorized model scope.
      if (normalize(await io.realpath(target.path)) === normalize(target.canonicalPath) && actual === normalize(target.canonicalPath)) return true;
    }
    return false;
  }
  function decorate(plan, policy) {
    return { ...plan, nativeConfirmation: { mode: plan.confirmationMode, text: plan.confirmation, requiresConfirmation: plan.requiresConfirmation },
      confirmationMode: 'project-authorization', confirmation: 'Agent review under standing project authorization; no per-plan human chat confirmation.',
      requiresConfirmation: true, requiresSpecificPlanChatApproval: false, nativePreviewSha256: sha(JSON.stringify(plan, null, 2)), executionAuthorization: summary(policy) };
  }
  function describe(text) {
    if (startup.mode !== 'project-authorization') return text;
    return text.replace(/After explicit user chat approval of the unchanged previewed plan/gi, 'After agent review under the active project authorization')
      .replace(/After explicit user chat approval/gi, 'Under the active project authorization')
      .replace(/still requires chat approval/gi, 'still requires agent review under the active execution policy')
      .replace(/Chat approval of this exact plan is required/gi, 'Agent review under the active project authorization is required')
      .replace(/Chat confirmation of this exact plan is required[.]/g, 'Standing project authorization replaces per-plan human chat confirmation.');
  }
  function instructions(original) {
    if (startup.mode === 'exact-plan-chat') return original;
    if (startup.mode !== 'project-authorization') return 'Model commits are blocked by invalid or revoked execution authorization. Read-only tools remain available. ' + original;
    const text = original
      .replace('All writes require plan preview and explicit user approval of that exact plan in chat.', 'All writes require a preview and agent review. For the authorized local test copy, the recorded standing project authorization replaces per-plan human chat confirmation.')
      .replace('After chat approval, invoke the commit tool once;', 'After agent review under the active authorization, invoke the commit tool once;')
      .replace('The trusted MCP client is responsible for verifying the chat approval; Revit cannot read the conversation.', 'The MCP commit gateway verifies the recorded authorization scope, fresh identity/revision and one-attempt journal. It does not claim a human approved each plan.')
      .replace('require explicit user chat approval of the reviewed plan', 'require preview review and a matching execution authorization')
      .replace('The trusted assistant/client must verify the human chat approval because the Revit backend cannot read the conversation.', 'The MCP commit gateway records standing project authorization with humanExactPlanApproval=false; the native backend cannot read chat.');
    return text + ' Active authorization: ' + JSON.stringify(summary()) + '. Outside these document paths automatic execution is denied; use exact-plan-chat mode for other projects. Legacy native chat labels alone do not prove human per-plan approval. Lifecycle save/exit/open still requires its separate exact approval.';
  }
  async function present(data, signal) {
    if (startup.mode !== 'project-authorization' || !object(data)) return data;
    const plan = data.status === 'pending' && Array.isArray(data.operations) ? data : data.plan?.status === 'pending' ? data.plan : null;
    if (!plan) return data;
    let policy, context;
    try { policy = await current(); context = await call('revit.context.get', {}, signal); }
    catch (error) {
      // Status recovery must remain available after revocation or a disconnect.
      return { ...data, executionAuthorization: { mode: 'blocked', requiresSpecificPlanChatApproval: true, reasonCode: error.code ?? 'authorization_unavailable', automaticExecutionAllowed: false } };
    }
    if (plan.documentIdentity !== context?.document?.identity || plan.documentRevision !== context?.document?.revision || !await inScope(policy, context)) return data;
    const decorated = decorate(plan, policy);
    return plan === data ? decorated : { ...data, plan: decorated, executionAuthorization: summary(policy),
      ...(typeof data.reviewNote === 'string' ? { reviewNote: describe(data.reviewNote) } : {}),
      ...(typeof data.note === 'string' ? { note: describe(data.note) } : {}) };
  }
  async function commit(method, args, signal) {
    const policy = await current();
    if (policy.mode === 'exact-plan-chat') return call(method, args, signal);
    if (!policy.grant.allowedActions.includes(method)) fail('execution_action_not_authorized', 'This standing authorization does not include the requested action.');
    if (!/^[a-f0-9]{32}$/.test(args.planId)) fail('invalid_plan_id', 'A native plan ID is required.');
    const context = await call('revit.context.get', {}, signal);
    if (!await inScope(policy, context)) fail('execution_document_not_authorized', 'The active document is outside the authorized local test copy. No commit was sent.');
    const plan = await call('revit.plan.get', { planId: args.planId }, signal);
    if (plan.planId !== args.planId) fail('execution_plan_mismatch', 'Native plan status returned a different plan.');
    if (['committed', 'failed'].includes(plan.status)) return plan;
    if (plan.status !== 'pending' || !Array.isArray(plan.operations) || !plan.operations.length || !Number.isFinite(Date.parse(plan.expiresAtUtc)) || clock() >= Date.parse(plan.expiresAtUtc))
      fail('execution_plan_not_pending', 'The original plan is not pending or has expired. Do not recreate or retry automatically.');
    if (plan.documentIdentity !== context.document.identity || plan.documentRevision !== context.document.revision) fail('execution_plan_stale', 'Native plan identity/revision differs from the current document.');
    const after = await call('revit.context.get', {}, signal);
    if (!await inScope(policy, after) || after.document.identity !== context.document.identity || after.document.revision !== context.document.revision || after.document.path !== context.document.path)
      fail('execution_document_changed', 'The active document changed before execution.');
    await current(); signal?.throwIfAborted();
    const permit = { schemaVersion: 1, kind: 'project-execution-authorization', status: 'reserved',
      authorizationId: policy.grant.authorizationId, authorizationFileSha256: policy.fingerprint,
      approvalSource: 'standing-project-authorization', humanExactPlanApproval: false,
      planId: plan.planId, action: method, attemptId: randomUUID(), reservedAtUtc: new Date(clock()).toISOString(),
      document: after.document, nativePreviewSha256: sha(JSON.stringify(plan, null, 2)),
      presentedPreviewSha256: sha(JSON.stringify(decorate(plan, policy), null, 2)),
      operationTypes: plan.operations.map(o => o.operationType), confirmCalls: 1, automaticRetries: 0, saveCalls: 0, restartCalls: 0 };
    await io.mkdir(auditRoot, { recursive: true });
    const journal = path.join(auditRoot, args.planId + '.json');
    try { await io.writeFile(journal, JSON.stringify(permit, null, 2), { flag: 'wx' }); }
    catch (e) { if (e.code === 'EEXIST') fail('execution_already_attempted', 'An attempt already exists for this plan. Query its original status; no second commit was sent.'); throw e; }
    await current(); signal?.throwIfAborted();
    let receipt;
    try { receipt = await call(method, args, signal); }
    catch (error) {
      const knownRollback = error.code === 'execution_failed' && object(error.details) &&
        error.details.planId === permit.planId && error.details.status === 'failed' && error.details.rolledBack === true;
      const failure = { ...permit, status: knownRollback ? 'failed' : 'outcome-unknown',
        errorCode: error.code ?? 'execution_failed', automaticRetryAllowed: false,
        ...(knownRollback ? { completedAtUtc: new Date(clock()).toISOString(), outcomeSource: 'native-failure-receipt',
          nativeRollbackReported: true, ...(typeof error.details.causeCode === 'string' ? { causeCode: error.details.causeCode } : {}) } : {}) };
      let auditUpdateFailed = false;
      try { await io.writeFile(journal, JSON.stringify(failure, null, 2)); } catch { auditUpdateFailed = true; }
      if (knownRollback) error.details = { ...error.details, executionAuthorization: { ...failure,
        auditFile: path.relative(root, journal).replaceAll(path.sep, '/'), auditUpdateFailed } };
      throw error;
    }
    const record = { ...permit, status: receipt.status ?? 'returned-unverified', completedAtUtc: new Date(clock()).toISOString() };
    let auditUpdateFailed = false;
    try { await io.writeFile(journal, JSON.stringify(record, null, 2)); } catch { auditUpdateFailed = true; }
    return { ...receipt, nativeConfirmationMode: receipt.confirmationMode, confirmationMode: 'project-authorization',
      executionAuthorization: { ...permit, auditFile: path.relative(root, journal).replaceAll(path.sep, '/'), auditUpdateFailed } };
  }
  return { summary, describe, instructions, present, commit };
}
