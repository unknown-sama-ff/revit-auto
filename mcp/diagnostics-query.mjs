import { z } from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {describeArgumentKeys} from './argument-diagnostics.mjs';
import {DiagnosticResultStore,diagnosticResultPageSchema} from './diagnostic-results.mjs';

export const diagnosticsWorkflowIds = ['diagnostics.query','diagnostics.result'];
const results=new DiagnosticResultStore();

const identity = z.string().min(1).max(200).refine(value => value.trim().length > 0, 'Read the current documentIdentity; it cannot be blank.');
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const diagnosticsInputSchema = z.object({
  documentIdentity: identity.optional(),
  expectedRevision: revision.optional(),
  responseMode:z.enum(['full','summary']).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  mark: z.string().trim().min(1).max(200).optional(),
  number: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(200).optional(),
  family: z.string().trim().min(1).max(200).optional(),
  type: z.string().trim().min(1).max(200).optional(),
  types: z.boolean().optional(),
  levelId: id.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  inspectElementIds: z.array(id).min(1).max(100).refine(values => new Set(values).size === values.length, 'inspectElementIds must be unique.').optional()
}).strict().refine(input => Object.keys(input).some(key => !['documentIdentity', 'expectedRevision','responseMode'].includes(key)), 'Provide at least one explicit diagnostic query.');

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function pluginPin(info){
  const parsed=z.object({protocol:z.literal('revit-auto-2027-v2'),moduleVersionId:z.string().uuid(),pid:id}).passthrough().safeParse(info);
  if(!parsed.success)fail('diagnostics_plugin_identity_invalid','Summary results require complete native module and process evidence.');
  return {moduleVersionId:parsed.data.moduleVersionId,pid:parsed.data.pid};
}
function samePlugin(before,after){if(!isDeepStrictEqual(before,after))fail('diagnostics_plugin_changed','Native plugin changed during the diagnostic read; no result returned.');}

function pin(context, expected) {
  if (context?.active === false) fail('no_active_document', 'Open the reviewed project before running diagnostics.query.');
  const d=context?.document;
  if (context?.active !== true || typeof d?.identity !== 'string' || !d.identity.trim() || !Number.isSafeInteger(d.revision) || d.revision < 0 ||
      typeof d.title!=='string'||typeof d.path!=='string'||typeof d.isModified!=='boolean'||typeof d.isReadOnly!=='boolean'||typeof d.isFamilyDocument!=='boolean')
    fail('diagnostics_context_invalid', 'Native context lacks complete document identity, revision, kind or state evidence.');
  if (context.document.identity !== expected.documentIdentity) fail('document_changed', 'The active project differs from the reviewed diagnostic request.');
  if (expected.expectedRevision !== undefined && context.document.revision !== expected.expectedRevision) fail('document_revision_changed', 'The project changed since the reviewed diagnostic context.');
  if(d.isFamilyDocument)fail('project_required','diagnostics.query searches project elements; use the separately scoped family reader for family documents.');
  return structuredClone(d);
}

async function readResultPage(args,call,signal,store){
  const input=diagnosticResultPageSchema.parse(args.input??{});
  if(args.planningMode&&args.planningMode!=='explicit')fail('invalid_planning_mode','Cached result reads use explicit mode only.');
  const expected={documentIdentity:identity.parse(args.documentIdentity),expectedRevision:revision.parse(args.expectedRevision)};
  store.assertKnown(input.resultHandle);
  const read=async(method)=>{signal?.throwIfAborted();const r=await call(method,{},signal);signal?.throwIfAborted();return r;};
  const pluginBefore=pluginPin(await read('revit.bridge.info'));
  const before=pin(await read('revit.context.get'),expected);
  const page=store.page(input,{...pluginBefore,document:before});
  const after=pin(await read('revit.context.get'),expected);
  if(!isDeepStrictEqual(before,after))fail('diagnostics_state_changed','Document changed while reading the cached result.');
  samePlugin(pluginBefore,pluginPin(await read('revit.bridge.info')));
  store.assertKnown(input.resultHandle);signal?.throwIfAborted();return page;
}

export async function runDiagnosticsWorkflow(args, call, signal,store=results) {
  signal?.throwIfAborted();
  if(args.name==='diagnostics.result')return readResultPage(args,call,signal,store);
  const raw=args.input??{},parsed=diagnosticsInputSchema.safeParse(raw);
  if(!parsed.success){
    const error=Object.assign(new Error('Invalid diagnostic input; fields remain case-sensitive and are never corrected automatically.'),{
      code:'invalid_diagnostics_input',details:{invalid_arguments:describeArgumentKeys(
        raw&&typeof raw==='object'&&!Array.isArray(raw)?Object.keys(raw):[],Object.keys(diagnosticsInputSchema.shape)),
        validation:parsed.error.issues.filter(i=>i.code!=='unrecognized_keys').slice(0,8).map(i=>({code:i.code,field:i.path.join('.'),message:i.message}))}});
    throw error;
  }
  const input=parsed.data;
  if (input.documentIdentity !== undefined && input.documentIdentity !== args.documentIdentity) fail('diagnostics_input_conflict', 'Conflicting workflow and diagnostic document identities.');
  if (input.expectedRevision !== undefined && args.expectedRevision !== undefined && input.expectedRevision !== args.expectedRevision) fail('diagnostics_input_conflict', 'Conflicting workflow and diagnostic revisions.');
  const mode = args.planningMode || 'explicit';
  if (!['explicit', 'ask', 'assisted'].includes(mode)) fail('invalid_planning_mode', `Unknown planningMode '${mode}'.`);
  const assumptions = [...(args.assumptions || [])];
  if (mode === 'assisted' && assumptions.length === 0) fail('assumptions_required', 'assisted planning must list its diagnostic assumptions.');
  if (mode === 'ask') return { workflowId: 'diagnostics.query', planningMode: mode, status: 'needs_clarification', requiresClarification: true, questions: ['请明确要查询的元素、族类型、类别、标记、房间号或元素 ID；查询不会修改模型。'], assumptions: [], candidateOnly: false, planCreated: false, readOnly: true };

  const read=async(method,params,requirements)=>{signal?.throwIfAborted();const result=await call(method,params,signal,requirements);signal?.throwIfAborted();return result;};
  const requirements={requiredFeatures:['readonly-query-pins']};
  const pluginBefore=input.responseMode==='summary'?pluginPin(await read('revit.bridge.info',{},requirements)):null;
  const before = await read('revit.context.get', {});
  const documentBefore=pin(before,{documentIdentity:args.documentIdentity,expectedRevision:args.expectedRevision??input.expectedRevision});
  const nativePins={documentIdentity:documentBefore.identity,expectedRevision:documentBefore.revision};
  const nativeQuery = Object.fromEntries(Object.entries(input).filter(([key]) => !['documentIdentity', 'expectedRevision', 'inspectElementIds','responseMode'].includes(key)));
  const searchFields = ['query', 'mark', 'number', 'category', 'family', 'type', 'types', 'levelId', 'limit', 'offset'];
  const searchArgs = Object.fromEntries(Object.entries(nativeQuery).filter(([key]) => searchFields.includes(key)));
  const search = Object.keys(searchArgs).length ? await read('revit.search', {...searchArgs,...nativePins},requirements) : null;
  const inspected = input.inspectElementIds ? await read('revit.inspect', { elementIds: input.inspectElementIds,...nativePins },requirements) : null;
  const after = await read('revit.context.get', {});
  const documentAfter=pin(after,nativePins);
  if(!isDeepStrictEqual(documentBefore,documentAfter))fail('diagnostics_state_changed','Document metadata or saved/read-only state changed during diagnostics; discard this report.');
  const report={
    status: 'read_only_result', workflowId: 'diagnostics.query', planningMode: mode, assumptions,
    candidateOnly: mode === 'assisted', readOnly: true, planCreated: false, requiresClarification: false, questions: [],
    search, inspected,
    documentIdentity: documentBefore.identity, documentRevision: documentBefore.revision,
    auditConsistency: { documentIdentityVerified: true, documentRevisionVerified: true, pathVerified: typeof before.document.path === 'string' && typeof after.document.path === 'string', savedStateVerified: typeof before.document.isModified === 'boolean' && typeof after.document.isModified === 'boolean' }
  };
  if(input.responseMode!=='summary')return report;
  samePlugin(pluginBefore,pluginPin(await read('revit.bridge.info',{},requirements)));
  signal?.throwIfAborted();
  return store.put({scope:{...pluginBefore,document:documentBefore},report,
    sourceQuery:{search:Object.keys(searchArgs).length?searchArgs:null,inspectElementIds:input.inspectElementIds??[]}});
}
