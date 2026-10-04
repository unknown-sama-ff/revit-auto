import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callRevit } from '../bridge.mjs';

async function fixture(handler, {oldVersion=false,confirmationMode='chat',features=[]} = {}) {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'revit-bridge-test-'));
  const token='test-only-token-'.repeat(4);
  const sockets=new Set();
  const bridge=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    let buffer='';socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8');const i=buffer.indexOf('\n');if(i<0)return;
      const request=JSON.parse(buffer.slice(0,i));buffer='';
      assert.equal(request.token,token);assert.ok(request.deadlineUnixMs>Date.now());
      if(request.method==='revit.bridge.info') {if(oldVersion)socket.end(JSON.stringify({ok:true,result:{}})+'\n');else send(socket,{protocol:'revit-auto-2027-v2',confirmationMode,features});return;}
      handler(request,socket);
    });
  });
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
  const config=path.join(folder,'bridge.json');
  await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token}));
  return {config,close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>bridge.close(r));await fs.rm(folder,{recursive:true,force:true});}};
}
const send=(socket,result)=>socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result})+'\n');

test('SDK client completes authenticated tool round-trip with Chinese UTF-8 split across TCP frames',async t=>{
  const f=await fixture((request,socket)=>{
    const bytes=Buffer.from(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result:{title:'照明项目',method:request.method}})+'\n');
    let i=0;const timer=setInterval(()=>{if(i===bytes.length){clearInterval(timer);socket.end();return;}socket.write(bytes.subarray(i,i+1));i++;},1);
    socket.on('close',()=>clearInterval(timer));
  });t.after(f.close);
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:f.config},stderr:'pipe'});
  const client=new Client({name:'Claude-compatible-test',version:'1.0'});t.after(()=>client.close());
  await client.connect(transport);
  const tools=await client.listTools();assert.ok(tools.tools.some(tool=>tool.name==='revit_plan_get'));
  const result=await client.callTool({name:'revit_context_get',arguments:{}});
  assert.equal(JSON.parse(result.content[0].text).title,'照明项目');
});
test('Claude and Codex compatible clients share one serialized plan host and confirm the same plan without duplicate writes (mock)',async t=>{
  let commits=0;let committed=false;const f=await fixture((request,socket)=>{
    if(request.method==='revit.plan.confirm'){if(!committed){committed=true;commits++;}send(socket,{status:'committed',planId:'same',createdElementIds:[100]});}
    else send(socket,{status:'pending'});
  });t.after(f.close);
  const clients=[];for(const name of ['Claude','Codex']){
    const c=new Client({name,version:'1.0'});clients.push(c);t.after(()=>c.close());
    await c.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:f.config},stderr:'pipe'}));
  }
  await Promise.all(clients.map(c=>c.callTool({name:'revit_plan_confirm',arguments:{planId:'same'}})));
  assert.equal(commits,1);
});
test('bridge errors propagate as actionable codes',async t=>{
  const f=await fixture((_,socket)=>socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:false,error:{code:'stale_plan',message:'Re-preview'}})+'\n'));t.after(f.close);
  const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
  await assert.rejects(callRevit('revit.plan.confirm',{planId:'x'}),error=>error.code==='stale_plan');
});
test('cancellation closes TCP connection instead of leaving a queued request',async t=>{
  let closed;const disconnect=new Promise(resolve=>closed=resolve);
  const f=await fixture((_,socket)=>socket.on('close',closed));t.after(f.close);
  const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
  const abort=new AbortController();const pending=callRevit('revit.plan.confirm',{planId:'x'},abort.signal);
  setTimeout(()=>abort.abort(),40);await assert.rejects(pending,/cancelled/);await disconnect;
});

test('old unauthenticated bridge is blocked before any model command is sent',async t=>{
  let forwarded=0;const f=await fixture((_,socket)=>{forwarded++;send(socket,{});},{oldVersion:true});t.after(f.close);
  const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
  await assert.rejects(callRevit('revit.plan.confirm',{planId:'x'}),/old.*incompatible/);assert.equal(forwarded,0);
});

for (const method of ['revit.plan.confirm','revit.import.commit']) {
  test(method+' refuses a running double-confirmation plugin before sending a write',async t=>{
    let forwarded=0;
    const f=await fixture((_,socket)=>{forwarded++;send(socket,{status:'committed'});},{confirmationMode:'revit-dialog'});
    t.after(f.close);
    const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;
    t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
    await assert.rejects(callRevit(method,{planId:'reviewed-plan'}),error=>error.code==='confirmation_mode_mismatch');
    assert.equal(forwarded,0);
  });
}
test('older plugin remains available for read-only queries while waiting for restart',async t=>{
  const f=await fixture((_,socket)=>send(socket,{active:true}),{confirmationMode:'revit-dialog'});t.after(f.close);
  const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
  assert.equal((await callRevit('revit.context.get')).active,true);
});

test('new read tools return a version/capability diagnostic when old DLL is running',async t=>{
 let forwarded=0;const f=await fixture((_,socket)=>{forwarded++;send(socket,{});},{features:[]});t.after(f.close);
 const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
 await assert.rejects(callRevit('revit.room.get',{roomId:1}),e=>e.code==='feature_not_loaded');assert.equal(forwarded,0);
});

test('legacyPoint capability is required before any plan is sent to an older DLL',async t=>{
 let forwarded=0;const f=await fixture((_,socket)=>{forwarded++;send(socket,{});});t.after(f.close);
 const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
 await assert.rejects(callRevit('revit.plan.create',{operations:[{operationType:'create_family_instance',placementMode:'legacyPoint'}]}),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('legacy-point-placement'));
 assert.equal(forwarded,0);
});
test('panel schedule naming requires a loaded native capability rather than silently ignoring the name',async t=>{
 let forwarded=0;const f=await fixture((_,socket)=>{forwarded++;send(socket,{});});t.after(f.close);
 const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
 await assert.rejects(callRevit('revit.plan.create',{operations:[{operationType:'create_panel_schedule',name:'AI配电盘表'}]}),e=>e.code==='feature_not_loaded');assert.equal(forwarded,0);
});
test('matching legacyPoint capability forwards only the plan preview',async t=>{
 let forwarded=0;const f=await fixture((request,socket)=>{assert.equal(request.method,'revit.plan.create');forwarded++;send(socket,{status:'pending'});},{features:['legacy-point-placement']});t.after(f.close);
 const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
 assert.equal((await callRevit('revit.plan.create',{operations:[{operationType:'create_family_instance',placementMode:'legacyPoint'}]})).status,'pending');assert.equal(forwarded,1);
});

test('view query and configuration are blocked on older native hosts before any method is forwarded',async t=>{
 let forwarded=0;const f=await fixture((_,socket)=>{forwarded++;send(socket,{});});t.after(f.close);
 const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
 await assert.rejects(callRevit('revit.view.get',{viewId:2}),e=>e.code==='feature_not_loaded');
 await assert.rejects(callRevit('revit.plan.create',{operations:[{operationType:'configure_view',viewId:2,referenceViewId:1,settings:['crop']}]}),e=>e.code==='feature_not_loaded');assert.equal(forwarded,0);
});


test('explicit crop is blocked on an otherwise capable old plugin before planning',async t=>{
 let forwarded=0;const f=await fixture((_,socket)=>{forwarded++;send(socket,{});},{features:['view-configuration']});t.after(f.close);
 const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
 await assert.rejects(callRevit('revit.plan.create',{operations:[{operationType:'configure_view',viewId:2,referenceViewId:1,settings:['crop'],cropBounds:{min:{xMm:32000,yMm:16000},max:{xMm:38000,yMm:22000}}}]}),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('explicit-crop-bounds'));assert.equal(forwarded,0);
});
test('explicit crop traverses the real MCP SDK to native preview only; malformed crop never forwards',async t=>{
 const calls=[];const f=await fixture((request,socket)=>{calls.push(request);assert.equal(request.method,'revit.plan.create');send(socket,{planId:'explicit-crop-preview',status:'pending',operations:request.params.operations});},{features:['view-configuration','explicit-crop-bounds']});t.after(f.close);
 const client=new Client({name:'explicit-crop-test',version:'1.0'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:f.config},stderr:'pipe'}));
 const op={operationType:'configure_view',viewId:2,referenceViewId:1,settings:['crop'],cropBounds:{min:{xMm:32000,yMm:16000},max:{xMm:38000,yMm:22000}}};
 const result=await client.callTool({name:'revit_plan_create',arguments:{documentIdentity:'test-copy',expectedRevision:2,summary:'explicit crop preview',operations:[op]}});assert.ok(!result.isError);assert.deepEqual(calls[0].params.operations,[op]);assert.equal(calls[0].params.expectedRevision,2);assert.equal(JSON.parse(result.content[0].text).status,'pending');
 const invalid=await client.callTool({name:'revit_plan_create',arguments:{documentIdentity:'test-copy',summary:'invalid crop',operations:[{...op,cropBounds:{...op.cropBounds,rotation:90}}]}});assert.equal(invalid.isError,true);assert.equal(calls.length,1);
});

test('criteria plan refuses a resolver-only old plugin before forwarding any preview',async t=>{
 let forwarded=0;const f=await fixture((_,socket)=>{forwarded++;send(socket,{});},{features:['connector-resolution']});t.after(f.close);
 const old=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=f.config;t.after(()=>{if(old===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=old;});
 const op={operationType:'connect_elements',firstElementId:1,firstConnectorId:3,secondElementId:2,secondConnector:{domain:'DomainPiping',shape:'Round',point:{xMm:1,yMm:2,zMm:3},toleranceMm:1}};
 await assert.rejects(callRevit('revit.plan.create',{operations:[op]}),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('connector-criteria-connections'));assert.equal(forwarded,0);
});
test('criteria selectors survive SDK planning without generated port IDs or writes',async t=>{
 const calls=[];const f=await fixture((request,socket)=>{calls.push(request);send(socket,{planId:'criteria-only-preview',status:'pending',operations:request.params.operations});},{features:['connector-criteria-connections']});t.after(f.close);
 const client=new Client({name:'criteria-preview-test',version:'1.0'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:f.config},stderr:'pipe'}));
 const point={xMm:34000,yMm:18772,zMm:495.312};const ops=[{operationType:'create_pipe',id:'stub',pipeTypeId:1887580,systemTypeId:1887577,levelId:311,start:point,end:{...point,yMm:19772},diameterMm:100},{operationType:'connect_elements',firstElementId:2295837,firstConnectorId:3,secondElementId:'@stub',secondConnector:{domain:'DomainPiping',shape:'Round',point,toleranceMm:1}}];
 const result=await client.callTool({name:'revit_plan_create',arguments:{documentIdentity:'copy-session',expectedRevision:0,summary:'criteria connection preview',operations:ops}});assert.ok(!result.isError,result.content[0].text);assert.deepEqual(calls[0].params.operations,ops);assert.equal(calls[0].method,'revit.plan.create');assert.equal(calls.length,1);
 const invalid=await client.callTool({name:'revit_plan_create',arguments:{documentIdentity:'copy-session',summary:'invalid',operations:[{...ops[1],secondElementId:2,secondConnectorId:0}]}});assert.equal(invalid.isError,true);assert.equal(calls.length,1);
});
