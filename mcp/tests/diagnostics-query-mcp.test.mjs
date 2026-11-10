import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=path.resolve(import.meta.dirname,'../..');
const context={active:true,document:{identity:'doc-a',revision:3,title:'test',path:'test.rvt',isModified:false,isReadOnly:false,isFamilyDocument:false}};
async function sdk(t,{old=false,switchBeforeSearch=false,recordCount=1,nativeHasMore=false}={}){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-diagnostics-')),sockets=new Set(),requests=[],token='pinned-diagnostic-test-'.repeat(3);
 const plugin={protocol:'revit-auto-2027-v2',version:'0.4.0',moduleVersionId:'11111111-2222-4333-8444-555555555555',pid:42,
  features:old?[]:['readonly-query-pins'],confirmationMode:'chat'};
 let activeContext=structuredClone(context);
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
  socket.on('data',chunk=>{
   buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
   const req=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));assert.equal(req.token,token);requests.push({method:req.method,args:req.params});
   const send=result=>socket.end(JSON.stringify({protocol:plugin.protocol,ok:true,result})+'\n');
   if(req.method==='revit.bridge.info')return send(plugin);
   if(req.method==='revit.context.get')return send(activeContext);
   if(req.method==='revit.search'||req.method==='revit.inspect'){
    const expectedDoc=switchBeforeSearch?'doc-b':'doc-a';
    if(req.params.documentIdentity!==expectedDoc||req.params.expectedRevision!==activeContext.document.revision)
     return socket.end(JSON.stringify({protocol:plugin.protocol,ok:false,error:{code:'document_changed',message:'Native scope refused'}})+'\n');
    return send({items:Array.from({length:recordCount},(_,i)=>({summary:{id:101+i},payload:'X'.repeat(300)})),
     ...(req.method==='revit.search'?{hasMore:nativeHasMore,offset:req.params.offset??0}:{})});
   }
   socket.end(JSON.stringify({protocol:plugin.protocol,ok:false,error:{code:'unexpected_method',message:req.method}})+'\n');
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const config=path.join(folder,'bridge.json');
 await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
 const client=new Client({name:'pinned-diagnostics-test',version:'1'});
 t.after(async()=>{await client.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('pinned-diagnostics-'));
  await fs.rm(folder,{recursive:true,force:true});});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],stderr:'pipe',
  env:{REVIT_AI_CONFIG:config,REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS:'0'}}));
 const run=async(input,{name='diagnostics.query',expectedRevision,documentIdentity='doc-a'}={})=>{const raw=await client.callTool({name:'revit_workflow_run',arguments:{name,documentIdentity,expectedRevision,input}});
  const result=JSON.parse(raw.content.find(c=>c.type==='text').text);if(raw.isError)throw Object.assign(new Error(result.message),result);return result;};
 return {client,run,requests,setDocument:edit=>edit(activeContext.document),setPlugin:edit=>edit(plugin)};
}
test('SDK diagnostics forwards the captured native pins with no extra model/context calls',async t=>{
 const f=await sdk(t);assert.ok((await f.client.listTools()).tools.some(t=>t.name==='revit_workflow_run'));
 const r=await f.run({query:'泵',inspectElementIds:[101]});assert.equal(r.documentRevision,3);assert.equal(r.readOnly,true);assert.equal(r.planCreated,false);
 assert.deepEqual(f.requests.filter(r=>r.method!=='revit.bridge.info'),[
  {method:'revit.context.get',args:{}},
  {method:'revit.search',args:{query:'泵',documentIdentity:'doc-a',expectedRevision:3}},
  {method:'revit.inspect',args:{elementIds:[101],documentIdentity:'doc-a',expectedRevision:3}},
  {method:'revit.context.get',args:{}}]);
 assert.ok(f.requests.every(r=>!Object.hasOwn(r.args,'requiredFeatures')));
});
test('SDK diagnostics refuses a host lacking read-pin support before target query dispatch',async t=>{
 const f=await sdk(t,{old:true});await assert.rejects(f.run({query:'泵'}),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('readonly-query-pins'));
 assert.ok(!f.requests.some(r=>r.method==='revit.search'||r.method==='revit.inspect'));
 assert.equal(f.requests.filter(r=>r.method==='revit.context.get').length,1);
});
test('SDK native scope refusal stops before inspect and does not retry after a document switch',async t=>{
 const f=await sdk(t,{switchBeforeSearch:true});await assert.rejects(f.run({query:'泵',inspectElementIds:[101]}),{code:'document_changed'});
 assert.deepEqual(f.requests.filter(r=>r.method!=='revit.bridge.info').map(r=>r.method),['revit.context.get','revit.search']);
});
test('SDK diagnostic typo rejection preserves spelling advice and emits no parameter values or native calls',async t=>{
 const f=await sdk(t);await assert.rejects(f.run({inspect_element_ids:['PRIVATE-DIAGNOSTIC-VALUE']}),e=>{
  assert.equal(e.code,'invalid_diagnostics_input');assert.equal(e.details.invalid_arguments.unknown[0].did_you_mean,'inspectElementIds');
  assert.ok(!JSON.stringify(e).includes('PRIVATE-DIAGNOSTIC-VALUE'));return true;
 });assert.deepEqual(f.requests,[]);
});
test('SDK summary and cached pages preserve native hasMore without repeating search or inspect',async t=>{
 const f=await sdk(t,{recordCount:3,nativeHasMore:true});
 const r=await f.run({query:'泵',limit:3,responseMode:'summary'});assert.equal(r.sections.search.capturedCount,3);
 assert.equal(r.sections.search.matchingSetComplete,false);assert.equal(r.search,undefined);
 const first=await f.run({resultHandle:r.resultHandle,section:'search',offset:0,limit:2},{name:'diagnostics.result',expectedRevision:3});
 assert.equal(first.returnedCount,2);assert.equal(first.hasMore,true);assert.equal(first.items[0].summary.id,101);
 const last=await f.run({resultHandle:r.resultHandle,section:'search',offset:2,limit:2},{name:'diagnostics.result',expectedRevision:3});
 assert.equal(last.returnedCount,1);assert.equal(last.hasMore,false);assert.equal(last.sourceSearchHasMore,true);
 assert.equal(last.snapshotSha256,r.snapshotSha256);assert.equal(last.writeAuthorization,false);
 assert.equal(f.requests.filter(r=>r.method==='revit.search').length,1);assert.equal(f.requests.filter(r=>r.method==='revit.inspect').length,0);
 assert.ok(f.requests.every(r=>['revit.bridge.info','revit.context.get','revit.search'].includes(r.method)));
});
test('SDK result handles do not survive another MCP process and invalid pages cause no native request',async t=>{
 const a=await sdk(t),b=await sdk(t),r=await a.run({query:'泵',responseMode:'summary'});
 await assert.rejects(b.run({resultHandle:r.resultHandle,section:'search'},{name:'diagnostics.result',expectedRevision:3}),{code:'diagnostic_result_unknown'});
 assert.deepEqual(b.requests,[]);const before=a.requests.length;
 await assert.rejects(a.run({resultHandle:r.resultHandle,section:'search',code:'PRIVATE-CODE'},{name:'diagnostics.result',expectedRevision:3}));
 await assert.rejects(a.run({resultHandle:r.resultHandle,section:'search'},{name:'diagnostics.result'}));
 assert.equal(a.requests.length,before);
});
test('SDK cached result refuses changed document revision and changed plugin without requery',async t=>{
 const f=await sdk(t),r=await f.run({query:'泵',responseMode:'summary'});
 f.setDocument(d=>d.revision=4);
 await assert.rejects(f.run({resultHandle:r.resultHandle,section:'search'},{name:'diagnostics.result',expectedRevision:4}),{code:'diagnostic_result_scope_changed'});
 f.setDocument(d=>d.revision=3);f.setPlugin(p=>p.pid=43);
 await assert.rejects(f.run({resultHandle:r.resultHandle,section:'search'},{name:'diagnostics.result',expectedRevision:3}),{code:'diagnostic_result_scope_changed'});
 assert.equal(f.requests.filter(r=>r.method==='revit.search').length,1);
});
test('SDK synthetic large-query summary reduces actual MCP result bytes and paging adds no target query',async t=>{
 const f=await sdk(t,{recordCount:100});
 const invoke=input=>f.client.callTool({name:'revit_workflow_run',arguments:{name:'diagnostics.query',documentIdentity:'doc-a',input}});
 const full=await invoke({query:'泵',limit:100}),summary=await invoke({query:'泵',limit:100,responseMode:'summary'});
 assert.ok(!full.isError);assert.ok(!summary.isError);
 const handle=JSON.parse(summary.content.find(c=>c.type==='text').text).resultHandle;
 const fullBytes=Buffer.byteLength(JSON.stringify(full),'utf8'),summaryBytes=Buffer.byteLength(JSON.stringify(summary),'utf8');
 assert.ok(summaryBytes<fullBytes/4);const targetBefore=f.requests.filter(r=>r.method==='revit.search').length;
 await f.run({resultHandle:handle,section:'search',offset:50,limit:10},{name:'diagnostics.result',expectedRevision:3});
 assert.equal(f.requests.filter(r=>r.method==='revit.search').length,targetBefore);
 t.diagnostic(JSON.stringify({fixture:'100 synthetic records, not native Revit performance',fullMcpResultBytes:fullBytes,summaryMcpResultBytes:summaryBytes,targetQueriesAddedByPage:0}));
});
