import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {stairConnectionsRequestSchema,stairConnectionsResponseSchema,readStairConnections} from '../stair-connections.mjs';
import {runReadonlyBatch} from '../readonly-batch.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const input={documentIdentity:'stair-doc',expectedRevision:0,stairId:99};
const context={active:true,document:{identity:'stair-doc',revision:0,path:'stair.rvt',isModified:false,isReadOnly:false,isFamilyDocument:false},counts:{OST_Stairs:1}};
const edge=(a,b,at='ET_RunEnd',bt='ET_Landing',av=1,bv=2)=>({elementId:a,peerElementId:b,connectionType:at,connectionTypeValue:av,peerConnectionType:bt,peerConnectionTypeValue:bv});
const node=(id,kind,connections,connectionsComplete=true,error=null)=>({elementId:id,kind,stairId:99,connectionsComplete,connections,error});
const report=()=>({documentIdentity:'stair-doc',documentRevision:0,stair:{id:99,typeId:5,uniqueId:'stair-unique',name:'stairs',className:'Stairs'},runIds:[1],landingIds:[2],components:[node(1,'run',[edge(1,2)]),node(2,'landing',[edge(2,1,'ET_Landing','ET_RunEnd',2,1)])],graph:{enumerationComplete:true,reciprocityStatus:'verified',issues:[],isolatedComponentIds:[]},readOnly:true,modelWritesRequested:false,automaticSave:false,planCreated:false,allModelSideEffectsVerified:false,completeStairConnectionsVerified:false,engineeringComplianceVerified:false});
const mutate=(data,change)=>{const v=structuredClone(data);change(v);return v;};

test('stair query refuses missing pins unsafe IDs code paths and unreviewed scope',()=>{
  assert.deepEqual(stairConnectionsRequestSchema.parse(input),input);
  for(const v of [{...input,code:'x'},{...input,stairId:0},{...input,stairId:Number.MAX_SAFE_INTEGER+1},{...input,expectedRevision:0.5},{...input,documentIdentity:' '},{stairId:99,documentIdentity:'stair-doc'},{...input,elementIds:[99]}])assert.equal(stairConnectionsRequestSchema.safeParse(v).success,false);
});
test('complete stair relation data is preserved without certifying whole stair physical acceptance',async()=>{
  const calls=[],raw=report(),saved=structuredClone(raw);const r=await readStairConnections(input,async(m,a)=>{calls.push({m,a});return m==='revit.context.get'?context:raw;});
  assert.deepEqual(r,saved);assert.deepEqual(raw,saved);assert.deepEqual(calls.map(c=>c.m),['revit.context.get','revit.stairs.connections','revit.context.get']);assert.deepEqual(calls[1].a,input);
});
test('stair partial and known-empty reports keep different graph and isolation semantics',()=>{
  const empty=report();empty.components.forEach(n=>n.connections=[]);empty.graph.isolatedComponentIds=[1,2];assert.equal(stairConnectionsResponseSchema.safeParse(empty).success,true);
  const partial=report();partial.components[0]=node(1,'run',[edge(1,2)],false,'native error');partial.graph.enumerationComplete=false;partial.graph.reciprocityStatus='unknown';assert.equal(stairConnectionsResponseSchema.safeParse(partial).success,true);
  partial.graph.isolatedComponentIds=[1];assert.equal(stairConnectionsResponseSchema.safeParse(partial).success,false);
});
test('malformed ownership duplicates unsafe endpoint evidence and acceptance flags fail closed',()=>{
  for(const edit of [r=>r.runIds.push(1),r=>r.components[0].stairId=8,r=>r.components[0].kind='landing',r=>r.components[0].connections[0].peerElementId=0,r=>r.components[0].error='contradiction',r=>r.graph.enumerationComplete=false,r=>r.graph.reciprocityStatus='inconsistent',r=>r.graph.issues.push({code:'self_connection',elementId:200,peerElementId:200}),r=>r.completeStairConnectionsVerified=true,r=>r.planCreated=true,r=>r.components[0].geometry='unexpected'])assert.equal(stairConnectionsResponseSchema.safeParse(mutate(report(),edit)).success,false);
});
test('future endpoint enum evidence is preserved as unknown rather than a false mismatch verdict',()=>{
  const r=report();r.components[0].connections[0].connectionType='future-end';r.components[0].connections[0].connectionTypeValue=8;r.components[1].connections[0].peerConnectionType='future-end';r.components[1].connections[0].peerConnectionTypeValue=8;
  r.graph.reciprocityStatus='unknown';r.graph.issues=[{code:'endpoint_type_unknown',elementId:1,peerElementId:2},{code:'endpoint_type_unknown',elementId:2,peerElementId:1}];
  assert.deepEqual(stairConnectionsResponseSchema.parse(r),r);
});
test('stair query rejects context drift wrong result scopes and cancellation without retry',async()=>{
  let calls=0;await assert.rejects(readStairConnections(input,async()=>{calls++;return mutate(context,c=>c.document.revision=1);}),{code:'document_revision_changed'});assert.equal(calls,1);
  const countDrift=async m=>m==='revit.stairs.connections'?report():++calls===1?context:mutate(context,c=>c.counts.OST_Stairs=2);calls=0;await assert.rejects(readStairConnections(input,countDrift),{code:'stairs_connections_state_changed'});
  await assert.rejects(readStairConnections(input,async m=>m==='revit.context.get'?context:mutate(report(),r=>r.documentIdentity='other')),{code:'document_changed'});
  const controller=new AbortController();controller.abort();calls=0;await assert.rejects(readStairConnections(input,async()=>{calls++;},controller.signal));assert.equal(calls,0);
  calls=0;await assert.rejects(readStairConnections(input,async m=>{calls++;if(m==='revit.stairs.connections')throw Object.assign(new Error('native failed'),{code:'native_error'});return context;}),{code:'native_error'});assert.equal(calls,2);
});

async function sdk(t,{old=false}={}){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'stairs-connections-sdk-')),token='stair-relations-mock-token-'.repeat(4),requests=[],sockets=new Set();
  const plugin={protocol:'revit-auto-2027-v2',version:'0.4.0',informationalVersion:'mock-stair-query',moduleVersionId:'11111111-2222-4333-8444-555555555555',features:old?['readonly-query-pins']:['readonly-query-pins','native-stair-connections'],confirmationMode:'chat',revitVersion:'2027',revitBuild:'27.3',pid:42};
  const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;const req=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));assert.equal(req.token,token);requests.push({method:req.method,args:req.params});let result;if(req.method==='revit.bridge.info')result=plugin;else if(req.method==='revit.context.get')result=context;else if(req.method==='revit.stairs.connections')result=report();else {socket.end(JSON.stringify({protocol:plugin.protocol,ok:false,error:{code:'unexpected_native_query',message:req.method}})+'\n');return;}socket.end(JSON.stringify({protocol:plugin.protocol,ok:true,result})+'\n');});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const config=path.join(folder,'bridge.json');await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
  const client=new Client({name:'stair-connections-sdk-test',version:'1'});
  t.after(async()=>{await client.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));const target=path.resolve(folder);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('stairs-connections-sdk-'));await fs.rm(target,{recursive:true,force:true});});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],stderr:'pipe',env:{REVIT_AI_CONFIG:config,REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS:'0'}}));
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});const v=JSON.parse(r.content.find(c=>c.type==='text').text);if(r.isError)throw Object.assign(new Error(v.message),v);return v;};
  return {client,requests,plugin,call};
}
test('SDK old plugin refuses stair connection query before new native method dispatch',async t=>{
  const f=await sdk(t,{old:true});await assert.rejects(f.call('revit_stairs_connections',input),{code:'feature_not_loaded'});assert.ok(!f.requests.some(r=>r.method==='revit.stairs.connections'));assert.ok(!f.requests.some(r=>/plan|save|restart/.test(r.method)));
});
test('SDK exposes pinned readonly stair tool with exact raw rows and unknown flags',async t=>{
  const f=await sdk(t),tools=(await f.client.listTools()).tools,tool=tools.find(t=>t.name==='revit_stairs_connections');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.inputSchema.additionalProperties,false);
  assert.deepEqual(await f.call(tool.name,input),report());assert.deepEqual(f.requests.filter(r=>r.method==='revit.stairs.connections').map(r=>r.args),[input]);assert.ok(!f.requests.some(r=>/plan|save|restart/.test(r.method)));
});
test('stair connection query participates in the verified readonly batch contract',async t=>{
  const f=await sdk(t);const b=await runReadonlyBatch({runId:'01a17740-0000-7000-8000-000000000000',taskId:'architecture.stair-connections-readonly',project:'stair.rvt',expectedMvid:f.plugin.moduleVersionId,tools:(await f.client.listTools()).tools,scopes:[{id:'native-stair',tool:'revit_stairs_connections',args:{stairId:99}}],toolCall:f.call,bridgeCall:async()=>f.plugin});assert.equal(b.status,'accepted');assert.deepEqual(b.scopes[0].result,report());
});
