import {z} from 'zod';
import {importInput} from './imports.mjs';

const row=z.record(z.string(),z.unknown());
export const parameterImportRequestInputSchema=z.object({
  format:z.enum(['json','csv','tsv','xlsx']).optional(),
  filePath:z.string().min(1).optional(),
  sheetName:z.string().min(1).optional(),
  rows:z.array(row).min(1).max(1000).optional(),
  mapping:z.record(z.string(),z.string().min(1)).optional(),
  defaults:row.optional()
}).strict();
export const parameterImportInputSchema=parameterImportRequestInputSchema.refine(
  value=>value.filePath!==undefined||value.rows!==undefined,
  'Provide an approved table file or explicit rows.'
);
const requestSchema=z.object({
  documentIdentity:z.string().trim().min(1).max(200),
  expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  planningMode:z.enum(['explicit','ask','assisted']).default('explicit'),
  assumptions:z.array(z.string().trim().min(1)).max(50).default([]),
  summary:z.string().optional(),
  input:parameterImportRequestInputSchema.default({})
});
function fail(code,message,details){
  const error=new Error(message);error.code=code;
  if(details!==undefined)error.details=details;
  throw error;
}
function assertContext(context,pin){
  if(context?.active===false||context?.document?.isFamilyDocument===true)fail('no_active_document','Open a project before previewing a parameter table.');
  const document=context?.document;
  if(context?.active!==true||typeof document?.identity!=='string'||!document.identity.trim()||!Number.isSafeInteger(document.revision)||document.revision<0||typeof document.path!=='string'||typeof document.isModified!=='boolean')
    fail('planning_context_invalid','Native context lacks a verified project identity, revision, path or saved state.');
  if(document.identity!==pin.documentIdentity)fail('document_changed','Active document differs from the reviewed parameter-import request.');
  if(pin.expectedRevision!==undefined&&document.revision!==pin.expectedRevision)fail('document_revision_changed','Project revision differs from the reviewed parameter-import request.');
}
async function recheckContext(before,call,signal){
  const after=await call('revit.context.get',{},signal);
  assertContext(after,{documentIdentity:before.document.identity,expectedRevision:before.document.revision});
  if(after.document.path!==before.document.path||after.document.isModified!==before.document.isModified)
    fail('planning_state_changed','The project path or saved state changed during the parameter-import preview.');
}
async function cleanupPreview(error,plan,call,signal){
  if(typeof plan?.planId!=='string'||!plan.planId.trim())return;
  const details={...error.details,planId:plan.planId};
  try{
    const cleanup=await call('revit.plan.cancel',{planId:plan.planId},signal);
    details.previewCleanup={attempted:true,status:cleanup?.status??'unknown'};
  }catch(cleanupError){
    details.previewCleanup={attempted:true,status:'unknown',code:cleanupError.code??'cancel_failed',message:cleanupError.message};
  }
  error.details=details;
}
export async function previewParameterImport(args,call,signal){
  signal?.throwIfAborted();
  const request=requestSchema.parse(args);
  const {planningMode,assumptions}=request;
  if(planningMode==='assisted'&&!assumptions.length)fail('assumptions_required','assisted parameter imports must disclose assumptions before a candidate preview.');
  if(planningMode==='ask')return {
    status:'needs_clarification',workflowId:'imports.parameter_table',planningMode,
    requiresClarification:true,questions:[
      '请明确 CSV/TSV/XLSX/JSON 来源、工作表以及目标字段到源列的映射。',
      '请明确目标元素或族/类型、标高、宿主与参数单位；表格缺少的数据不会自动推断。'
    ],assumptions:[],candidateOnly:false,warnings:[],alternatives:[],
    missingInputs:request.input.filePath===undefined&&request.input.rows===undefined?['input.filePath or input.rows']:[],
    planCreated:false,readOnly:true
  };
  const input=parameterImportInputSchema.parse(request.input);
  const metadata={
    workflowId:'imports.parameter_table',planningMode,requiresClarification:false,questions:[],
    assumptions,candidateOnly:planningMode==='assisted',missingInputs:[],alternatives:[],
    warnings:planningMode==='assisted'?['表格候选仅使用显式数据与已披露假设，不代表工程设计已核定；仍需聊天确认。']:[]
  };
  const before=await call('revit.context.get',{},signal);
  assertContext(before,request);
  if(before.document.isReadOnly===true)fail('document_read_only','The active project cannot accept parameter-import changes.');
  const parsed=await importInput(input);
  if(parsed.candidateOnly)fail('candidate_only_import','This input is candidate geometry, not a parameter table. Use the dedicated candidate workflow.');
  if(parsed.issues?.length){
    await recheckContext(before,call,signal);
    return {...metadata,status:'validation_issues',planCreated:false,issues:parsed.issues,operations:parsed.operations||[],note:'No plan was created because the table contains mapping or validation errors.'};
  }
  if(!parsed.operations?.length)fail('empty_import','The parameter table produced no operations.');
  const pin={documentIdentity:before.document.identity,expectedRevision:before.document.revision};
  const summary=[request.summary||'参数表受控导入预览',planningMode==='assisted'?'候选预览':'明确约束预览',assumptions.length?'假设：'+assumptions.join('；'):''].filter(Boolean).join('；');
  const plan=await call('revit.plan.create',{...pin,summary,source:'workflow:imports.parameter_table:'+planningMode,operations:parsed.operations},signal);
  try{
    if(typeof plan?.planId!=='string'||!plan.planId.trim()||plan.status!=='pending')fail('invalid_preview_response','Native host did not return an identifiable pending parameter-import preview.');
    if(plan.documentIdentity!==pin.documentIdentity)fail('plan_scope_mismatch','Parameter-import preview lacks the reviewed project identity.');
    if(plan.documentRevision!==pin.expectedRevision)fail('document_revision_changed','Parameter-import preview lacks the reviewed model revision.');
    await recheckContext(before,call,signal);
  }catch(error){
    await cleanupPreview(error,plan,call,signal);
    throw error;
  }
  return {...metadata,status:'preview',planCreated:true,plan,documentIdentity:pin.documentIdentity,documentRevision:pin.expectedRevision,importedOperationCount:parsed.operations.length,note:'Preview only. Chat approval of this exact plan is required; no automatic save.'};
}
