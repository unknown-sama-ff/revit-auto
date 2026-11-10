#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {callRevit} from './bridge.mjs';
import {createUuidV7} from './acceptance-run.mjs';

const root=path.resolve(import.meta.dirname,'..');
const project=path.join(root,'acceptance/models/floor-side-effect-isolated-20261020.rvt');
const normalize=p=>path.resolve(p).toLowerCase(),sha=b=>createHash('sha256').update(b).digest('hex');
const readJson=async p=>JSON.parse(await fs.readFile(p,'utf8'));
async function fileState(p){
 const a=await fs.stat(p,{bigint:true}),bytes=await fs.readFile(p),b=await fs.stat(p,{bigint:true});
 assert.equal(a.size,b.size);assert.equal(a.mtimeNs,b.mtimeNs);
 return {path:p,bytes:bytes.length,sha256:sha(bytes),mtimeNs:b.mtimeNs.toString()};
}
export async function hashRunArtifacts(directory){
 const hashes={};for(const name of await fs.readdir(directory)){
  const target=path.join(directory,name);if((await fs.stat(target)).isFile())hashes[name]=sha(await fs.readFile(target));
 }return hashes;
}

// Fixed read-only acceptance recipe; no arbitrary file, query, script or model plan input.
export async function acceptDiagnosticResults(){
 const client=new Client({name:'diagnostic-results-native-acceptance',version:'1'}),calls=[];
 const sourcePaths=['mcp/diagnostic-results.mjs','mcp/diagnostics-query.mjs','mcp/bridge.mjs','mcp/workflow-registry.mjs','mcp/revit-custom.mjs','mcp/diagnostic-results-acceptance.mjs'];
 const sources=await Promise.all(sourcePaths.map(async p=>({path:p,bytes:await fs.readFile(path.join(root,p))})));
 const sourceHashes=Object.fromEntries(sources.map(s=>[s.path,sha(s.bytes)]));
 const requireUnchangedSources=async()=>{for(const s of sources)assert.equal(sha(await fs.readFile(path.join(root,s.path))),sourceHashes[s.path],s.path+' changed during acceptance');};
 let directory,runId;
 const write=async(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 const native=async(method,args={})=>{
  assert.ok(['revit.bridge.info','revit.search'].includes(method));
  const result=await callRevit(method,args,undefined,method==='revit.search'?{requiredFeatures:['readonly-query-pins']}:{});
  calls.push({via:'native',method,args,result});return result;
 };
 const tool=async(name,args={})=>{
  assert.ok(['revit_workflow_list','revit_context_get','revit_workflow_run'].includes(name));
  if(name==='revit_workflow_run')assert.ok(['diagnostics.query','diagnostics.result'].includes(args.name));
  const raw=await client.callTool({name,arguments:args});calls.push({via:'sdk',name,args,raw});
  const result=JSON.parse(raw.content.find(c=>c.type==='text').text);
  if(raw.isError)throw Object.assign(new Error(result.message),result);return {result,raw};
 };
 try{
  const env={};for(const k of ['REVIT_AI_CONFIG','REVIT_AI_TIMEOUT_MS','REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS'])if(process.env[k]!==undefined)env[k]=process.env[k];
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],stderr:'pipe',env}));
  const {result:before}=await tool('revit_context_get');
  if(before.active!==true||before.document?.isFamilyDocument!==false)
   return {status:'PROJECT_DOCUMENT_REQUIRED',message:'Switch to the already-open isolated project tab. No document was opened/closed or saved, and no target search/inspection was sent.'};
  if(typeof before.document.identity!=='string'||!before.document.identity.trim()||!Number.isSafeInteger(before.document.revision)||before.document.revision<0||
     typeof before.document.path!=='string'||typeof before.document.isModified!=='boolean'||typeof before.document.isReadOnly!=='boolean')
   return {status:'UNVERIFIED_DOCUMENT_STATE',message:'Document identity/revision or state evidence is incomplete. No target query was sent.'};
  if(normalize(before.document.path)!==normalize(project))
   return {status:'REVIEWED_PROJECT_REQUIRED',message:'The active project is not the fixed isolated acceptance copy. No target query was sent.'};
  if(before.document.isModified!==false)
   return {status:'UNMODIFIED_BASELINE_REQUIRED',message:'The project is modified; no save is requested and no target query was sent.'};
  const prepared=await readJson(path.join(root,'acceptance/preparations/family-empty-owner-20261028/registration-prepared.json'));
  const plugin=await native('revit.bridge.info');assert.equal(plugin.protocol,'revit-auto-2027-v2');assert.equal(plugin.moduleVersionId,prepared.candidateMvid);
  assert.ok(Number.isSafeInteger(plugin.pid)&&plugin.pid>0);
  assert.ok(plugin.features.includes('readonly-query-pins'));assert.equal(sha(await fs.readFile(prepared.candidateDll)).toUpperCase(),prepared.candidateDllSha256);
  const {result:catalog}=await tool('revit_workflow_list');
  for(const id of ['diagnostics.query','diagnostics.result']){const w=catalog.workflows.find(w=>w.workflowId===id);assert.ok(w?.enabled);assert.equal(w.destructiveLevel,'read-only');}
  const diskBefore=await fileState(project),query={category:'OST_Walls',types:false,offset:0,limit:100};
  const pins={documentIdentity:before.document.identity,expectedRevision:before.document.revision};
  await requireUnchangedSources();
  runId=createUuidV7();directory=path.join(root,'acceptance/runs',runId);await fs.mkdir(directory);
  await write('manifest.json',{schemaVersion:1,runId,taskId:'foundation.runtime-diagnostics',profile:'readonly-diagnostic-result-pages',
   createdAtUtc:new Date().toISOString(),scope:'One bounded wall-search baseline and summary/page comparison on fixed isolated project',
   pluginMvid:plugin.moduleVersionId,sourceHashes,notApplicable:['preview','confirmation','execution','save','reopen','visual'],modelWritesRequested:0});
  for(const s of sources){const target=path.join(directory,'source-snapshot',s.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,s.bytes,{flag:'wx'});}
  const tools=await client.listTools();await write('mcp-tools.json',tools);
  await write('baseline.json',{schemaVersion:1,runId,plugin,before,diskBefore,query,pins,mcpServer:client.getServerVersion()});
  // One independent native baseline is intentional. Paging itself must not re-execute the source search.
  const baseline=await native('revit.search',{...query,...pins});assert.ok(Array.isArray(baseline.items));
  await write('native-search-baseline.json',baseline);
  const summary=await tool('revit_workflow_run',{name:'diagnostics.query',...pins,input:{...query,responseMode:'summary'}});
  assert.equal(summary.result.status,'read_only_result_summary');assert.equal(summary.result.sections.search.capturedCount,baseline.items.length);
  assert.equal(summary.result.sections.search.nativeHasMore,baseline.hasMore);assert.equal(summary.result.sourcePlugin.moduleVersionId,plugin.moduleVersionId);
  assert.equal(summary.result.sourcePlugin.pid,plugin.pid);assert.equal(summary.result.documentIdentity,pins.documentIdentity);
  assert.equal(summary.result.documentRevision,pins.expectedRevision);await write('query-summary.json',summary);
  const handle=summary.result.resultHandle,captured=[],pages=[];
  const firstLimit=baseline.items.length>1?Math.min(5,baseline.items.length-1):1;
  const first=await tool('revit_workflow_run',{name:'diagnostics.result',...pins,input:{resultHandle:handle,section:'search',offset:0,limit:firstLimit}});
  captured.push(...first.result.items);pages.push(first);
  if(first.result.hasMore){const next=await tool('revit_workflow_run',{name:'diagnostics.result',...pins,
   input:{resultHandle:handle,section:'search',offset:captured.length,limit:100}});captured.push(...next.result.items);pages.push(next);}
  assert.equal(pages.at(-1).result.hasMore,false);assert.deepEqual(captured,baseline.items);
  for(const p of pages){assert.equal(p.result.snapshotSha256,summary.result.snapshotSha256);assert.equal(p.result.sourceSearchHasMore,baseline.hasMore);
   assert.equal(p.result.capturedSnapshotOnly,true);assert.equal(p.result.writeAuthorization,false);}
  await write('cached-pages.json',pages);
  const {result:after}=await tool('revit_context_get'),pluginAfter=await native('revit.bridge.info'),diskAfter=await fileState(project);
  assert.ok(isDeepStrictEqual(before,after));assert.ok(isDeepStrictEqual(plugin,pluginAfter));assert.deepEqual(diskBefore,diskAfter);
  await requireUnchangedSources();
  await write('after.json',{schemaVersion:1,runId,after,pluginAfter,diskAfter,fullContextUnchanged:true,diskUnchanged:true});
  await write('calls.json',calls);const hashes=await hashRunArtifacts(directory);
  const result={schemaVersion:1,runId,taskId:'foundation.runtime-diagnostics',status:'SCOPED_SDK_NATIVE_RESULT_PAGING_ACCEPTED',
   capturedAtUtc:new Date().toISOString(),document:before.document,moduleVersionId:plugin.moduleVersionId,pid:plugin.pid,
   capturedCount:captured.length,sourceNativeHasMore:baseline.hasMore,cachedPageCount:pages.length,allCapturedRecordsEqualNativeBaseline:true,
   summaryMcpResultBytes:Buffer.byteLength(JSON.stringify(summary.raw),'utf8'),fullContextUnchanged:true,diskUnchanged:true,
   observationScope:'fresh-sdk-process',currentChatConnectionVerified:false,
   directNativeBaselineSearchCalls:1,sdkSummaryQueries:1,sdkPageReads:pages.length,
   pageTargetCallsIndependentlyMeasured:false,pageNoRequeryEvidence:'source guard and SDK/mock trace; live cache pages equal independent native baseline',
   limits:['Bounded wall search only; no native pagination or universal tool cache acceptance.','TTL, eviction, changed-state refusal and cross-process isolation have offline tests, not destructive native injections.'],
   actionCounters:{modelWritesRequested:0,planCreateCalls:0,confirmCalls:0,saveCalls:0,restartCalls:0,documentOpenCloseCalls:0,familyLoadCalls:0},evidenceHashes:hashes};
  await write('summary.json',result);return {status:result.status,runId,directory,capturedCount:captured.length,cachedPages:pages.length,diskUnchanged:true};
 }catch(e){if(directory)await write('failure.json',{runId,code:e.code??null,message:e.message,calls,automaticRetryAllowed:false});throw e;}
 finally{await client.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await acceptDiagnosticResults();console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='SCOPED_SDK_NATIVE_RESULT_PAGING_ACCEPTED'?0:2;}
 catch(e){console.error(JSON.stringify({status:'ACCEPTANCE_FAILED_NO_RETRY',code:e.code??null,message:e.message}));process.exitCode=1;}
}
