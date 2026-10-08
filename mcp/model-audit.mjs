import {z} from 'zod';

const auditInputSchema=z.object({documentIdentity:z.string().min(1).optional(),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()}).strict();
function fail(code,message){const error=new Error(message);error.code=code;throw error;}

function requireContext(context){
  if(context?.active===false)fail('no_active_document','Open the reviewed project before auditing.');
  if(context?.active!==true || typeof context.document?.identity!=='string' || !context.document.identity.trim() || !Number.isSafeInteger(context.document.revision) || context.document.revision<0)fail('audit_context_invalid','Native context lacks a verified document identity or revision; no audit snapshot can be certified.');
}

// Controlled read adapter: never execute a legacy script or produce a model plan.
export async function runModelAuditWorkflow(args,call,signal){
  const input=auditInputSchema.parse(args.input||{});
  if(input.documentIdentity!==undefined && input.documentIdentity!==args.documentIdentity)fail('audit_input_conflict','Conflicting workflow and audit document identities.');
  if(input.expectedRevision!==undefined && args.expectedRevision!==undefined && input.expectedRevision!==args.expectedRevision)fail('audit_input_conflict','Conflicting workflow and audit revisions.');
  const expectedRevision=args.expectedRevision??input.expectedRevision;
  const before=await call('revit.context.get',{},signal);
  requireContext(before);
  if(before.document?.identity!==args.documentIdentity)fail('document_changed','The active project is not the reviewed audit document.');
  if(expectedRevision!==undefined && before.document?.revision!==expectedRevision)fail('document_revision_changed','The audit project changed after the reviewed context.');
  const report=await call('revit.audit.run',{},signal);
  if(report.documentIdentity!==before.document.identity)fail('audit_scope_mismatch','Native audit evidence does not identify the reviewed project.');
  if(report.documentRevision!==undefined && report.documentRevision!==before.document.revision)fail('audit_scope_mismatch','Native audit evidence identifies a different model revision.');
  const after=await call('revit.context.get',{},signal);
  requireContext(after);
  if(after.document?.identity!==before.document.identity)fail('document_changed','The active project changed during the audit; discard this report.');
  if(after.document?.revision!==before.document.revision)fail('document_revision_changed','The model revision changed during the audit; discard this report.');
  if(after.document?.path!==before.document.path || after.document?.isModified!==before.document.isModified)fail('audit_state_changed','The document path or saved state changed during the audit; discard this report.');
  return {...report,status:'read_only_result',workflowId:'audit',documentRevision:before.document.revision,readOnly:true,planCreated:false,
    auditConsistency:{documentIdentityVerified:true,documentRevisionVerified:true,uiThreadSnapshotVerified:report.snapshotPolicy==='ui-thread-json-v1',
      pathVerified:typeof before.document.path==='string' && typeof after.document.path==='string',
      savedStateVerified:typeof before.document.isModified==='boolean' && typeof after.document.isModified==='boolean'},
    warningsTruncated:Number.isSafeInteger(report.warningCount) && Array.isArray(report.warnings) ? report.warningCount>report.warnings.length : null,
    engineeringComplianceVerified:false};
}
