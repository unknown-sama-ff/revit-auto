import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('SDK gates dimension preview and preserves complete mock native readback through one confirm and status query',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'dimension-readback-')),token='offline-dimension-fixture-'.repeat(4),requests=[],sockets=new Set();
 let loaded=false;
 const native={dimensionId:100,uniqueId:'dimension-uid',className:'LinearDimension',viewId:20,typeId:30,areReferencesAvailable:true,
  axis:{origin:{xMm:500,yMm:0,zMm:0},direction:{x:-1,y:0,z:0}},isBound:false,
  references:[{stableReference:'ref-b',elementId:2,linkedElementId:-1,referenceType:'REFERENCE_TYPE_SURFACE'},
   {stableReference:'ref-a',elementId:1,linkedElementId:-1,referenceType:'REFERENCE_TYPE_SURFACE'}]};
 const check={phase:'after-transaction-commit',dimensionId:100,actualReferences:native.references,referenceCount:2,
  referenceMembershipVerified:true,referenceOrderMatches:false,referenceOrderRequired:false,supportingLineVerified:true,
  lineExtentsVerified:false,measurementVerified:false,nativeReadbackVerified:true,sideEffectsVerified:false,persistenceVerified:false,visualVerified:false};
 const receipt={planId:'mock-dimension-plan',status:'committed',createdElementIds:[100],
  documentationCreationVerification:{completedDimensionCount:1,dimensionChecks:[check]},saved:false};
 const inspection={items:[{summary:{id:100},dimensionReadback:{supported:true,scope:'linear-dimension-identity-axis-reference-observations',native,
  requestedGeometryVerified:false,measurementVerified:false,sideEffectsVerified:false}},
  {summary:{id:123},gridDimensionReference:{supported:true,scope:'local-grid-element-stable-reference',
   documentIdentity:'mock-document',documentRevision:1,gridId:123,uniqueId:'grid-uid',
   native:{stableReference:'native-grid-stable',elementId:123,linkedElementId:-1,referenceType:'REFERENCE_TYPE_NONE'},
   modelCurve:{supported:true,kind:'bounded-line',units:'mm',start:{xMm:0,yMm:0,zMm:0},end:{xMm:0,yMm:5000,zMm:0}},
   roundTripVerified:true,referenceSource:'Autodesk.Revit.DB.Reference(Grid)',dimensionSuitabilityVerified:false,
   viewVisibilityVerified:false,modelWritesRequested:false}}]};
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
  socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;
   const req=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));assert.equal(req.token,token);requests.push({method:req.method,args:req.params});
   const result=req.method==='revit.bridge.info'?{protocol:'revit-auto-2027-v2',version:'0.4.0',confirmationMode:'chat',features:['readonly-query-pins','annotation-input-contracts',...(loaded?['dimension-creation-readback']:[])]}:
    req.method==='revit.plan.create'?{planId:'mock-dimension-plan',status:'pending'}:
    ['revit.plan.confirm','revit.plan.get'].includes(req.method)?receipt:req.method==='revit.inspect'?inspection:undefined;
   socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:!!result,...(result?{result}:{error:{code:'unexpected_mock_method',message:req.method}})})+'\n');
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const config=path.join(folder,'bridge.json');await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
 const client=new Client({name:'offline-dimension-readback-sdk',version:'1'});
 t.after(async()=>{await client.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('dimension-readback-'));
  await fs.rm(folder,{recursive:true,force:true});});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],stderr:'ignore',env:{REVIT_AI_CONFIG:config,REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS:'0'}}));
 const call=async(name,args)=>{const raw=await client.callTool({name,arguments:args}),value=JSON.parse(raw.content.find(c=>c.type==='text').text);
  if(raw.isError)throw Object.assign(new Error(value.message),value);return value;};
 const args={documentIdentity:'mock-document',expectedRevision:0,summary:'Offline mock dimension',operations:[{
  operationType:'create_dimension',viewId:20,dimensionTypeId:30,start:{xMm:0,yMm:0,zMm:0},end:{xMm:1000,yMm:0,zMm:0},references:['ref-a','ref-b']}]};
 await assert.rejects(call('revit_plan_create',args),e=>e.code==='feature_not_loaded'&&e.details.requiredFeatures.includes('dimension-creation-readback'));
 assert.equal(requests.filter(r=>r.method==='revit.plan.create').length,0);
 loaded=true;assert.equal((await call('revit_plan_create',args)).status,'pending');
 assert.deepEqual(await call('revit_plan_confirm',{planId:'mock-dimension-plan'}),receipt);
 assert.deepEqual(await call('revit_plan_get',{planId:'mock-dimension-plan'}),receipt);
 assert.deepEqual(await call('revit_inspect',{documentIdentity:'mock-document',expectedRevision:1,elementIds:[100,123]}),inspection);
 assert.equal(requests.filter(r=>r.method==='revit.plan.create').length,1);assert.equal(requests.filter(r=>r.method==='revit.plan.confirm').length,1);
 assert.equal(requests.filter(r=>r.method==='revit.plan.get').length,1);assert.equal(requests.filter(r=>r.method==='revit.inspect').length,1);
 assert.deepEqual(requests.find(r=>r.method==='revit.plan.create').args,args);
});
