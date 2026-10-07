import {z} from 'zod';

const name = z.string().trim().min(1).max(300);
export const familyAuditSchema = z.object({
  names:z.array(name).min(1).max(100).refine(values=>new Set(values).size===values.length,'Duplicate family names are not allowed.'),
  documentIdentity:z.string().trim().min(1).max(200).optional(),
  expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  maxTypesPerFamily:z.number().int().min(1).max(2000).optional()
}).strict();

const TOTAL_LIMIT=5000;
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function assertContext(context,expected){
  if(!context.active||!context.document?.identity)fail('no_active_document','Open a Revit project before auditing families.');
  if(expected.documentIdentity&&expected.documentIdentity!==context.document.identity)fail('document_changed','The active project differs from the reviewed family audit request.');
  if(expected.expectedRevision!==undefined&&expected.expectedRevision!==context.document.revision)fail('document_revision_changed','The project changed before or during the family audit.');
}

// Catalog reads only. Native type IDs are returned as evidence, never chosen or executed.
export async function auditFamilies(request,call,signal){
  const input=familyAuditSchema.parse(request);
  signal?.throwIfAborted();
  const before=await call('revit.context.get',{},signal);
  assertContext(before,input);
  const pin={documentIdentity:before.document.identity,expectedRevision:before.document.revision};
  const limit=input.maxTypesPerFamily??500;
  const results=[];
  let total=0;
  for(const requested of input.names){
    signal?.throwIfAborted();
    if(total>=TOTAL_LIMIT){results.push({requested,status:'not_scanned',candidates:[],complete:false,hasMore:true});continue;}
    const candidates=[],seen=new Set();
    let offset=0,hasMore=false;
    do{
      signal?.throwIfAborted();
      const pageLimit=Math.min(500,limit-candidates.length,TOTAL_LIMIT-total);
      const page=await call('revit.search',{family:requested,types:true,limit:pageLimit,offset},signal);
      if(!Array.isArray(page.items)||typeof page.hasMore!=='boolean')fail('invalid_audit_response','Native family search returned an incomplete page.');
      if(page.items.length>pageLimit)fail('invalid_audit_response','Native search exceeded the declared page limit.');
      for(const row of page.items){
        if(!Number.isSafeInteger(row.id)||row.id<=0||row.className!=='FamilySymbol'||row.family!==requested||seen.has(row.id))
          fail('invalid_audit_response','Native exact-family search returned an unrelated or repeated symbol.');
        seen.add(row.id);candidates.push(row);total++;
      }
      hasMore=page.hasMore;
      if(hasMore&&!page.items.length)fail('invalid_audit_response','Native family search stalled; no complete absence can be certified.');
      offset+=page.items.length;
      assertContext(await call('revit.context.get',{},signal),pin);
    }while(hasMore&&candidates.length<limit&&total<TOTAL_LIMIT);
    results.push({requested,status:hasMore?'partial':candidates.length?'found':'missing',candidates,complete:!hasMore,hasMore});
  }
  const after=await call('revit.context.get',{},signal);
  assertContext(after,pin);
  if(after.document.isModified!==before.document.isModified)fail('audit_state_changed','Model saved state changed during a read-only family audit.');
  const complete=results.every(row=>row.complete);
  return {status:'read_only_result',workflowId:'families.audit',documentIdentity:pin.documentIdentity,documentRevision:pin.expectedRevision,
    readOnly:true,planCreated:false,requiresClarification:false,questions:[],assumptions:[],candidateOnly:false,
    results,complete,truncated:!complete,returnedTypeCount:total,limits:{maxTypesPerFamily:limit,maxTotalTypes:TOTAL_LIMIT},
    note:'Exact family names only. Symbols are catalog evidence, not a selected type. Missing/partial results do not load files or create a model plan.'};
}
