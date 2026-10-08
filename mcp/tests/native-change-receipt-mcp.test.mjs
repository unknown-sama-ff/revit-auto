import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const evidence={documentIdentity:'doc-a',startRevision:0,endRevision:1,executionOutcome:'committed',evidenceKind:'document-changed-event-union',observedEventCount:1,observedAddedElementIds:[10,11,12,13,14,15,16,17],observedModifiedElementIds:[100,101,102],observedDeletedElementIds:[],additionalAddedElementIds:[13,14,15,16,17],unreportedModifiedElementIds:[100,101,102],elementIdsTruncated:false,eventMetadataTruncated:false,revisionCoverageComplete:true,elementEvidenceComplete:true,captureComplete:true,netModelDiffVerified:false,sideEffectsVerified:false};
const receipt={planId:'reviewed-plan',status:'committed',completedOperationCount:3,createdElementIds:[10,11,12],changedElementIds:[],nativeChanges:evidence,confirmationMode:'chat',saved:false};
async function fixture(t,{failure=false,oldReceipt=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-receipt-mcp-'));const token='receipt-fixture-only-'.repeat(4),sockets=new Set(),methods=[];let committed=false,executions=0;
 const result=oldReceipt?{planId:'reviewed-plan',status:'committed',createdElementIds:[10,11,12],saved:false}:receipt;
 const errorDetails={planId:'reviewed-plan',status:'failed',rolledBack:false,createdElementIds:[],nativeChanges:{...evidence,executionOutcome:'failed',observedDeletedElementIds:[10],observedThenDeletedElementIds:[10],captureComplete:false,elementEvidenceComplete:false},code:'execution_failed',causeCode:'invalid_operation'};
 const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buf='';socket.on('data',chunk=>{
  buf+=chunk.toString('utf8');const i=buf.indexOf('\n');if(i<0)return;const r=JSON.parse(buf.slice(0,i));assert.equal(r.token,token);methods.push(r.method);let payload;
  if(r.method==='revit.bridge.info')payload={ok:true,result:{protocol:'revit-auto-2027-v2',confirmationMode:'chat',features:oldReceipt?[]:['native-change-receipts']}};
  else if(r.method==='revit.plan.confirm'){assert.equal(r.params.planId,'reviewed-plan');if(!committed){committed=true;executions++;}payload=failure?{ok:false,error:{code:'execution_failed',message:'Native test failure; inspect receipt without retry.',details:errorDetails}}:{ok:true,result};}
  else if(r.method==='revit.plan.get')payload={ok:true,result:{planId:'reviewed-plan',status:failure?'failed':'committed',receipt:failure?errorDetails:result}};
  else payload={ok:false,error:{code:'unexpected_call',message:'No plan recreation/save permitted'}};
  socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',...payload})+'\n');
 });});
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>bridge.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('revit-receipt-mcp-'));await fs.rm(dir,{recursive:true,force:true});});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const config=path.join(dir,'bridge.json');await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token}));
 const client=new Client({name:'native-receipt-contract',version:'1.0'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));return {client,methods,executions:()=>executions};
}
async function tool(client,name){const r=await client.callTool({name,arguments:{planId:'reviewed-plan'}});return {error:r.isError===true,data:JSON.parse(r.content[0].text)};}
test('stdio preserves full event evidence separately from three primary ids without calling save',async t=>{
 const f=await fixture(t);const r=await tool(f.client,'revit_plan_confirm');assert.equal(r.error,false);assert.deepEqual(r.data,receipt);assert.equal(r.data.nativeChanges.additionalAddedElementIds.length,5);assert.equal(r.data.nativeChanges.unreportedModifiedElementIds.length,3);assert.equal(r.data.nativeChanges.sideEffectsVerified,false);assert.equal(r.data.nativeChanges.netModelDiffVerified,false);assert.equal(f.executions(),1);assert.ok(!f.methods.some(m=>/save|plan.create/.test(m)));
 const get=await tool(f.client,'revit_plan_get');assert.deepEqual(get.data.receipt,receipt);assert.equal(f.executions(),1);
});
test('native failure retains transient/unknown event evidence and does not retry or recreate plan',async t=>{
 const f=await fixture(t,{failure:true});const r=await tool(f.client,'revit_plan_confirm');assert.equal(r.error,true);assert.equal(r.data.code,'execution_failed');assert.equal(r.data.details.nativeChanges.executionOutcome,'failed');assert.equal(r.data.details.nativeChanges.captureComplete,false);assert.equal(r.data.details.rolledBack,false);assert.deepEqual(r.data.details.nativeChanges.observedThenDeletedElementIds,[10]);assert.equal(f.executions(),1);assert.equal(f.methods.filter(m=>m==='revit.plan.confirm').length,1);
 const get=await tool(f.client,'revit_plan_get');assert.deepEqual(get.data.receipt,r.data.details);assert.equal(f.executions(),1);
});
test('old receipt without nativeChanges remains unverified rather than invented complete evidence',async t=>{
 const f=await fixture(t,{oldReceipt:true});const r=await tool(f.client,'revit_plan_get');assert.equal(r.error,false);assert.equal(r.data.receipt.nativeChanges,undefined);assert.equal(r.data.receipt.sideEffectsVerified,undefined);assert.equal(r.data.receipt.captureComplete,undefined);assert.equal(f.executions(),0);
});
