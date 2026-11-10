import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createLocalTestCopySupervisor,createPowerShellPlatform,readLifecycleChain,recipesFromLoadedEvidence,runSupervisorCli,sha256} from '../local-test-copy-supervisor.mjs';

const operationId='1'.repeat(32),mvid='12345678-1234-1234-1234-123456789abc';
const clone=value=>structuredClone(value),encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const scopeNames=['fullScope','architectureScope','categoryScope','typeScope','familyScope','newTypeScope','additionalNativeScope','relationScope'];
const summary=id=>({id,uniqueId:`native-${id}`,name:`Element ${id}`,className:'FamilyInstance',typeId:10,ownerViewId:-1,levelId:20});
const inspected=id=>({summary:summary(id),parameters:[{id:9,value:'kept'},{id:2,value:null}],connectors:[{connectorId:2,peers:[{elementId:4,connectorId:3},{elementId:2,connectorId:1}]}],piping:{supported:false,reason:'not_piping'},electrical:{systemIds:[2,1],memberIds:[3,2]},geometry:{vertices:[{x:0,y:1},{x:2,y:3}],parameters:[{id:2,value:'ordered'},{id:1,value:'geometry'}]},projection:null});
const dependency=id=>({elementId:id,exists:true,summary:summary(id),dependencies:{supported:true,complete:true,ids:[],count:0,truncated:false},familySymbols:{applicable:false,supported:false,complete:false,ids:[],count:null,truncated:false,reason:'not_family'}});

async function fixture(t,options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'revit-lifecycle-fixture-')),runtime=path.join(root,'runtime');await fs.mkdir(runtime);
  t.after(async()=>{assert.ok(path.basename(root).startsWith('revit-lifecycle-fixture-'));await fs.rm(root,{recursive:true,force:true});});
  const model=path.join(root,'fixed-test-copy.rvt'),exe=path.join(root,'Revit.exe'),configPath=path.join(runtime,'bridge.json');
  await fs.writeFile(model,'saved original model');await fs.writeFile(exe,'fake executable bytes');await fs.writeFile(configPath,'{"port":18765}');
  let wall=Date.parse('2026-10-11T00:00:00Z'),mono=0,oldExited=false,launched=false,scopePhase=null,readIndex=0,request,requestHash,latestState,latestHash,events=[],states=[],saveAction=null,savedFile;
  const controller=new AbortController(),calls=[],counts={save:0,exit:0,launch:0,open:0,reads:0};
  const clock={wall:()=>wall,mono:()=>mono,wait:async ms=>{const accelerated=(options.hangSave&&counts.save>0)||(options.hangOpen&&counts.open>0)||(options.noExit&&counts.exit>0)||(options.noPort&&counts.launch>0),step=accelerated?ms:1;mono+=step;wall+=step;await new Promise(resolve=>setTimeout(resolve,1));}};
  const oldProcess={pid:101,startTimeUtc:'2026-10-10T23:00:00.1230000Z',exePath:exe,exeSha256:sha256(await fs.readFile(exe)),version:'27.3.1.0',moduleVersionId:mvid,userSid:'S-1-5-21-test',sessionId:1};
  const newProcess={...oldProcess,pid:202,startTimeUtc:'2026-10-11T00:02:00.1230000Z'};
  const context={active:true,document:{identity:'2'.repeat(32),revision:3,path:model,isModified:options.modified===true,isReadOnly:false,isFamilyDocument:false},revitVersion:'2027',revitBuild:'27.3.1',counts:{elements:4},levels:[{id:20,name:'Level 1'}],familyTypes:[{id:11},{id:10}],elementTypes:[{id:10}],units:{length:'millimeters'},pagination:{complete:true},activeView:{id:30},selectedElementIds:[3,2]};
  const config={path:configPath,sha256:sha256(await fs.readFile(configPath)),aclSddl:'O:SYG:SYD:P',port:18765};
  const file=async candidate=>{const bytes=await fs.readFile(candidate);return {path:candidate,bytes:bytes.length,sha256:sha256(bytes),fileIdentity:candidate===model?'12345678:0000000000000001':'12345678:0000000000000002'};};
  const initialFile=await file(model),historicalContext=clone(context);historicalContext.document.identity='3'.repeat(32);historicalContext.document.revision=0;historicalContext.document.isModified=false;
  const items=[1,2,3,4].map(inspected),evidence={status:'ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED',loadedModuleVerified:true,savedReadScopesVerified:true,readScopePersistenceVerified:true,after:historicalContext,savedFileBefore:initialFile,savedFileAfter:initialFile,categoryIds:{Fixtures:[1,2,3,4]},typeCategoryIds:{Types:[]},dependencies:{documentIdentity:historicalContext.document.identity,documentRevision:0,items:[1,2,3,4].map(dependency),modelWritesRequested:false,automaticSave:false,relationshipScope:'native-logical-dependents-and-family-symbol-membership',allModelSideEffectsVerified:false}};
  for(const name of scopeNames)evidence[name]={items:clone(items)};
  const sourceFile=path.join(runtime,'fixed-loaded-evidence.json');await fs.writeFile(sourceFile,encode(evidence));const boundEvidence={file:path.basename(sourceFile),sha256:sha256(await fs.readFile(sourceFile))};
  const artifact=suffix=>path.join(runtime,`lifecycle-${operationId}-${suffix}.json`);
  async function append(kind,stageOrKind,data){
    const rows=kind==='state'?states:events,previous=rows.at(-1)?.hash??null;
    const value={schemaVersion:1,operationId,requestSha256:requestHash,sequence:rows.length+1,previousSha256:previous,[kind==='state'?'stage':'kind']:stageOrKind,atUtc:new Date(wall).toISOString(),data};
    const bytes=encode(value),name=artifact(`${kind}-${String(value.sequence).padStart(6,'0')}`);await fs.writeFile(name,bytes,{flag:'wx'});const row={value,hash:sha256(bytes),file:name};rows.push(row);if(kind==='state'){latestState=value;latestHash=row.hash;}return row;
  }
  async function result(recipe,reopened=false){
    let value;
    if(recipe.method==='revit.context.get'){value=clone(context);if(scopePhase){value.document.isModified=false;}if(reopened){value.document.identity='4'.repeat(32);value.document.revision=0;value.activeView={id:99};value.selectedElementIds=[];}}
    else if(recipe.method==='revit.search'){const ids=evidence[recipe.params.types?'typeCategoryIds':'categoryIds'][recipe.params.category],page=ids.slice(recipe.params.offset,recipe.params.offset+500);value={items:page.map(summary),offset:recipe.params.offset,limit:500,hasMore:recipe.params.offset+page.length<ids.length};}
    else if(recipe.method==='revit.inspect'){value={items:recipe.params.elementIds.map(id=>clone(items.find(item=>item.summary.id===id)))};if(options.driftAtPrepare&&!scopePhase)value.items[0].geometry.vertices.reverse();if(options.geometryDrift&&scopePhase==='OPEN_READBACK_PENDING')value.items[0].geometry.parameters.reverse();if(options.unorderedOnly){for(const item of value.items){item.parameters.reverse();item.connectors[0].peers.reverse();item.electrical.systemIds.reverse();item.electrical.memberIds.reverse();}}}
    else{value=clone(evidence.dependencies);value.documentIdentity=reopened?'4'.repeat(32):context.document.identity;value.documentRevision=reopened?0:context.document.revision;}
    return value;
  }
  function response(scope=null){return {operationId,requestSha256:requestHash,stage:latestState.stage,recipeCount:request.recipeCount,readIndex,readRound:Math.floor(readIndex/request.recipeCount),leaseActive:latestState.stage!=='PREVIEW_READY'&&latestState.stage!=='REOPEN_VERIFIED',exitPosted:latestState.stage==='EXIT_POSTED',modelWritesRequested:false,automaticRetry:false,allModelSideEffectsVerified:false,requestFile:artifact('request'),request:clone(request),latestState:clone(latestState),stateSha256:latestHash,eventCount:events.length,eventTailSha256:events.at(-1)?.hash??null,stopReason:null,scope};}
  async function prepared(){
    const registration=JSON.parse(await fs.readFile(path.join(runtime,'local-test-copy-registration.json'),'utf8')),recipes=registration.readRecipes,values=[];for(const recipe of recipes)values.push(await result(recipe));
    if(options.badCapturedBaseline)values.find((_,i)=>recipes[i].method==='revit.inspect').items[0].projection={changed:true};
    const snapshot={recipes,values};await fs.writeFile(artifact('baseline-snapshot'),encode(snapshot));
    request={schemaVersion:1,operationId,createdAtUtc:new Date(wall).toISOString(),expiresAtUtc:new Date(wall+600000).toISOString(),registrationSha256:sha256(await fs.readFile(path.join(runtime,'local-test-copy-registration.json'))),registration,document:{identity:context.document.identity,revision:context.document.revision,path:model,isModified:context.document.isModified},process:clone(oldProcess),bridgeConfig:clone(config),savedFile:clone(initialFile),baselineSnapshotFile:artifact('baseline-snapshot'),baselineSnapshotSha256:sha256(await fs.readFile(artifact('baseline-snapshot'))),recipeCount:recipes.length};
    await fs.writeFile(artifact('request'),encode(request));requestHash=sha256(await fs.readFile(artifact('request')));await append('state','PREVIEW_READY',{readIndex:0});return response();
  }
  const call=async(method,params)=>{
    calls.push({method,params:clone(params)});
    if(method==='revit.bridge.info')return {pid:launched?newProcess.pid:oldProcess.pid,moduleVersionId:launched&&options.wrongMvid?'87654321-4321-4321-4321-cba987654321':mvid,features:options.noCapability?[]:['local-test-copy-lifecycle']};
    if(['revit.context.get','revit.search','revit.inspect','revit.element.dependencies'].includes(method))return result({method,params});
    if(method==='revit.lifecycle.prepare')return prepared();
    assert.equal(params.operationId,operationId);assert.equal(params.requestSha256,requestHash);
    if(method==='revit.lifecycle.get'){const value=response();if(options.badResponseHash)value.stateSha256='f'.repeat(64);return value;}
    if(method==='revit.lifecycle.save_once'){
      counts.save++;assert.equal(counts.save,1);assert.ok(await fs.stat(artifact('backup')));await append('state','SAVE_STARTED',{readIndex:0});
      if(options.dialog)await append('event','dialog',{stopReason:'dialog_pending'});
      if(options.captureFailure)await append('event','event_capture_failed',{stopReason:'event_capture_incomplete'});
      if(options.hangSave||options.dialog||options.captureFailure)return new Promise(()=>{});
      if(options.rejectSave)throw Object.assign(new Error('Save acknowledgment lost'),{code:'native_disconnect'});
      if(context.document.isModified)await fs.writeFile(model,'saved once with native metadata');savedFile=await file(model);saveAction=context.document.isModified?'save_performed':'noop_already_saved';scopePhase='SAVE_READBACK_PENDING';readIndex=0;
      await append('state',scopePhase,{readIndex,savedFile,saveAction});const value=response();if(options.lateSave){mono+=120001;wall+=120001;}return value;
    }
    if(method==='revit.lifecycle.verify_scope'){
      counts.reads++;assert.equal(params.readIndex,readIndex);const phase=scopePhase,recipe=request.registration.readRecipes[readIndex%request.recipeCount],value=await result(recipe,phase==='OPEN_READBACK_PENDING');
      const scope={phase,readIndex,method:recipe.method,documentIdentity:phase==='OPEN_READBACK_PENDING'?'4'.repeat(32):context.document.identity,documentRevision:phase==='OPEN_READBACK_PENDING'?0:context.document.revision,result:value,matched:true};
      readIndex++;await append('state',readIndex===2*request.recipeCount?(phase==='SAVE_READBACK_PENDING'?'SAVE_VERIFIED':'REOPEN_VERIFIED'):phase,{readIndex,savedFile,saveAction});return response(scope);
    }
    if(method==='revit.lifecycle.post_exit_once'){
      counts.exit++;assert.equal(counts.exit,1);await append('state','EXIT_POSTED',{readIndex,savedFile,exitCommandPosted:true});oldExited=!options.noExit;
      if(!options.missingClosure)await append('event','shutdown_closed',{complete:true,stopReason:null});return response();
    }
    if(method==='revit.lifecycle.open_saved_copy_once'){
      counts.open++;assert.equal(counts.open,1);assert.ok(await fs.stat(artifact('continuation')));await append('state','OPEN_STARTED',{readIndex:0});readIndex=0;
      if(options.hangOpen)return new Promise(()=>{});scopePhase='OPEN_READBACK_PENDING';await append('state',scopePhase,{readIndex,savedFile});const value=response();if(options.lateOpen){mono+=180001;wall+=180001;}return value;
    }
    throw new Error(`Unexpected native route ${method}`);
  };
  const platform={
    file:async candidate=>{const value=await file(candidate);if(options.badBackup&&candidate!==model)value.sha256='e'.repeat(64);return value;},
    config:async()=>({...config,...(options.configChanged?{aclSddl:'changed'}:{})}),
    currentIdentity:async()=>({userSid:options.otherUser?'different-user':oldProcess.userSid,sessionId:options.otherSession?2:1}),
    inspectProcess:async pid=>{if(options.lateHandshake&&launched){mono+=180001;wall+=180001;}return {...clone(pid===newProcess.pid?newProcess:oldProcess),...(options.pidReuse&&!launched?{startTimeUtc:'2026-10-10T23:00:00.1230001Z'}:{}),...(options.newExeChanged&&launched?{exeSha256:'f'.repeat(64)}:{})};},
    capture:async()=>({id:'old-retained-handle',pid:oldProcess.pid}),
    observeHandle:async handle=>{if(options.lateExit&&handle.id==='old-retained-handle'&&oldExited){mono+=120001;wall+=120001;}return {exited:handle.id==='old-retained-handle'?oldExited:options.newEnded===true,exitCode:handle.id==='old-retained-handle'?(oldExited?(options.nonzeroExit?1:0):null):(options.newEnded?1:null)};},
    portFree:async()=>!options.portTaken,
    portOwner:async()=>launched?(options.noPort?null:options.newPortTaken?303:newProcess.pid):(oldExited?null:oldProcess.pid),
    launchEmpty:async target=>{counts.launch++;assert.equal(counts.launch,1);assert.deepEqual(target,{exePath:exe,operationId,requestSha256:requestHash});if(options.launchFailure)throw new Error('Single launch failed');if(options.cancelDuringLaunch){controller.abort();return new Promise(()=>{});}if(options.lateLaunch){mono+=180001;wall+=180001;}launched=true;return {id:'new-retained-handle',pid:newProcess.pid};}
  };
  const makeSupervisor=()=>createLocalTestCopySupervisor({root,call,platform,clock,boundEvidence,signal:controller.signal,onProgress:progress=>{if(options.cancelAtStage===progress.stage)controller.abort();}});
  let supervisor=makeSupervisor();
  return {root,runtime,model,artifact,evidence,boundEvidence,context,calls,counts,controller,platform,clock,call,prepare:()=>supervisor.prepare(),execute:()=>supervisor.execute({operationId,expectedRequestSha256:requestHash}),get request(){return request;},get hash(){return requestHash;},advance:ms=>{wall+=ms;mono+=ms;},backwards:()=>{wall-=10000;},newSupervisor:()=>{supervisor=makeSupervisor();},append,prepared,result,config,oldProcess,newProcess};
}

test('prepare is read-only, complete and session-neutral; capability gate runs first',async t=>{
  const f=await fixture(t),preview=await f.prepare();assert.equal(preview.status,'PREVIEW_READY');assert.equal(f.counts.save,0);assert.equal(f.counts.launch,0);assert.equal(f.request.registration.readRecipes.at(-1).params.documentIdentity,undefined);assert.deepEqual(f.request.registration.readRecipes.at(-1).params,{elementIds:[1,2,3,4]});
  assert.equal((await fs.readdir(f.runtime)).some(name=>name.includes('attempt')||name.includes('backup')),false);
  const missing=await fixture(t,{noCapability:true});await assert.rejects(missing.prepare,/capability/);assert.deepEqual(missing.calls.map(row=>row.method),['revit.bridge.info']);
});

for(const modified of [false,true])test(`one complete ${modified?'save':'no-op'} flow backs up, exits normally, launches empty and opens once`,async t=>{
  const f=await fixture(t,{modified});await f.prepare();const original=await fs.readFile(f.model),value=await f.execute();assert.equal(value.status,'REOPEN_VERIFIED');assert.deepEqual(f.counts,{save:1,exit:1,launch:1,open:1,reads:4*f.request.recipeCount});assert.equal(value.saveAction,modified?'save_performed':'noop_already_saved');assert.equal(value.allModelSideEffectsVerified,false);assert.equal(value.typeCopyExecutionAccepted,false);assert.equal(value.automaticRetry,false);
  const backup=await fs.readFile(path.join(f.runtime,`lifecycle-${operationId}-backup.rvt`));assert.deepEqual(backup,original);const continuation=JSON.parse(await fs.readFile(f.artifact('continuation'),'utf8'));assert.equal(continuation.oldProcess.pid,101);assert.equal(continuation.newProcess.pid,202);assert.equal(continuation.savedFile.sha256,sha256(await fs.readFile(f.model)));assert.equal(continuation.savedFile.sha256===sha256(backup),!modified);
  const before=await fs.readFile(f.artifact('supervisor-stop')).catch(()=>null);assert.equal(before,null);const repeated=await f.execute();assert.equal(repeated.reason,'lifecycle_attempt_exists');assert.deepEqual(f.counts,{save:1,exit:1,launch:1,open:1,reads:4*f.request.recipeCount});assert.equal(await fs.readFile(f.artifact('supervisor-stop')).catch(()=>null),null);
});

test('dirty or reopened context does not authorize observable model drift as a new baseline',async t=>{
  const f=await fixture(t,{modified:true,driftAtPrepare:true});await assert.rejects(f.prepare,/Inspection differs/);assert.equal(f.calls.some(row=>row.method==='revit.lifecycle.prepare'),false);assert.equal(f.counts.save,0);
});
test('native captured baseline cannot swallow geometry/projection drift',async t=>{const f=await fixture(t,{badCapturedBaseline:true});await assert.rejects(f.prepare,/Inspection differs/);assert.equal(f.counts.save,0);});
test('overlapping historical scopes must agree exactly',async t=>{const f=await fixture(t);f.evidence.typeScope.items[0].projection={unknown:true};const file=path.join(f.runtime,f.boundEvidence.file);await fs.writeFile(file,encode(f.evidence));f.boundEvidence.sha256=sha256(await fs.readFile(file));await assert.rejects(f.prepare,/Overlapping/);});
test('only known unordered native collections are canonicalized',async t=>{const f=await fixture(t,{unorderedOnly:true});await f.prepare();assert.equal((await f.execute()).status,'REOPEN_VERIFIED');});
test('ordered geometry arrays remain significant during reopened readback',async t=>{const f=await fixture(t,{geometryDrift:true});await f.prepare();assert.equal((await f.execute()).status,'STOPPED');assert.equal(f.counts.open,1);assert.equal(f.counts.launch,1);});

for(const [option,expected] of [['hangSave','SAVE_OUTCOME_UNKNOWN'],['rejectSave','SAVE_OUTCOME_UNKNOWN'],['dialog','SAVE_OUTCOME_UNKNOWN'],['captureFailure','SAVE_OUTCOME_UNKNOWN']])test(`${option} stops permanently before exit or launch`,async t=>{const f=await fixture(t,{[option]:true});await f.prepare();assert.equal((await f.execute()).status,expected);assert.equal(f.counts.save,1);assert.equal(f.counts.exit,0);assert.equal(f.counts.launch,0);assert.equal(f.counts.open,0);const stop=JSON.parse(await fs.readFile(f.artifact('supervisor-stop'),'utf8'));assert.equal(stop.status,expected);});
for(const option of ['missingClosure','nonzeroExit','noExit','portTaken'])test(`${option} rejects old-process exit proof without launching`,async t=>{const f=await fixture(t,{[option]:true});await f.prepare();assert.equal((await f.execute()).status,'STOPPED');assert.equal(f.counts.exit,1);assert.equal(f.counts.launch,0);assert.equal(f.counts.open,0);});
for(const option of ['wrongMvid','newExeChanged','newPortTaken','newEnded','noPort','launchFailure'])test(`${option} allows at most one empty launch and no open`,async t=>{const f=await fixture(t,{[option]:true});await f.prepare();assert.equal((await f.execute()).status,'STOPPED');assert.equal(f.counts.launch,1);assert.equal(f.counts.open,0);});
test('unknown open outcome never dispatches another open',async t=>{const f=await fixture(t,{hangOpen:true});await f.prepare();assert.equal((await f.execute()).status,'OPEN_OUTCOME_UNKNOWN');assert.equal(f.counts.open,1);assert.equal(f.counts.launch,1);assert.equal((await f.execute()).reason,'lifecycle_attempt_exists');assert.equal(f.counts.open,1);});

for(const option of ['pidReuse','otherUser','otherSession','configChanged','badBackup','badResponseHash'])test(`${option} rejects mismatched preflight evidence`,async t=>{
  const f=await fixture(t);await f.prepare();
  if(option==='pidReuse'){const original=f.platform.inspectProcess;f.platform.inspectProcess=async pid=>({...await original(pid),startTimeUtc:'2026-10-10T23:00:00.1230001Z'});}
  if(option==='otherUser'||option==='otherSession')f.platform.currentIdentity=async()=>({userSid:option==='otherUser'?'other':f.oldProcess.userSid,sessionId:option==='otherSession'?2:1});
  if(option==='configChanged')f.platform.config=async()=>({...f.config,aclSddl:'changed'});
  if(option==='badBackup'){const original=f.platform.file;f.platform.file=async candidate=>({...await original(candidate),...(candidate!==f.model?{sha256:'f'.repeat(64)}:{})});}
  if(option==='badResponseHash'){const source=JSON.parse(await fs.readFile(f.artifact('state-000001'),'utf8'));source.data.hidden='tampered';await fs.writeFile(f.artifact('state-000001'),encode(source));}
  assert.equal((await f.execute()).status,'STOPPED');assert.equal(f.counts.save,0);assert.equal(f.counts.exit,0);assert.equal(f.counts.launch,0);
});

test('missing/wrong explicit digest cannot create a stop marker for a different approval',async t=>{const f=await fixture(t);await f.prepare();const s=createLocalTestCopySupervisor({root:f.root,call:f.call,platform:f.platform,clock:f.clock,boundEvidence:f.boundEvidence});await assert.rejects(s.execute({operationId}),/SHA-256/);await assert.rejects(s.execute({operationId,expectedRequestSha256:'f'.repeat(64)}),/changed/);assert.equal(await fs.stat(f.artifact('supervisor-stop')).catch(()=>null),null);assert.equal(f.counts.save,0);});
test('expired preview and backwards wall time stop without any save',async t=>{const expired=await fixture(t);await expired.prepare();expired.advance(600001);assert.equal((await expired.execute()).status,'STOPPED');assert.equal(expired.counts.save,0);const backward=await fixture(t);await backward.prepare();backward.backwards();assert.equal((await backward.execute()).status,'STOPPED');assert.equal(backward.counts.save,0);});
test('source evidence and registration are rechecked before backup/action',async t=>{const f=await fixture(t);await f.prepare();await fs.appendFile(path.join(f.runtime,f.boundEvidence.file),' ');assert.equal((await f.execute()).status,'STOPPED');assert.equal(f.counts.save,0);assert.equal(await fs.stat(f.artifact('backup')).catch(()=>null),null);});
test('baseline snapshot cannot redirect to a different operation file',async t=>{const f=await fixture(t);await f.prepare();const request=JSON.parse(await fs.readFile(f.artifact('request'),'utf8'));request.baselineSnapshotFile=path.join(f.runtime,'other-baseline.json');await fs.copyFile(f.artifact('baseline-snapshot'),request.baselineSnapshotFile);await fs.writeFile(f.artifact('request'),encode(request));const hash=sha256(await fs.readFile(f.artifact('request')));const s=createLocalTestCopySupervisor({root:f.root,call:f.call,platform:f.platform,clock:f.clock,boundEvidence:f.boundEvidence});assert.equal((await s.execute({operationId,expectedRequestSha256:hash})).status,'STOPPED');assert.equal(f.counts.save,0);});
test('existing backup is never overwritten and action attempt cannot be replayed',async t=>{const f=await fixture(t);await f.prepare();const backup=path.join(f.runtime,`lifecycle-${operationId}-backup.rvt`);await fs.writeFile(backup,'prior immutable backup');assert.equal((await f.execute()).status,'STOPPED');assert.equal(await fs.readFile(backup,'utf8'),'prior immutable backup');assert.equal(f.counts.save,0);});
for(const stage of ['BACKUP_VERIFIED','OLD_PROCESS_EXITED','NEW_PROCESS_READY'])test(`cancellation after ${stage} prevents the next side effect`,async t=>{const f=await fixture(t,{cancelAtStage:stage});await f.prepare();assert.equal((await f.execute()).status,'CANCELLED');if(stage==='BACKUP_VERIFIED')assert.equal(f.counts.save,0);if(stage==='OLD_PROCESS_EXITED')assert.equal(f.counts.launch,0);if(stage==='NEW_PROCESS_READY')assert.equal(f.counts.open,0);});
for(const suffix of ['launch-attempt','continuation'])test(`cancellation immediately after persisted ${suffix} prevents launch/open dispatch`,async t=>{
  const f=await fixture(t);await f.prepare();const originalOpen=fs.open;
  fs.open=async(...args)=>{const handle=await originalOpen(...args);if(args[0]===f.artifact(suffix)&&args[1]==='wx'){const originalSync=handle.sync.bind(handle);handle.sync=async()=>{await originalSync();f.controller.abort();};}return handle;};
  try{assert.equal((await f.execute()).status,'CANCELLED');assert.equal(f.counts.open,0);if(suffix==='launch-attempt')assert.equal(f.counts.launch,0);}finally{fs.open=originalOpen;}
});
for(const [option,status]of [['lateSave','SAVE_OUTCOME_UNKNOWN'],['lateOpen','OPEN_OUTCOME_UNKNOWN'],['lateExit','STOPPED'],['lateHandshake','STOPPED']])test(`${option} successful evidence after monotonic deadline cannot start next phase`,async t=>{
  const f=await fixture(t,{[option]:true});await f.prepare();assert.equal((await f.execute()).status,status);if(option==='lateSave'){assert.equal(f.counts.exit,0);assert.equal(f.counts.launch,0);}if(option==='lateExit')assert.equal(f.counts.launch,0);if(option==='lateHandshake'){assert.equal(f.counts.open,0);assert.equal(await fs.stat(f.artifact('continuation')).catch(()=>null),null);}if(option==='lateOpen')assert.equal(f.counts.reads,2*f.request.recipeCount);
});
test('cancellation while launch RPC is pending persists permanent stop, retains uncertainty and never opens',async t=>{const f=await fixture(t,{cancelDuringLaunch:true});await f.prepare();const stopped=await f.execute();assert.equal(stopped.status,'CANCELLED');assert.equal(stopped.launchOutcome,'unknown');assert.equal(f.counts.launch,1);assert.equal(f.counts.open,0);assert.equal(JSON.parse(await fs.readFile(f.artifact('supervisor-stop'),'utf8')).status,'CANCELLED');assert.ok(await fs.stat(f.artifact('launch-attempt')));assert.equal((await f.execute()).reason,'lifecycle_attempt_exists');});
test('late launch callback cannot extend the shared startup budget or open a model',async t=>{const f=await fixture(t,{lateLaunch:true});await f.prepare();const stopped=await f.execute();assert.equal(stopped.status,'STOPPED');assert.equal(stopped.launchOutcome,'unknown');assert.equal(f.counts.launch,1);assert.equal(f.counts.open,0);assert.equal(await fs.stat(f.artifact('continuation')).catch(()=>null),null);});
for(const suffix of ['launch-observed','continuation'])test(`late ${suffix} persistence cannot advance startup or open`,async t=>{
  const f=await fixture(t);await f.prepare();const originalOpen=fs.open;fs.open=async(...args)=>{const handle=await originalOpen(...args);if(args[0]===f.artifact(suffix)&&args[1]==='wx'){const originalSync=handle.sync.bind(handle);handle.sync=async()=>{await originalSync();f.advance(180001);};}return handle;};
  try{assert.equal((await f.execute()).status,'STOPPED');assert.equal(f.counts.open,0);if(suffix==='launch-observed')assert.equal(await fs.stat(f.artifact('continuation')).catch(()=>null),null);}finally{fs.open=originalOpen;}
});

test('immutable chain rejects gaps, tampered or deleted observed tails and unknown events',async t=>{
  const f=await fixture(t);await f.prepare();const first=await readLifecycleChain(f.runtime,operationId,f.hash,'state');assert.equal(first.count,1);await f.append('state','PREVIEW_READY',{readIndex:0});const second=await readLifecycleChain(f.runtime,operationId,f.hash,'state',{priorCount:first.count,priorTail:first.tail});assert.equal(second.count,2);
  await fs.unlink(f.artifact('state-000002'));await assert.rejects(readLifecycleChain(f.runtime,operationId,f.hash,'state',{priorCount:second.count,priorTail:second.tail}),/truncated/);await fs.rename(f.artifact('state-000001'),f.artifact('state-000003'));await assert.rejects(readLifecycleChain(f.runtime,operationId,f.hash,'state'),/gap/);
  const unknown=await fixture(t);await unknown.prepare();await unknown.append('event','unrecognized-event',{stopReason:null});assert.equal((await unknown.execute()).status,'STOPPED');assert.equal(unknown.counts.save,0);
});
test('exact multiple of 500 membership uses no additional empty page',async t=>{const f=await fixture(t);f.evidence.categoryIds.Fixtures=Array.from({length:1000},(_,index)=>index+1);const recipes=recipesFromLoadedEvidence(f.evidence);assert.deepEqual(recipes.filter(row=>row.method==='revit.search'&&!row.params.types).map(row=>row.params.offset),[0,500]);});
test('CLI rejects path overrides and missing explicit approval before calling adapters',async()=>{let calls=0;const options={root:process.cwd(),call:()=>{calls++;},platform:{}};await assert.rejects(runSupervisorCli(['prepare','--path','arbitrary'],options),/no path overrides/);await assert.rejects(runSupervisorCli(['execute','--operation-id',operationId],options),/explicit approved/);assert.equal(calls,0);});

function fakeChild(handler){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();let buffer='';child.stdin.on('data',bytes=>{buffer+=bytes;for(;;){const index=buffer.indexOf('\n');if(index<0)break;const line=buffer.slice(0,index);buffer=buffer.slice(index+1);handler(JSON.parse(line),child);}});return child;}
test('OS helper uses hidden fixed structured transport and never a shell command',async()=>{
  let args,options;const p=createPowerShellPlatform('fixed-script.ps1',{spawnProcess:(exe,a,o)=>{assert.equal(exe,'pwsh.exe');args=a;options=o;return fakeChild((request,child)=>child.stdout.write(JSON.stringify({id:request.id,ok:true,result:{userSid:'test',sessionId:1}})+'\n'));}});assert.deepEqual(await p.currentIdentity(),{userSid:'test',sessionId:1});assert.deepEqual(args,['-NoLogo','-NoProfile','-NonInteractive','-File','fixed-script.ps1','-OsHelper']);assert.equal(options.windowsHide,true);assert.equal(options.shell,undefined);p.close();
});
test('OS helper timeout poisons transport without retrying or killing any process',async()=>{let dispatches=0;const child=fakeChild(()=>dispatches++);child.kill=()=>assert.fail('Process kill is forbidden');const p=createPowerShellPlatform('fixed-script.ps1',{rpcTimeoutMs:10,spawnProcess:()=>child});await assert.rejects(p.currentIdentity(),/timed out/);await assert.rejects(p.currentIdentity(),/timed out/);assert.equal(dispatches,1);p.close();});
test('OS helper drains bounded diagnostics and fails closed on unknown response IDs',async()=>{const child=fakeChild((request,c)=>{c.stderr.write('diagnostic');c.stdout.write(JSON.stringify({id:request.id+1,ok:true,result:{}})+'\n');});const p=createPowerShellPlatform('fixed-script.ps1',{spawnProcess:()=>child});await assert.rejects(p.currentIdentity(),/Unexpected/);p.close();});
test('OS helper preserves bounded structured launch diagnostics',async()=>{const child=fakeChild((request,c)=>c.stdout.write(JSON.stringify({id:request.id,ok:false,code:'os_inspection_failed',detail:{type:'System.ComponentModel.Win32Exception',line:241,message:'launch detail'}})+'\n'));const p=createPowerShellPlatform('fixed-script.ps1',{spawnProcess:()=>child});await assert.rejects(p.currentIdentity(),error=>error.code==='os_inspection_failed'&&error.detail.line===241&&error.message==='launch detail');p.close();});
test('launch helper uses the Windows shell with the Revit working directory and avoids eager Handle access',async()=>{const source=await fs.readFile(path.resolve(import.meta.dirname,'../../tools/test-copy-restart.ps1'),'utf8');assert.match(source,/\$start\.WorkingDirectory=\[IO\.Path\]::GetDirectoryName\(\$argument\.exePath\)/);assert.match(source,/\$start\.UseShellExecute=\$true/);assert.doesNotMatch(source,/\$proc\.Handle\|Out-Null;\$id=/);});
test('launch helper reads a closed operation lease record instead of the held supervisor lock',async()=>{const source=await fs.readFile(path.resolve(import.meta.dirname,'../../tools/test-copy-restart.ps1'),'utf8');assert.match(source,/lifecycle-\$op-supervisor-lease\.json/);assert.doesNotMatch(source,/local-test-copy-supervisor\.lock/);const supervisor=await fs.readFile(path.resolve(import.meta.dirname,'../local-test-copy-supervisor.mjs'),'utf8');assert.match(supervisor,/paths\(operationId,'supervisor-lease'\)/);});
test('actual PowerShell parser preserves exact UTC strings and helper syntax', {skip:process.platform!=='win32'},async()=>{
  const script=path.resolve(import.meta.dirname,'../../tools/test-copy-restart.ps1'),source=await fs.readFile(script,'utf8');assert.match(source,/ConvertFrom-Json -AsHashtable -Depth 20 -DateKind String/);
  const ps=`$ErrorActionPreference='Stop'; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'","''")}',[ref]$null,[ref]$errors)|Out-Null; if($errors){throw 'Script syntax is invalid'}; $pin='{"startTimeUtc":"2026-10-11T00:00:00.1230000Z"}'|ConvertFrom-Json -AsHashtable -Depth 20 -DateKind String; if($pin.startTimeUtc -isnot [string] -or $pin.startTimeUtc -cne '2026-10-11T00:00:00.1230000Z'){throw 'Exact timestamp was changed'}; 'parser_and_timestamp_verified'`;
  const result=await promisify(execFile)('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,timeout:15000});assert.equal(result.stdout.trim(),'parser_and_timestamp_verified');
});
test('actual PowerShell final launch gate rejects a persisted cancellation before Process.Start', {skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),hash='a'.repeat(64),script=path.resolve(import.meta.dirname,'../../tools/test-copy-restart.ps1');await fs.writeFile(f.artifact('supervisor-stop'),encode({schemaVersion:1,operationId,requestSha256:hash,status:'CANCELLED',atUtc:'2026-10-11T00:00:00Z',reason:'lifecycle_cancelled'}));
  const ps=`$ErrorActionPreference='Stop'; $ast=[System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'","''")}',[ref]$null,[ref]$null); foreach($name in @('Assert-HelperFields','Assert-LaunchNotStopped')){$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true); Invoke-Expression $fn.Extent.Text}; $lifecycleRuntime='${f.runtime.replaceAll("'","''")}'; function Read-HelperRecord($p){Get-Content -Raw -LiteralPath $p|ConvertFrom-Json -AsHashtable -DateKind String}; try{Assert-LaunchNotStopped '${operationId}' '${hash}';throw 'Launch gate failed to stop'}catch{if($_.Exception.Message -cne 'Permanent supervisor stop prevents empty Revit launch.'){throw};'launch_stopped_before_process_start'}`;
  const result=await promisify(execFile)('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,timeout:15000});assert.equal(result.stdout.trim(),'launch_stopped_before_process_start');
});
test('actual Windows shared-handle hash supports an open writer and a Unicode local path', {skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),candidate=path.join(f.root,'共享读取测试.rvt'),bytes=Buffer.from('native-shared-read-fixture');await fs.writeFile(candidate,bytes);const script=path.resolve(import.meta.dirname,'../../tools/test-copy-restart.ps1');
  const ps=`$ErrorActionPreference='Stop';$ast=[System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'","''")}',[ref]$null,[ref]$null);$add=$ast.Find({param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Add-Type'},$true);Invoke-Expression $add.Parent.Extent.Text;$writer=[IO.FileStream]::new('${candidate.replaceAll("'","''")}',[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete);try{$snapshot=[LifecycleFileIdentity]::Snapshot('${candidate.replaceAll("'","''")}');if($snapshot[2] -cne '${sha256(bytes)}' -or [long]$snapshot[1] -ne ${bytes.length}){throw 'Shared-handle digest changed'};'shared_unicode_hash_verified'}finally{$writer.Dispose()}`;
  const result=await promisify(execFile)('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,timeout:15000});assert.equal(result.stdout.trim(),'shared_unicode_hash_verified');
  const source=await fs.readFile(script,'utf8');assert.match(source,/\[Console\]::InputEncoding=\[Text\.UTF8Encoding\]::new\(\$false\)/);assert.match(source,/\[Console\]::OutputEncoding=\[Text\.UTF8Encoding\]::new\(\$false\)/);
});
test('actual hidden OS helper can read its own identity and local port without touching Revit', {skip:process.platform!=='win32'||process.env.REVIT_LIFECYCLE_OS_SMOKE!=='1'},async()=>{
  const access=await promisify(execFile)('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"try{Get-NetTCPConnection -State Listen -ErrorAction Stop|Out-Null;'available'}catch{if($_.FullyQualifiedErrorId -notlike 'HRESULT 0x80041003,*'){throw};'access_denied'}"],{windowsHide:true,timeout:15000});
  const p=createPowerShellPlatform(path.resolve(import.meta.dirname,'../../tools/test-copy-restart.ps1'));try{const identity=await p.currentIdentity();assert.equal(typeof identity.userSid,'string');assert.ok(Number.isSafeInteger(identity.sessionId));if(access.stdout.trim()==='available')assert.equal(typeof await p.portFree(65001),'boolean');else{assert.equal(access.stdout.trim(),'access_denied');await assert.rejects(p.portFree(65001),{code:'os_inspection_failed'});}}finally{p.close();}
});
