import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';

const text=z.string().min(1).max(200).refine(v=>v.trim().length>0);
const key=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/i);
const requestId=z.string().uuid().transform(v=>v.toLowerCase());
const run=z.object({mode:z.literal('run').default('run'),requestId,assetKeys:z.array(key).min(1).max(4)
 .refine(v=>new Set(v).size===v.length),expectedCatalogSha256:hash.optional()}).strict();
const status=z.object({mode:z.literal('status'),requestId}).strict();
export const externalFamilyMetadataInputSchema=z.union([run,status]);
export const externalFamilyMetadataRequestSchema=z.union([run.extend({documentIdentity:text,
 expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict(),status]);
const errorSchema=z.object({code:text,message:text}).strict();
const field=value=>z.object({known:z.boolean(),value:value.nullable(),reason:z.string().min(1).max(200).nullable()}).strict()
 .refine(f=>f.known?f.value!==null&&f.reason===null:f.value===null&&f.reason!==null);
const nativeString=z.string().max(300);
const safeCount=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const category=z.object({id:z.number().int().safe(),name:nativeString}).strict();
const familyMetadata=z.object({documentTitle:field(nativeString),ownerFamilyName:field(nativeString),category:field(category),
 typeNames:field(z.array(nativeString).max(2000)),typeCount:field(safeCount)}).strict();
const templateCategories=['OST_Walls','OST_Windows','OST_LightingFixtures'];
const legacySymbolCategory=name=>['门','窗','照明','灯具','电气','图框','结构柱'].some(part=>name.includes(part));
const sourceElementId=z.string().regex(/^[1-9][0-9]{0,18}$/)
 .refine(value=>/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n);
const templateSymbol=z.object({category,familyName:nativeString,typeName:nativeString,sourceElementId}).strict();
const templateCounts=z.array(z.object({category:z.enum(templateCategories),count:safeCount.max(2147483647)}).strict()).length(3)
 .refine(rows=>new Set(rows.map(row=>row.category)).size===3);
const templateMetadata=z.object({documentTitle:field(nativeString),instanceCounts:field(templateCounts),
 symbolScope:field(z.literal('legacy-category-name-contains-v1')),symbols:field(z.array(templateSymbol).max(2000)),symbolCount:field(safeCount)}).strict();
const commonAsset={assetKey:key,status:z.enum(['complete','failed','not-scanned']),
 sourceSha256:hash.nullable(),sourceBytes:safeCount.nullable(),sourceBytesUnchanged:z.boolean().nullable(),
 sourceFormat:field(nativeString),upgradedInMemory:z.boolean().nullable(),openedInBackground:z.boolean(),
 ownershipVerified:z.boolean(),ownedDocumentClosed:z.boolean().nullable(),copyDeleted:z.boolean().nullable(),
 ownershipEvidence:z.object({beforeOpenDocumentCount:safeCount.nullable(),newDocumentVerified:z.boolean(),taskCopyPathVerified:z.boolean(),
  ownedDocumentIdentity:text.nullable(),closeAttempted:z.boolean(),nativeCloseReturned:z.boolean().nullable(),
  ownedDocumentPresentAfterClose:z.boolean().nullable()}).strict(),
 error:errorSchema.nullable(),cleanupError:errorSchema.nullable()};
const asset=z.discriminatedUnion('kind',[
 z.object({...commonAsset,kind:z.literal('rfa'),metadata:familyMetadata}).strict(),
 z.object({...commonAsset,kind:z.literal('rte'),metadata:templateMetadata}).strict(),
 z.object({...commonAsset,kind:z.literal(null),status:z.enum(['failed','not-scanned']),metadata:z.null()}).strict()
]);
const report=z.object({readOnly:z.literal(true),planCreated:z.literal(false),modelWritesRequested:z.literal(false),
 familyLoaded:z.literal(false),automaticSave:z.literal(false),automaticRetry:z.literal(false),
 externalReferenceIsolationVerified:z.literal(false),documentIdentity:text,documentRevision:safeCount,
 catalogSha256:hash.nullable(),activeProjectUnchanged:z.boolean(),existingDocumentsUnchanged:z.boolean(),
 complete:z.boolean(),results:z.array(asset).max(4),errors:z.array(errorSchema).max(8)}).strict();
export const externalFamilyMetadataResponseSchema=z.object({schemaVersion:z.literal(1),requestId,
 state:z.enum(['running','completed','failed','not-found']),automaticRetry:z.literal(false),report:report.nullable()}).strict();
function fail(code,message,details){throw Object.assign(new Error(message),{code,...(details?{details}:{})});}
function pin(context,request){
 const d=context?.document;
 if(context?.active!==true||!d||d.isFamilyDocument!==false||typeof d.identity!=='string'||!d.identity||
  !Number.isSafeInteger(d.revision)||d.revision<0||typeof d.path!=='string'||typeof d.isModified!=='boolean'||
  !Number.isSafeInteger(context.activeView?.id)||!Array.isArray(context.selectedElementIds)||
  context.selectedElementIds.some(v=>!Number.isSafeInteger(v)))
  fail('external_family_context_unknown','The active project context lacks complete read-only pins.');
 if(d.identity!==request.documentIdentity||d.revision!==request.expectedRevision)
  fail('external_family_context_changed','The active project differs from the reviewed request.');
 return {identity:d.identity,revision:d.revision,path:d.path,isModified:d.isModified,
  activeViewId:context.activeView.id,selectedElementIds:[...context.selectedElementIds].sort((a,b)=>a-b)};
}
function validate(value,request){
 if(!value||Buffer.byteLength(JSON.stringify(value),'utf8')>1024*1024||
  Buffer.byteLength(JSON.stringify({content:[{type:'text',text:JSON.stringify(value,null,2)}]}),'utf8')>2*1024*1024||
  !externalFamilyMetadataResponseSchema.safeParse(value).success||value.requestId.toLowerCase()!==request.requestId)
  fail('external_family_response_invalid','External family metadata response or recovery identity is invalid.');
 const r=value.report;
 if(!r){if(value.state==='completed'||request.mode==='run'&&value.state==='not-found')fail('external_family_response_invalid','Run response has no valid report or recovery state.');return value;}
 if(request.mode==='run'&&(r.documentIdentity!==request.documentIdentity||r.documentRevision!==request.expectedRevision||
  !isDeepStrictEqual(r.results.map(v=>v.assetKey),request.assetKeys)||
  request.expectedCatalogSha256&&r.catalogSha256!==null&&r.catalogSha256.toLowerCase()!==request.expectedCatalogSha256.toLowerCase()))
  fail('external_family_response_invalid','Native report is bound to a different project, catalog, or asset selection.');
 if(new Set(r.results.map(v=>v.assetKey)).size!==r.results.length)
  fail('external_family_response_invalid','Native asset results are duplicated.');
 let total=0;
 for(const a of r.results){
  if(a.kind==='rfa'&&a.metadata.typeNames.known){
   if(!a.metadata.typeCount.known||a.metadata.typeCount.value!==a.metadata.typeNames.value.length)
    fail('external_family_response_invalid','Native type list and count differ.');
   total+=a.metadata.typeNames.value.length;
  }
  if(a.kind==='rte'&&a.metadata.symbols.known){
   const rows=a.metadata.symbols.value;
   if(!a.metadata.symbolCount.known||a.metadata.symbolCount.value!==rows.length||
    new Set(rows.map(row=>row.sourceElementId)).size!==rows.length||rows.some(row=>!legacySymbolCategory(row.category.name)))
    fail('external_family_response_invalid','Native template symbol scope, count or source identifiers differ.');
   total+=rows.length;
  }
  if(a.status==='complete'&&(!a.metadata||!Object.values(a.metadata).every(v=>v.known)||!a.sourceSha256||!a.sourceBytes||
   a.sourceBytes>100*1024*1024||a.sourceBytesUnchanged!==true||!a.openedInBackground||!a.ownershipVerified||
   a.ownedDocumentClosed!==true||a.copyDeleted!==true||a.error!==null||a.cleanupError!==null))
   fail('external_family_response_invalid','Complete asset lacks metadata or safe ownership/cleanup evidence.');
  const e=a.ownershipEvidence;
  if(a.status==='complete'&&(!e.newDocumentVerified||!e.taskCopyPathVerified||!e.ownedDocumentIdentity||!e.closeAttempted||
   e.nativeCloseReturned!==true||e.ownedDocumentPresentAfterClose!==false||e.beforeOpenDocumentCount===null))
   fail('external_family_response_invalid','Complete asset lacks native document ownership and close-return evidence.');
 }
 if(total>5000||r.results.reduce((n,a)=>n+(a.sourceBytes??0),0)>200*1024*1024||
  r.complete&&(!r.activeProjectUnchanged||!r.existingDocumentsUnchanged||r.errors.length||
   !r.results.length||r.results.some(a=>a.status!=='complete'))||value.state==='completed'&&!r.complete||
  value.state==='failed'&&r.complete)
  fail('external_family_response_invalid','Native completion, budget, or project preservation evidence is inconsistent.');
 return value;
}

export async function readExternalFamilyMetadata(input,call,signal){
 const request=externalFamilyMetadataRequestSchema.parse(input);
 signal?.throwIfAborted();
 if(request.mode==='status')return validate(await call('revit.external_asset.metadata',request,signal),request);
 const before=pin(await call('revit.context.get',{},signal),request);
 signal?.throwIfAborted();
 let value;
 try{value=await call('revit.external_asset.metadata',request,signal);}
 catch(error){
  // A synchronous native open/close may outlive transport cancellation; never retry it.
  error.details={...(error.details??{}),requestId:request.requestId,automaticRetry:false,
   recovery:{name:'families.external_audit',input:{mode:'status',requestId:request.requestId}}};
  throw error;
 }
 validate(value,request);
 // Cleanup failures must remain visible even if a changed project prevents further reads.
 if(value.state==='failed'||value.state==='running')return value;
 try{
  signal?.throwIfAborted();
  const after=pin(await call('revit.context.get',{},signal),request);
  if(!isDeepStrictEqual(before,after))fail('external_family_context_changed','Active project state changed during external family auditing.');
 }catch(error){
  error.details={...(error.details??{}),requestId:request.requestId,automaticRetry:false,nativeState:value.state,
   recovery:{name:'families.external_audit',input:{mode:'status',requestId:request.requestId}}};
  throw error;
 }
 return value;
}
export function runExternalFamilyMetadataWorkflow(args,call,signal){
 const input=externalFamilyMetadataInputSchema.parse(args.input??{});
 return readExternalFamilyMetadata(input.mode==='status'?input:{...input,documentIdentity:args.documentIdentity,
  expectedRevision:args.expectedRevision},call,signal);
}
