import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assessRuntimeDiagnostic,probeRuntimeDiagnostic,parseRuntimeDiagnosticArgs} from '../runtime-diagnostics.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const id='11111111-2222-4333-8444-555555555555',other='66666666-7777-4888-8999-aaaaaaaaaaaa';
const plugin={protocol:'revit-auto-2027-v2',moduleVersionId:id,pid:42,features:['family-text-notes'],version:'0.4.0',revitBuild:'27.3'};
const context={active:true,document:{title:'THS-A1.rfa',path:'',identity:'family-session',revision:0,isModified:true,isReadOnly:false,isFamilyDocument:true},
 familyDocumentScope:{ownerFamilyAvailable:true,documentTitle:'THS-A1.rfa',familyName:'Actual native owner',categoryId:-2000280}};
const catalog={workflows:[{workflowId:'families.text_notes',enabled:true}]};
const observations=()=>({pluginBefore:structuredClone(plugin),pluginAfter:structuredClone(plugin),context:structuredClone(context),
 workflowCatalog:structuredClone(catalog),serverInfo:{name:'revit-custom',version:'0.4.0'},toolCount:40});
const options={expectedMvid:id,requiredFeatures:['family-text-notes'],requiredWorkflows:['families.text_notes']};

test('runtime diagnosis preserves actual owner separate from title and never grants write permission',()=>{
 const o=observations(),before=structuredClone(o),r=assessRuntimeDiagnostic(o,options);
 assert.equal(r.status,'observed');assert.deepEqual(r.issues,[]);assert.equal(r.documentState,'family');
 assert.equal(r.document.title,'THS-A1.rfa');assert.equal(r.familyDocumentScope.familyName,'Actual native owner');
 assert.equal(r.document.isModified,true);assert.equal(r.writeAuthorization,false);assert.equal(r.nativeAcceptanceCertified,false);
 assert.equal(r.currentChatConnectionVerified,false);assert.deepEqual(o,before);
 assert.ok(Object.values(r.actionCounters).every(v=>v===0));
});
test('runtime diagnosis separates stale DLL and stale MCP catalog with expected actual evidence',()=>{
 const o=observations();o.workflowCatalog={workflows:[]};
 const r=assessRuntimeDiagnostic(o,{...options,expectedMvid:other});
 assert.deepEqual(r.issues.map(v=>v.code),['PLUGIN_MODULE_MISMATCH','MCP_WORKFLOW_MISSING']);
 assert.equal(r.issues[0].expected,other);assert.equal(r.issues[0].observed,id);
 assert.match(r.issues[1].nextAction,/does not require restarting Revit/);
 assert.ok(r.issues.every(i=>i.automaticRetryAllowed===false));
});
test('unknown capabilities and family scope remain unknown instead of guessed or absent-as-false',()=>{
 const o=observations();delete o.context.familyDocumentScope;
 let r=assessRuntimeDiagnostic(o,options);assert.equal(r.familyDocumentScope,null);assert.equal(r.documentState,'family');
 assert.equal(r.issues[0].code,'FAMILY_SCOPE_UNAVAILABLE');
 o.pluginBefore={protocol:'old'};o.pluginAfter=undefined;r=assessRuntimeDiagnostic(o,options);
 assert.equal(r.plugin,null);assert.ok(r.issues.some(v=>v.code==='NATIVE_IDENTITY_UNAVAILABLE'));
 assert.ok(!r.issues.some(v=>v.code==='NATIVE_FEATURE_MISSING'));
 const known=observations();known.pluginBefore.features=[];known.pluginAfter.features=[];
 assert.equal(assessRuntimeDiagnostic(known,options).issues[0].code,'NATIVE_FEATURE_MISSING');
});
test('runtime diagnosis does not accept malformed catalogs scope or a changing plugin binding',()=>{
 const o=observations();o.pluginAfter.pid++;
 assert.equal(assessRuntimeDiagnostic(o,options).plugin.bindingVerified,false);
 o.workflowCatalog.workflows.push({...o.workflowCatalog.workflows[0]});
 assert.ok(assessRuntimeDiagnostic(o,options).issues.some(i=>i.code==='MCP_CATALOG_UNAVAILABLE'));
 o.context.familyDocumentScope.documentTitle='another family';
 assert.ok(assessRuntimeDiagnostic(o,options).issues.some(i=>i.code==='FAMILY_SCOPE_UNAVAILABLE'));
 const empty=observations();empty.context.familyDocumentScope.familyName='';
 const r=assessRuntimeDiagnostic(empty,options);assert.equal(r.familyDocumentScope.familyName,'');
 assert.equal(r.issues[0].code,'FAMILY_QUERY_CONTRACT_UNSUPPORTED');
 empty.pluginBefore.features.push('family-text-known-empty-owner');empty.pluginAfter.features.push('family-text-known-empty-owner');
 assert.equal(assessRuntimeDiagnostic(empty,options).status,'observed');
 empty.context.familyDocumentScope.familyName=null;
 assert.equal(assessRuntimeDiagnostic(empty,options).issues[0].code,'FAMILY_SCOPE_INCOMPLETE');
});
test('no open document is explicit and only becomes an unmet requirement when requested',()=>{
 const o=observations();o.context={active:false};
 assert.equal(assessRuntimeDiagnostic(o,options).documentState,'none');
 assert.equal(assessRuntimeDiagnostic(o,options).status,'observed');
 assert.equal(assessRuntimeDiagnostic(o,{...options,requireActiveDocument:true}).issues[0].code,'NO_ACTIVE_DOCUMENT');
});
test('diagnostic summary omits large catalogs while original native data remains complete in evidence',async()=>{
 const calls=[],large={...structuredClone(context),familyTypes:Array.from({length:400},(_,i)=>({id:i+1,name:'A'.repeat(100)}))};
 const r=await probeRuntimeDiagnostic({...options,toolCount:40,serverInfo:{name:'revit-custom',version:'0.4.0'},
  nativeCall:async(m,a)=>{calls.push(m);return plugin;},toolCall:async m=>{calls.push(m);return m==='revit_workflow_list'?catalog:large;}});
 assert.deepEqual(calls,['revit.bridge.info','revit_workflow_list','revit_context_get','revit.bridge.info']);
 assert.equal(r.evidence.context.familyTypes.length,400);assert.equal(r.report.document.familyTypes,undefined);
 assert.ok(Buffer.byteLength(JSON.stringify(r.report))<Buffer.byteLength(JSON.stringify(r.evidence))/5);
});
test('failed bridge is not retried and does not trigger a native context request',async()=>{
 const calls=[];const r=await probeRuntimeDiagnostic({...options,nativeCall:async m=>{calls.push(m);throw Object.assign(new Error('offline'),{code:'ECONNREFUSED'});},
  toolCall:async m=>{calls.push(m);return catalog;}});
 assert.deepEqual(calls,['revit.bridge.info','revit_workflow_list']);assert.equal(r.report.status,'attention-required');
 assert.deepEqual(r.evidence.errors,[{stage:'native-info-before',code:'ECONNREFUSED',message:'offline'}]);
});
test('context error has one attempt and cancellation stops the diagnostic sequence',async()=>{
 const calls=[];const r=await probeRuntimeDiagnostic({...options,nativeCall:async m=>{calls.push(m);return plugin;},toolCall:async m=>{
  calls.push(m);if(m==='revit_context_get')throw Object.assign(new Error('busy'),{code:'host_busy'});return catalog;}});
 assert.equal(calls.filter(m=>m==='revit_context_get').length,1);assert.equal(r.evidence.errors[0].code,'host_busy');
 const ac=new AbortController();ac.abort();let count=0;
 await assert.rejects(probeRuntimeDiagnostic({...options,signal:ac.signal,nativeCall:async()=>count++,toolCall:async()=>count++}));assert.equal(count,0);
 const during=new AbortController();count=0;
 await assert.rejects(probeRuntimeDiagnostic({...options,signal:during.signal,nativeCall:async()=>{count++;during.abort();return plugin;},toolCall:async()=>count++}));
 assert.equal(count,1);
});
test('strict CLI arguments reject executable payload paths duplicates and missing values before I/O',()=>{
 assert.equal(parseRuntimeDiagnosticArgs(['--expected-mvid',id,'--require-feature','family-text-notes','--evidence']).evidence,true);
 for(const a of [['--save'],['--expected-mvid'],['--expected-mvid','wrong'],['--expected-mvid',id,'--expected-mvid',other],
  ['--evidence','--evidence'],['--require-feature','x','--require-feature','x'],['--require-workflow','--evidence'],['--output','anything']])
  assert.throws(()=>parseRuntimeDiagnosticArgs(a));
 assert.throws(()=>assessRuntimeDiagnostic(observations(),{code:'arbitrary'}));
});

async function bridge(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-health-')),requests=[],sockets=new Set(),token='runtime-diagnostic-test-'.repeat(3);
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let data='';
  socket.on('data',chunk=>{data+=chunk.toString('utf8');if(!data.includes('\n'))return;const req=JSON.parse(data.slice(0,data.indexOf('\n')));
   assert.equal(req.token,token);requests.push(req.method);
   const result=req.method==='revit.bridge.info'?plugin:req.method==='revit.context.get'?context:null;
   socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:!!result,result,error:result?undefined:{code:'unexpected_method',message:req.method}})+'\n');
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const config=path.join(dir,'bridge.json');
 await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('runtime-health-'));
  await fs.rm(dir,{recursive:true,force:true});});
 const run=async args=>{try{return {...await promisify(execFile)(process.execPath,[path.join(root,'mcp/health.mjs'),...args],
  {cwd:root,env:{...process.env,REVIT_AI_CONFIG:config,REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS:'0'}}),code:0};}
  catch(e){return {stdout:e.stdout,stderr:e.stderr,code:e.code};}};
 return {requests,run};
}
test('health CLI uses real SDK initialize discovery and reads with clean JSON output',async t=>{
 const f=await bridge(t),r=await f.run(['--expected-mvid',id,'--require-feature','family-text-notes','--require-workflow','families.text_notes']);
 assert.equal(r.code,0,r.stdout+r.stderr);const report=JSON.parse(r.stdout);
 assert.equal(report.status,'observed');assert.equal(report.mcp.serverInfo.name,'revit-custom');assert.ok(report.mcp.toolCount>=40);
 assert.equal(report.plugin.moduleVersionId,id);assert.equal(report.familyDocumentScope.familyName,'Actual native owner');
 assert.equal(report.currentChatConnectionVerified,false);assert.ok(f.requests.every(m=>['revit.bridge.info','revit.context.get'].includes(m)));
 assert.equal(f.requests.filter(m=>m==='revit.context.get').length,1);
});
test('health CLI reports expected build mismatch and rejects invalid arguments without native calls',async t=>{
 const f=await bridge(t),r=await f.run(['--expected-mvid',other]);assert.equal(r.code,1);
 assert.equal(JSON.parse(r.stdout).issues[0].code,'PLUGIN_MODULE_MISMATCH');const before=f.requests.length;
 const bad=await f.run(['--save']);assert.equal(bad.code,2);assert.equal(JSON.parse(bad.stdout).status,'diagnostic-failed');
 assert.equal(f.requests.length,before);
});
test('health CLI publishes key-only spelling guidance and never connects to native Revit on rejected arguments',async t=>{
 const f=await bridge(t),r=await f.run(['--expected_mvid','PRIVATE-CLI-VALUE']);
 assert.equal(r.code,2);const report=JSON.parse(r.stdout);assert.equal(report.code,'invalid_diagnostic_arguments');
 assert.equal(report.details.invalid_arguments.unknown[0].did_you_mean,'--expected-mvid');
 assert.ok(!r.stdout.includes('PRIVATE-CLI-VALUE'));assert.deepEqual(f.requests,[]);
 assert.equal(report.automaticRetryAllowed,false);assert.equal(report.modelWritesRequested,0);
});
