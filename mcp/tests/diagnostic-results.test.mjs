import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagnosticResultStore} from '../diagnostic-results.mjs';
import {runDiagnosticsWorkflow} from '../diagnostics-query.mjs';

const mvid='11111111-2222-4333-8444-555555555555';
const doc=()=>({identity:'doc-a',revision:3,title:'test',path:'test.rvt',isModified:false,isReadOnly:false,isFamilyDocument:false});
const scope=()=>({moduleVersionId:mvid,pid:42,document:doc()});
const capture=()=>({scope:scope(),report:{readOnly:true,planCreated:false,planningMode:'explicit',candidateOnly:false,
 documentIdentity:'doc-a',documentRevision:3,search:{items:[{id:1,value:'original'},{id:2},{id:3}],offset:0,hasMore:true},inspected:null},
 sourceQuery:{search:{query:'泵',offset:0},inspectElementIds:[]}});
const page=handle=>({resultHandle:handle,section:'search',offset:0,limit:2});

test('captured result and returned pages are detached from input and caller mutations',()=>{
 const store=new DiagnosticResultStore(),input=capture(),summary=store.put(input);
 input.report.search.items[0].value='mutated';input.scope.document.title='mutated';
 const first=store.page(page(summary.resultHandle),scope());assert.equal(first.items[0].value,'original');
 first.items[0].value='mutated page';assert.equal(store.page(page(summary.resultHandle),scope()).items[0].value,'original');
 assert.equal(first.snapshotSha256,summary.snapshotSha256);assert.equal(first.writeAuthorization,false);
});
test('cache pagination preserves native truncation and never claims the full matching set',()=>{
 const store=new DiagnosticResultStore(),summary=store.put(capture());
 assert.equal(summary.sections.search.matchingSetComplete,false);assert.equal(summary.sections.search.nativeHasMore,true);
 const end=store.page({...page(summary.resultHandle),offset:2},scope());assert.equal(end.returnedCount,1);assert.equal(end.hasMore,false);
 assert.equal(end.sourceSearchHasMore,true);assert.equal(end.capturedCount,3);
 assert.throws(()=>store.page({...page(summary.resultHandle),section:'inspected'},scope()),{code:'diagnostic_result_section_absent'});
 assert.throws(()=>store.page({...page(summary.resultHandle),offset:4},scope()),{code:'diagnostic_result_offset_invalid'});
 assert.equal(store.page({...page(summary.resultHandle),offset:3},scope()).returnedCount,0);
});
test('all document and plugin pins must match before any cached record is returned',()=>{
 const store=new DiagnosticResultStore(),summary=store.put(capture());
 for(const edit of [s=>s.document.identity='other',s=>s.document.revision++,s=>s.document.path='other.rvt',s=>s.document.title='other',
  s=>s.document.isModified=true,s=>s.document.isReadOnly=true,s=>s.pid++,s=>s.moduleVersionId='66666666-7777-4888-8999-aaaaaaaaaaaa']){
  const s=scope();edit(s);assert.throws(()=>store.page(page(summary.resultHandle),s),{code:'diagnostic_result_scope_changed'});
 }
});
test('TTL uses the monotonic clock and reads do not extend retention',()=>{
 let time=0;const store=new DiagnosticResultStore({ttlMs:100,clock:()=>time,wallClock:()=>1000});
 const summary=store.put(capture());time=90;assert.equal(store.page(page(summary.resultHandle),scope()).returnedCount,2);
 time=100;assert.throws(()=>store.page(page(summary.resultHandle),scope()),{code:'diagnostic_result_expired'});
 assert.equal(store.stats.entries,0);assert.throws(()=>store.page(page(summary.resultHandle),scope()),{code:'diagnostic_result_unknown'});
});
test('FIFO eviction and serialized payload budgets bound retained data',()=>{
 const store=new DiagnosticResultStore({maxEntries:2}),a=store.put(capture()),b=store.put(capture());store.put(capture());
 assert.throws(()=>store.page(page(a.resultHandle),scope()),{code:'diagnostic_result_unknown'});
 assert.equal(store.page(page(b.resultHandle),scope()).returnedCount,2);assert.equal(store.stats.entries,2);
 const tiny=new DiagnosticResultStore({maxResultBytes:1});assert.throws(()=>tiny.put(capture()),{code:'diagnostic_result_too_large'});assert.equal(tiny.stats.entries,0);
 const cap=new DiagnosticResultStore({maxBytes:2048,maxResultBytes:2048});for(let i=0;i<10;i++)cap.put(capture());
 assert.ok(cap.stats.serializedBytes<=2048);
});
test('page response size refuses overflow without silently trimming records',()=>{
 const store=new DiagnosticResultStore({maxPageBytes:100}),summary=store.put(capture());
 assert.throws(()=>store.page(page(summary.resultHandle),scope()),{code:'diagnostic_result_page_too_large'});
 assert.equal(store.stats.entries,1);
});
test('unknown native pagination and nonzero source offset cannot become complete matching sets',()=>{
 const store=new DiagnosticResultStore(),unknown=capture();delete unknown.report.search.hasMore;
 assert.equal(store.put(unknown).sections.search.matchingSetComplete,null);
 const tail=capture();tail.report.search.hasMore=false;tail.sourceQuery.search.offset=10;tail.report.search.offset=10;
 assert.equal(store.put(tail).sections.search.matchingSetComplete,false);
 const complete=capture();complete.report.search.hasMore=false;
 assert.equal(store.put(complete).sections.search.matchingSetComplete,true);
});
test('response cap accounts for pretty MCP text escaping rather than only compact payload bytes',()=>{
 const store=new DiagnosticResultStore({maxPageBytes:1500}),input=capture();
 input.report.search.items=[{value:'\n'.repeat(500)}];const r=store.put(input);
 assert.throws(()=>store.page({...page(r.resultHandle),limit:1},scope()),{code:'diagnostic_result_page_too_large'});
});
test('invalid JSON and non-readonly reports never publish a handle',()=>{
 for(const edit of [v=>v.report.readOnly=false,v=>v.report.planCreated=true,v=>v.report.documentRevision=9,
  v=>v.report.search.items.push({bad:NaN}),v=>v.report.search.items.push({bad:undefined})]){
  const store=new DiagnosticResultStore(),input=capture();edit(input);assert.throws(()=>store.put(input),{code:'diagnostic_result_invalid'});assert.equal(store.stats.entries,0);
 }
});
test('summary keeps assisted assumptions and refuses oversize metadata before publishing or evicting',()=>{
 const store=new DiagnosticResultStore(),input=capture();input.report.planningMode='assisted';input.report.candidateOnly=true;input.report.assumptions=['Reviewed scope'];
 const r=store.put(input);input.report.assumptions[0]='mutated';assert.deepEqual(r.assumptions,['Reviewed scope']);assert.equal(r.candidateOnly,true);
 const oversized=capture();oversized.report.assumptions=['X'.repeat(300000)];
 assert.throws(()=>store.put(oversized),{code:'diagnostic_result_summary_too_large'});assert.equal(store.stats.entries,1);
 assert.equal(store.page(page(r.resultHandle),scope()).returnedCount,2);
});

function fixture(){
 const calls=[],context={active:true,document:doc()},plugin={protocol:'revit-auto-2027-v2',moduleVersionId:mvid,pid:42};
 const call=async(m,a)=>{calls.push(m);if(m==='revit.bridge.info')return structuredClone(plugin);if(m==='revit.context.get')return structuredClone(context);
  if(m==='revit.search')return capture().report.search;if(m==='revit.inspect')return {items:[{id:1}]};throw new Error(m);};
 return {calls,context,plugin,call};
}
test('summary is opt-in and result pages reuse captured records without repeating model queries',async()=>{
 const f=fixture(),store=new DiagnosticResultStore();
 const r=await runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{query:'泵',responseMode:'summary'}},f.call,undefined,store);
 assert.equal(r.search,undefined);assert.equal(r.sections.search.capturedCount,3);assert.equal(store.stats.entries,1);
 assert.deepEqual(f.calls,['revit.bridge.info','revit.context.get','revit.search','revit.context.get','revit.bridge.info']);f.calls.length=0;
 const p=await runDiagnosticsWorkflow({name:'diagnostics.result',documentIdentity:'doc-a',expectedRevision:3,input:page(r.resultHandle)},f.call,undefined,store);
 assert.equal(p.returnedCount,2);assert.deepEqual(f.calls,['revit.bridge.info','revit.context.get','revit.context.get','revit.bridge.info']);
});
test('plugin drift or cancellation never publishes a summary handle',async()=>{
 const f=fixture(),store=new DiagnosticResultStore();let reads=0;
 await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{query:'泵',responseMode:'summary'}},async(m,a)=>{
  const v=await f.call(m,a);if(m==='revit.bridge.info'&&++reads===2)v.pid++;return v;
 },undefined,store),{code:'diagnostics_plugin_changed'});assert.equal(store.stats.entries,0);
 const ac=new AbortController();await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{query:'泵',responseMode:'summary'}},async(m,a)=>{
  const v=await f.call(m,a);if(m==='revit.search')ac.abort();return v;
 },ac.signal,store));assert.equal(store.stats.entries,0);
});
test('invalid paging input missing revision and expired handles fail before native reads',async()=>{
 let now=0;const store=new DiagnosticResultStore({ttlMs:10,clock:()=>now}),r=store.put(capture()),f=fixture();
 const args={name:'diagnostics.result',documentIdentity:'doc-a',expectedRevision:3,input:page(r.resultHandle)};
 await assert.rejects(runDiagnosticsWorkflow({...args,expectedRevision:undefined},f.call,undefined,store));
 await assert.rejects(runDiagnosticsWorkflow({...args,input:{...args.input,path:'unsafe.json'}},f.call,undefined,store));
 now=10;await assert.rejects(runDiagnosticsWorkflow(args,f.call,undefined,store),{code:'diagnostic_result_expired'});assert.deepEqual(f.calls,[]);
});
test('response mode alone cannot become an unscoped diagnostic query',async()=>{
 const f=fixture();await assert.rejects(runDiagnosticsWorkflow({documentIdentity:'doc-a',input:{responseMode:'summary'}},f.call),{code:'invalid_diagnostics_input'});
 assert.deepEqual(f.calls,[]);
});
test('cached page data is withheld if the plugin changes during the final state checks',async()=>{
 const f=fixture(),store=new DiagnosticResultStore(),r=store.put(capture());let infoCalls=0;
 await assert.rejects(runDiagnosticsWorkflow({name:'diagnostics.result',documentIdentity:'doc-a',expectedRevision:3,input:page(r.resultHandle)},async(m,a)=>{
  const v=await f.call(m,a);if(m==='revit.bridge.info'&&++infoCalls===2)v.pid++;return v;
 },undefined,store),{code:'diagnostics_plugin_changed'});
 assert.ok(!f.calls.includes('revit.search'));assert.ok(!f.calls.includes('revit.inspect'));
});
