import { buildRegisteredWorkflow } from './workflow-adapter.mjs';
import { z } from 'zod';
import { parseElectricalWireInput, inspectElectricalWireScope } from './electrical-wire.mjs';
import { parseElectricalCircuitInput, inspectElectricalCircuitScope } from './electrical-circuit.mjs';
import { parseElectricalSheetInput, inspectElectricalSheetScope } from './electrical-sheet.mjs';
import {drawingPlacementMoveSchema,viewportLabelMoveSchema,parseDrawingPlacementInput,inspectDrawingPlacementScope} from './drawing-placement.mjs';
import {titleBlockChangeSchema,parseTitleBlockChangeInput,inspectTitleBlockChangeScope} from './titleblock-change.mjs';
import {architectureTypeCopySchema} from './architecture-type-copy.mjs';

const MODES = new Set(['explicit', 'ask', 'assisted']);
const INPUT_KEYS = {
  'lighting.full': ['typeCopies','panels','lights','switches','parameterChanges','circuits','views','viewConfigurations','wires','schedules','panelSchedules','sheets','viewports','tags','dimensions'],
  'lighting.place': ['typeCopies','panels','lights','switches','parameterChanges','circuits','views','viewConfigurations','wires','schedules','panelSchedules','sheets','viewports','tags','dimensions'],
  'electrical.circuit': ['parameterChanges','circuits','panelDistributionSystems','panelSchedules','tags','dimensions'],
  'electrical.wire': ['wires','wireDeletions','switchControls','tags','dimensions'],
  'electrical.sheet': ['titleBlockChanges','placementMoves','viewportLabelMoves','sheetChanges','viewChanges','views','viewConfigurations','schedules','panelSchedules','sheets','viewports','tags','dimensions'],
  'architecture.build': ['typeCopies','columns','levels','grids','walls','floors','doors','windows','rooms','views','schedules','sheets','viewports','tags','dimensions'],
  'architecture.rooms': ['rooms','views','schedules','sheets','viewports','tags','dimensions'],
  'architecture.openings': ['typeCopies','doors','windows','schedules','sheets','viewports','tags','dimensions'],
  'architecture.documentation': ['titleBlockChanges','placementMoves','viewportLabelMoves','views','viewConfigurations','schedules','panelSchedules','sheets','viewports','tags','dimensions']
};
export const registeredWriteWorkflowIds = Object.keys(INPUT_KEYS);
const identity = z.string().trim().min(1).max(200);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const row = z.record(z.string(), z.unknown());
function parseInput(name, input) {
  if (!INPUT_KEYS[name]) fail('unsupported_registered_workflow', 'No registered planning adapter for '+name+'.');
  if (input && Object.hasOwn(input, 'operations')) fail('raw_operations_not_allowed', 'Registered workflows accept domain inputs only; use the separately reviewed plan interface for raw operations.');
  if (name === 'electrical.wire') return parseElectricalWireInput(input ?? {});
  if (name === 'electrical.circuit') return parseElectricalCircuitInput(input ?? {});
  if (name === 'electrical.sheet') return parseElectricalSheetInput(input ?? {});
  const shape = {documentIdentity:identity.optional(),expectedRevision:revision.optional()};
  for (const key of INPUT_KEYS[name]) shape[key] = z.array(key==='placementMoves'?drawingPlacementMoveSchema:key==='viewportLabelMoves'?viewportLabelMoveSchema:key==='titleBlockChanges'?titleBlockChangeSchema:key==='typeCopies'&&['architecture.build','architecture.openings'].includes(name)?architectureTypeCopySchema:row).max(1000).optional();
  const parsed=z.object(shape).strict().parse(input ?? {});
  if(name==='architecture.documentation'){
    parseDrawingPlacementInput({placementMoves:parsed.placementMoves,viewportLabelMoves:parsed.viewportLabelMoves});
    parseTitleBlockChangeInput({titleBlockChanges:parsed.titleBlockChanges});
  }
  return parsed;
}

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function assertContext(context, args) {
  if (context?.active === false) fail('no_active_document', 'Open a Revit project before creating a modeling preview.');
  if (context?.active !== true || typeof context.document?.identity !== 'string' || !context.document.identity.trim() || !Number.isSafeInteger(context.document.revision) || context.document.revision < 0 || typeof context.document.path !== 'string' || typeof context.document.isModified !== 'boolean') {
    fail('planning_context_invalid', 'Native context lacks a verified project identity, revision, path or saved state.');
  }
  if (context.document.identity !== args.documentIdentity) fail('document_changed', 'The active project differs from the reviewed modeling request.');
  if (args.expectedRevision !== undefined && context.document.revision !== args.expectedRevision) fail('document_revision_changed', 'The project changed since the reviewed modeling context.');
}

function validateNestedPins(input, args) {
  if (input.documentIdentity !== undefined && input.documentIdentity !== args.documentIdentity) fail('planning_input_conflict', 'Conflicting workflow and modeling document identities.');
  if (input.expectedRevision !== undefined && args.expectedRevision !== undefined && input.expectedRevision !== args.expectedRevision) fail('planning_input_conflict', 'Conflicting workflow and modeling revisions.');
  if (Object.hasOwn(input, 'operations')) fail('raw_operations_not_allowed', 'Registered workflows accept domain inputs only; raw operation lists are not accepted.');
}

function resolveMode(args, workflow) {
  const mode = args.planningMode || 'explicit';
  if (!MODES.has(mode) || !workflow.planningModes.includes(mode)) fail('invalid_planning_mode', `Planning mode '${mode}' is not supported by workflow '${workflow.workflowId}'.`);
  const assumptions = z.array(z.string().trim().min(1)).max(50).parse(args.assumptions ?? []);
  if (mode === 'assisted' && assumptions.length === 0) fail('assumptions_required', 'assisted planning must list its assumptions before a candidate preview.');
  if (mode === 'ask') return { mode, assumptions: [], candidateOnly: false, questions: args.name === 'electrical.circuit' ? [
    '请明确回路成员、开关控制、配电箱和回路名称；不按标记、数量或旧样板分组猜测。',
    '如需设置配电系统，请明确当前项目中的配电箱和 DistributionSysType；如需改名，请明确具体已有回路。'
  ] : args.name === 'electrical.wire' ? [
    '请明确导线所属视图、类型、两端设备/接口及折点；不按样板数量或固定标记自动布线。',
    '如需替换，请明确要删除的现有导线范围及对应新导线；如需控制编号，请明确开关和新编号。'
  ] : args.name === 'electrical.sheet' ? [
    '请明确图纸编号、名称、图框类型、已有或新建视图/明细表，以及纸面放置坐标。',
    '如需修改已有图纸或平面视图，请明确目标 ID、图纸新编号/名称或视图新名称/比例；不自动重编号或猜测类型。'
  ] : [
    '请明确要创建或修改的元素范围、族/类型和标高；不根据测试文件或样板默认值猜测。',
    '请明确坐标、宿主、连接关系或图纸/视图要求；缺少关键约束时不创建计划。'
  ] };
  return { mode, assumptions, candidateOnly: mode === 'assisted', questions: [] };
}

export async function previewRegisteredWriteWorkflow(args, workflow, call, signal) {
  signal?.throwIfAborted();
  if (workflow.destructiveLevel === 'read-only') fail('workflow_read_only', 'Read-only workflows use a read adapter, not a modeling preview.');
  if (args.name !== workflow.workflowId) fail('planning_input_conflict', 'Workflow metadata does not match the requested workflow.');
  identity.parse(args.documentIdentity);
  if (args.expectedRevision !== undefined) revision.parse(args.expectedRevision);
  const input = parseInput(workflow.workflowId, args.input);
  validateNestedPins(input, args);
  const mode = resolveMode(args, workflow);
  if (mode.questions.length) return {
    status: 'needs_clarification', workflowId: workflow.workflowId, planningMode: mode.mode,
    requiresClarification: true, questions: mode.questions, assumptions: [], candidateOnly: false,
    missingInputs: [], warnings: [], alternatives: [], planCreated: false, readOnly: true
  };

  if (!INPUT_KEYS[workflow.workflowId].some(key => input[key]?.length)) fail('empty_modeling_scope', 'Provide at least one domain operation before creating a modeling preview.');
  const workflowPlan = buildRegisteredWorkflow(workflow.workflowId, input);
  const expectedRevision = args.expectedRevision ?? input.expectedRevision;
  const before = await call('revit.context.get', {}, signal);
  assertContext(before, {...args, expectedRevision});
  if (before.document.isFamilyDocument === true) fail('project_document_required', 'This workflow requires a project, not a family document.');
  if (before.document.isReadOnly === true) fail('document_read_only', 'The active project cannot accept modeling changes.');
  const pinnedRevision = before.document.revision;
  let domainReview = args.name === 'electrical.wire' ? await inspectElectricalWireScope(input, call, signal) : args.name === 'electrical.circuit' ? await inspectElectricalCircuitScope(input, call, signal) : args.name === 'electrical.sheet' ? await inspectElectricalSheetScope(input, call, signal) : null;
  if(args.name==='architecture.documentation'){
    const placementReview=await inspectDrawingPlacementScope({placementMoves:input.placementMoves,viewportLabelMoves:input.viewportLabelMoves},call,signal);
    const titleBlockReview=await inspectTitleBlockChangeScope({titleBlockChanges:input.titleBlockChanges},call,signal);
    if(placementReview||titleBlockReview)domainReview={...(placementReview??{}),...(titleBlockReview??{}),
      warnings:[...(placementReview?.warnings??[]),...(titleBlockReview?.warnings??[])]};
  }
  if (domainReview) {
    const inspectedContext = await call('revit.context.get', {}, signal);
    assertContext(inspectedContext, {documentIdentity:before.document.identity,expectedRevision:pinnedRevision});
    if (inspectedContext.document.path !== before.document.path || inspectedContext.document.isModified !== before.document.isModified) fail('planning_state_changed', 'The project path or saved state changed during domain inspection.');
  }
  const summary = [args.summary || workflow.workflowId, mode.mode === 'assisted' ? '候选预览' : '明确约束预览', mode.assumptions.length ? `假设：${mode.assumptions.join('；')}` : ''].filter(Boolean).join('；');
  const plan = await call('revit.plan.create', {
    documentIdentity: before.document.identity,
    expectedRevision: pinnedRevision,
    summary,
    source: `workflow:${workflow.workflowId}:${mode.mode}`,
    operations: workflowPlan.operations
  }, signal);
  try {
    if (!plan || typeof plan.planId !== 'string' || !plan.planId.trim() || plan.status !== 'pending') fail('invalid_preview_response', 'Native host did not return an identifiable pending preview.');
    if (plan.documentIdentity !== before.document.identity) fail('plan_scope_mismatch', 'Native preview lacks the reviewed project identity.');
    if (plan.documentRevision !== pinnedRevision) fail('document_revision_changed', 'Native preview lacks the reviewed model revision.');
    const after = await call('revit.context.get', {}, signal);
    assertContext(after, {documentIdentity:before.document.identity,expectedRevision:pinnedRevision});
    if (after.document.path !== before.document.path || after.document.isModified !== before.document.isModified) fail('planning_state_changed', 'The document path or saved state changed while creating the preview.');
  } catch (error) {
    if (typeof plan?.planId === 'string' && plan.planId.trim()) {
      const details = {...error.details, planId:plan.planId};
      try {
        const cleanup = await call('revit.plan.cancel', {planId:plan.planId}, signal);
        details.previewCleanup = {attempted:true,status:cleanup?.status ?? 'unknown'};
      } catch (cleanupError) {
        details.previewCleanup = {attempted:true,status:'unknown',code:cleanupError.code ?? 'cancel_failed',message:cleanupError.message};
      }
      error.details = details;
    }
    throw error;
  }
  return {
    workflowId: workflow.workflowId, planningMode: mode.mode, assumptions: mode.assumptions,
    candidateOnly: mode.candidateOnly, reviewNote: mode.mode === 'assisted' ? '这是基于已披露假设生成的候选方案，仍需聊天确认。' : '这是基于用户明确约束生成的预览，仍需聊天确认。',
    status: 'preview', requiresClarification: false, questions: [], missingInputs: [], alternatives: [],
    warnings: [...(mode.candidateOnly ? ['候选假设不代表工程设计已核定。'] : []), ...(domainReview?.warnings ?? [])],
    ...(domainReview ? {domainReview} : {}),
    planCreated: true, documentIdentity: before.document.identity, documentRevision: pinnedRevision, plan
  };
}
