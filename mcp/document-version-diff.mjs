import {z} from 'zod';

const MAX_IDS_PER_SET=20000;
const nonblank=z.string().min(1).max(200).refine(value=>value.trim().length>0);
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const guid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const ids=z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(MAX_IDS_PER_SET).refine(values=>values.every((value,index)=>index===0||values[index-1]<value),'IDs must be sorted and unique');

export const documentVersionDiffRequestSchema=z.object({documentIdentity:nonblank,expectedRevision:revision,baseVersionGuid:guid}).strict();
export const documentVersionDiffResponseSchema=z.object({
  documentIdentity:nonblank,documentRevision:revision,baseVersionGuid:guid,currentVersionGuid:guid,currentSaveCount:z.number().int().min(0),
  modelKind:z.enum(['workshared','non_workshared']),createdIds:ids,modifiedIds:ids,deletedIds:ids,deletedIdsAvailable:z.boolean(),
  complete:z.literal(true),truncated:z.literal(false),modelWritesRequested:z.literal(false),automaticSave:z.literal(false),
  allModelSideEffectsVerified:z.literal(false),scopeNote:z.string().min(1)
}).strict().superRefine((value,context)=>{
  if(!value.deletedIdsAvailable&&value.deletedIds.length!==0)context.addIssue({code:'custom',message:'Unavailable deleted ID evidence must use an empty list.'});
  if(value.modelKind==='non_workshared'&&value.deletedIdsAvailable)context.addIssue({code:'custom',message:'Non-workshared documents do not expose deleted ID history.'});
  if(value.modelKind==='workshared'&&!value.deletedIdsAvailable)context.addIssue({code:'custom',message:'Workshared deletion history availability must be reported by Revit.'});
});

const contextSchema=z.object({active:z.literal(true),document:z.object({identity:nonblank,revision,path:z.string(),isModified:z.boolean(),isReadOnly:z.boolean()}).passthrough()}).passthrough();
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function snapshot(value,request){
  if(value?.active===false)fail('no_active_document','Open the reviewed document before querying version differences.');
  const parsed=contextSchema.safeParse(value);if(!parsed.success)fail('document_version_diff_context_invalid','Native context lacks a pinned document identity, revision, path or saved state.');
  const document=parsed.data.document;
  if(document.identity!==request.documentIdentity)fail('document_changed','Active document differs from the reviewed version-diff request.');
  if(document.revision!==request.expectedRevision)fail('document_revision_changed','Active revision differs from the reviewed version-diff request.');
  return {identity:document.identity,revision:document.revision,path:document.path,isModified:document.isModified,isReadOnly:document.isReadOnly};
}

export async function readDocumentVersionDiff(input,call,signal){
  const request=documentVersionDiffRequestSchema.parse(input);signal?.throwIfAborted();
  const before=snapshot(await call('revit.context.get',{},signal),request);signal?.throwIfAborted();
  const parsed=documentVersionDiffResponseSchema.safeParse(await call('revit.document.version_diff',request,signal));
  if(!parsed.success)fail('document_version_diff_response_invalid','Native version difference is malformed, incomplete or exceeds its bounded response contract; discard this report.');
  const report=parsed.data;
  if(report.documentIdentity!==request.documentIdentity)fail('document_changed','Native version difference belongs to another document.');
  if(report.documentRevision!==request.expectedRevision)fail('document_revision_changed','Native version difference belongs to another document revision.');
  if(report.baseVersionGuid.toLowerCase()!==request.baseVersionGuid.toLowerCase())fail('document_version_diff_scope_mismatch','Native version difference does not match the requested base version GUID.');
  signal?.throwIfAborted();const after=snapshot(await call('revit.context.get',{},signal),request);
  if(after.path!==before.path||after.isModified!==before.isModified||after.isReadOnly!==before.isReadOnly)fail('document_version_diff_state_changed','Document state changed during native version difference read; discard this report.');
  signal?.throwIfAborted();return report;
}
