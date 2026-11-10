import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('SDK rejects invalid tag and dimension inputs before any native dispatch without value leakage',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-mcp-')),token='annotation-fixture-'.repeat(4),requests=[],sockets=new Set();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',chunk=>{
  buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
  const r=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));requests.push(r.method);
  socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result:{status:'unexpected-mock-dispatch'}})+'\n');
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const config=path.join(folder,'bridge.json');await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
 const client=new Client({name:'annotation-input-sdk-test',version:'1'});
 t.after(async()=>{await client.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('annotation-mcp-'));await fs.rm(folder,{recursive:true,force:true});});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],stderr:'ignore',env:{REVIT_AI_CONFIG:config,REVIT_AI_TIMEOUT_MS:'1000'}}));
 const common={documentIdentity:'mock-document',expectedRevision:0,summary:'offline invalid annotation request'};
 const operations=[
  {operationType:'create_tag',elementId:1,viewId:2,xMm:0,yMm:0,tagtypeid:'do-not-echo-value'},
  {operationType:'create_dimension',viewId:2,start:{xMm:0,yMm:0},end:{xMm:100,yMm:0},references:'not-an-array'},
  {operationType:'create_dimension',viewId:2,start:{xMm:0,yMm:0},end:{xMm:100,yMm:0},references:['duplicate','duplicate']}
 ];
 for(const operation of operations){
  const raw=await client.callTool({name:'revit_plan_create',arguments:{...common,operations:[operation]}});
  assert.equal(raw.isError,true);const r=JSON.parse(raw.content.find(c=>c.type==='text').text);
  assert.equal(r.code,'invalid_annotation_input');assert.ok(!JSON.stringify(r).includes('do-not-echo-value'));
 }
 assert.deepEqual(requests,[]);
});
