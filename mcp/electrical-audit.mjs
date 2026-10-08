import {z} from 'zod';

const identity=z.string().min(1).max(200).refine(value=>value.trim().length>0,'Read the current documentIdentity; it cannot be blank.');
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nativeFields={circuitIds:z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(200).refine(ids=>new Set(ids).size===ids.length,'Circuit IDs must be unique.').optional(),
 maxCircuits:z.number().int().min(1).max(200).optional(),maxMembersPerCircuit:z.number().int().min(1).max(500).optional(),maxParametersPerCircuit:z.number().int().min(1).max(128).optional()};
const bounded=input=>!input.circuitIds||input.circuitIds.length<=(input.maxCircuits??100);
export const electricalAuditInputSchema=z.object({documentIdentity:identity.optional(),expectedRevision:revision.optional(),...nativeFields}).strict().refine(bounded,'Selected circuits exceed maxCircuits.');
export const electricalAuditSchema=z.object({documentIdentity:identity,expectedRevision:revision.optional(),...nativeFields}).strict().refine(bounded,'Selected circuits exceed maxCircuits.');
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function contextPin(context,expected){
 if(context?.active===false)fail('no_active_document','Open the reviewed project before auditing electrical circuits.');
 if(context?.active!==true||typeof context.document?.identity!=='string'||!context.document.identity.trim()||!Number.isSafeInteger(context.document.revision)||context.document.revision<0)fail('electrical_audit_context_invalid','Native context lacks a verified project identity or revision.');
 if(context.document.identity!==expected.documentIdentity)fail('document_changed','The electrical audit active project differs from the reviewed identity.');
 if(expected.expectedRevision!==undefined&&context.document.revision!==expected.expectedRevision)fail('document_revision_changed','The electrical audit project changed since the reviewed context.');
}

export async function auditElectrical(request,call,signal){
 const input=electricalAuditSchema.parse(request);signal?.throwIfAborted();
 const before=await call('revit.context.get',{},signal);contextPin(before,input);
 const pin={documentIdentity:before.document.identity,expectedRevision:before.document.revision};
 const report=await call('revit.electrical.audit',{...input,...pin},signal);
 if(report.documentIdentity!==pin.documentIdentity||report.documentRevision!==pin.expectedRevision)fail('electrical_audit_scope_mismatch','Native electrical audit does not identify the reviewed project and revision.');
 if(report.snapshotPolicy!=='ui-thread-json-v1')fail('electrical_audit_snapshot_unknown','The native electrical audit did not verify its UI-thread data snapshot.');
 const after=await call('revit.context.get',{},signal);contextPin(after,pin);
 if(after.document.path!==before.document.path||after.document.isModified!==before.document.isModified)fail('electrical_audit_state_changed','The electrical audit document path or saved state changed; discard this report.');
 return {...report,status:'read_only_result',workflowId:'electrical.audit',readOnly:true,planCreated:false,requiresClarification:false,questions:[],assumptions:[],candidateOnly:false,
  auditConsistency:{documentIdentityVerified:true,documentRevisionVerified:true,uiThreadSnapshotVerified:true,
   pathVerified:typeof before.document.path==='string'&&typeof after.document.path==='string',
   savedStateVerified:typeof before.document.isModified==='boolean'&&typeof after.document.isModified==='boolean'},engineeringComplianceVerified:false};
}

export async function runElectricalAuditWorkflow(args,call,signal){
 const input=electricalAuditInputSchema.parse(args.input||{});
 if(input.documentIdentity!==undefined&&input.documentIdentity!==args.documentIdentity)fail('electrical_audit_input_conflict','Conflicting workflow and electrical audit document identities.');
 if(input.expectedRevision!==undefined&&args.expectedRevision!==undefined&&input.expectedRevision!==args.expectedRevision)fail('electrical_audit_input_conflict','Conflicting workflow and electrical audit revisions.');
 return auditElectrical({...input,documentIdentity:args.documentIdentity,expectedRevision:args.expectedRevision??input.expectedRevision},call,signal);
}
