import {z} from 'zod';

export const savedVerificationSchema=z.object({
  documentIdentity:z.string().min(1),
  expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  sinceRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  limit:z.number().int().min(1).max(100).optional()
}).strict();
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
export async function verifySaved(raw,call,signal){
  const args=savedVerificationSchema.parse(raw);
  const context=await call('revit.context.get',{},signal);
  if(!context.active||!context.document||context.document.isFamilyDocument)fail('no_active_document','Open a project before checking saved state.');
  if(context.document.identity!==args.documentIdentity)fail('document_changed','Active document differs from the reviewed saved-state request.');
  if(args.expectedRevision!==undefined&&context.document.revision!==args.expectedRevision)fail('document_revision_changed','Project revision differs from the reviewed saved-state request.');
  const sinceRevision=args.sinceRevision??0;
  if(sinceRevision>context.document.revision)fail('invalid_revision','sinceRevision cannot be newer than the current project revision.');
  const changes=await call('revit.changes.get',{documentIdentity:context.document.identity,sinceRevision,limit:args.limit??100},signal);
  if(changes.documentIdentity!==undefined&&changes.documentIdentity!==context.document.identity)fail('document_changed','Change history belongs to a different project.');
  const history=changes.history && typeof changes.history==='object' ? changes.history : changes;
  if(history.currentRevision!==undefined&&history.currentRevision!==context.document.revision)fail('document_revision_changed','Change history was read from a different project revision.');
  return {workflowId:'verification.saved',planningMode:'explicit',documentIdentity:context.document.identity,revision:context.document.revision,saved:context.document.isModified===false,isModified:context.document.isModified===true,sinceRevision,changes,automaticSave:false,planCreated:false,note:'Read-only saved-state evidence. The plugin never saves or opens another RVT; saving remains a user action.'};
}
