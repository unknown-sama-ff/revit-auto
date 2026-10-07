import {z} from 'zod';
const familyKey=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const sha256=z.string().regex(/^[0-9a-fA-F]{64}$/);
const text=z.string().trim().min(1).max(200);
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
 const input=familyLoadSchema.parse(args.input||{});
 const before=await call('revit.context.get',{},signal);
 if(!before.active||before.document?.isFamilyDocument)fail('no_active_document','Open a project for family-load preview.');
 if(before.document.identity!==args.documentIdentity)fail('document_changed','Active document differs from reviewed family-load request.');
 if(args.expectedRevision!==undefined&&before.document.revision!==args.expectedRevision)fail('document_revision_changed','Project changed before family-load preview.');
 const pin={documentIdentity:before.document.identity,expectedRevision:before.document.revision};
 const catalog=await call('revit.family.library.get',pin,signal);
 if(catalog.documentIdentity!==pin.documentIdentity||catalog.documentRevision!==pin.expectedRevision)fail('document_changed','Family library response belongs to a changed project.');
 if(catalog.catalogSha256===undefined)fail('feature_not_loaded','The running host lacks family-catalog-snapshot protection. Load the updated plugin before family preview; no plan created.');
 const operations=familyLoadOperations(input,catalog.assets,catalog.catalogSha256);
 const summary=[args.summary||'受控本机族库加载',...operations.map(op=>op.expectedFamilyName+' ['+op.familyKey+'] '+op.conflictPolicy+'; overwriteTypeParameters='+op.overwriteTypeParameters),
  '仅预览；字节哈希绑定，原生族名/类别/类型执行核验；不放置实例、不自动保存。'].join('；');
 const plan=await call('revit.plan.create',{...pin,summary,source:'workflow:families.load:explicit',operations},signal);
 if(plan.documentIdentity!==pin.documentIdentity||plan.documentRevision!==pin.expectedRevision){
  await call('revit.plan.cancel',{planId:plan.planId},signal);fail('document_revision_changed','Family preview revision differs; review a new plan, no load committed.');
 }
 return {workflowId:'families.load',planningMode:'explicit',requiresClarification:false,questions:[],assumptions:[],candidateOnly:false,
  warnings:plan.warnings||[],missingInputs:[],alternatives:[],plan,reviewNote:'Loading may replace existing type geometry/parameters only under the explicit policy; native impacts appear in plan warnings. Shared families are refused. Chat confirmation of this exact plan is required.'};
}
