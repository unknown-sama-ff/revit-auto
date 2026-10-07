import {z} from 'zod';

const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const savedVerificationInputSchema=z.object({
  documentIdentity:z.string().min(1).optional(),
  expectedRevision:revision.optional(),
  sinceRevision:revision.optional(),
  limit:z.number().int().min(1).max(100).optional()
}).strict();
export const savedVerificationSchema=savedVerificationInputSchema.extend({documentIdentity:z.string().min(1)}).strict();
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function documentSnapshot(context){
  if(!context?.active||!context.document||context.document.isFamilyDocument)fail('no_active_document','Open a project before checking saved state.');
  const doc=context.document;
  if(typeof doc.identity!=='string'||!doc.identity||!revision.safeParse(doc.revision).success)fail('invalid_verification_response','Native context lacks a valid identity/revision.');
  return {identity:doc.identity,revision:doc.revision,isModified:typeof doc.isModified==='boolean'?doc.isModified:null,path:typeof doc.path==='string'?doc.path:null};
}
export async function verifySaved(raw,call,signal){
  const args=savedVerificationSchema.parse(raw);
  const before=documentSnapshot(await call('revit.context.get',{},signal));
  if(before.identity!==args.documentIdentity)fail('document_changed','Active document differs from the reviewed saved-state request.');
  if(args.expectedRevision!==undefined&&before.revision!==args.expectedRevision)fail('document_revision_changed','Project revision differs from the reviewed saved-state request.');
  const sinceRevision=args.sinceRevision??0;
  if(sinceRevision>before.revision)fail('invalid_revision','sinceRevision cannot be newer than the current project revision.');
  const changes=await call('revit.changes.get',{documentIdentity:before.identity,sinceRevision,limit:args.limit??100},signal);
  if(!changes||typeof changes!=='object'||typeof changes.documentIdentity!=='string')fail('invalid_verification_response','Native history lacks document identity.');
  if(changes.documentIdentity!==before.identity)fail('document_changed','Change history belongs to a different project.');
  const history=changes.history&&typeof changes.history==='object'?changes.history:changes;
  if(!revision.safeParse(history.currentRevision).success)fail('invalid_verification_response','Native history lacks a valid currentRevision.');
  if(history.currentRevision!==before.revision)fail('document_revision_changed','Change history was read from a different project revision.');
  const after=documentSnapshot(await call('revit.context.get',{},signal));
  if(after.identity!==before.identity)fail('document_changed','Active document changed while reading saved-state evidence.');
  if(after.revision!==before.revision)fail('document_revision_changed','Project revision changed while reading saved-state evidence.');
  if(after.isModified!==before.isModified||after.path!==before.path)fail('saved_state_changed','Saved/unsaved state or document path changed while reading saved-state evidence.');
  const historyTruncated=history.hasMore===true||history.historyComplete===false||history.changes?.some?.(record=>record.elementIdsTruncated===true)===true;
  const historyComplete=typeof history.historyComplete==='boolean'&&typeof history.hasMore==='boolean'?history.historyComplete&&!historyTruncated:null;
  return {workflowId:'verification.saved',planningMode:'explicit',documentIdentity:after.identity,revision:after.revision,
    saved:after.isModified===null?null:!after.isModified,isModified:after.isModified,saveState:after.isModified===null?'unknown':after.isModified?'unsaved_changes':'no_pending_changes',
    sinceRevision,changes,historyComplete,historyTruncated,persistenceVerified:false,automaticSave:false,planCreated:false,
    note:'Read-only current-session state only. isModified=false means no pending changes; it does not prove disk contents or close/reopen persistence. Unknown native state remains unknown. The plugin never saves or opens another RVT.'};
}
