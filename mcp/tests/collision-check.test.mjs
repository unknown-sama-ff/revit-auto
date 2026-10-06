import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {collisionInputSchema, collisionCategories} from '../collision-request.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const valid = {documentIdentity:'test-document',expectedRevision:0,targetElementIds:[10],excludeElementIds:[11],clearanceMm:0};

test('collision schema preserves zero revision and no guessed clearance', () => {
  assert.deepEqual(collisionInputSchema.parse(valid), valid);
  assert.deepEqual(collisionInputSchema.parse({documentIdentity:'doc',targetElementIds:[10]}), {documentIdentity:'doc',targetElementIds:[10]});
});
test('collision schema rejects NaN/infinity, negative clearance, and zero tolerance', () => {
  for (const value of [NaN,Infinity,-Infinity,-1,10001,'300',null]) assert.equal(collisionInputSchema.safeParse({...valid,clearanceMm:value}).success,false);
  for (const value of [0,-1,NaN,Infinity,11,null,'1']) assert.equal(collisionInputSchema.safeParse({...valid,toleranceMm:value}).success,false);
});
test('collision schema rejects malformed ids, exclusions, duplicate categories and excessive scope', () => {
  for (const input of [
    {...valid,targetElementIds:[]}, {...valid,targetElementIds:[0]}, {...valid,targetElementIds:['@route']},
    {...valid,targetElementIds:[Number.MAX_SAFE_INTEGER+1]}, {...valid,targetElementIds:[10,10]},
    {...valid,targetElementIds:Array.from({length:51},(_,i)=>i+100)},
    {...valid,excludeElementIds:[10]}, {...valid,excludeElementIds:[11,11]},
    {...valid,candidateCategories:['OST_Rooms']}, {...valid,candidateCategories:['OST_Walls','OST_Walls']},
    {...valid,maxCandidates:0}, {...valid,maxCandidates:1001}, {...valid,maxCandidates:1.5},
    {...valid,expectedRevision:-1}, {...valid,expectedRevision:Number.MAX_SAFE_INTEGER+1},
    {...valid,documentIdentity:' '}, {...valid,move:true}
  ]) assert.equal(collisionInputSchema.safeParse(input).success,false,JSON.stringify(input));
});
test('native and MCP collision category lists match exactly', async () => {
  const source=await fs.readFile(path.join(root,'v27/CollisionCheckRules.cs'),'utf8');
  assert.deepEqual([...source.matchAll(/"(OST_\w+)"/g)].map(m=>m[1]),collisionCategories);
});
test('native collision service is query-only, bounded, and preserves geometry failures (source contract)', async () => {
  const source=await fs.readFile(path.join(root,'v27/CollisionCheckService.cs'),'utf8');
  assert.doesNotMatch(source,/new Transaction|\.Save\(|\.SaveAs\(|\.Delete\(|\.Regenerate\(|DirectShape|\.Set\(/);
  assert.match(source,/Error is null && Solids.Count > 0/);
  assert.match(source,/BoundingBoxIntersectsFilter/);
  assert.match(source,/transform.Multiply\(instance.Transform\)/);
  assert.match(source,/SolidUtils.CreateTransformed/);
  assert.match(source,/BooleanOperationsUtils.ExecuteBooleanOperation/);
  assert.match(source,/finally \{ foreach \(var snapshot in snapshots.Values\) snapshot.Dispose\(\); \}/);
  assert.match(source,/targetGroupExcludedFromExternalCandidates = true/);
  assert.match(source,/includesLinkedModels = false/);
  assert.match(source,/RevitCommandRouter.Revision\(doc\) != revision/);
  assert.match(source,/complete = !truncated && unknown.Count == 0/);
  assert.match(source,/pairTruncated = selectedPairs.Length > MaxTargetCandidatePairs/);
  assert.match(source,/degenerate-solid-geometry/);
  assert.match(source,/invalid-transformed-solid/);
});

async function fixture(t,{features=['collision-check'],result,error}={}) {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'revit-collision-test-'));
  const token='collision-test-token-'.repeat(4);
  const requests=[];
  const sockets=new Set();
  const bridge=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    let buffer='';socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
      const request=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));
      assert.equal(request.token,token);requests.push({method:request.method,params:request.params});
      const response=request.method==='revit.bridge.info'
        ? {ok:true,result:{protocol:'revit-auto-2027-v2',version:'0.3.22',features,confirmationMode:'chat'}}
        : error ? {ok:false,error} : {ok:true,result};
      socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',...response})+'\n');
    });
  });
  t.after(async()=>{
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>bridge.close(resolve));
    assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('revit-collision-test-'));
    await fs.rm(folder,{recursive:true,force:true});
  });
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
  const config=path.join(folder,'bridge.json');
  await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token}));
  const client=new Client({name:'collision-contract-test',version:'1.0'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
  return {client,requests};
}

test('collision MCP is discoverable and read-only without a write approval flag (mock)',async t=>{
  const {client}=await fixture(t,{result:{}});
  const tools=await client.listTools();const tool=tools.tools.find(tool=>tool.name==='revit_collision_check');
  assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);
  assert.equal(tool.annotations.idempotentHint,true);assert.equal(tool.annotations.openWorldHint,false);
  assert.deepEqual(tool.inputSchema.required,['documentIdentity','targetElementIds']);
  assert.equal(tool.inputSchema.additionalProperties,false);
  assert.match(tool.description,/unknown geometry/);assert.match(tool.description,/Target group/);
});
test('collision MCP forwards current identity/revision and preserves exact/candidate/unknown/truncated evidence (mock)',async t=>{
  const payload={documentIdentity:'test-document',documentRevision:0,
    collisions:[{targetElementId:10,candidateElementId:20,evidence:'exact-solid-intersection',intersectionVolumeMm3:200}],
    clearanceCandidates:[{targetElementId:10,candidateElementId:21,evidence:'expanded-bounding-box-candidate',clearanceMm:300}],
    unknown:[{targetElementId:10,candidateElementId:22,reason:'boolean-intersection-unavailable'}],
    diagnostics:{truncated:true,complete:false,candidateCount:5,scannedCandidateCount:3}};
  const {client,requests}=await fixture(t,{result:payload});
  const input={...valid,clearanceMm:300};
  const result=await client.callTool({name:'revit_collision_check',arguments:input});
  assert.notEqual(result.isError,true);assert.deepEqual(JSON.parse(result.content[0].text),payload);
  assert.deepEqual(requests.map(r=>r.method),['revit.bridge.info','revit.collision.check']);
  assert.deepEqual(requests[1].params,input);
});
test('collision MCP rejects extra/malformed input before any native request (mock)',async t=>{
  const {client,requests}=await fixture(t,{result:{}});
  for(const input of [{...valid,move:true},{...valid,targetElementIds:[10,10]},{...valid,excludeElementIds:[10]},{...valid,clearanceMm:-1}]) {
    let failed=false;try{const result=await client.callTool({name:'revit_collision_check',arguments:input});failed=result.isError===true;}catch{failed=true;}
    assert.equal(failed,true);
  }
  assert.deepEqual(requests,[]);
});
test('collision MCP refuses old DLL before forwarding any collision request (mock)',async t=>{
  const {client,requests}=await fixture(t,{features:[],result:{}});
  const result=await client.callTool({name:'revit_collision_check',arguments:valid});
  assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,'feature_not_loaded');
  assert.deepEqual(requests.map(r=>r.method),['revit.bridge.info']);
});
for(const code of ['document_changed','document_revision_changed','collision_analysis_timeout','element_not_found']) {
  test(`collision MCP preserves ${code} and never retries or submits a model plan (mock)`,async t=>{
    const {client,requests}=await fixture(t,{error:{code,message:'Stop and read context again',details:{expectedRevision:0,currentRevision:1}}});
    const result=await client.callTool({name:'revit_collision_check',arguments:valid});
    assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,code);
    assert.deepEqual(requests.map(r=>r.method),['revit.bridge.info','revit.collision.check']);
  });
}


test('native Boolean failure keeps original diagnostic without certifying or perturbing geometry (source contract)', async () => {
  const source=await fs.readFile(path.join(root,'v27/CollisionCheckService.cs'),'utf8');
  assert.match(source,/CollisionBooleanDiagnostics\.Capture\(error,/);
  assert.match(source,/candidateSolidIndex/);
  assert.match(source,/booleanError \?\? "intersection-unknown", booleanDetails/);
  assert.doesNotMatch(source,/CreateTranslation|SetTransform|CreateRotation|retryBoolean|\.MoveElement/);
});


test('collision MCP preserves bounded native Boolean failure details as unknown diagnostic data (mock)',async t=>{
  const details={exceptionType:'Autodesk.Revit.Exceptions.InvalidOperationException',message:'Native geometry cannot be intersected. This is diagnostic data only.',messageTruncated:false,targetSolidIndex:0,candidateSolidIndex:3,targetSolidCount:1,candidateSolidCount:5,targetBounds:{minX:33000,minY:18000,minZ:400,maxX:34300,maxY:18000,maxZ:600},candidateBounds:{minX:33700,minY:17000,minZ:0,maxX:34400,maxY:18700,maxZ:1000}};
  const payload={documentIdentity:'test-document',documentRevision:0,collisions:[],clearanceCandidates:[],unknown:[{targetElementId:10,candidateElementId:20,role:'pair',reason:'boolean-intersection-unavailable:InvalidOperationException',details}],diagnostics:{truncated:false,complete:false,unknownCount:1}};
  const {client,requests}=await fixture(t,{features:['collision-check','collision-boolean-diagnostics'],result:payload});
  const result=await client.callTool({name:'revit_collision_check',arguments:valid});
  assert.notEqual(result.isError,true);assert.deepEqual(JSON.parse(result.content[0].text),payload);
  assert.deepEqual(requests.map(r=>r.method),['revit.bridge.info','revit.collision.check']);
});
