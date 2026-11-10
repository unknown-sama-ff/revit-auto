import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {canonicalInspectionItems} from './acceptance-helpers.mjs';
import {lifecyclePreparedRequestSchema,validateLifecycleResponse} from './document-lifecycle.mjs';

export const BOUND_LOADED_EVIDENCE=Object.freeze({file:'element-dependencies-loaded-1791644043265.json',sha256:'3d807d10a564c39f8508c2b8061176908f97c87ecc6c3ec2db1fd38cfabfc2c3'});
const opPattern=/^[a-f0-9]{32}$/,hashPattern=/^[a-f0-9]{64}$/,terminal=new Set(['FAILED','STOPPED','CANCELLED','SAVE_OUTCOME_UNKNOWN','OPEN_OUTCOME_UNKNOWN']);
const eventKinds=new Set(['dialog','document_saving','document_saved','document_opened','document_closing','document_changed','application_closing','shutdown_closed','stopped','event_capture_failed']);
const stages=new Set(['PREVIEW_READY','BACKUP_VERIFIED','SAVE_STARTED','SAVE_READBACK_PENDING','SAVE_VERIFIED','EXIT_STARTED','EXIT_POSTED','OLD_PROCESS_EXITED','NEW_PROCESS_READY','OPEN_STARTED','OPEN_READBACK_PENDING','REOPEN_VERIFIED',...terminal]);
const scopeNames=['fullScope','architectureScope','categoryScope','typeScope','familyScope','newTypeScope','additionalNativeScope','relationScope'];
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const parse=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function check(value,message){if(!value)fail('lifecycle_supervisor_rejected',message);}
function exact(value,keys){check(value&&typeof value==='object'&&!Array.isArray(value),'Expected a lifecycle object.');check(Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key)),'Lifecycle record has missing or unknown fields.');}
function equal(actual,expected,message){check(isDeepStrictEqual(actual,expected),message);}
function validHash(value){check(typeof value==='string'&&hashPattern.test(value),'Expected a lowercase SHA-256.');return value;}
function validId(value){check(typeof value==='string'&&opPattern.test(value),'Expected a lowercase operation ID.');return value;}
const lowerPath=value=>path.resolve(value).toLowerCase();
const sameFile=(a,b)=>a&&b&&lowerPath(a.path)===lowerPath(b.path)&&a.bytes===b.bytes&&a.sha256===b.sha256&&a.fileIdentity===b.fileIdentity;
const sameProcess=(a,b)=>a&&b&&['pid','startTimeUtc','exePath','exeSha256','version','userSid','sessionId'].every(key=>key==='exePath'?lowerPath(a[key])===lowerPath(b[key]):a[key]===b[key]);

async function noLinks(file){const absolute=path.resolve(file);let cursor=absolute;for(;;){try{check(!(await fs.lstat(cursor)).isSymbolicLink(),'Lifecycle paths cannot contain links.');}catch(error){if(error.code!=='ENOENT')throw error;}const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}return absolute;}
async function readBound(file,hash){await noLinks(file);const handle=await fs.open(file,'r');let bytes;try{check((await handle.stat()).size<=32*1024*1024,'Bound evidence exceeds the local file budget.');bytes=await handle.readFile();}finally{await handle.close();}if(hash!==undefined)equal(sha256(bytes),hash,'A bound lifecycle artifact changed.');check(bytes.length<=32*1024*1024,'Bound evidence exceeds the local file budget.');return {value:parse(bytes),sha256:sha256(bytes),bytes};}
async function writeNew(file,value){await noLinks(file);const bytes=Buffer.isBuffer(value)?value:encode(value),handle=await fs.open(file,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}return {path:file,sha256:sha256(bytes)};}
async function copyNew(from,to){await noLinks(from);await noLinks(to);await fs.copyFile(from,to,fs.constants.COPYFILE_EXCL);const handle=await fs.open(to,'r+');try{await handle.sync();}finally{await handle.close();}}
async function present(file){try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

/** Published native files are atomic; gaps, edited tails or malformed records stop continuation. */
export async function readLifecycleChain(runtime,operationId,requestSha256,kind,{priorCount=0,priorTail=null}={}){
  validId(operationId);validHash(requestSha256);check(['state','event'].includes(kind),'Unknown native lifecycle chain.');
  const prefix=`lifecycle-${operationId}-${kind}-`,names=(await fs.readdir(runtime)).filter(name=>name.startsWith(prefix)&&name.endsWith('.json')).sort();
  check(names.length<=1024&&names.length>=priorCount,'Lifecycle chain was truncated or exceeds its budget.');
  const records=[];let previous=null,total=0,seenPrior=null;
  for(let index=0;index<names.length;index++){
    equal(names[index],`${prefix}${String(index+1).padStart(6,'0')}.json`,'Lifecycle chain has a gap or malformed filename.');
    const file=path.join(runtime,names[index]),read=await readBound(file);total+=read.bytes.length;check(total<=8*1024*1024,'Lifecycle chain exceeds its evidence budget.');
    const value=read.value;exact(value,['schemaVersion','operationId','requestSha256','sequence','previousSha256',kind==='state'?'stage':'kind','atUtc','data']);
    check(value.schemaVersion===1&&value.operationId===operationId&&value.requestSha256===requestSha256&&value.sequence===index+1,'Lifecycle record is not bound to the reviewed operation.');
    equal(value.previousSha256,previous,'Lifecycle chain digest link differs.');check(Number.isFinite(Date.parse(value.atUtc))&&value.data&&typeof value.data==='object'&&!Array.isArray(value.data),'Malformed lifecycle time or data.');
    check(kind==='state'?stages.has(value.stage):eventKinds.has(value.kind),'Unknown native lifecycle stage or event.');
    if(index+1===priorCount)seenPrior=read.sha256;records.push({...read,file});previous=read.sha256;
  }
  if(priorCount)equal(seenPrior,priorTail,'An already observed lifecycle tail changed.');return {records,count:records.length,tail:previous};
}

/** All target IDs and queries derive from the one completed bound evidence. */
export function recipesFromLoadedEvidence(evidence){
  check(evidence.status==='ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED'&&evidence.loadedModuleVerified===true&&evidence.savedReadScopesVerified===true&&evidence.readScopePersistenceVerified===true,'The fixed dependency-loaded baseline is incomplete.');
  check(evidence.after?.document?.isModified===false&&evidence.savedFileAfter?.sha256===evidence.savedFileBefore?.sha256,'Baseline does not prove stable saved bytes.');
  const recipes=[{method:'revit.context.get',params:{}}];
  for(const [field,types]of [['categoryIds',false],['typeCategoryIds',true]])for(const category of Object.keys(evidence[field]).sort()){
    const ids=evidence[field][category];check(Array.isArray(ids)&&ids.length<=100000&&new Set(ids).size===ids.length&&ids.every(id=>Number.isSafeInteger(id)&&id>0),'Invalid complete category membership.');
    for(let offset=0;offset<Math.max(1,ids.length);offset+=500)recipes.push({method:'revit.search',params:{category,types,limit:500,offset}});
  }
  const ids=[...new Set(scopeNames.flatMap(name=>{const items=evidence[name]?.items;check(Array.isArray(items)&&items.length>0,'Missing complete inspection range.');return items.map(item=>{check(Number.isSafeInteger(item.summary?.id)&&item.summary.id>0,'Invalid inspection range ID.');return item.summary.id;});}))].sort((a,b)=>a-b);
  for(let offset=0;offset<ids.length;offset+=100)recipes.push({method:'revit.inspect',params:{elementIds:ids.slice(offset,offset+100)}});
  const roots=evidence.dependencies?.items?.map(item=>item.elementId);check(Array.isArray(roots)&&roots.length===4&&new Set(roots).size===4,'Four bounded dependency roots are required.');
  recipes.push({method:'revit.element.dependencies',params:{elementIds:roots}});
  check(recipes.length<=100,'Fixed read recipes exceed their budget.');return recipes;
}

function normalizeZero(value){if(typeof value==='number')return Object.is(value,-0)?0:value;if(value&&typeof value==='object')for(const key of Object.keys(value))value[key]=normalizeZero(value[key]);return value;}
function canonicalResult(method,value){
  const result=normalizeZero(structuredClone(value));
  if(method==='revit.inspect')result.items=canonicalInspectionItems(result.items);
  if(method==='revit.context.get')for(const field of ['familyTypes','elementTypes','selectedElementIds'])if(Array.isArray(result[field]))result[field].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(method==='revit.search')result.items.sort((a,b)=>a.id-b.id||JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(method==='revit.element.dependencies')result.items.sort((a,b)=>a.elementId-b.elementId);
  return result;
}
function compareContext(actual,expected,{reopened=false,saved=false,history=false}={}){
  check(actual.active===true&&actual.document?.path===expected.document.path,'Context belongs to another document.');const wanted=structuredClone(expected);
  if(reopened){check(actual.document.identity!==expected.document.identity&&actual.document.revision===0,'Reopen needs a fresh revision-zero session.');wanted.document.identity=actual.document.identity;wanted.document.revision=0;wanted.activeView=actual.activeView;wanted.selectedElementIds=actual.selectedElementIds;}
  if(history){wanted.document.identity=actual.document.identity;wanted.document.revision=actual.document.revision;wanted.document.isModified=actual.document.isModified;if(actual.document.identity!==expected.document.identity){wanted.activeView=actual.activeView;wanted.selectedElementIds=actual.selectedElementIds;}}
  if(saved)wanted.document.isModified=false;equal(canonicalResult('revit.context.get',actual),canonicalResult('revit.context.get',wanted),'Complete context changed outside expected session and saved state.');
}
function compareRecipeResult(recipe,result,expected,{reopened=false,saved=false}={}){
  if(recipe.method==='revit.context.get')return compareContext(result,expected,{reopened,saved});
  if(recipe.method==='revit.element.dependencies'&&reopened){const wanted=structuredClone(expected);wanted.documentIdentity=result.documentIdentity;wanted.documentRevision=result.documentRevision;check(result.documentRevision===0,'Reopened dependency revision is not zero.');equal(canonicalResult(recipe.method,result),canonicalResult(recipe.method,wanted),'Reopened dependency evidence changed.');return;}
  equal(canonicalResult(recipe.method,result),canonicalResult(recipe.method,expected),'Complete fixed read evidence changed.');
}

function sourceItems(evidence){
  const items=new Map();
  for(const name of scopeNames)for(const item of evidence[name].items){const id=item.summary.id;if(items.has(id))equal(canonicalInspectionItems([item]),canonicalInspectionItems([items.get(id)]),'Overlapping historical scopes disagree.');else items.set(id,item);}
  return items;
}
function compareHistoricalReads(baseline,evidence,document){
  equal(baseline.recipes,recipesFromLoadedEvidence(evidence),'Fixed historical recipes differ.');
  const items=sourceItems(evidence);
  check(Array.isArray(baseline.values)&&baseline.values.length===baseline.recipes.length,'Historical comparison lacks complete values.');
  for(let index=0;index<baseline.recipes.length;index++){
    const recipe=baseline.recipes[index],value=baseline.values[index];
    if(recipe.method==='revit.context.get'){compareContext(value,evidence.after,{history:true});equal(value.document.identity,document.identity,'Baseline session differs.');equal(value.document.revision,document.revision,'Baseline revision differs.');equal(value.document.isModified,document.isModified,'Baseline saved state differs.');}
    else if(recipe.method==='revit.inspect'){exact(value,['items']);equal(value.items.map(item=>item.summary?.id),recipe.params.elementIds,'Historical inspection is incomplete.');equal(canonicalInspectionItems(value.items),canonicalInspectionItems(recipe.params.elementIds.map(id=>items.get(id))),'Inspection differs from fixed saved evidence.');}
    else if(recipe.method==='revit.search'){
      exact(value,['items','offset','limit','hasMore']);const ids=[...evidence[recipe.params.types?'typeCategoryIds':'categoryIds'][recipe.params.category]].sort((a,b)=>a-b),page=ids.slice(recipe.params.offset,recipe.params.offset+500);
      equal(value.items.map(item=>item.id).sort((a,b)=>a-b),page,'Complete membership differs.');check(value.offset===recipe.params.offset&&value.limit===500&&value.hasMore===(recipe.params.offset+page.length<ids.length),'Membership pagination is incomplete.');
      check(new Set(value.items.map(item=>item.id)).size===value.items.length,'Search contains duplicate membership.');
    }else{const expected=structuredClone(evidence.dependencies);expected.documentIdentity=document.identity;expected.documentRevision=document.revision;equal(canonicalResult(recipe.method,value),canonicalResult(recipe.method,expected),'Bounded dependencies differ from saved evidence.');}
  }
}

export function createLocalTestCopySupervisor({root,call,platform,clock={wall:()=>Date.now(),mono:()=>performance.now(),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))},signal,onProgress=()=>{},boundEvidence=BOUND_LOADED_EVIDENCE}={}){
  check(typeof root==='string'&&typeof call==='function'&&platform,'A fixed root and native/OS adapters are required.');
  const runtime=path.join(path.resolve(root),'runtime'),paths=(id,suffix)=>path.join(runtime,`lifecycle-${validId(id)}-${suffix}.json`);
  let current,lastWall=clock.wall(),externalSeq=0,externalTail=null,chainSeen={state:{priorCount:0,priorTail:null},event:{priorCount:0,priorTail:null}};
  const tick=()=>{const wall=clock.wall();check(wall>=lastWall,'System clock moved backwards.');lastWall=wall;if(signal?.aborted)fail('lifecycle_cancelled','Supervisor cancellation stops further actions.');return wall;};
  async function observedRead(method,params){
    const started=clock.mono();let outcome;const pending=Promise.resolve().then(()=>call(method,params)).then(value=>{outcome={value};},error=>{outcome={error};});
    while(!outcome){tick();check(clock.mono()-started<30000,'Read-only bridge observation timed out.');await clock.wait(1000);}await pending;tick();check(clock.mono()-started<30000,'Read-only bridge observation completed after its deadline.');if(outcome.error)throw outcome.error;return outcome.value;
  }
  const record=async(stage,data={})=>{const artifact={schemaVersion:1,operationId:current.operationId,requestSha256:current.requestSha256,sequence:++externalSeq,previousSha256:externalTail,stage,atUtc:new Date(clock.wall()).toISOString(),data};const result=await writeNew(paths(current.operationId,`supervisor-${String(externalSeq).padStart(6,'0')}`),artifact);externalTail=result.sha256;onProgress({stage});return result;};
  async function responseDisk(response){
    const state=await readLifecycleChain(runtime,response.operationId,response.requestSha256.toLowerCase(),'state'),events=await readLifecycleChain(runtime,response.operationId,response.requestSha256.toLowerCase(),'event');
    const captured=state.records[response.latestState.sequence-1];check(captured,'Response state is missing on disk.');equal(captured.value,response.latestState,'Native response state differs from disk.');equal(captured.sha256,response.stateSha256.toLowerCase(),'Native response state digest differs.');
    check(response.eventCount<=events.count,'Response event tail is missing.');equal(response.eventCount?events.records[response.eventCount-1].sha256:null,response.eventTailSha256?.toLowerCase()??null,'Native response event digest differs.');
  }
  const native=async(method,params,expected)=>{const action=['revit.lifecycle.save_once','revit.lifecycle.post_exit_once','revit.lifecycle.open_saved_copy_once'].includes(method);const response=validateLifecycleResponse(method,params,await (action?call(method,params):observedRead(method,params)),expected);await responseDisk(response);return response;};
  async function monitor(){
    tick();const operation=current.operationId,hash=current.requestSha256;
    const state=await readLifecycleChain(runtime,operation,hash,'state',chainSeen.state),events=await readLifecycleChain(runtime,operation,hash,'event',chainSeen.event);
    chainSeen={state:{priorCount:state.count,priorTail:state.tail},event:{priorCount:events.count,priorTail:events.tail}};
    for(const {value}of events.records)check(!['dialog','stopped','event_capture_failed'].includes(value.kind)&&!(typeof value.data.stopReason==='string'&&value.data.stopReason),'Native event requires a stop.');
    check(!state.records.some(row=>terminal.has(row.value.stage)),'Native lifecycle reached a terminal state.');check(!(await present(paths(operation,'supervisor-stop'))),'Permanent supervisor stop exists.');return {state,events};
  }
  async function protectedCheck(request,{processInfo=request.process}={}){
    tick();equal(await platform.config(request.bridgeConfig.path),request.bridgeConfig,'Bridge config content or ACL changed.');const actual=await platform.inspectProcess(processInfo.pid);check(sameProcess(actual,processInfo),'Revit PID, start time or executable identity changed.');
    const owner=await platform.currentIdentity();check(actual.userSid===owner.userSid&&actual.sessionId===owner.sessionId,'Supervisor requires the same user and interactive session.');
    check(await platform.portOwner(request.bridgeConfig.port)===processInfo.pid,'Fixed bridge port has another owner.');const info=await observedRead('revit.bridge.info',{});check(info.pid===processInfo.pid&&info.moduleVersionId===processInfo.moduleVersionId&&info.features?.includes('local-test-copy-lifecycle'),'Loaded bridge differs from the reviewed process.');
  }
  async function stop(status,error,extra={}){const reason=error?.code??'lifecycle_supervisor_stopped',errorDetail=error?.detail??null;if(current){const file=paths(current.operationId,'supervisor-stop');if(!(await present(file)))await writeNew(file,{schemaVersion:1,operationId:current.operationId,requestSha256:current.requestSha256,status,atUtc:new Date(clock.wall()).toISOString(),reason});try{await record(status,{reason,...extra,...(errorDetail?{errorDetail}: {})});}catch{/* Keep the original stop. */}}return {status,operationId:current?.operationId,reason,automaticRetry:false,allModelSideEffectsVerified:false,...extra,...(errorDetail?{errorDetail}: {})};}
  async function boundedAction(method,params,status,budget=120000){
    tick();await monitor();tick();
    const started=clock.mono();let outcome;const pending=native(method,params,{request:current.request}).then(value=>{outcome={value};},error=>{outcome={error};});
    while(!outcome){try{await monitor();}catch(error){return {stop:await stop(signal?.aborted?'CANCELLED':status,error)};}if(clock.mono()-started>=budget)return {stop:await stop(status,{code:'lifecycle_observation_timeout'})};await clock.wait(1000);}
    await pending;if(outcome.error)return {stop:await stop(status,outcome.error)};try{await monitor();check(clock.mono()-started<budget,'Native action observation completed after its deadline.');}catch(error){return {stop:await stop(signal?.aborted?'CANCELLED':status,error)};}return outcome;
  }
  async function snapshot(file){const value=await platform.file(file);exact(value,['path','bytes','sha256','fileIdentity']);validHash(value.sha256);check(lowerPath(value.path)===lowerPath(file)&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[a-f0-9]{8}:[a-f0-9]{16}$/.test(value.fileIdentity),'Invalid stable local file identity.');return value;}
  async function requestFiles(response){
    const expected=paths(response.operationId,'request');equal(path.resolve(response.requestFile),expected,'Request escaped fixed operation path.');const read=await readBound(expected,response.requestSha256.toLowerCase());equal(read.value,response.request,'Native response differs from immutable request.');
    const registration=await readBound(path.join(runtime,'local-test-copy-registration.json'),response.request.registrationSha256.toLowerCase());equal(registration.value,response.request.registration,'Native registration differs.');
    equal(path.resolve(response.request.bridgeConfig.path),path.join(runtime,'bridge.json'),'Request changed the fixed bridge config path.');const evidenceFile=path.join(runtime,boundEvidence.file);equal(path.resolve(response.request.registration.baselineEvidenceFile),evidenceFile,'Registration changed the fixed evidence path.');equal(response.request.registration.baselineEvidenceSha256.toLowerCase(),validHash(boundEvidence.sha256),'Registration changed the fixed evidence digest.');const evidence=(await readBound(evidenceFile,boundEvidence.sha256)).value;
    equal(path.resolve(response.request.document.path),path.resolve(evidence.after.document.path),'Request changed the bound model.');check(response.request.savedFile.sha256===evidence.savedFileAfter.sha256&&response.request.savedFile.bytes===evidence.savedFileAfter.bytes,'Request changed historical disk bytes.');
    equal(path.resolve(response.request.baselineSnapshotFile),paths(response.operationId,'baseline-snapshot'),'Snapshot escaped fixed operation path.');const baseline=await readBound(response.request.baselineSnapshotFile,response.request.baselineSnapshotSha256.toLowerCase());exact(baseline.value,['recipes','values']);equal(baseline.value.recipes,response.request.registration.readRecipes,'Baseline recipe differs.');check(Array.isArray(baseline.value.values)&&baseline.value.values.length===response.recipeCount,'Missing complete baseline recipe values.');compareHistoricalReads(baseline.value,evidence,response.request.document);return baseline.value;
  }
  async function prepare(){
    tick();const info=await observedRead('revit.bridge.info',{});check(info.features?.includes('local-test-copy-lifecycle'),'Lifecycle capability is not loaded; manual bootstrap is required.');
    const source=await readBound(path.join(runtime,boundEvidence.file),validHash(boundEvidence.sha256)),evidence=source.value,context=await observedRead('revit.context.get',{});compareContext(context,evidence.after,{history:true});check(context.document.isReadOnly===false,'Test-copy context is read-only.');
    const sourceFile=await snapshot(context.document.path);check(sourceFile.sha256===evidence.savedFileAfter.sha256&&sourceFile.bytes===evidence.savedFileAfter.bytes,'Current disk file differs from fixed saved evidence.');const processInfo=await platform.inspectProcess(info.pid),owner=await platform.currentIdentity();check(processInfo.version.startsWith('27.3.')&&processInfo.pid===info.pid,'Expected Revit 2027.3 process.');check(processInfo.userSid===owner.userSid&&processInfo.sessionId===owner.sessionId,'Supervisor is outside Revit\'s user session.');
    const config=await platform.config(path.join(runtime,'bridge.json'));check(config.path===path.join(runtime,'bridge.json'),'Config override is forbidden.');check(await platform.portOwner(config.port)===info.pid,'Fixed bridge port has another owner.');
    const recipes=recipesFromLoadedEvidence(evidence),values=[];
    for(const recipe of recipes){tick();const params=recipe.method==='revit.element.dependencies'?{...recipe.params,documentIdentity:context.document.identity,expectedRevision:context.document.revision}:recipe.params;values.push(await observedRead(recipe.method,params));}
    compareHistoricalReads({recipes,values},evidence,context.document);
    equal(await platform.config(config.path),config,'Config changed during preparation.');check(sameFile(await snapshot(sourceFile.path),sourceFile),'Model file changed during preparation.');equal(await observedRead('revit.context.get',{}),context,'Document changed during preparation.');
    const registration={modelPath:context.document.path,baselineEvidenceFile:path.join(runtime,boundEvidence.file),baselineEvidenceSha256:source.sha256,readRecipes:recipes},registrationFile=path.join(runtime,'local-test-copy-registration.json');
    if(await present(registrationFile))equal((await readBound(registrationFile)).value,registration,'Existing fixed registration differs and cannot be overwritten.');else await writeNew(registrationFile,registration);
    const response=await native('revit.lifecycle.prepare',{});current={operationId:response.operationId,requestSha256:response.requestSha256.toLowerCase(),request:response.request};check(sameProcess(response.request.process,processInfo)&&response.request.process.moduleVersionId===info.moduleVersionId,'Native preview differs from OS process inspection.');equal(response.request.document,{identity:context.document.identity,revision:context.document.revision,path:context.document.path,isModified:context.document.isModified},'Preview session differs.');equal(response.request.bridgeConfig,config,'Preview config differs.');check(sameFile(response.request.savedFile,sourceFile),'Preview file differs.');const captured=await requestFiles(response);for(let index=0;index<recipes.length;index++)compareRecipeResult(recipes[index],captured.values[index],values[index]);await monitor();
    return {status:'PREVIEW_READY',operationId:response.operationId,requestSha256:current.requestSha256,expiresAtUtc:response.request.expiresAtUtc,recipeCount:response.recipeCount,saveAction:context.document.isModified?'save_once':'noop_already_saved',automaticRetry:false,allModelSideEffectsVerified:false};
  }
  async function verifyRounds(phase,baseline,{reopened=false}={}){
    const request=current.request,N=request.recipeCount,rounds=[[],[]],started=clock.mono(),budget=reopened?180000:120000;let identity=null,revision=null;
    for(let index=0;index<2*N;index++){await monitor();tick();const response=await native('revit.lifecycle.verify_scope',{operationId:current.operationId,requestSha256:current.requestSha256,readIndex:index},{request,phase}),scope=response.scope;check(scope?.phase===phase&&scope.readIndex===index,'Scope read is out of phase.');if(identity===null){identity=scope.documentIdentity;revision=scope.documentRevision;}check(identity===scope.documentIdentity&&revision===scope.documentRevision,'Session changed during scope reads.');if(reopened)check(identity!==request.document.identity&&revision===0,'Opened copy did not create a fresh revision-zero session.');else check(identity===request.document.identity&&revision===request.document.revision,'Save scope belongs to another session.');
      check(clock.mono()-started<budget,'Complete scope verification timed out.');const recipe=request.registration.readRecipes[index%N],value=scope.result;compareRecipeResult(recipe,value,baseline.values[index%N],{reopened,saved:true});rounds[Math.floor(index/N)].push(value);check(response.stage===(index===2*N-1?(reopened?'REOPEN_VERIFIED':'SAVE_VERIFIED'):phase),'Verification stage advanced unexpectedly.');}
    for(let index=0;index<N;index++)compareRecipeResult(request.registration.readRecipes[index],rounds[1][index],rounds[0][index]);return monitor();
  }
  async function waitExit(handle,savedFile){const started=clock.mono();for(;;){const chains=await monitor(),observed=await platform.observeHandle(handle);if(observed.exited){check(observed.exitCode===0,'Old process exit code is not zero.');const closed=chains.events.records.at(-1);check(closed?.value.kind==='shutdown_closed'&&closed.value.data.complete===true&&closed.value.data.stopReason===null,'Native shutdown log is not successfully closed.');check(await platform.portFree(current.request.bridgeConfig.port),'Fixed port was taken over or did not close.');check(sameFile(await snapshot(savedFile.path),savedFile),'Saved file changed before exit proof.');tick();check(clock.mono()-started<120000,'Exit evidence completed after its deadline.');return {closed,observed};}check(clock.mono()-started<120000,'Old process did not naturally exit in time.');await clock.wait(1000);}}
  async function waitNewProcess(handle,started=clock.mono()){for(;;){await monitor();check(!(await platform.observeHandle(handle)).exited,'New Revit ended before handshake.');const port=await platform.portOwner(current.request.bridgeConfig.port);if(port!==null){check(port===handle.pid,'Another process acquired the fixed bridge port.');const info=await observedRead('revit.bridge.info',{});check(info.pid===handle.pid&&info.moduleVersionId===current.request.process.moduleVersionId&&info.features?.includes('local-test-copy-lifecycle'),'New plugin handshake differs.');const actual=await platform.inspectProcess(info.pid);check(actual.pid!==current.request.process.pid&&actual.startTimeUtc!==current.request.process.startTimeUtc,'PID/start-time reuse is rejected.');for(const key of ['exePath','exeSha256','version','userSid','sessionId'])equal(actual[key],current.request.process[key],'New process differs from the bound executable or user.');tick();check(clock.mono()-started<180000,'New handshake completed after its deadline.');return {...actual,moduleVersionId:info.moduleVersionId};}check(clock.mono()-started<180000,'New handshake timed out.');await clock.wait(1000);}}
  async function launchEmptyBounded(started){
    let outcome;Promise.resolve().then(()=>{tick();return platform.launchEmpty({exePath:current.request.process.exePath,operationId:current.operationId,requestSha256:current.requestSha256});}).then(value=>{outcome={value};},error=>{outcome={error};});
    try{
      while(!outcome){await monitor();check(clock.mono()-started<180000,'Launch dispatch timed out.');await clock.wait(1000);}
      if(outcome.error)throw outcome.error;await monitor();check(clock.mono()-started<180000,'Launch dispatch completed after its deadline.');return {handle:outcome.value};
    }catch(error){return {stop:await stop(signal?.aborted?'CANCELLED':'STOPPED',error,{launchOutcome:'unknown'})};}
  }
  async function execute({operationId,expectedRequestSha256}){
    validId(operationId);validHash(expectedRequestSha256);let lease;current=undefined;
    const reviewed=await readBound(paths(operationId,'request'),expectedRequestSha256);const request=lifecyclePreparedRequestSchema.parse(reviewed.value);check(request.operationId===operationId,'Operation differs from immutable request.');
    if(await present(paths(operationId,'supervisor-attempt')))return {status:'STOPPED',operationId,reason:'lifecycle_attempt_exists',automaticRetry:false,allModelSideEffectsVerified:false};
    current={operationId,requestSha256:expectedRequestSha256,request};externalSeq=0;externalTail=null;chainSeen={state:{priorCount:0,priorTail:null},event:{priorCount:0,priorTail:null}};
    try{tick();check(tick()<Date.parse(request.expiresAtUtc)&&tick()>=Date.parse(request.createdAtUtc),'Ten-minute preview expired or not yet valid.');
      const response=await native('revit.lifecycle.get',{operationId,requestSha256:expectedRequestSha256},{request,stage:'PREVIEW_READY'}),baseline=await requestFiles(response);await protectedCheck(request);const oldHandle=await platform.capture(request.process);check(sameFile(await snapshot(request.savedFile.path),request.savedFile),'File differs from reviewed preview.');await monitor();
      lease=await fs.open(path.join(runtime,'local-test-copy-supervisor.lock'),'wx');await lease.writeFile(encode({operationId,requestSha256:expectedRequestSha256}));await lease.sync();await writeNew(paths(operationId,'supervisor-lease'),{schemaVersion:1,operationId,requestSha256:expectedRequestSha256,atUtc:new Date(clock.wall()).toISOString()});await writeNew(paths(operationId,'supervisor-attempt'),{schemaVersion:1,operationId,requestSha256:expectedRequestSha256,atUtc:new Date(clock.wall()).toISOString(),automaticRetry:false});
      const backupPath=path.join(runtime,`lifecycle-${operationId}-backup.rvt`);await monitor();tick();await copyNew(request.savedFile.path,backupPath);const backup=await snapshot(backupPath);check(backup.sha256===request.savedFile.sha256&&backup.bytes===request.savedFile.bytes,'Backup bytes differ.');await writeNew(paths(operationId,'backup'),{schemaVersion:1,operationId,requestSha256:expectedRequestSha256,backupPath,backupSha256:backup.sha256,sourceFile:request.savedFile});await record('BACKUP_VERIFIED');
      await protectedCheck(request);check(tick()<Date.parse(request.expiresAtUtc),'Preview expired before save.');const saved=await boundedAction('revit.lifecycle.save_once',{operationId,requestSha256:expectedRequestSha256},'SAVE_OUTCOME_UNKNOWN');if(saved.stop)return saved.stop;check(saved.value.stage==='SAVE_READBACK_PENDING','Save did not enter readback.');await verifyRounds('SAVE_READBACK_PENDING',baseline);
      const saveState=(await readLifecycleChain(runtime,operationId,expectedRequestSha256,'state')).records.filter(row=>row.value.stage==='SAVE_VERIFIED').at(-1);check(saveState,'Missing SAVE_VERIFIED state.');const savedFile=saveState.value.data.savedFile;check(sameFile(await snapshot(request.savedFile.path),savedFile),'Verified disk file differs.');await record('SAVE_VERIFIED',{saveAction:saveState.value.data.saveAction??null});
      await protectedCheck(request);const exit=await boundedAction('revit.lifecycle.post_exit_once',{operationId,requestSha256:expectedRequestSha256},'STOPPED');if(exit.stop)return exit.stop;check(exit.value.stage==='EXIT_POSTED','Normal exit was not posted.');await record('EXIT_POSTED');const observation=await waitExit(oldHandle,savedFile),exitFile=await writeNew(paths(operationId,'exit-observed'),{schemaVersion:1,operationId,requestSha256:expectedRequestSha256,oldProcess:request.process,exitCode:0,portReleased:true,eventClosureFile:observation.closed.file,eventClosureSha256:observation.closed.sha256,savedFile,atUtc:new Date(clock.wall()).toISOString()});await record('OLD_PROCESS_EXITED');
      tick();check(sameFile(await snapshot(savedFile.path),savedFile),'File changed before launch.');equal(await platform.config(request.bridgeConfig.path),request.bridgeConfig,'Config changed before launch.');check(await platform.portFree(request.bridgeConfig.port),'Port is not free before launch.');await writeNew(paths(operationId,'launch-attempt'),{schemaVersion:1,operationId,requestSha256:expectedRequestSha256,exitEvidenceSha256:exitFile.sha256,atUtc:new Date(clock.wall()).toISOString()});
      await monitor();tick();const launchStarted=clock.mono(),launched=await launchEmptyBounded(launchStarted);if(launched.stop)return launched.stop;
      const newHandle=launched.handle,newProcess=await waitNewProcess(newHandle,launchStarted);await monitor();tick();check(clock.mono()-launchStarted<180000,'Startup launch evidence completed after its deadline.');
      const launchFile=await writeNew(paths(operationId,'launch-observed'),{schemaVersion:1,operationId,requestSha256:expectedRequestSha256,exitEvidenceSha256:exitFile.sha256,newProcess,emptyDocumentLaunch:true,atUtc:new Date(clock.wall()).toISOString()});
      await monitor();tick();check(clock.mono()-launchStarted<180000,'Startup launch evidence persisted after its deadline.');await record('NEW_PROCESS_READY');await protectedCheck(request,{processInfo:newProcess});check(sameFile(await snapshot(savedFile.path),savedFile),'File changed before continuation.');
      await monitor();tick();check(clock.mono()-launchStarted<180000,'Startup continuation began after its deadline.');await writeNew(paths(operationId,'continuation'),{schemaVersion:1,operationId,requestSha256:expectedRequestSha256,savedFile,oldProcess:request.process,newProcess,exitEvidenceFile:exitFile.path,exitEvidenceSha256:exitFile.sha256,launchEvidenceFile:launchFile.path,launchEvidenceSha256:launchFile.sha256});
      await monitor();tick();check(clock.mono()-launchStarted<180000,'Startup continuation persisted after its deadline.');const opened=await boundedAction('revit.lifecycle.open_saved_copy_once',{operationId,requestSha256:expectedRequestSha256},'OPEN_OUTCOME_UNKNOWN',180000);if(opened.stop)return opened.stop;
      check(opened.value.stage==='OPEN_READBACK_PENDING','Open did not enter readback.');await verifyRounds('OPEN_READBACK_PENDING',baseline,{reopened:true});check(sameFile(await snapshot(savedFile.path),savedFile),'File changed during reopened readback.');await protectedCheck(request,{processInfo:newProcess});await record('REOPEN_VERIFIED');
      return {status:'REOPEN_VERIFIED',operationId,saveAction:saveState.value.data.saveAction??null,readScopePersistenceVerified:true,automaticRetry:false,typeCopyExecutionAccepted:false,allModelSideEffectsVerified:false};
    }catch(error){return stop(signal?.aborted?'CANCELLED':'STOPPED',error);}finally{if(lease){await lease.close();await fs.unlink(path.join(runtime,'local-test-copy-supervisor.lock')).catch(()=>{});await fs.unlink(paths(operationId,'supervisor-lease')).catch(()=>{});}}
  }
  return {prepare,execute};
}

/** A fixed script and structured operations; input data never becomes shell source. */
export function createPowerShellPlatform(script,{executable='pwsh.exe',spawnProcess=spawn,rpcTimeoutMs=15000}={}){
  check(Number.isFinite(rpcTimeoutMs)&&rpcTimeoutMs>0&&rpcTimeoutMs<=30000,'OS helper timeout is outside its bounded budget.');
  const child=spawnProcess(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-OsHelper'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let sequence=0,buffer='',stderrBytes=0,fatal=null;const pending=new Map();
  const rejectAll=error=>{fatal??=error;for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(fatal);}pending.clear();child.stdin.end();};
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
    if(fatal)return;buffer+=chunk;if(buffer.length>1024*1024)return rejectAll(new Error('OS helper output exceeded its limit.'));
    for(;;){const index=buffer.indexOf('\n');if(index<0)break;const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
      try{const response=JSON.parse(line);exact(response,response.ok?['id','ok','result']:['id','ok','code','detail']);check(Number.isSafeInteger(response.id)&&typeof response.ok==='boolean','Malformed OS helper response.');const waiter=pending.get(response.id);check(waiter,'Unexpected OS helper response.');pending.delete(response.id);clearTimeout(waiter.timer);if(response.ok)waiter.resolve(response.result);else waiter.reject(Object.assign(new Error(response.detail?.message??'OS lifecycle inspection failed.'),{code:response.code??'os_inspection_failed',detail:response.detail??null}));}
      catch(error){rejectAll(error);return;}
    }
  });
  // Drain diagnostic output without publishing private values or allowing a full pipe to stall supervision.
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>65536)rejectAll(new Error('OS helper diagnostics exceeded their limit.'));});
  child.stdin.on('error',rejectAll);child.on('error',rejectAll);child.on('exit',()=>rejectAll(new Error('OS helper ended.')));
  const invoke=(operation,args)=>{if(fatal)return Promise.reject(fatal);return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>rejectAll(Object.assign(new Error('OS helper inspection timed out.'),{code:'os_inspection_timeout'})),rpcTimeoutMs);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,operation,args})+'\n');});};
  return {file:file=>invoke('file',{path:file}),config:file=>invoke('config',{path:file}),currentIdentity:()=>invoke('identity',{}),inspectProcess:pid=>invoke('inspect_process',{pid}),capture:process=>invoke('capture',{process}),observeHandle:handle=>invoke('observe',{handle}),portFree:port=>invoke('port_free',{port}),portOwner:port=>invoke('port_owner',{port}),launchEmpty:input=>invoke('launch_empty',input),close:()=>rejectAll(new Error('OS helper closed.'))};
}

export async function runSupervisorCli(argv,{root=path.resolve(import.meta.dirname,'..'),call,platform,boundEvidence,clock,signal,onProgress}={}){
  const mode=argv[0];check(['prepare','execute'].includes(mode),'Expected prepare or execute.');if(mode==='prepare')check(argv.length===1,'Prepare accepts no path overrides.');else check(argv.length===5&&argv[1]==='--operation-id'&&argv[3]==='--expected-request-sha256','Execute requires explicit approved operation ID and expected request SHA-256.');
  const fixedConfig=path.join(root,'runtime','bridge.json');check(!process.env.REVIT_AI_CONFIG||lowerPath(process.env.REVIT_AI_CONFIG)===lowerPath(fixedConfig),'REVIT_AI_CONFIG must be fixed runtime config.');if(!call)call=(await import('./bridge.mjs')).callRevit;let owned=false;
  if(!platform){check(process.platform==='win32','Production lifecycle supervision requires Windows.');platform=createPowerShellPlatform(path.join(root,'tools','test-copy-restart.ps1'));owned=true;}
  try{const supervisor=createLocalTestCopySupervisor({root,call,platform,boundEvidence,clock,signal,onProgress});return mode==='prepare'?await supervisor.prepare():await supervisor.execute({operationId:argv[2],expectedRequestSha256:argv[4]});}finally{if(owned)platform.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());runSupervisorCli(process.argv.slice(2),{signal:controller.signal,onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')}).then(value=>{process.stdout.write(JSON.stringify(value)+'\n');if(!['PREVIEW_READY','REOPEN_VERIFIED'].includes(value.status))process.exitCode=1;},error=>{process.stderr.write(JSON.stringify({code:error.code??'lifecycle_supervisor_failed'})+'\n');process.exitCode=1;});
}
