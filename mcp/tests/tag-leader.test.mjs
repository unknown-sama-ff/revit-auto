import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {validateOperations} from '../workflows.mjs';
import {callRevit} from '../bridge.mjs';

const tag=()=>({operationType:'create_tag',elementId:10,viewId:20,xMm:0,yMm:0});
test('explicit tag leader accepts only boolean values without changing omitted behavior',()=>{
 for(const leader of [true,false])assert.doesNotThrow(()=>validateOperations([{...tag(),leader}]));
 assert.doesNotThrow(()=>validateOperations([tag()]));
 for(const leader of [undefined,null,'true',0,{},[]])assert.throws(()=>validateOperations([{...tag(),leader}]),/leader.*boolean/);
});
test('native tag creation applies room leader and remembers the resolved view after parameter writes',async()=>{
 const root=path.resolve(import.meta.dirname,'../..'),exec=await fs.readFile(path.join(root,'v27/ModelExecutor.cs'),'utf8');
 assert.match(exec,/roomTag\.HasLeader = roomLeader/);
 assert.ok(exec.indexOf('RememberTagCreation(Doc, created')>exec.indexOf('foreach (var property in JsonDefaults.ObjectOrEmpty(op, "parameters")'));
 assert.ok(exec.indexOf('tagExpected = new(created.Id.Value')<exec.indexOf('foreach (var property in JsonDefaults.ObjectOrEmpty(op, "parameters")'));
 const service=await fs.readFile(path.join(root,'v27/DocumentationCreationReadbackService.cs'),'utf8');
 assert.match(service,/RequireTagDocument\(doc\)/);assert.match(service,/tagLeaderChecks/);assert.match(service,/ReadTagLeader\(doc.GetElement/);
});
test('bridge blocks explicit leader plans on old modules and forwards once only with readback capability',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'tag-leader-bridge-')),token='tag-leader-test-token-'.repeat(3),requests=[],sockets=new Set();let features=[];
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',chunk=>{
  buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;const r=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));assert.equal(r.token,token);
  if(r.method!=='revit.bridge.info')requests.push(r);
  const result=r.method==='revit.bridge.info'?{protocol:'revit-auto-2027-v2',confirmationMode:'chat',features}:{status:'pending'};
  socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result})+'\n');
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const config=path.join(folder,'bridge.json');await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
 const previous=process.env.REVIT_AI_CONFIG;process.env.REVIT_AI_CONFIG=config;
 t.after(async()=>{if(previous===undefined)delete process.env.REVIT_AI_CONFIG;else process.env.REVIT_AI_CONFIG=previous;
  for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(folder).startsWith('tag-leader-bridge-'));await fs.rm(folder,{recursive:true,force:true});});
 const request={documentIdentity:'tag-doc',expectedRevision:0,summary:'one tag',operations:[{...tag(),leader:false}]};
 await assert.rejects(callRevit('revit.plan.create',request),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('tag-leader-readback'));
 assert.equal(requests.length,0);features=['tag-leader-readback','tag-target-readback','annotation-input-contracts'];assert.equal((await callRevit('revit.plan.create',request)).status,'pending');
 assert.equal(requests.length,1);assert.equal(requests[0].method,'revit.plan.create');assert.deepEqual(requests[0].params,request);
 features=['tag-target-readback','annotation-input-contracts'];await callRevit('revit.plan.create',{...request,operations:[tag()]});assert.equal(requests.length,2);
 await assert.rejects(callRevit('revit.plan.create',request),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('tag-leader-readback'));
 assert.equal(requests.length,2);
 features=['tag-leader-readback'];
 for(const operations of [[tag()],[{...tag(),leader:true}]])
  await assert.rejects(callRevit('revit.plan.create',{...request,operations}),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('tag-target-readback'));
 assert.equal(requests.length,2);
 features=['tag-leader-readback','tag-target-readback'];
 const dimension={operationType:'create_dimension',viewId:20,start:{xMm:0,yMm:0},end:{xMm:100,yMm:0},references:['a','b']};
 for(const operations of [[tag()],[dimension]])
  await assert.rejects(callRevit('revit.plan.create',{...request,operations}),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('annotation-input-contracts'));
 assert.equal(requests.length,2);
 features=['annotation-input-contracts','dimension-creation-readback'];
 await callRevit('revit.plan.create',{...request,operations:[dimension]});
 assert.equal(requests.length,3);assert.deepEqual(requests[2].params.operations,[dimension]);
});
