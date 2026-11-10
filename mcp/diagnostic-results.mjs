// Adapted from OakPlank/RevitMCP ResultStore (MIT, Copyright (c) 2026 OakPlank).
// See ../THIRD_PARTY_NOTICES.md. Added scope pins, immutable snapshots, budgets and expiry.
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';

const MiB=1024*1024;
const identity=z.string().min(1).max(200).refine(v=>v.trim().length>0);
export const resultScopeSchema=z.object({moduleVersionId:z.string().uuid(),pid:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
 document:z.object({identity,revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),title:z.string(),path:z.string(),
  isModified:z.boolean(),isReadOnly:z.boolean(),isFamilyDocument:z.literal(false)}).passthrough()}).strict();
export const diagnosticResultPageSchema=z.object({resultHandle:z.string().regex(/^res_[a-f0-9]{32}$/),section:z.enum(['search','inspected']),
 offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(100).default(25)}).strict();
function fail(code,message){throw Object.assign(new Error(message),{code});}
function encode(value){
 try{return JSON.stringify(value,(_key,v)=>{
  if(['undefined','function','symbol','bigint'].includes(typeof v)||(typeof v==='number'&&!Number.isFinite(v)))throw new Error('Non-JSON value');
  return v;
 });}catch{fail('diagnostic_result_invalid','Only complete JSON snapshots can be retained.');}
}
const digest=s=>createHash('sha256').update(s).digest('hex');
const responseBytes=value=>Buffer.byteLength(JSON.stringify({content:[{type:'text',text:JSON.stringify(value,null,2)}]}),'utf8')+512;

export class DiagnosticResultStore{
 #entries=new Map();#bytes=0;
 constructor({ttlMs=300000,maxEntries=16,maxBytes=8*MiB,maxResultBytes=2*MiB,maxPageBytes=256*1024,clock=()=>performance.now(),wallClock=()=>Date.now()}={}){
  if([ttlMs,maxEntries,maxBytes,maxResultBytes,maxPageBytes].some(v=>!Number.isSafeInteger(v)||v<=0)||maxResultBytes>maxBytes||
   ttlMs>300000||maxEntries>16||maxBytes>8*MiB||maxResultBytes>2*MiB||maxPageBytes>256*1024)throw new Error('Invalid diagnostic result-store limits.');
  Object.assign(this,{ttlMs,maxEntries,maxBytes,maxResultBytes,maxPageBytes,clock,wallClock});
 }
 #drop(handle){const r=this.#entries.get(handle);if(r){this.#bytes-=r.bytes;this.#entries.delete(handle);}}
 #prune(){const now=this.clock();for(const [h,r] of this.#entries)if(now>=r.deadline)this.#drop(h);}
 #record(handle){
  if(!/^res_[a-f0-9]{32}$/.test(handle))fail('invalid_diagnostic_result_handle','Use an exact result handle returned by this MCP process.');
  const r=this.#entries.get(handle);if(!r)fail('diagnostic_result_unknown','Result was evicted or belongs to another MCP process; it is not queried again automatically.');
  if(this.clock()>=r.deadline){this.#drop(handle);fail('diagnostic_result_expired','The captured result expired; no native query was repeated.');}return r;
 }
 assertKnown(handle){this.#record(handle);}
 get stats(){this.#prune();return {entries:this.#entries.size,serializedBytes:this.#bytes};}
 put({scope,report,sourceQuery}){
  const pin=resultScopeSchema.parse(scope);
  if(report?.readOnly!==true||report?.planCreated!==false||report.documentIdentity!==pin.document.identity||report.documentRevision!==pin.document.revision)
   fail('diagnostic_result_invalid','Only matching read-only diagnostic reports can be retained.');
  if(report.modelWritesRequested===true||!sourceQuery||!Array.isArray(sourceQuery.inspectElementIds))
   fail('diagnostic_result_invalid','Captured reports require an explicit read-only source query.');
  for(const key of ['search','inspected'])if(report[key]!==null&&!Array.isArray(report[key]?.items))
   fail('diagnostic_result_invalid','Captured diagnostic sections require native items arrays or known null.');
  const capturedAtUtc=new Date(this.wallClock()).toISOString(),expiresAtUtc=new Date(this.wallClock()+this.ttlMs).toISOString();
  const text=encode({scope:pin,report,sourceQuery,capturedAtUtc,expiresAtUtc}),bytes=Buffer.byteLength(text,'utf8');
  if(bytes>this.maxResultBytes)fail('diagnostic_result_too_large','Captured result exceeds its storage budget; narrow the query.');
  const handle='res_'+randomUUID().replaceAll('-',''),snapshotSha256=digest(text);
  const frozen=JSON.parse(text),search=frozen.report.search;
  const nativeHasMore=typeof search?.hasMore==='boolean'?search.hasMore:null;
  const requestedOffset=frozen.sourceQuery.search?.offset??0;
  const nativeOffset=Number.isSafeInteger(search?.offset)&&search.offset>=0?search.offset:null;
  const matchesComplete=search===null?null:nativeHasMore===true||requestedOffset>0?false:
   nativeHasMore===false&&(search.offset===undefined||nativeOffset===requestedOffset)?true:null;
  const summary={status:'read_only_result_summary',workflowId:'diagnostics.query',documentIdentity:pin.document.identity,documentRevision:pin.document.revision,
   planningMode:frozen.report.planningMode,candidateOnly:frozen.report.candidateOnly,assumptions:frozen.report.assumptions??[],
   auditConsistency:frozen.report.auditConsistency??null,requiresClarification:false,questions:[],
   resultHandle:handle,snapshotSha256,capturedAtUtc,expiresAtUtc,
   sections:{search:search===null?null:{capturedCount:search.items.length,requestedOffset,nativeOffset,nativeHasMore,matchingSetComplete:matchesComplete},
    inspected:report.inspected===null?null:{capturedCount:report.inspected.items.length,requestedCount:frozen.sourceQuery.inspectElementIds.length}},
   sourcePlugin:{moduleVersionId:pin.moduleVersionId,pid:pin.pid},capturedSnapshotOnly:true,readOnly:true,planCreated:false,
   modelWritesRequested:false,writeAuthorization:false,automaticRetryAllowed:false};
  if(responseBytes(summary)>256*1024)fail('diagnostic_result_summary_too_large','Summary metadata exceeds its MCP budget; narrow the request. No handle was published.');
  this.#prune();while(this.#entries.size>=this.maxEntries||this.#bytes+bytes>this.maxBytes)this.#drop(this.#entries.keys().next().value);
  this.#entries.set(handle,{text,bytes,deadline:this.clock()+this.ttlMs,snapshotSha256});this.#bytes+=bytes;return summary;
 }
 page(input,scope){
  const args=diagnosticResultPageSchema.parse(input),record=this.#record(args.resultHandle),frozen=JSON.parse(record.text);
  if(!isDeepStrictEqual(frozen.scope,resultScopeSchema.parse(scope)))fail('diagnostic_result_scope_changed','Document state, revision or plugin differs from the captured result; no cached data returned.');
  const section=frozen.report[args.section];if(section===null)fail('diagnostic_result_section_absent','That section was not requested in the original query.');
  if(args.offset>section.items.length)fail('diagnostic_result_offset_invalid','Offset exceeds the captured records.');
  const items=section.items.slice(args.offset,args.offset+args.limit);
  const result={status:'read_only_result_page',workflowId:'diagnostics.result',resultHandle:args.resultHandle,section:args.section,
   offset:args.offset,limit:args.limit,capturedCount:section.items.length,returnedCount:items.length,hasMore:args.offset+items.length<section.items.length,
   items,sourceSearchHasMore:typeof frozen.report.search?.hasMore==='boolean'?frozen.report.search.hasMore:null,
   sourceSearchOffset:frozen.sourceQuery.search?.offset??null,snapshotSha256:record.snapshotSha256,
   documentIdentity:frozen.scope.document.identity,documentRevision:frozen.scope.document.revision,
   sourcePlugin:{moduleVersionId:frozen.scope.moduleVersionId,pid:frozen.scope.pid},
   capturedAtUtc:frozen.capturedAtUtc,expiresAtUtc:frozen.expiresAtUtc,capturedSnapshotOnly:true,readOnly:true,planCreated:false,
   modelWritesRequested:false,writeAuthorization:false,automaticRetryAllowed:false};
  // Match the existing MCP text envelope, including pretty JSON escaping and transport headroom.
  if(responseBytes(result)>this.maxPageBytes)fail('diagnostic_result_page_too_large','Page exceeds its MCP response budget; reduce limit or use a narrower source query.');
  return result;
 }
}
