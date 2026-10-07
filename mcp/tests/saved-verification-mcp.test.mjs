import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
async function fixture(t,{features=['document-change-history'],after={},historyPatch={},nativeError}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-saved-mcp-'));
 const calls=[],sockets=new Set();let readHistory=false;
 const token='saved-fixture-token-'.repeat(4);
 const document={identity:'doc-a',revision:3,isModified:false,isFamilyDocument:false,path:'fixture.rvt'};
 const bridge=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
  socket.on('data',chunk=>{
   buffer+=chunk.toString('utf8');const i=buffer.indexOf('\n');if(i<0)return;
   const request=JSON.parse(buffer.slice(0,i));assert.equal(request.token,token);calls.push(request);
   let payload;
   if(request.method==='revit.bridge.info')payload={ok:true,result:{protocol:'revit-auto-2027-v2',features,confirmationMode:'chat'}};
   else if(request.method==='revit.context.get')payload={ok:true,result:{active:true,document:{...document,...(readHistory?after:{})}}};
   else if(request.method==='revit.changes.get'){
    readHistory=true;payload=nativeError?{ok:false,error:{code:nativeError,message:'Fixture history unavailable'}}:{ok:true,result:{documentIdentity:'doc-a',history:{sinceRevision:request.params.sinceRevision,currentRevision:3,historyComplete:true,changes:[],hasMore:false,...historyPatch}}};
   }else payload={ok:false,error:{code:'unexpected_write',message:'Only saved-state reads are permitted.'}};
   socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',...payload})+'\n');
  });
 });
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>bridge.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('revit-saved-mcp-'));await fs.rm(dir,{recursive:true,force:true});});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const config=path.join(dir,'bridge.json');await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token}));
 const client=new Client({name:'saved-contract-test',version:'1.0'});t.after(()=>client.close());
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
 return {client,calls};
}
async function invoke(client,name,input){const r=await client.callTool({name,arguments:input});return {error:r.isError===true,data:JSON.parse(r.content[0].text)};}
const direct={documentIdentity:'doc-a',expectedRevision:3,sinceRevision:2,limit:20};
const workflow={name:'verification.saved',documentIdentity:'doc-a',expectedRevision:3,input:{sinceRevision:2,limit:20}};

test('direct and unified saved verification are discoverable and return identical evidence via stdio',async t=>{
 const {client,calls}=await fixture(t);const tools=await client.listTools();const tool=tools.tools.find(t=>t.name==='revit_saved_verify');assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.inputSchema.additionalProperties,false);
 const a=await invoke(client,'revit_saved_verify',direct),b=await invoke(client,'revit_workflow_run',workflow);assert.equal(a.error,false);assert.equal(b.error,false);assert.deepEqual(a.data,b.data);assert.equal(b.data.planCreated,false);
 assert.ok(calls.every(c=>['revit.bridge.info','revit.context.get','revit.changes.get'].includes(c.method)));
 assert.deepEqual(calls.filter(c=>c.method==='revit.changes.get').map(c=>c.params),Array(2).fill({documentIdentity:'doc-a',sinceRevision:2,limit:20}));
});
for(const [label,after,code] of [['project switch',{identity:'doc-b'},'document_changed'],['edit during query',{revision:4},'document_revision_changed'],['save state changes without revision',{isModified:true},'saved_state_changed']]){
 test('saved verification rejects '+label+' at final recheck without retry',async t=>{
  const {client,calls}=await fixture(t,{after});const r=await invoke(client,'revit_saved_verify',direct);assert.equal(r.error,true);assert.equal(r.data.code,code);assert.equal(calls.filter(c=>c.method==='revit.changes.get').length,1);
 });
}
test('unified saved verification rejects conflicting nested context before native reads',async t=>{
 const {client,calls}=await fixture(t);for(const patch of [{documentIdentity:'other'},{expectedRevision:4}]){const r=await invoke(client,'revit_workflow_run',{...workflow,input:{...workflow.input,...patch}});assert.equal(r.error,true);assert.match(r.data.message,/Conflicting/);}assert.equal(calls.length,0);
});
test('older native host is refused before a history request',async t=>{
 const {client,calls}=await fixture(t,{features:[]});const r=await invoke(client,'revit_saved_verify',direct);assert.equal(r.error,true);assert.equal(r.data.code,'feature_not_loaded');assert.equal(calls.filter(c=>c.method==='revit.changes.get').length,0);
});
test('native history failure is propagated once with no retry or final recheck',async t=>{
 const {client,calls}=await fixture(t,{nativeError:'history_unavailable'});const r=await invoke(client,'revit_workflow_run',workflow);assert.equal(r.error,true);assert.equal(r.data.code,'history_unavailable');assert.equal(calls.filter(c=>c.method==='revit.changes.get').length,1);assert.equal(calls.filter(c=>c.method==='revit.context.get').length,1);
});
test('truncated history is evidence, not a complete saved-model verification',async t=>{
 const {client}=await fixture(t,{historyPatch:{historyComplete:false,hasMore:true}});const r=await invoke(client,'revit_workflow_run',workflow);assert.equal(r.error,false);assert.equal(r.data.historyComplete,false);assert.equal(r.data.historyTruncated,true);assert.equal(r.data.persistenceVerified,false);
});
