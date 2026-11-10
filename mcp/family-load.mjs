import {z} from 'zod';
const familyKey=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const sha256=z.string().regex(/^[0-9a-fA-F]{64}$/);
const text=z.string().trim().min(1).max(200);
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const category=z.number().int().negative().min(-10000000);
const types=z.array(text).min(1).max(200).refine(v=>new Set(v).size===v.length,'Required types must be distinct.');
export const familyLoadSchema=z.object({
  families:z.array(z.object({familyKey,conflictPolicy:z.enum(['reject','keep_existing','replace']),overwriteTypeParameters:z.boolean()}).strict()
    .refine(row=>row.conflictPolicy==='replace'||row.overwriteTypeParameters===false,'Only replace may overwrite type parameters.'))
    .min(1).max(50).refine(rows=>new Set(rows.map(r=>r.familyKey)).size===rows.length,'Duplicate family keys in load request.')
}).strict();
const assetSchema=z.object({familyKey,sha256,expectedFamilyName:text,expectedCategoryId:category,requiredTypes:types});
export const loadFamilyOperationSchema=z.object({operationType:z.literal('load_family'),familyKey,sha256,catalogSha256:sha256,
  expectedFamilyName:text,expectedCategoryId:category,requiredTypes:types,conflictPolicy:z.enum(['reject','keep_existing','replace']),overwriteTypeParameters:z.boolean()})
  .strict().refine(row=>row.conflictPolicy==='replace'||!row.overwriteTypeParameters,'Only replace may overwrite type parameters.');
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function documentSnapshot(context,args){
 if(context?.active===false)fail('no_active_document','Open a project for family-load preview.');
 const doc=context?.document;
 if(context?.active!==true||typeof doc?.identity!=='string'||!doc.identity.trim()||!revision.safeParse(doc.revision).success||
   typeof doc.path!=='string'||typeof doc.isModified!=='boolean'||typeof doc.isFamilyDocument!=='boolean'||typeof doc.isReadOnly!=='boolean')
  fail('planning_context_invalid','Native context lacks verified project identity, revision, path, saved state or writable project flags.');
 if(doc.identity!==args.documentIdentity)fail('document_changed','Active document differs from reviewed family-load request.');
 if(args.expectedRevision!==undefined&&doc.revision!==args.expectedRevision)fail('document_revision_changed','Project changed before family-load preview.');
 if(doc.isFamilyDocument)fail('project_document_required','Open a project instead of the family editor for family-load preview.');
 if(doc.isReadOnly)fail('document_read_only','The active project cannot accept a family load.');
 return {identity:doc.identity,revision:doc.revision,path:doc.path,isModified:doc.isModified};
}
function assertStable(before,after){
 if(after.path!==before.path||after.isModified!==before.isModified)
  fail('planning_state_changed','Project path or saved state changed while preparing the family-load preview.');
}
export function familyLoadOperations(input,assets,catalogSha256){
 const pinnedCatalogHash=sha256.parse(catalogSha256).toLowerCase();
 const request=familyLoadSchema.parse(input);
 const catalog=z.array(assetSchema).max(1000).parse(assets);
 if(new Set(catalog.map(a=>a.familyKey)).size!==catalog.length)fail('invalid_family_library','Native catalog contains duplicate keys.');
 return request.families.map(row=>{
  const asset=catalog.find(a=>a.familyKey===row.familyKey);
  if(!asset)fail('family_not_registered','Requested familyKey is not in the local approved catalog.');
  return loadFamilyOperationSchema.parse({operationType:'load_family',catalogSha256:pinnedCatalogHash,familyKey:asset.familyKey,sha256:asset.sha256.toLowerCase(),expectedFamilyName:asset.expectedFamilyName,
   expectedCategoryId:asset.expectedCategoryId,requiredTypes:[...asset.requiredTypes],conflictPolicy:row.conflictPolicy,overwriteTypeParameters:row.overwriteTypeParameters});
 });
}
export async function previewFamilyLoads(args,call,signal){
 signal?.throwIfAborted();
 text.parse(args.documentIdentity);
 if(args.expectedRevision!==undefined)revision.parse(args.expectedRevision);
 const input=familyLoadSchema.parse(args.input||{});
 const before=documentSnapshot(await call('revit.context.get',{},signal),args);
 const pin={documentIdentity:before.identity,expectedRevision:before.revision};
 const catalog=await call('revit.family.library.get',pin,signal);
 if(!catalog||typeof catalog!=='object')fail('invalid_family_library','Native catalog did not return a library snapshot.');
 if(catalog.documentIdentity!==pin.documentIdentity||catalog.documentRevision!==pin.expectedRevision)fail('document_changed','Family library response belongs to a changed project.');
 if(catalog.catalogSha256===undefined)fail('feature_not_loaded','The running host lacks family-catalog-snapshot protection. Load the updated plugin before family preview; no plan created.');
 const operations=familyLoadOperations(input,catalog.assets,catalog.catalogSha256);
 assertStable(before,documentSnapshot(await call('revit.context.get',{},signal),pin));
 const summary=[args.summary||'受控本机族库加载',...operations.map(op=>op.expectedFamilyName+' ['+op.familyKey+'] '+op.conflictPolicy+'; overwriteTypeParameters='+op.overwriteTypeParameters),
  '仅预览；字节哈希绑定，原生族名/类别/类型执行核验；不放置实例、不自动保存。'].join('；');
 const plan=await call('revit.plan.create',{...pin,summary,source:'workflow:families.load:explicit',operations},signal);
 try{
  if(!plan||typeof plan.planId!=='string'||!plan.planId.trim()||plan.status!=='pending')
   fail('invalid_preview_response','Native host did not return an identifiable pending family preview.');
  if(plan.documentIdentity!==pin.documentIdentity)fail('plan_scope_mismatch','Family preview belongs to a different project.');
  if(plan.documentRevision!==pin.expectedRevision)fail('document_revision_changed','Family preview revision differs; review a new plan, no load committed.');
  assertStable(before,documentSnapshot(await call('revit.context.get',{},signal),pin));
 }catch(error){
  if(typeof plan?.planId==='string'&&plan.planId.trim()){
   const details={...error.details,planId:plan.planId};
   try{
    const cleanup=await call('revit.plan.cancel',{planId:plan.planId},signal);
    details.previewCleanup={attempted:true,status:cleanup?.status==='cancelled'?'cancelled':'unknown'};
   }catch(cleanupError){
    details.previewCleanup={attempted:true,status:'unknown',code:cleanupError?.code??'cancel_failed',message:cleanupError?.message??String(cleanupError)};
   }
   error.details=details;
  }
  throw error;
 }
 return {workflowId:'families.load',planningMode:'explicit',requiresClarification:false,questions:[],assumptions:[],candidateOnly:false,
  status:'preview',planCreated:true,documentIdentity:pin.documentIdentity,documentRevision:pin.expectedRevision,
  warnings:plan.warnings||[],missingInputs:[],alternatives:[],plan,reviewNote:'Loading may replace existing type geometry/parameters only under the explicit policy; native impacts appear in plan warnings. Shared families are refused. Chat confirmation of this exact plan is required.'};
}
