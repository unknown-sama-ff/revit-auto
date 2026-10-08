import test from 'node:test';
import assert from 'node:assert/strict';
import {getWorkflow} from '../workflow-registry.mjs';

test('electrical audit workflows are discoverable read adapters, not model operation builders',()=>{
 for(const id of ['electrical.audit','audit.electrical']){
  const workflow=getWorkflow(id);assert.ok(workflow,id);
  assert.equal(workflow.enabled,true);assert.equal(workflow.destructiveLevel,'read-only');assert.equal(workflow.operationBuilder,null);assert.equal(workflow.readAdapter,id);
  assert.ok(workflow.legacySources.includes('audit-final.csx'));
  assert.notEqual(workflow.acceptanceStatus,'implemented-and-accepted');
 }
});

import {auditElectrical,electricalAuditInputSchema,electricalAuditSchema,runElectricalAuditWorkflow} from '../electrical-audit.mjs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.resolve(import.meta.dirname,'../..');
const initial={active:true,document:{identity:'doc-a',revision:0,path:'TEST.rvt',isModified:false}};
const report={documentIdentity:'doc-a',documentRevision:0,snapshotPolicy:'ui-thread-json-v1',readOnly:true,planCreated:false,
 scope:{kind:'explicit-circuit-ids',requestedCircuitIds:[101],totalCount:1,returnedCount:1,truncated:false},
 circuits:[{circuitId:101,fields:{circuitNumber:{state:'known',supported:true,value:'1'},panelId:{state:'known-null',supported:true},loadName:{state:'unknown',supported:false,error:'unsupported'}},members:[{elementId:10,fields:{mark:{state:'known',supported:true,value:'L1'}}}],memberAudit:{totalCount:1,returnedCount:1,truncated:false},parameters:[],parameterAudit:{totalCount:5,returnedCount:0,truncated:true},complete:false}],complete:false,engineeringComplianceVerified:false};
function fixture(contexts=[initial],native=report){
 const requests=[];let index=0;
 const call=async(method,args,signal)=>{requests.push({method,args,signal});if(method==='revit.context.get')return structuredClone(contexts[Math.min(index++,contexts.length-1)]);if(method==='revit.electrical.audit'){if(native instanceof Error)throw native;return structuredClone(native)};throw new Error('Unexpected model method: '+method)};
 return {call,requests};
}

test('electrical audit schemas require exact safe IDs and bounded scope',()=>{
 const valid={documentIdentity:'doc-a',expectedRevision:0,circuitIds:[101],maxCircuits:1,maxMembersPerCircuit:500,maxParametersPerCircuit:128};
 assert.deepEqual(electricalAuditSchema.parse(valid),valid);
 for(const input of [{documentIdentity:''},{documentIdentity:'doc',expectedRevision:null},{documentIdentity:'doc',circuitIds:[]},{documentIdentity:'doc',circuitIds:[1,1]},{documentIdentity:'doc',circuitIds:[0]},{documentIdentity:'doc',circuitIds:[Number.MAX_SAFE_INTEGER+1]},{documentIdentity:'doc',maxCircuits:201},{documentIdentity:'doc',maxMembersPerCircuit:501},{documentIdentity:'doc',maxParametersPerCircuit:129},{documentIdentity:'doc',circuitIds:[1,2],maxCircuits:1},{documentIdentity:'doc',code:'unsafe'},{documentIdentity:'doc',filePath:'legacy.csx'}])assert.equal(electricalAuditSchema.safeParse(input).success,false,JSON.stringify(input));
 assert.equal(electricalAuditInputSchema.safeParse({code:'unsafe'}).success,false);
});
test('direct electrical audit pins native revision zero, preserves unknown and truncation, and never plans',async()=>{
 const f=fixture();const result=await auditElectrical({documentIdentity:'doc-a',expectedRevision:0,circuitIds:[101]},f.call);
 assert.equal(result.documentRevision,0);assert.equal(result.readOnly,true);assert.equal(result.planCreated,false);assert.equal(result.complete,false);assert.equal(result.engineeringComplianceVerified,false);assert.equal(result.auditConsistency.uiThreadSnapshotVerified,true);
 assert.deepEqual(result.circuits,report.circuits);assert.deepEqual(result.scope,report.scope);
 assert.deepEqual(f.requests.map(r=>r.method),['revit.context.get','revit.electrical.audit','revit.context.get']);
 assert.equal(f.requests[1].args.expectedRevision,0);assert.deepEqual(f.requests[1].args.circuitIds,[101]);
});
test('electrical audit reads current revision when none was supplied without claiming an earlier approval',async()=>{
 const f=fixture();await auditElectrical({documentIdentity:'doc-a'},f.call);assert.equal(f.requests[1].args.expectedRevision,0);
});
test('electrical workflow rejects nested conflicts and unsupported inputs before native reads',async()=>{
 for(const input of [{documentIdentity:'other'},{expectedRevision:1},{code:'unsafe'},{filePath:'unsafe.csx'}]){
  const f=fixture();await assert.rejects(runElectricalAuditWorkflow({documentIdentity:'doc-a',expectedRevision:0,input},f.call));assert.deepEqual(f.requests,[]);
 }
});
test('stale document or revision is refused before any native electrical audit',async()=>{
 for(const [input,code] of [[{documentIdentity:'other'},'document_changed'],[{documentIdentity:'doc-a',expectedRevision:1},'document_revision_changed']]){
  const f=fixture();await assert.rejects(auditElectrical(input,f.call),e=>e.code===code);assert.deepEqual(f.requests.map(r=>r.method),['revit.context.get']);
 }
});
test('native project/version/snapshot mismatch never certifies electrical report',async()=>{
 for(const [native,code] of [[{...report,documentIdentity:'other'},'electrical_audit_scope_mismatch'],[{...report,documentRevision:1},'electrical_audit_scope_mismatch'],[{...report,documentRevision:undefined},'electrical_audit_scope_mismatch'],[{...report,snapshotPolicy:undefined},'electrical_audit_snapshot_unknown']]){
  const f=fixture([initial],native);await assert.rejects(auditElectrical({documentIdentity:'doc-a'},f.call),e=>e.code===code);assert.equal(f.requests.filter(r=>r.method==='revit.electrical.audit').length,1);
 }
});
test('post-query state changes discard electrical audit and never retry',async()=>{
 for(const [document,code] of [[{...initial.document,identity:'other'},'document_changed'],[{...initial.document,revision:1},'document_revision_changed'],[{...initial.document,path:'OTHER.rvt'},'electrical_audit_state_changed'],[{...initial.document,isModified:true},'electrical_audit_state_changed']]){
  const f=fixture([initial,{active:true,document}]);await assert.rejects(auditElectrical({documentIdentity:'doc-a'},f.call),e=>e.code===code);assert.equal(f.requests.filter(r=>r.method==='revit.electrical.audit').length,1);
 }
});
test('missing native context and unknown saved/path states stay explicitly unverified',async()=>{
 for(const context of [{active:false},{active:true,document:{identity:'doc-a'}},{active:true,document:{identity:'doc-a',revision:null}}]){
  const f=fixture([context]);await assert.rejects(auditElectrical({documentIdentity:'doc-a'},f.call));assert.equal(f.requests.length,1);
 }
 const f=fixture([{active:true,document:{identity:'doc-a',revision:0,path:null,isModified:null}}]);const result=await auditElectrical({documentIdentity:'doc-a'},f.call);assert.equal(result.auditConsistency.savedStateVerified,false);assert.equal(result.auditConsistency.pathVerified,false);
});
test('native read errors and cancellation propagate without automatic retry or plan recreation',async()=>{
 const error=Object.assign(new Error('Native query failed'),{code:'electrical_audit_timeout'});const f=fixture([initial],error);
 await assert.rejects(auditElectrical({documentIdentity:'doc-a'},f.call),e=>e===error);assert.equal(f.requests.length,2);
 const controller=new AbortController();controller.abort();const cancelled=fixture();await assert.rejects(auditElectrical({documentIdentity:'doc-a'},cancelled.call,controller.signal));assert.equal(cancelled.requests.length,0);
});

async function clientFixture(t,{features=['electrical-circuit-audit'],native=report,contexts=[initial]}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-electrical-audit-'));const token='electrical-audit-test-token-'.repeat(3);
 const requests=[];const sockets=new Set();let index=0;
 const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',data=>{buffer+=data.toString('utf8');const newline=buffer.indexOf('\n');if(newline<0)return;const request=JSON.parse(buffer.slice(0,newline));assert.equal(request.token,token);requests.push({method:request.method,args:request.params});
  const result=request.method==='revit.bridge.info'?{protocol:'revit-auto-2027-v2',features,confirmationMode:'chat'}:request.method==='revit.context.get'?contexts[Math.min(index++,contexts.length-1)]:native;
  socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result})+'\n');
 });});
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>bridge.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('revit-electrical-audit-'));await fs.rm(dir,{recursive:true,force:true});});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const config=path.join(dir,'bridge.json');await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token}));
 const client=new Client({name:'electrical-audit-contract',version:'1.0'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
 return{client,requests};
}
const decode=result=>JSON.parse(result.content[0].text);

test('actual SDK discovers read-only electrical audit and both workflows share the same evidence adapter (mock)',async t=>{
 const {client,requests}=await clientFixture(t);const tools=await client.listTools();const tool=tools.tools.find(t=>t.name==='revit_electrical_audit');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.deepEqual(tool.inputSchema.required,['documentIdentity']);assert.equal(tool.inputSchema.properties.maxCircuits.maximum,200);
 const direct=await client.callTool({name:'revit_electrical_audit',arguments:{documentIdentity:'doc-a',expectedRevision:0,circuitIds:[101]}});assert.notEqual(direct.isError,true);
 for(const name of ['electrical.audit','audit.electrical']){const unified=await client.callTool({name:'revit_workflow_run',arguments:{name,documentIdentity:'doc-a',expectedRevision:0,planningMode:'explicit',input:{circuitIds:[101]}}});assert.notEqual(unified.isError,true);assert.deepEqual(decode(unified),decode(direct));}
 assert.equal(requests.filter(r=>r.method==='revit.electrical.audit').length,3);assert.ok(requests.every(r=>['revit.bridge.info','revit.context.get','revit.electrical.audit'].includes(r.method)));
 const registry=decode(await client.callTool({name:'revit_workflow_list',arguments:{}}));assert.match(JSON.stringify(registry),/electrical.audit/);
});
test('SDK refuses old native plugin before forwarding electrical audit or any model operation (mock)',async t=>{
 const {client,requests}=await clientFixture(t,{features:['mechanical-port-audit-tristate']});const result=await client.callTool({name:'revit_electrical_audit',arguments:{documentIdentity:'doc-a'}});assert.equal(result.isError,true);assert.equal(decode(result).code,'feature_not_loaded');assert.equal(requests.some(r=>r.method==='revit.electrical.audit'),false);assert.equal(requests.some(r=>/plan|confirm|import/.test(r.method)),false);
});
test('SDK rejects ambiguous or executable workflow inputs before contacting native bridge (mock)',async t=>{
 const {client,requests}=await clientFixture(t);
 for(const input of [{circuitIds:[101,101]},{circuitIds:[101,102],maxCircuits:1},{code:'document.Delete(...)'},{documentIdentity:'other'},{expectedRevision:1}]){
  const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'electrical.audit',documentIdentity:'doc-a',expectedRevision:0,input}});assert.equal(result.isError,true);
 }
 assert.deepEqual(requests,[]);
});
test('SDK discards changed native revision and retains truncation rather than certifying complete project (mock)',async t=>{
 const {client,requests}=await clientFixture(t,{native:{...report,documentRevision:2}});const result=await client.callTool({name:'revit_electrical_audit',arguments:{documentIdentity:'doc-a',expectedRevision:0,circuitIds:[101]}});assert.equal(result.isError,true);assert.equal(decode(result).code,'electrical_audit_scope_mismatch');assert.equal(requests.filter(r=>r.method==='revit.electrical.audit').length,1);
});
test('native electrical audit is UI-snapshotted bounded read-only code without transactions or saves (source contract)',async()=>{
 const source=await fs.readFile(path.join(root,'v27/ElectricalAuditService.cs'),'utf8');assert.match(source,/NativeReadSnapshot\.Freeze/);assert.match(source,/circuit\.Elements/);assert.match(source,/circuit\.BaseEquipment/);assert.match(source,/ElectricalAuditRules\.TotalMemberBudget/);assert.match(source,/ElectricalAuditRules\.TotalParameterBudget/);assert.match(source,/MaxResponseBytes/);assert.match(source,/cancellation\.ThrowIfCancellationRequested/);assert.match(source,/snapshotPolicy="ui-thread-json-v1"/);assert.doesNotMatch(source,/new Transaction|TransactionGroup|\.Set\(|\.Save\(|\.SaveAs\(|\.Delete\(|OpenDocumentFile/);
 const router=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');assert.match(router,/"electrical-circuit-audit"/);assert.match(router,/"revit.electrical.audit" => CommandResult.Success\(ElectricalAuditService.Run/);
});

test('audit-final migration row records read-only circuit coverage but not native acceptance',async()=>{
 const matrix=JSON.parse(await fs.readFile(path.join(root,'mcp/legacy-source-matrix.json'),'utf8'));
 const row=matrix.sources.find(row=>row.legacyScript==='audit-final.csx');
 assert.equal(row.newWorkflow,'electrical.audit');assert.equal(row.acceptanceStatus,'implemented-not-accepted');assert.equal(row.runtimeExecutionAllowed,false);
 assert.deepEqual(row.generatedOperations,[]);assert.ok(row.readOnlyQueries.includes('revit.electrical.audit'));
});
