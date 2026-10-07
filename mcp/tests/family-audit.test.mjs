import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFamilies,familyAuditSchema} from '../family-audit.mjs';
import {buildRegisteredWorkflow} from '../workflow-adapter.mjs';
const context={active:true,document:{identity:'doc-a',revision:0,isModified:false}};
const symbol=(id,family='Pump')=>({id,family,className:'FamilySymbol',name:'Type '+id});
const clone=value=>structuredClone(value);
function fixture(search,contexts=[context]){
  const calls=[];let index=0;
  const call=async(method,args,signal)=>{calls.push({method,args,signal});if(method==='revit.context.get')return clone(contexts[Math.min(index++,contexts.length-1)]);if(method==='revit.search')return search(args);throw new Error('Unsafe/non-read request: '+method);};
  return {call,calls};
}

test('family catalog uses native exact family search and never guesses a type',async()=>{
 const f=fixture(args=>({items:args.family==='Pump'?[symbol(1),symbol(2)]:[],hasMore:false}));
 const r=await auditFamilies({names:['Pump','Missing'],documentIdentity:'doc-a',expectedRevision:0},f.call);
 assert.deepEqual(r.results.map(i=>i.status),['found','missing']);assert.equal(r.results[0].candidates.length,2);
 assert.equal(r.planCreated,false);assert.equal(r.readOnly,true);assert.equal(r.complete,true);assert.equal(r.returnedTypeCount,2);
 assert.ok(f.calls.filter(c=>c.method==='revit.search').every(c=>c.args.family&&!Object.hasOwn(c.args,'query')));
 assert.ok(f.calls.every(c=>['revit.context.get','revit.search'].includes(c.method)));
});
test('family catalog reads all native pages up to declared maximum',async()=>{
 const all=Array.from({length:601},(_,i)=>symbol(i+1));const f=fixture(({offset,limit})=>({items:all.slice(offset,offset+limit),hasMore:offset+limit<all.length}));
 const r=await auditFamilies({names:['Pump'],maxTypesPerFamily:1000},f.call);
 assert.equal(r.results[0].status,'found');assert.equal(r.results[0].candidates.length,601);assert.equal(r.complete,true);
 assert.deepEqual(f.calls.filter(c=>c.method==='revit.search').map(c=>[c.args.offset,c.args.limit]),[[0,500],[500,500]]);
});
test('default family cap returns partial instead of absence or complete catalog',async()=>{
 const f=fixture(()=>({items:Array.from({length:500},(_,i)=>symbol(i+1)),hasMore:true}));const r=await auditFamilies({names:['Pump']},f.call);
 assert.equal(r.results[0].status,'partial');assert.equal(r.results[0].hasMore,true);assert.equal(r.truncated,true);assert.equal(r.complete,false);
});
test('global catalog budget leaves later families explicitly not scanned',async()=>{
 const names=['F1','F2','F3','F4'];const f=fixture(({family,offset,limit})=>({items:Array.from({length:limit},(_,i)=>symbol(Number(family.slice(1))*10000+offset+i+1,family)),hasMore:offset+limit<2000}));
 const r=await auditFamilies({names,maxTypesPerFamily:2000},f.call);
 assert.equal(r.returnedTypeCount,5000);assert.deepEqual(r.results.map(i=>i.status),['found','found','partial','not_scanned']);assert.equal(r.truncated,true);
});
test('stale audit identity and revision rejected before search',async()=>{
 for(const [request,code] of [[{documentIdentity:'old'},'document_changed'],[{expectedRevision:1},'document_revision_changed']]){
  const f=fixture(()=>{throw Error('Must not search');});await assert.rejects(auditFamilies({names:['Pump'],...request},f.call),e=>e.code===code);assert.deepEqual(f.calls.map(c=>c.method),['revit.context.get']);
 }
});
test('changed document during paginated audit discards result',async()=>{
 const changed={active:true,document:{identity:'doc-b',revision:0,isModified:false}};const f=fixture(()=>({items:[symbol(1)],hasMore:false}),[context,changed]);
 await assert.rejects(auditFamilies({names:['Pump']},f.call),e=>e.code==='document_changed');
});
test('changed revision during read-only audit discards result',async()=>{
 const changed={active:true,document:{identity:'doc-a',revision:1,isModified:false}};const f=fixture(()=>({items:[symbol(1)],hasMore:false}),[context,changed]);
 await assert.rejects(auditFamilies({names:['Pump']},f.call),e=>e.code==='document_revision_changed');
});
test('changed saved-state does not silently certify query',async()=>{
 const changed={active:true,document:{identity:'doc-a',revision:0,isModified:true}};const f=fixture(()=>({items:[],hasMore:false}),[context,context,changed]);
 await assert.rejects(auditFamilies({names:['Pump']},f.call),e=>e.code==='audit_state_changed');
});
test('no document is reported rather than treated as empty library',async()=>{
 const f=fixture(()=>({items:[],hasMore:false}),[{active:false}]);await assert.rejects(auditFamilies({names:['Pump']},f.call),e=>e.code==='no_active_document');
});
test('unrelated or duplicate native symbols and stalled pagination are rejected',async()=>{
 for(const page of [{items:[symbol(1,'Other')],hasMore:false},{items:[symbol(1),symbol(1)],hasMore:false},{items:[],hasMore:true},{items:[],hasMore:'unknown'}]){
  const f=fixture(()=>page);await assert.rejects(auditFamilies({names:['Pump']},f.call),e=>e.code==='invalid_audit_response');
 }
});
test('audit schema rejects executable paths, blank/duplicate names and unsafe revisions',()=>{
 for(const request of [{names:[]},{names:[' ']},{names:['Pump','Pump']},{names:['Pump'],filePath:'x.csx'},{names:['Pump'],code:'write'},{names:['Pump'],expectedRevision:-1},{names:['Pump'],expectedRevision:1.5},{names:['Pump'],expectedRevision:Number.MAX_SAFE_INTEGER+1},{names:['Pump'],maxTypesPerFamily:0},{names:['Pump'],maxTypesPerFamily:2001}])assert.equal(familyAuditSchema.safeParse(request).success,false);
});
test('pre-aborted audit sends no native request',async()=>{
 const controller=new AbortController();controller.abort();const f=fixture(()=>({items:[],hasMore:false}));await assert.rejects(auditFamilies({names:['Pump']},f.call,controller.signal));assert.equal(f.calls.length,0);
});
test('read-only registry adapters cannot use a modeling builder',()=>{
 assert.throws(()=>buildRegisteredWorkflow('families.audit',{names:['Pump']}),e=>e.code==='workflow_read_only');
});
