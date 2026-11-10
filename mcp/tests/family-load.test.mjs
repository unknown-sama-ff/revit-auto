import test from 'node:test';
import assert from 'node:assert/strict';
import {familyLoadSchema,loadFamilyOperationSchema,familyLoadOperations,previewFamilyLoads} from '../family-load.mjs';

const asset={familyKey:'pump-main',sha256:'A'.repeat(64),expectedFamilyName:'水泵',expectedCategoryId:-2001160,requiredTypes:['标准']};
const catalog=[asset];const catalogHash='b'.repeat(64);
function base(){return {families:[{familyKey:'pump-main',conflictPolicy:'reject',overwriteTypeParameters:false}]};}
const context={active:true,document:{identity:'doc-a',revision:0,path:'model.rvt',isModified:false,isFamilyDocument:false,isReadOnly:false}};
const pending={planId:'p1',status:'pending',documentIdentity:'doc-a',documentRevision:0,warnings:[]};
const request=()=>({documentIdentity:'doc-a',expectedRevision:0,input:base()});
function fixture(options={}){
 const contexts=options.contexts??[context],calls=[];let contextIndex=0;
 const call=async(method,args)=>{
  calls.push([method,args]);
  if(method==='revit.context.get'){
   if(contextIndex===2&&options.finalError)throw options.finalError;
   return structuredClone(contexts[Math.min(contextIndex++,contexts.length-1)]);
  }
  if(method==='revit.family.library.get'){
   if(options.catalogError)throw options.catalogError;
   return structuredClone(Object.hasOwn(options,'catalog')?options.catalog:{documentIdentity:'doc-a',documentRevision:0,assets:catalog,catalogSha256:catalogHash});
  }
  if(method==='revit.plan.create'){
   if(options.createError)throw options.createError;
   return structuredClone(Object.hasOwn(options,'plan')?options.plan:pending);
  }
  if(method==='revit.plan.cancel'){
   if(options.cancelError)throw options.cancelError;
   return structuredClone(Object.hasOwn(options,'cleanup')?options.cleanup:{status:'cancelled'});
  }
  throw new Error('Unexpected '+method);
 };
 return {call,calls};
}

test('family load schema rejects paths, ids, duplicates, and unsafe overwrite policy',()=>{
 assert.throws(()=>familyLoadSchema.parse({families:[{familyKey:'pump-main',path:'x.rfa',conflictPolicy:'reject',overwriteTypeParameters:false}]}));
 assert.throws(()=>familyLoadSchema.parse({families:[{familyKey:'pump-main',id:1,conflictPolicy:'reject',overwriteTypeParameters:false}]}));
 assert.throws(()=>familyLoadSchema.parse({families:[{familyKey:'pump-main',conflictPolicy:'reject',overwriteTypeParameters:true}]}));
 assert.throws(()=>familyLoadSchema.parse({families:[base().families[0],base().families[0]]}));
});

test('family load operation binding uses only exact approved catalog metadata',()=>{
 const ops=familyLoadOperations(base(),catalog,catalogHash);assert.equal(ops.length,1);assert.equal(ops[0].operationType,'load_family');assert.equal(ops[0].sha256,'a'.repeat(64));assert.equal(ops[0].expectedFamilyName,'水泵');assert.deepEqual(ops[0].requiredTypes,['标准']);
 assert.throws(()=>familyLoadOperations({families:[{familyKey:'unknown',conflictPolicy:'reject',overwriteTypeParameters:false}]},catalog,catalogHash),e=>e.code==='family_not_registered');
 assert.throws(()=>familyLoadOperations(base(),[{...asset,familyKey:'pump-main'},{...asset}],catalogHash),e=>e.code==='invalid_family_library');
});

test('family load preview pins context, reads catalog, creates only a preview',async()=>{
 const f=fixture();const result=await previewFamilyLoads(request(),f.call);
 assert.equal(result.plan.planId,'p1');assert.equal(result.planCreated,true);assert.equal(result.status,'preview');assert.equal(result.documentRevision,0);
 assert.deepEqual(f.calls.map(c=>c[0]),['revit.context.get','revit.family.library.get','revit.context.get','revit.plan.create','revit.context.get']);
 assert.deepEqual(f.calls[1][1],{documentIdentity:'doc-a',expectedRevision:0});assert.equal(f.calls[3][1].expectedRevision,0);
 assert.equal(f.calls.some(c=>c[0]==='revit.plan.confirm'),false);assert.equal(f.calls.some(c=>c[0]==='revit.save'),false);
});

test('family load preview cancels stale plan and rejects changed context',async()=>{
 const stale=fixture({plan:{...pending,documentRevision:1}});
 await assert.rejects(previewFamilyLoads(request(),stale.call),error=>error.code==='document_revision_changed'&&error.details.planId==='p1'&&error.details.previewCleanup.status==='cancelled');
 assert.deepEqual(stale.calls.filter(([method])=>method==='revit.plan.cancel').map(([,args])=>args),[{planId:'p1'}]);
 const wrong=fixture();await assert.rejects(previewFamilyLoads({...request(),documentIdentity:'other'},wrong.call),/Active document differs/);
 assert.deepEqual(wrong.calls.map(([method])=>method),['revit.context.get']);
});

test('family load preview propagates native catalog failure and does not retry or confirm',async()=>{
 const error=Object.assign(new Error('native unavailable'),{code:'family_catalog_unavailable'}),f=fixture({catalogError:error});
 await assert.rejects(previewFamilyLoads(request(),f.call),caught=>caught===error);assert.deepEqual(f.calls.map(([method])=>method),['revit.context.get','revit.family.library.get']);
});

test('family preview refuses unknown context fields and non-writable documents before reading assets',async()=>{
 for(const patch of [{identity:null},{identity:' '},{revision:undefined},{revision:null},{revision:'0'},{revision:-1},{revision:Number.MAX_SAFE_INTEGER+1},{path:undefined},{path:null},{isModified:undefined},{isModified:null},{isFamilyDocument:undefined},{isReadOnly:null}]){
  const f=fixture({contexts:[{active:true,document:{...context.document,...patch}}]});
  await assert.rejects(previewFamilyLoads(request(),f.call),error=>error.code==='planning_context_invalid');
  assert.deepEqual(f.calls.map(([method])=>method),['revit.context.get']);
 }
 for(const [patch,code] of [[{isFamilyDocument:true},'project_document_required'],[{isReadOnly:true},'document_read_only']]){
  const f=fixture({contexts:[{active:true,document:{...context.document,...patch}}]});
  await assert.rejects(previewFamilyLoads(request(),f.call),error=>error.code===code);assert.equal(f.calls.length,1);
 }
 const inactive=fixture({contexts:[{active:false}]});await assert.rejects(previewFamilyLoads(request(),inactive.call),error=>error.code==='no_active_document');
});

test('family preview stops when project identity revision path or save state changes during catalog read',async()=>{
 for(const [patch,code] of [[{identity:'other'},'document_changed'],[{revision:1},'document_revision_changed'],[{path:'other.rvt'},'planning_state_changed'],[{isModified:true},'planning_state_changed'],[{isReadOnly:true},'document_read_only']]){
  const f=fixture({contexts:[context,{active:true,document:{...context.document,...patch}}]});
  await assert.rejects(previewFamilyLoads(request(),f.call),error=>error.code===code);
  assert.deepEqual(f.calls.map(([method])=>method),['revit.context.get','revit.family.library.get','revit.context.get']);
 }
});

test('family preview preserves explicit unsaved project context rather than guessing a path',async()=>{
 const f=fixture({contexts:[{active:true,document:{...context.document,path:'',isModified:true}}]});
 const result=await previewFamilyLoads(request(),f.call);assert.equal(result.planCreated,true);assert.equal(result.documentRevision,0);
});

test('family preview cannot cancel responses without a known native plan ID',async()=>{
 for(const plan of [undefined,null,{}, {...pending,planId:''},{...pending,planId:'  '},{...pending,planId:12}]){
  const f=fixture({plan});await assert.rejects(previewFamilyLoads(request(),f.call),error=>error.code==='invalid_preview_response');
  assert.deepEqual(f.calls.map(([method])=>method),['revit.context.get','revit.family.library.get','revit.context.get','revit.plan.create']);
 }
});

test('family preview discards nonpending wrong-project and unverified-revision native plans once',async()=>{
 for(const [patch,code] of [[{status:undefined},'invalid_preview_response'],[{status:'committed'},'invalid_preview_response'],[{documentIdentity:'other'},'plan_scope_mismatch'],[{documentIdentity:undefined},'plan_scope_mismatch'],[{documentRevision:'0'},'document_revision_changed'],[{documentRevision:undefined},'document_revision_changed']]){
  const f=fixture({plan:{...pending,...patch}});await assert.rejects(previewFamilyLoads(request(),f.call),error=>error.code===code&&error.details.previewCleanup.status==='cancelled');
  assert.equal(f.calls.filter(([method])=>method==='revit.plan.create').length,1);assert.equal(f.calls.filter(([method])=>method==='revit.plan.cancel').length,1);
 }
});

test('family preview cancels known plans after final context changes or unreadable post-preview state',async()=>{
 for(const [patch,code] of [[{identity:'other'},'document_changed'],[{revision:1},'document_revision_changed'],[{path:'other.rvt'},'planning_state_changed'],[{isModified:true},'planning_state_changed'],[{isModified:null},'planning_context_invalid']]){
  const f=fixture({contexts:[context,context,{active:true,document:{...context.document,...patch}}]});
  await assert.rejects(previewFamilyLoads(request(),f.call),error=>error.code===code&&error.details.previewCleanup.status==='cancelled');
  assert.deepEqual(f.calls.map(([method])=>method),['revit.context.get','revit.family.library.get','revit.context.get','revit.plan.create','revit.context.get','revit.plan.cancel']);
 }
 const error=Object.assign(new Error('post-preview transport disconnected'),{code:'bridge_disconnected',details:{native:'preserve'}}),f=fixture({finalError:error});
 await assert.rejects(previewFamilyLoads(request(),f.call),caught=>caught===error&&caught.details.native==='preserve'&&caught.details.previewCleanup.status==='cancelled');
});

test('family preview retains its primary error when cleanup fails or cannot prove cancellation',async()=>{
 const cleanupFailure=Object.assign(new Error('cancel disconnected'),{code:'bridge_unavailable'}),failed=fixture({plan:{...pending,documentRevision:1},cancelError:cleanupFailure});
 await assert.rejects(previewFamilyLoads(request(),failed.call),error=>error.code==='document_revision_changed'&&error.details.planId==='p1'&&error.details.previewCleanup.status==='unknown'&&error.details.previewCleanup.code==='bridge_unavailable'&&error.details.previewCleanup.message==='cancel disconnected');
 assert.equal(failed.calls.filter(([method])=>method==='revit.plan.cancel').length,1);
 for(const cleanup of [undefined,{ok:true},{status:'pending'},{status:'committed'},{status:12}]){
  const f=fixture({plan:{...pending,documentRevision:1},cleanup});
  await assert.rejects(previewFamilyLoads(request(),f.call),error=>error.code==='document_revision_changed'&&error.details.previewCleanup.status==='unknown');
 }
});

test('family preview never retries a failed native plan creation or guesses a cleanup target',async()=>{
 const error=Object.assign(new Error('preview transport lost'),{code:'bridge_disconnected',details:{opaque:'preserve'}}),f=fixture({createError:error});
 await assert.rejects(previewFamilyLoads(request(),f.call),caught=>caught===error&&caught.details.opaque==='preserve');
 assert.deepEqual(f.calls.map(([method])=>method),['revit.context.get','revit.family.library.get','revit.context.get','revit.plan.create']);
});

test('operation schema refuses native ids and invalid category semantics',()=>{
 assert.throws(()=>loadFamilyOperationSchema.parse({...familyLoadOperations(base(),catalog,catalogHash)[0],id:123}));
 assert.throws(()=>loadFamilyOperationSchema.parse({...familyLoadOperations(base(),catalog,catalogHash)[0],expectedCategoryId:1}));
});



