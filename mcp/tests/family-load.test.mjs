import test from 'node:test';
import assert from 'node:assert/strict';
import {familyLoadSchema,loadFamilyOperationSchema,familyLoadOperations,previewFamilyLoads} from '../family-load.mjs';

const asset={familyKey:'pump-main',sha256:'A'.repeat(64),expectedFamilyName:'水泵',expectedCategoryId:-2001160,requiredTypes:['标准']};
const catalog=[asset];
function base(){return {families:[{familyKey:'pump-main',conflictPolicy:'reject',overwriteTypeParameters:false}]};}

test('family load schema rejects paths, ids, duplicates, and unsafe overwrite policy',()=>{
 assert.throws(()=>familyLoadSchema.parse({families:[{familyKey:'pump-main',path:'x.rfa',conflictPolicy:'reject',overwriteTypeParameters:false}]}));
 assert.throws(()=>familyLoadSchema.parse({families:[{familyKey:'pump-main',id:1,conflictPolicy:'reject',overwriteTypeParameters:false}]}));
 assert.throws(()=>familyLoadSchema.parse({families:[{familyKey:'pump-main',conflictPolicy:'reject',overwriteTypeParameters:true}]}));
 assert.throws(()=>familyLoadSchema.parse({families:[base().families[0],base().families[0]]}));
});

test('family load operation binding uses only exact approved catalog metadata',()=>{
 const ops=familyLoadOperations(base(),catalog);assert.equal(ops.length,1);assert.equal(ops[0].operationType,'load_family');assert.equal(ops[0].sha256,'a'.repeat(64));assert.equal(ops[0].expectedFamilyName,'水泵');assert.deepEqual(ops[0].requiredTypes,['标准']);
 assert.throws(()=>familyLoadOperations({families:[{familyKey:'unknown',conflictPolicy:'reject',overwriteTypeParameters:false}]},catalog),e=>e.code==='family_not_registered');
 assert.throws(()=>familyLoadOperations(base(),[{...asset,familyKey:'pump-main'},{...asset}]),e=>e.code==='invalid_family_library');
});

test('family load preview pins context, reads catalog, creates only a preview',async()=>{
 const calls=[];const result=await previewFamilyLoads({documentIdentity:'doc-a',expectedRevision:3,input:base()},async(method,args)=>{calls.push([method,args]);if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:3,isFamilyDocument:false}};if(method==='revit.family.library.get')return {documentIdentity:'doc-a',documentRevision:3,assets:catalog};if(method==='revit.plan.create')return {planId:'p1',documentIdentity:'doc-a',documentRevision:3,warnings:[]};throw new Error('unexpected '+method);});
 assert.equal(result.plan.planId,'p1');assert.deepEqual(calls.map(c=>c[0]),['revit.context.get','revit.family.library.get','revit.plan.create']);assert.equal(calls.some(c=>c[0]==='revit.plan.confirm'),false);assert.equal(calls.some(c=>c[0]==='revit.save'),false);
});

test('family load preview cancels stale plan and rejects changed context',async()=>{
 let contextCalls=0;let cancel;
 await assert.rejects(()=>previewFamilyLoads({documentIdentity:'doc-a',expectedRevision:0,input:base()},async(method,args)=>{if(method==='revit.context.get'){contextCalls++;return {active:true,document:{identity:'doc-a',revision:contextCalls===1?0:1,isFamilyDocument:false}};}if(method==='revit.family.library.get')return {documentIdentity:'doc-a',documentRevision:0,assets:catalog};if(method==='revit.plan.create')return {planId:'p1',documentIdentity:'doc-a',documentRevision:1,warnings:[]};if(method==='revit.plan.cancel'){cancel=args.planId;return {ok:true};}throw new Error('unexpected '+method);}),/Family preview revision differs/);assert.equal(cancel,'p1');
 await assert.rejects(()=>previewFamilyLoads({documentIdentity:'other',input:base()},async method=>{if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:0,isFamilyDocument:false}};throw new Error('should stop');}),/Active document differs/);
});

test('family load preview propagates native catalog failure and does not retry or confirm',async()=>{
 const calls=[];await assert.rejects(()=>previewFamilyLoads({documentIdentity:'doc-a',input:base()},async method=>{calls.push(method);if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:0,isFamilyDocument:false}};const e=new Error('native unavailable');e.code='family_catalog_unavailable';throw e;}),/native unavailable/);assert.deepEqual(calls,['revit.context.get','revit.family.library.get']);
});

test('operation schema refuses native ids and invalid category semantics',()=>{
 assert.throws(()=>loadFamilyOperationSchema.parse({...familyLoadOperations(base(),catalog)[0],id:123}));
 assert.throws(()=>loadFamilyOperationSchema.parse({...familyLoadOperations(base(),catalog)[0],expectedCategoryId:1}));
});



