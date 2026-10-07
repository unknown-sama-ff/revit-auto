import {z} from 'zod';
import {importInput} from './imports.mjs';

const row=z.record(z.string(),z.unknown());
export const parameterImportInputSchema=z.object({
  format:z.enum(['json','csv','tsv','xlsx']).optional(),
  filePath:z.string().min(1).optional(),
  sheetName:z.string().min(1).optional(),
  rows:z.array(row).min(1).max(1000).optional(),
  mapping:z.record(z.string(),z.string().min(1)).optional(),
  defaults:row.optional()
}).strict().refine(value=>value.filePath!==undefined||value.rows!==undefined,'Provide an approved table file or explicit rows.');
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
export async function previewParameterImport(args,call,signal){
  const input=parameterImportInputSchema.parse(args.input||{});
  const before=await call('revit.context.get',{},signal);
  if(!before.active||!before.document||before.document.isFamilyDocument)fail('no_active_document','Open a project before previewing a parameter table.');
  if(before.document.identity!==args.documentIdentity)fail('document_changed','Active document differs from the reviewed parameter-import request.');
  if(args.expectedRevision!==undefined&&before.document.revision!==args.expectedRevision)fail('document_revision_changed','Project revision differs from the reviewed parameter-import request.');
  const parsed=await importInput(input);
  if(parsed.candidateOnly)fail('candidate_only_import','This input is candidate geometry, not a parameter table. Use the dedicated candidate workflow.');
  if(parsed.issues?.length) return {workflowId:'imports.parameter_table',planningMode:'explicit',requiresClarification:false,questions:[],assumptions:[],candidateOnly:false,planCreated:false,issues:parsed.issues,operations:parsed.operations||[],note:'No plan was created because the table contains mapping or validation errors.'};
  if(!parsed.operations?.length)fail('empty_import','The parameter table produced no operations.');
  const pin={documentIdentity:before.document.identity,expectedRevision:before.document.revision};
  const plan=await call('revit.plan.create',{...pin,summary:args.summary||'参数表受控导入预览',source:'workflow:imports.parameter_table:explicit',operations:parsed.operations},signal);
  if(plan.documentIdentity!==pin.documentIdentity||plan.documentRevision!==pin.expectedRevision){
    if(plan.planId)await call('revit.plan.cancel',{planId:plan.planId},signal);
    fail('document_revision_changed','Parameter-import preview became stale; review a new plan, no import committed.');
  }
  return {workflowId:'imports.parameter_table',planningMode:'explicit',requiresClarification:false,questions:[],assumptions:[],candidateOnly:false,planCreated:true,plan,importedOperationCount:parsed.operations.length,note:'Preview only. Chat approval of this exact plan is required; no automatic save.'};
}
