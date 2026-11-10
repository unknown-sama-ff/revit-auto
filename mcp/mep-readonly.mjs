import { z } from 'zod';
import { collisionCategories } from './collision-request.mjs';

export const pumpReadOnlyWorkflowIds = ['pump_room.audit', 'pump_room.collision', 'pump_room.clearance'];

const identity = z.string().min(1).max(200).refine(value => value.trim().length > 0, 'Read the current documentIdentity; it cannot be blank.');
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ids = z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(1000).refine(values => new Set(values).size === values.length, 'Element IDs must be unique.');

export const pumpAuditInputSchema = z.object({
  documentIdentity: identity.optional(),
  expectedRevision: revision.optional(),
  elementIds: ids.optional(),
  systemIds: ids.max(200).optional(),
  includeFlow: z.boolean().optional(),
  maxSystems: z.number().int().min(1).max(200).optional()
}).strict();

const collisionId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const collisionIds = max => z.array(collisionId).max(max).refine(values => new Set(values).size === values.length, 'Element IDs must be unique.');
export const pumpCollisionInputSchema = z.object({
  targetElementIds: collisionIds(50).optional(),
  excludeElementIds: collisionIds(500).optional(),
  candidateCategories: z.array(z.enum(collisionCategories)).max(collisionCategories.length).refine(values => new Set(values).size === values.length, 'Duplicate categories are not allowed.').optional(),
  clearanceMm: z.number().finite().min(0).max(10000).optional(),
  toleranceMm: z.number().finite().gt(0).max(10).optional(),
  maxCandidates: z.number().int().min(1).max(1000).optional()
}).strict().refine(input => !(input.excludeElementIds || []).some(id => input.targetElementIds.includes(id)), 'A target cannot also be excluded.');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function pinContext(context, expected) {
  if (context?.active === false) fail('no_active_document', 'Open the reviewed project before running the pump-room read-only workflow.');
  if (context?.active !== true || typeof context.document?.identity !== 'string' || !context.document.identity.trim() || !Number.isSafeInteger(context.document.revision) || context.document.revision < 0) {
    fail('pump_read_context_invalid', 'Native context lacks a verified project identity or revision.');
  }
  if (context.document.identity !== expected.documentIdentity) fail('document_changed', 'The active project differs from the reviewed pump-room request.');
  if (expected.expectedRevision !== undefined && context.document.revision !== expected.expectedRevision) fail('document_revision_changed', 'The pump-room project changed since the reviewed context.');
}

function verifyReadOnly(before, after) {
  if (after.document.identity !== before.document.identity) fail('document_changed', 'The active project changed during the read-only workflow.');
  if (after.document.revision !== before.document.revision) fail('document_revision_changed', 'The model revision changed during the read-only workflow.');
  if (after.document.path !== before.document.path || after.document.isModified !== before.document.isModified) fail('pump_read_state_changed', 'The project path or saved state changed during the read-only workflow; discard this report.');
}

function nestedPinConflict(input, args) {
  if (input.documentIdentity !== undefined && input.documentIdentity !== args.documentIdentity) fail('pump_read_input_conflict', 'Conflicting workflow and pump-room document identities.');
  if (input.expectedRevision !== undefined && args.expectedRevision !== undefined && input.expectedRevision !== args.expectedRevision) fail('pump_read_input_conflict', 'Conflicting workflow and pump-room revisions.');
}

function planningResponse(name, mode, assumptions, questions = []) {
  return {
    workflowId: name,
    planningMode: mode,
    status: 'needs_clarification',
    requiresClarification: true,
    questions,
    assumptions,
    candidateOnly: mode === 'assisted',
    planCreated: false,
    readOnly: true
  };
}

function resolveReadMode(name, args, input) {
  const mode = args.planningMode || 'explicit';
  if (!['explicit', 'ask', 'assisted'].includes(mode)) fail('invalid_planning_mode', `Unknown planningMode '${mode}'.`);
  const assumptions = [...(args.assumptions || [])];
  if (mode === 'assisted' && assumptions.length === 0) fail('assumptions_required', 'assisted planning must list its model/design assumptions before a read-only candidate query.');
  if (mode === 'ask') {
    if (name === 'pump_room.audit') return { mode, assumptions, questions: ['请明确要审计当前泵房设备/管道，还是同时指定系统 ID 和元素 ID；审计不会修改模型。'] };
    if (!input.targetElementIds?.length) return { mode, assumptions, questions: ['请提供需要检查的目标元素 ID；如需净距筛查，请同时提供 clearanceMm。'] };
    if (name === 'pump_room.clearance' && !(input.clearanceMm > 0)) return { mode, assumptions, questions: ['请提供明确的维护净距 clearanceMm；插件只做候选筛查，不猜工程标准。'] };
  }
  if (name !== 'pump_room.audit' && !input.targetElementIds?.length) fail('missing_collision_targets', 'Provide explicit targetElementIds; the read-only workflow will not infer pump-room targets.');
  if (name === 'pump_room.clearance' && !(input.clearanceMm > 0)) fail('missing_clearance', 'Provide a positive clearanceMm; no engineering standard is inferred.');
  return { mode, assumptions, candidateOnly: mode === 'assisted', questions: [] };
}

async function runAudit(args, call, signal, mode) {
  const input = pumpAuditInputSchema.parse(args.input || {});
  nestedPinConflict(input, args);
  const before = await call('revit.context.get', {}, signal);
  pinContext(before, args);
  const pin = { documentIdentity: before.document.identity, expectedRevision: before.document.revision };
  const report = await call('revit.audit.run', {}, signal);
  if (report.documentIdentity !== pin.documentIdentity) fail('pump_audit_scope_mismatch', 'Native pump-room audit evidence identifies a different project.');
  if (report.documentRevision !== undefined && report.documentRevision !== pin.expectedRevision) fail('pump_audit_scope_mismatch', 'Native pump-room audit evidence identifies a different revision.');
  const flowDiagnostics = [];
  const systemIds = (input.systemIds || []).slice(0, input.maxSystems || 200);
  if (input.includeFlow === true && systemIds.length === 0) fail('flow_systems_required', 'includeFlow requires explicit systemIds; no system is inferred.');
  for (const systemId of systemIds) flowDiagnostics.push(await call('revit.flow.diagnose', { ...pin, systemId }, signal));
  const inspected = input.elementIds?.length ? await call('revit.inspect', { elementIds: input.elementIds }, signal) : null;
  const after = await call('revit.context.get', {}, signal);
  pinContext(after, pin);
  verifyReadOnly(before, after);
  return {
    ...report,
    status: 'read_only_result',
    workflowId: 'pump_room.audit',
    planningMode: mode.mode,
    assumptions: mode.assumptions,
    candidateOnly: mode.candidateOnly === true,
    readOnly: true,
    planCreated: false,
    requiresClarification: false,
    questions: [],
    flowDiagnostics,
    inspected,
    auditConsistency: {
      documentIdentityVerified: true,
      documentRevisionVerified: true,
      pathVerified: typeof before.document.path === 'string' && typeof after.document.path === 'string',
      savedStateVerified: typeof before.document.isModified === 'boolean' && typeof after.document.isModified === 'boolean'
    },
    engineeringComplianceVerified: false
  };
}

async function runCollision(args, call, signal, mode, workflowId) {
  const input = pumpCollisionInputSchema.parse(args.input || {});
  const request = { ...input, documentIdentity: args.documentIdentity, expectedRevision: args.expectedRevision };
  const before = await call('revit.context.get', {}, signal);
  pinContext(before, args);
  request.documentIdentity = before.document.identity;
  request.expectedRevision = before.document.revision;
  const report = await call('revit.collision.check', request, signal);
  if (report.documentIdentity !== request.documentIdentity || report.documentRevision !== request.expectedRevision) fail('pump_collision_scope_mismatch', 'Native collision evidence identifies a different project or revision.');
  const after = await call('revit.context.get', {}, signal);
  pinContext(after, { documentIdentity: before.document.identity, expectedRevision: before.document.revision });
  verifyReadOnly(before, after);
  return {
    ...report,
    status: 'read_only_result',
    workflowId,
    planningMode: mode.mode,
    assumptions: mode.assumptions,
    candidateOnly: mode.candidateOnly === true,
    readOnly: true,
    planCreated: false,
    requiresClarification: false,
    questions: [],
    engineeringComplianceVerified: false,
    auditConsistency: {
      documentIdentityVerified: true,
      documentRevisionVerified: true,
      pathVerified: typeof before.document.path === 'string' && typeof after.document.path === 'string',
      savedStateVerified: typeof before.document.isModified === 'boolean' && typeof after.document.isModified === 'boolean'
    }
  };
}

export async function runPumpReadOnlyWorkflow(args, call, signal) {
  const input = args.name === 'pump_room.audit' ? pumpAuditInputSchema.parse(args.input || {}) : pumpCollisionInputSchema.parse(args.input || {});
  const mode = resolveReadMode(args.name, args, input);
  if (mode.questions?.length) return planningResponse(args.name, mode.mode, mode.assumptions, mode.questions);
  if (args.name === 'pump_room.audit') return runAudit(args, call, signal, mode);
  return runCollision(args, call, signal, mode, args.name);
}
