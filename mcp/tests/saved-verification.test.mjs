import test from 'node:test';
import assert from 'node:assert/strict';
import {savedVerificationSchema,verifySaved} from '../saved-verification.mjs';
const base={documentIdentity:'doc-a',expectedRevision:3,sinceRevision:2,limit:20};

test('saved verification reports current saved state and bounded history without plans',async()=>{
 const calls=[];const result=await verifySaved(base,async(method,args)=>{calls.push([method,args]);if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:3,isFamilyDocument:false,isModified:false}};if(method==='revit.changes.get')return {documentIdentity:'doc-a',currentRevision:3,entries:[{revision:3,added:[10],modified:[],deleted:[],transactions:['AI test']}]};throw new Error('unexpected '+method);});
 assert.equal(result.saved,true);assert.equal(result.planCreated,false);assert.deepEqual(calls.map(([method])=>method),['revit.context.get','revit.changes.get','revit.context.get']);assert.deepEqual(calls[1][1],{documentIdentity:'doc-a',sinceRevision:2,limit:20});
});

test('saved verification reports unsaved state and never saves',async()=>{
 const calls=[];const result=await verifySaved({documentIdentity:'doc-a'},async(method)=>{calls.push(method);if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:4,isFamilyDocument:false,isModified:true}};if(method==='revit.changes.get')return {documentIdentity:'doc-a',currentRevision:4,entries:[]};throw new Error('unexpected');});
 assert.equal(result.saved,false);assert.equal(result.isModified,true);assert.equal(result.automaticSave,false);assert.ok(!calls.includes('revit.plan.create'));assert.ok(!calls.includes('revit.save'));
});

test('saved verification rejects identity, revision and invalid baseline before history query',async()=>{
 let calls=0;await assert.rejects(()=>verifySaved({documentIdentity:'other'},async method=>{calls++;if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:0,isFamilyDocument:false,isModified:false}};throw new Error('history must not be queried');}),/Active document differs/);assert.equal(calls,1);
 await assert.rejects(()=>verifySaved({documentIdentity:'doc-a',expectedRevision:1},async method=>{calls++;if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:0,isFamilyDocument:false,isModified:false}};throw new Error('history must not be queried');}),/Project revision differs/);
 await assert.rejects(()=>verifySaved({documentIdentity:'doc-a',sinceRevision:2},async method=>{calls++;if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:1,isFamilyDocument:false,isModified:false}};throw new Error('history must not be queried');}),/sinceRevision/);
});

test('saved verification schema is strict and bounded',()=>{
 assert.throws(()=>savedVerificationSchema.parse({documentIdentity:'doc-a',save:true}));
 assert.throws(()=>savedVerificationSchema.parse({documentIdentity:'doc-a',limit:101}));
 assert.throws(()=>savedVerificationSchema.parse({documentIdentity:'doc-a',sinceRevision:-1}));
});
test('saved verification validates the native nested history revision shape',async()=>{
 await assert.rejects(()=>verifySaved({documentIdentity:'doc-a',expectedRevision:3},async(method)=>{
   if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:3,isFamilyDocument:false,isModified:false}};
   if(method==='revit.changes.get')return {documentIdentity:'doc-a',history:{currentRevision:2,changes:[]}};
   throw new Error('unexpected');
 }),/different project revision/);
});


test('unknown native modified state remains unknown, never clean or persistence-certified',async()=>{
 const r=await verifySaved({documentIdentity:'doc-a'},async method=>method==='revit.context.get'?{active:true,document:{identity:'doc-a',revision:0,isFamilyDocument:false}}:{documentIdentity:'doc-a',history:{currentRevision:0,historyComplete:true,hasMore:false,changes:[]}});
 assert.equal(r.saved,null);assert.equal(r.isModified,null);assert.equal(r.saveState,'unknown');assert.equal(r.persistenceVerified,false);
});
test('element id truncation prevents complete evidence even when transaction history is retained',async()=>{
 const r=await verifySaved({documentIdentity:'doc-a'},async method=>method==='revit.context.get'?{active:true,document:{identity:'doc-a',revision:2,isModified:false}}:{documentIdentity:'doc-a',history:{currentRevision:2,historyComplete:true,hasMore:false,changes:[{elementIdsTruncated:true}]}});
 assert.equal(r.historyComplete,false);assert.equal(r.historyTruncated,true);assert.equal(r.persistenceVerified,false);
});
test('missing history identity or revision cannot certify saved verification',async()=>{
 for(const history of [{history:{currentRevision:0}},{documentIdentity:'doc-a',history:{}}]){
  await assert.rejects(()=>verifySaved({documentIdentity:'doc-a'},async method=>method==='revit.context.get'?{active:true,document:{identity:'doc-a',revision:0,isModified:false}}:history),e=>e.code==='invalid_verification_response');
 }
});
test('SaveAs or document path change without revision invalidates saved snapshot',async()=>{
 let n=0;await assert.rejects(()=>verifySaved({documentIdentity:'doc-a'},async method=>method==='revit.context.get'?{active:true,document:{identity:'doc-a',revision:0,isModified:false,path:++n===1?'before.rvt':'after.rvt'}}:{documentIdentity:'doc-a',history:{currentRevision:0,historyComplete:true,hasMore:false,changes:[]}}),e=>e.code==='saved_state_changed');
});
