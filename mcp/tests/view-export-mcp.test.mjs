import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const selected={documentIdentity:'doc-a',expectedRevision:2,viewIds:[20,10]};
async function clientFixture(t,{features=['batch-view-image-export'],nativeFailure}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-export-mcp-')),calls=[],sockets=new Set();
  const token='batch-export-fixture-token-'.repeat(4);
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
    socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
      const request=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));assert.equal(request.token,token);calls.push(request);
      const result=request.method==='revit.bridge.info'?{protocol:'revit-auto-2027-v2',version:'0.4.0',features,confirmationMode:'chat'}:
        {documentIdentity:request.params.documentIdentity,documentRevision:request.params.expectedRevision,exports:request.params.viewIds.map(viewId=>({viewId,file:'exports/view-'+viewId+'.png',widthPixels:4096,heightPixels:2896})),savedModel:false};
      const payload=request.method!=='revit.bridge.info'&&nativeFailure?{ok:false,error:nativeFailure}:{ok:true,result};
      socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',...payload})+'\n');
    });
  });
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('revit-export-mcp-'));await fs.rm(dir,{recursive:true,force:true});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const config=path.join(dir,'bridge.json');await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
  const client=new Client({name:'batch-export-contract',version:'1.0'});t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
  return {client,calls};
}
async function call(client,input){const result=await client.callTool({name:'revit_view_export_images',arguments:input});return {error:result.isError===true,data:JSON.parse(result.content[0].text)};}
test('batch export is discoverable as a read-only bounded pinned MCP tool (mock)',async t=>{
  const {client,calls}=await clientFixture(t);const list=await client.listTools();
  const tool=list.tools.find(item=>item.name==='revit_view_export_images');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.annotations.idempotentHint,false);assert.equal(tool.inputSchema.additionalProperties,false);
  assert.ok(tool.inputSchema.required.includes('documentIdentity'));assert.ok(tool.inputSchema.required.includes('expectedRevision'));assert.equal(tool.inputSchema.properties.viewIds.maxItems,20);
  const result=await call(client,selected);assert.equal(result.error,false);assert.deepEqual(result.data.exports.map(row=>row.viewId),[20,10]);assert.equal(result.data.savedModel,false);
  assert.deepEqual(calls.map(row=>row.method),['revit.bridge.info','revit.view.export_images']);
  assert.deepEqual(calls[1].params,{...selected,pixelSize:4096,resolutionDpi:300});
});
test('old loaded plugins reject batch export before any native export request (mock)',async t=>{
  const {client,calls}=await clientFixture(t,{features:['view-image-export']});const result=await call(client,selected);
  assert.equal(result.error,true);assert.equal(result.data.code,'feature_not_loaded');assert.deepEqual(result.data.details.requiredFeatures,['batch-view-image-export']);assert.deepEqual(calls.map(row=>row.method),['revit.bridge.info']);
});
test('batch export schema rejects malformed input before contacting the native bridge (mock)',async t=>{
  const {client,calls}=await clientFixture(t);
  for(const input of [{...selected,viewIds:[10,10]},{...selected,viewIds:[]},{...selected,pixelSize:8193},{...selected,outputPath:'elsewhere'},{...selected,expectedRevision:undefined}]){
    const result=await client.callTool({name:'revit_view_export_images',arguments:input});assert.equal(result.isError,true);
  }
  assert.deepEqual(calls,[]);
});
test('native stale-context and partial-export errors are returned without retry or model plans (mock)',async t=>{
  const error={code:'document_revision_changed',message:'Project changed',details:{outputDirectory:'exports/mock',completedExports:[{viewId:20}],retryAutomatically:false}};
  const {client,calls}=await clientFixture(t,{nativeFailure:error});const result=await call(client,selected);
  assert.equal(result.error,true);assert.deepEqual(result.data,error);assert.deepEqual(calls.map(row=>row.method),['revit.bridge.info','revit.view.export_images']);
});
