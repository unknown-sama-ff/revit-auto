import test from 'node:test';import assert from 'node:assert/strict';
import {validateOperations,workflowOperations} from '../workflows.mjs';
const wall={id:'wallCut',operationType:'create_opening',openingKind:'wall_rectangle',hostElementId:10,start:{xMm:100,yMm:0,zMm:500},end:{xMm:900,yMm:0,zMm:1800},hostToleranceMm:1};
test('controlled opening workflow preserves explicit wall corners and host without door/window substitution',()=>{
 const operations=workflowOperations('openings.create',{openings:[wall]});assert.equal(operations.length,1);assert.equal(operations[0].operationType,'create_opening');assert.deepEqual(operations[0].start,wall.start);assert.equal(operations[0].hostElementId,10);
 assert.deepEqual(validateOperations([wall]),[wall]);
});

import {previewOpeningsWorkflow} from '../opening-planning.mjs';
import {getWorkflow} from '../workflow-registry.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.resolve(import.meta.dirname,'../..');
const boundary=[{xMm:100,yMm:100,zMm:3000},{xMm:900,yMm:100,zMm:3000},{xMm:900,yMm:900,zMm:3000},{xMm:100,yMm:900,zMm:3000}];
const floor={operationType:'create_opening',openingKind:'floor_profile',hostElementId:11,boundary,cutDirection:'vertical',hostToleranceMm:1};
const shaft={operationType:'create_opening',openingKind:'shaft',baseLevelId:12,topLevelId:13,boundary,hostToleranceMm:1};

test('floor and shaft openings retain exact reviewed profile and cut mode, including clockwise order',()=>{
 assert.deepEqual(validateOperations([floor,shaft]),[floor,shaft]);assert.doesNotThrow(()=>validateOperations([{...floor,boundary:[...boundary].reverse()}]));
 const tilted=boundary.map(p=>({...p,zMm:p.xMm+3000}));assert.doesNotThrow(()=>validateOperations([{...floor,cutDirection:'perpendicular',boundary:tilted}]));assert.throws(()=>validateOperations([{...floor,boundary:tilted}]),/horizontal/);
});
test('opening operation refuses missing kind host levels coordinates direction tolerance and hidden writes',()=>{
 for(const op of [{...wall,hostElementId:'@newWall'},{...wall,hostToleranceMm:0},{...wall,hostToleranceMm:101},{...wall,end:{xMm:900,yMm:0}},{...wall,end:{xMm:100,yMm:0,zMm:1800}},{...wall,start:{...wall.start,feet:true}},{...wall,parameters:{Comments:'hidden'}},{...wall,code:'unsafe'},{...floor,cutDirection:undefined},{...floor,hostElementId:0},{...shaft,baseLevelId:13},{...shaft,topLevelId:'@newLevel'},{...floor,boundary:[...boundary,boundary[0]]},{...floor,boundary:[boundary[0],boundary[2],boundary[1],boundary[3]]},{...floor,boundary:[boundary[0],boundary[1],{...boundary[2],zMm:3100},boundary[3]]},{...floor,boundary:[boundary[0],boundary[1],{...boundary[1],xMm:900.1,yMm:100.1},boundary[2],boundary[3]]},{...floor,boundary:Array(129).fill(boundary[0])}])assert.throws(()=>validateOperations([op]),JSON.stringify(op));
});
test('opening modes clarify incomplete/ask requests without native calls, preserve assisted assumptions and do not commit',async()=>{
 const calls=[];const call=async(method,args)=>{calls.push({method,args});return {planId:'opening-test-plan',status:'pending',operations:args.operations,requiresConfirmation:true}};
 for(const request of [{planningMode:'ask',input:{openings:[wall]}},{planningMode:'explicit',input:{openings:[{openingKind:'shaft'}]}},{input:{}}]){
  const result=await previewOpeningsWorkflow({documentIdentity:'doc-a',expectedRevision:0,...request},call);assert.equal(result.planCreated,false);assert.equal(result.requiresClarification,true);assert.ok(result.questions.length);assert.deepEqual(calls,[]);
 }
 const result=await previewOpeningsWorkflow({documentIdentity:'doc-a',expectedRevision:0,planningMode:'explicit',input:{openings:[wall,floor,shaft]}},call);assert.equal(result.planCreated,true);assert.equal(result.candidateOnly,false);assert.equal(calls[0].method,'revit.plan.create');assert.equal(calls[0].args.expectedRevision,0);assert.equal(calls.length,1);
 await assert.rejects(previewOpeningsWorkflow({documentIdentity:'doc-a',planningMode:'assisted',input:{openings:[wall]}},call),e=>e.code==='assumptions_required');assert.equal(calls.length,1);
 const assisted=await previewOpeningsWorkflow({documentIdentity:'doc-a',planningMode:'assisted',assumptions:['用户允许候选洞口位置'],input:{openings:[wall]}},call);assert.equal(assisted.candidateOnly,true);assert.deepEqual(assisted.assumptions,['用户允许候选洞口位置']);assert.equal(calls.length,2);assert.equal(assisted.engineeringComplianceVerified,false);
});
test('openings workflow rejects arbitrary operations, script inputs and unknown kinds before native requests',async()=>{
 for(const input of [{operations:[wall]},{code:'unsafe'},{filePath:'legacy.csx'},{openings:[{openingKind:'guessed-host'}]},{openings:[{...wall,hostElementId:'@newWall'}]}]){
  let calls=0;await assert.rejects(previewOpeningsWorkflow({documentIdentity:'doc-a',input},async()=>{calls++}));assert.equal(calls,0);
 }
 assert.throws(()=>workflowOperations('openings.create',{openings:[wall],anything:'ignored'}));
});
test('openings.create registry remains a separate unaccepted native adapter',()=>{
 assert.equal(getWorkflow('openings.create').legacySources.includes('openings.csx'),true);
 assert.equal(getWorkflow('openings.create').acceptanceStatus,'implemented-not-fully-migrated');
});
test('hosted door/window legacy adapter remains independent from native Opening API',()=>{
 const ops=workflowOperations('architecture.openings',{doors:[{symbolId:21,hostElementId:10,levelId:12,xMm:100,yMm:0,zMm:0}]});assert.equal(ops[0].operationType,'create_family_instance');assert.equal(getWorkflow('openings.create').enabled,true);assert.deepEqual(getWorkflow('openings.create').planningModes,['explicit','ask','assisted']);
});
async function fixture(t,features){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'opening-mcp-contract-'));const token='opening-contract-token-'.repeat(4);const requests=[];const sockets=new Set();
 const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',data=>{buffer+=data.toString('utf8');const newline=buffer.indexOf('\n');if(newline<0)return;const request=JSON.parse(buffer.slice(0,newline));assert.equal(request.token,token);requests.push({method:request.method,args:request.params});const result=request.method==='revit.bridge.info'?{protocol:'revit-auto-2027-v2',features,confirmationMode:'chat'}:request.method==='revit.plan.create'?{planId:'opening-plan',documentIdentity:request.params.documentIdentity,documentRevision:request.params.expectedRevision,operations:request.params.operations,status:'pending',requiresConfirmation:true,requiresRevitConfirmation:false}:{unexpectedMethod:request.method};socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result})+'\n');});});
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>bridge.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('opening-mcp-contract-'));await fs.rm(dir,{recursive:true,force:true});});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const file=path.join(dir,'bridge.json');await fs.writeFile(file,JSON.stringify({port:bridge.address().port,token}));const client=new Client({name:'native-opening-sdk-contract',version:'1.0'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],env:{REVIT_AI_CONFIG:file},stderr:'pipe'}));return{client,requests};
}
const decode=result=>JSON.parse(result.content[0].text);
test('SDK explicit opening workflow forwards a pinned preview only and does not confirm or modify',async t=>{
 const {client,requests}=await fixture(t,['native-opening']);const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'openings.create',documentIdentity:'doc-a',expectedRevision:0,planningMode:'explicit',input:{openings:[wall,floor,shaft]}}});assert.notEqual(result.isError,true);const preview=decode(result);assert.equal(preview.plan.status,'pending');assert.equal(preview.plan.requiresConfirmation,true);assert.equal(preview.plan.requiresRevitConfirmation,false);assert.equal(preview.plan.operations.length,3);assert.equal(preview.plan.documentRevision,0);assert.deepEqual(requests.map(r=>r.method),['revit.bridge.info','revit.plan.create']);
});
test('SDK old host lacks native opening capability and is refused before creating a plan',async t=>{
 const {client,requests}=await fixture(t,[]);const result=await client.callTool({name:'revit_plan_create',arguments:{documentIdentity:'doc-a',expectedRevision:0,summary:'Opening preview',operations:[wall]}});assert.equal(result.isError,true);assert.equal(decode(result).code,'feature_not_loaded');assert.deepEqual(requests.map(r=>r.method),['revit.bridge.info']);
});
test('SDK ask and malformed opening inputs do not contact the native bridge',async t=>{
 const {client,requests}=await fixture(t,['native-opening']);for(const request of [{planningMode:'ask',input:{openings:[wall]}},{planningMode:'explicit',input:{openings:[{openingKind:'wall_rectangle'}]}}]){const result=await client.callTool({name:'revit_workflow_run',arguments:{name:'openings.create',documentIdentity:'doc-a',...request}});assert.notEqual(result.isError,true);assert.equal(decode(result).planCreated,false);}
 const bad=await client.callTool({name:'revit_workflow_run',arguments:{name:'openings.create',documentIdentity:'doc-a',input:{openings:[{...wall,hostElementId:'@newWall'}]}}});assert.equal(bad.isError,true);assert.deepEqual(requests,[]);
});
test('native opening execution uses existing transaction engine, host/profile verification and uncertainty disclosure (source contract)',async()=>{
 const service=await fs.readFile(path.join(root,'v27/OpeningService.cs'),'utf8');assert.match(service,/doc\.Create\.NewOpening/);assert.match(service,/OpeningRules\.EdgesMatch/);assert.match(service,/opening\.Host\?\.Id!=host\.Id/);assert.match(service,/exactCutImpactVerified=false/);assert.match(service,/sideEffectsVerified=false/);assert.match(service,/cutDirectionIndependentlyVerified=false/);assert.doesNotMatch(service,/new Transaction|\.Save\(|\.SaveAs\(|TaskDialog|OpenDocumentFile/);
 const executor=await fs.readFile(path.join(root,'v27/ModelExecutor.cs'),'utf8');assert.match(executor,/case "create_opening": ValidateOpening\(op\)/);assert.match(executor,/case "create_opening": created = CreateOpening\(op\)/);assert.match(executor,/OpeningService\.Verify\(Doc,\(Opening\)created,op\)/);
 const router=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');assert.match(router,/OpeningService\.Preview\(doc,op\)/);assert.match(router,/"native-opening"/);
});
