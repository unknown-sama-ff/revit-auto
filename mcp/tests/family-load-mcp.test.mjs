import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const catalogHash='b'.repeat(64);
const asset={familyKey:'reviewed-panel',sha256:'a'.repeat(64),expectedFamilyName:'Reviewed Panel',expectedCategoryId:-2001040,requiredTypes:['Reviewed Type']};
const request={name:'families.load',planningMode:'explicit',documentIdentity:'doc-a',expectedRevision:0,input:{families:[{familyKey:asset.familyKey,conflictPolicy:'keep_existing',overwriteTypeParameters:false}]}};
async function fixture(t,{features=['controlled-family-loading','family-catalog-snapshot'],contextPatch={},catalogPatch={},planError,stalePlan=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-family-load-mcp-'));
 const token='family-load-test-token-'.repeat(4);const calls=[],sockets=new Set();
 const catalog={documentIdentity:'doc-a',documentRevision:0,catalogSha256:catalogHash,assets:[asset],...catalogPatch};
 const bridge=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
  socket.on('data',chunk=>{
   buffer+=chunk.toString('utf8');const i=buffer.indexOf('\n');if(i<0)return;
   const r=JSON.parse(buffer.slice(0,i));assert.equal(r.token,token);calls.push(r);
   let payload;
   if(r.method==='revit.bridge.info')payload={ok:true,result:{protocol:'revit-auto-2027-v2',features,confirmationMode:'chat',version:'fixture'}};
   else if(r.method==='revit.context.get')payload={ok:true,result:{active:true,document:{identity:'doc-a',revision:0,isFamilyDocument:false,...contextPatch}}};
   else if(r.method==='revit.family.library.get')payload={ok:true,result:catalog};
   else if(r.method==='revit.plan.create')payload=planError?{ok:false,error:{code:planError,message:'Native preview refused; no write committed'}}:{ok:true,result:{planId:'fixture-plan',documentIdentity:'doc-a',documentRevision:stalePlan?1:0,operations:r.params.operations,status:'pending',requiresConfirmation:true,requiresRevitConfirmation:false,warnings:[]}};
   else if(r.method==='revit.plan.cancel')payload={ok:true,result:{planId:r.params.planId,status:'cancelled'}};
   else payload={ok:false,error:{code:'unexpected_write',message:'Fixture forbids execution and save'}};
   socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',...payload})+'\n');
  });
 });
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>bridge.close(resolve));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('revit-family-load-mcp-'));await fs.rm(dir,{recursive:true,force:true});});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const config=path.join(dir,'bridge.json');await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token}));
 const client=new Client({name:'family-load-stdio-contract',version:'1.0'});t.after(()=>client.close());
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
 return {client,calls};
}
async function call(client,name,arguments_){const r=await client.callTool({name,arguments:arguments_});return {error:r.isError===true,data:JSON.parse(r.content[0].text)};}
const writes=calls=>calls.filter(c=>!['revit.bridge.info','revit.context.get','revit.family.library.get','revit.plan.create','revit.plan.cancel'].includes(c.method));

test('family loading is discoverable and workflow preview binds catalog/asset hashes via real stdio',async t=>{
 const {client,calls}=await fixture(t);const tools=(await client.listTools()).tools;
 const catalogTool=tools.find(t=>t.name==='revit_family_library_get');assert.equal(catalogTool.annotations.readOnlyHint,true);assert.equal(catalogTool.annotations.destructiveHint,false);
 assert.ok(tools.some(t=>t.name==='revit_workflow_run'));assert.ok(!tools.some(t=>/send_code|execute_script/.test(t.name)));
 const r=await call(client,'revit_workflow_run',request);assert.equal(r.error,false);assert.equal(r.data.plan.status,'pending');assert.equal(r.data.plan.requiresRevitConfirmation,false);
 const plan=calls.find(c=>c.method==='revit.plan.create');assert.equal(plan.params.expectedRevision,0);assert.equal(plan.params.documentIdentity,'doc-a');
 assert.deepEqual(plan.params.operations,[{operationType:'load_family',catalogSha256:catalogHash,familyKey:asset.familyKey,sha256:asset.sha256,expectedFamilyName:asset.expectedFamilyName,expectedCategoryId:asset.expectedCategoryId,requiredTypes:asset.requiredTypes,conflictPolicy:'keep_existing',overwriteTypeParameters:false}]);
 assert.equal(writes(calls).length,0);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);
});
test('workflow rejects paths scripts and extra operation fields before any native request',async t=>{
 const {client,calls}=await fixture(t);
 for(const patch of [{filePath:'outside.rfa'},{scriptPath:'load.csx'},{code:'execute'},{id:'typeAlias'},{catalogSha256:catalogHash}]){
  const r=await call(client,'revit_workflow_run',{...request,input:{families:[{...request.input.families[0],...patch}]}});assert.equal(r.error,true);
 }
 assert.equal(calls.length,0);
});
test('unknown catalog key never reaches native plan creation',async t=>{
 const {client,calls}=await fixture(t);const r=await call(client,'revit_workflow_run',{...request,input:{families:[{familyKey:'not-registered',conflictPolicy:'reject',overwriteTypeParameters:false}]}});
 assert.equal(r.error,true);assert.equal(r.data.code,'family_not_registered');assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);assert.equal(writes(calls).length,0);
});
test('native catalog without snapshot hash is refused without a preview',async t=>{
 const {client,calls}=await fixture(t,{catalogPatch:{catalogSha256:undefined}});const r=await call(client,'revit_workflow_run',request);
 assert.equal(r.error,true);assert.equal(r.data.code,'feature_not_loaded');assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});
test('old host lacking snapshot feature is blocked before plan.create is forwarded',async t=>{
 const {client,calls}=await fixture(t,{features:['controlled-family-loading']});const r=await call(client,'revit_workflow_run',request);
 assert.equal(r.error,true);assert.equal(r.data.code,'feature_not_loaded');assert.ok(r.data.details.requiredFeatures.includes('family-catalog-snapshot'));assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,0);
});
for(const code of ['family_catalog_changed','family_asset_changed','shared_family_not_supported']){
 test('native '+code+' is propagated once and never retried or confirmed',async t=>{
  const {client,calls}=await fixture(t,{planError:code});const r=await call(client,'revit_workflow_run',request);assert.equal(r.error,true);assert.equal(r.data.code,code);assert.equal(calls.filter(c=>c.method==='revit.plan.create').length,1);assert.equal(writes(calls).length,0);
 });
}
test('stale native family preview is cancelled once and never confirmed',async t=>{
 const {client,calls}=await fixture(t,{stalePlan:true});const r=await call(client,'revit_workflow_run',request);
 assert.equal(r.error,true);assert.equal(r.data.code,'document_revision_changed');assert.deepEqual(calls.filter(c=>c.method==='revit.plan.cancel').map(c=>c.params),[{planId:'fixture-plan'}]);assert.equal(writes(calls).length,0);
});
test('wrong workflow revision is rejected before catalog or plan queries',async t=>{
 const {client,calls}=await fixture(t,{contextPatch:{revision:1}});const r=await call(client,'revit_workflow_run',request);
 assert.equal(r.error,true);assert.equal(r.data.code,'document_revision_changed');assert.equal(calls.filter(c=>c.method==='revit.family.library.get'||c.method==='revit.plan.create').length,0);
});
