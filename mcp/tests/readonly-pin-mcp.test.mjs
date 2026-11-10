import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath=path.resolve(import.meta.dirname,'../revit-custom.mjs');
const pin={documentIdentity:'session-current',expectedRevision:0};
const cases=[
  ['revit_search',{category:'OST_Walls'}],
  ['revit_inspect',{elementIds:[10]}],
  ['revit_type_resolve',{family:'Wall',type:'Basic'}],
  ['revit_view_get',{viewId:20}],
  ['revit_room_get',{roomId:30}],
  ['revit_audit_run',{}]
];

async function fixture(t,{staleCode}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-read-pin-'));
  const requests=[],sockets=new Set();
  const bridge=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    let buffer='';socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
      const request=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));requests.push(request);
      if(request.method==='revit.bridge.info'){
        socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result:{protocol:'revit-auto-2027-v2',features:['mechanical-port-audit-tristate','native-type-resolver','view-settings','room-boundaries'],confirmationMode:'chat'}})+'\n');
        return;
      }
      if(staleCode&&request.params.documentIdentity&&request.params.documentIdentity!=='session-current'){
        socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:false,error:{code:'document_changed',message:'Stale document identity.'}})+'\n');return;
      }
      if(staleCode&&request.params.expectedRevision!==undefined&&request.params.expectedRevision!==0){
        socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:false,error:{code:'document_revision_changed',message:'Stale document revision.'}})+'\n');return;
      }
      socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result:{readOnly:true,planCreated:false}})+'\n');
    });
  });
  t.after(async()=>{
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>bridge.close(resolve));
    assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));
    await fs.rm(dir,{recursive:true,force:true});
  });
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
  const config=path.join(dir,'bridge.json');
  await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token:'readonly-pin-fixture-token-'.repeat(3)}));
  const client=new Client({name:'readonly-pin-contract',version:'1.0'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[serverPath],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
  return {client,requests};
}

async function call(client,name,args){
  const response=await client.callTool({name,arguments:args});
  return {isError:response.isError===true,data:JSON.parse(response.content[0].text)};
}

test('pinned read tools expose optional identity and revision while legacy calls remain valid',async t=>{
  const {client,requests}=await fixture(t);
  const listed=await client.listTools();
  for(const [name,args] of cases){
    const tool=listed.tools.find(item=>item.name===name);
    assert.ok(tool,`missing MCP tool ${name}`);
    assert.ok(Object.hasOwn(tool.inputSchema.properties,'documentIdentity'),`${name} lacks documentIdentity`);
    assert.ok(Object.hasOwn(tool.inputSchema.properties,'expectedRevision'),`${name} lacks expectedRevision`);
    assert.equal(tool.annotations.readOnlyHint,true);
    assert.equal(tool.annotations.destructiveHint,false);
    const response=await call(client,name,args);
    assert.equal(response.isError,false,`${name} rejected its legacy input`);
  }
  const native=requests.filter(request=>cases.some(([name])=>name.replaceAll('_','.')===request.method));
  assert.equal(native.length,cases.length);
  for(let i=0;i<cases.length;i++){
    const [name,args]=cases[i];
    assert.deepEqual(native[i].params,args);
  }
});

test('pinned read tools forward explicit session pins and preserve native stale errors',async t=>{
  const {client,requests}=await fixture(t,{staleCode:true});
  for(const [name,args] of cases){
    const response=await call(client,name,{...args,...pin});
    assert.equal(response.isError,false,`${name} rejected a matching pin`);
  }
  const native=requests.filter(request=>cases.some(([name])=>name.replaceAll('_','.')===request.method));
  assert.ok(native.every(request=>request.params.documentIdentity===pin.documentIdentity&&request.params.expectedRevision===0));
  for(const [stale,code] of [[{documentIdentity:'old-session'},'document_changed'],[{expectedRevision:1},'document_revision_changed']]){
    const response=await call(client,'revit_search',{category:'OST_Walls',...stale});
    assert.equal(response.isError,true);
    assert.equal(response.data.code,code);
  }
});

test('native router applies read pins before dispatching every scoped read method',async()=>{
  const source=await fs.readFile(path.resolve(import.meta.dirname,'../../v27/RevitCommandRouter.cs'),'utf8');
  assert.ok(source.includes('"readonly-query-pins"'),'the native bridge must advertise enforced read pins');
  const guard=source.indexOf('DocumentReadPinRules.Validate(parameters, Identity(readDocument), Revision(readDocument))');
  const dispatch=source.indexOf('return method switch',guard);
  assert.ok(guard>=0&&dispatch>guard,'native pin validation must run before query dispatch');
  const guarded=source.slice(source.lastIndexOf('if (method is',guard),guard);
  for(const method of ['revit.search','revit.inspect','revit.type.resolve','revit.view.get','revit.room.get','revit.audit.run'])assert.ok(guarded.includes(`"${method}"`),`${method} lacks the native pin gate`);
});
