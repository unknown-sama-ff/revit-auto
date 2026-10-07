import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const serverPath=path.resolve(import.meta.dirname,'../revit-custom.mjs');
async function clientFixture(t,{contextRevision=0,changeAfterSearch=false,failSearch=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-family-mcp-'));
 const calls=[],sockets=new Set();let searched=false;
 const bridge=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
  let buffer='';socket.on('data',chunk=>{
   buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
   const request=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));assert.equal(request.token,'family-fixture-token-'.repeat(4));calls.push(request.method);
   let payload;
   if(request.method==='revit.bridge.info')payload={ok:true,result:{protocol:'revit-auto-2027-v2',features:[],confirmationMode:'chat'}};
   else if(request.method==='revit.context.get')payload={ok:true,result:{active:true,document:{identity:'doc-a',revision:changeAfterSearch&&searched?contextRevision+1:contextRevision,isModified:false}}};
   else if(request.method==='revit.search'){
    searched=true;
    payload=failSearch?{ok:false,error:{code:'host_stopped',message:'Revit disconnected'}}:{ok:true,result:{items:request.params.family==='水泵'?[{id:10,className:'FamilySymbol',family:'水泵',name:'标准'}]:[],hasMore:false}};
   }else payload={ok:false,error:{code:'unexpected_write',message:'This fixture only allows catalog reads.'}};
   socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',...payload})+'\n');
  });
 });
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>bridge.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('revit-family-mcp-'));await fs.rm(dir,{recursive:true,force:true});});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
 const config=path.join(dir,'bridge.json');await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token:'family-fixture-token-'.repeat(4)}));
 const client=new Client({name:'family-audit-contract',version:'1.0'});t.after(()=>client.close());
 await client.connect(new StdioClientTransport({command:process.execPath,args:[serverPath],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
 return {client,calls};
}
async function call(client,name,input){const r=await client.callTool({name,arguments:input});return {error:r.isError===true,data:JSON.parse(r.content[0].text)};}

test('direct and workflow family-audit surfaces return identical catalog data without plan requests (mock)',async t=>{
 const {client,calls}=await clientFixture(t);
 const list=await client.listTools();const direct=list.tools.find(t=>t.name==='revit_families_audit');assert.equal(direct.annotations.readOnlyHint,true);assert.equal(direct.annotations.destructiveHint,false);assert.equal(direct.inputSchema.additionalProperties,false);
 const a=await call(client,'revit_families_audit',{names:['水泵','未装族'],documentIdentity:'doc-a',expectedRevision:0});
 const b=await call(client,'revit_workflow_run',{name:'families.audit',documentIdentity:'doc-a',expectedRevision:0,input:{names:['水泵','未装族']}});
 assert.equal(a.error,false);assert.equal(b.error,false);assert.deepEqual(a.data,b.data);assert.deepEqual(a.data.results.map(r=>r.status),['found','missing']);assert.equal(a.data.planCreated,false);
 assert.ok(calls.every(c=>['revit.bridge.info','revit.context.get','revit.search'].includes(c)));
 const registry=await call(client,'revit_workflow_list',{});const family=registry.data.workflows.find(w=>w.workflowId==='families.audit');assert.equal(family.operationBuilder,null);assert.equal(family.readAdapter,'families.audit');
});
test('workflow top-level revision is checked before catalog queries (mock)',async t=>{
 const {client,calls}=await clientFixture(t,{contextRevision:1});const r=await call(client,'revit_workflow_run',{name:'families.audit',documentIdentity:'doc-a',expectedRevision:0,input:{names:['水泵']}});
 assert.equal(r.error,true);assert.equal(r.data.code,'document_revision_changed');assert.ok(!calls.includes('revit.search'));assert.ok(!calls.includes('revit.plan.create'));
});
test('workflow does not let nested identity override reviewed project (mock)',async t=>{
 const {client,calls}=await clientFixture(t);const r=await call(client,'revit_workflow_run',{name:'families.audit',documentIdentity:'doc-a',input:{names:['水泵'],documentIdentity:'other'}});
 assert.equal(r.error,true);assert.match(r.data.message,/Conflicting/);assert.deepEqual(calls,[]);
});
test('workflow validates nested audit fields before any native call (mock)',async t=>{
 const {client,calls}=await clientFixture(t);for(const input of [{names:['水泵'],filePath:'anything.csx'},{names:['水泵'],script:'anything'},{names:[]}]){const r=await call(client,'revit_workflow_run',{name:'families.audit',documentIdentity:'doc-a',input});assert.equal(r.error,true);}assert.deepEqual(calls,[]);
});
test('family audit reports native disconnection without retrying or creating plans (mock)',async t=>{
 const {client,calls}=await clientFixture(t,{failSearch:true});const r=await call(client,'revit_families_audit',{names:['水泵']});assert.equal(r.error,true);assert.equal(r.data.code,'host_stopped');assert.equal(calls.filter(c=>c==='revit.search').length,1);assert.ok(!calls.includes('revit.plan.create'));
});
test('family-audit stdio results are discarded if revision changes during search (mock)',async t=>{
 const {client,calls}=await clientFixture(t,{changeAfterSearch:true});const r=await call(client,'revit_workflow_run',{name:'families.audit',documentIdentity:'doc-a',input:{names:['水泵']}});assert.equal(r.error,true);assert.equal(r.data.code,'document_revision_changed');assert.ok(!calls.includes('revit.plan.confirm'));
});
