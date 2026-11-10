import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';

const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const integer=z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const revision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nonblank=z.string().min(1).refine(s=>s.trim().length>0);
const identity=nonblank.max(200);
const ordered=ids=>ids.every((n,i)=>i===0||ids[i-1]<n);
const ids=z.array(id).max(1000).refine(ordered,'IDs must be sorted and unique.');
export const stairConnectionsRequestSchema=z.object({documentIdentity:identity,expectedRevision:revision,stairId:id}).strict();
const row=z.object({elementId:id,peerElementId:id,connectionType:nonblank.max(80),connectionTypeValue:integer,peerConnectionType:nonblank.max(80),peerConnectionTypeValue:integer}).strict();
const component=z.object({elementId:id,kind:z.enum(['run','landing']),stairId:id,connectionsComplete:z.boolean(),connections:z.array(row).max(4000),error:nonblank.max(1200).nullable()}).strict().superRefine((v,c)=>{
  if(v.connectionsComplete!==(v.error===null))c.addIssue({code:'custom',message:'Known complete and unknown reads require honest explicit error evidence.'});
});
const issue=z.object({code:z.enum(['duplicate_connection','run_connection_count_exceeded','source_component_mismatch','self_connection','peer_outside_stair','connection_kinds_invalid','endpoint_type_invalid','endpoint_type_unknown','missing_reverse_connection']),elementId:id,peerElementId:id.nullable()}).strict();
export const stairConnectionsResponseSchema=z.object({
  documentIdentity:identity,documentRevision:revision,
  stair:z.object({id,uniqueId:nonblank,name:z.string(),className:z.literal('Stairs'),typeId:id}).strict(),
  runIds:ids,landingIds:ids,components:z.array(component).max(1000),
  graph:z.object({enumerationComplete:z.boolean(),reciprocityStatus:z.enum(['verified','inconsistent','unknown']),issues:z.array(issue).max(33000),isolatedComponentIds:ids}).strict(),
  readOnly:z.literal(true),modelWritesRequested:z.literal(false),automaticSave:z.literal(false),planCreated:z.literal(false),
  allModelSideEffectsVerified:z.literal(false),completeStairConnectionsVerified:z.literal(false),engineeringComplianceVerified:z.literal(false)
}).strict().superRefine((v,c)=>{
  const bad=message=>c.addIssue({code:'custom',message});
  const members=[...v.runIds,...v.landingIds],byId=new Map(v.components.map(n=>[n.elementId,n]));
  if(members.length>1000||new Set(members).size!==members.length||v.components.length!==members.length||byId.size!==members.length||!ordered(v.components.map(n=>n.elementId)))bad('Component membership must match the native run/landing sets exactly.');
  for(const n of v.components)if(n.stairId!==v.stair.id||!(n.kind==='run'?v.runIds:v.landingIds).includes(n.elementId))bad('Component ownership or kind does not match this stair.');
  if(v.components.reduce((n,r)=>n+r.connections.length,0)>4000)bad('The native connection record budget is exceeded.');
  const complete=v.components.every(n=>n.connectionsComplete);
  const unknownEndpoint=v.graph.issues.some(i=>i.code==='endpoint_type_unknown');
  if(v.graph.enumerationComplete!==complete||((!complete||unknownEndpoint)!==(v.graph.reciprocityStatus==='unknown')))bad('Graph completeness cannot contradict native reads or unknown endpoint types.');
  if(v.graph.reciprocityStatus==='verified'&&v.graph.issues.length!==0||v.graph.reciprocityStatus==='inconsistent'&&v.graph.issues.length===0||!complete&&v.graph.issues.length!==0)bad('Graph issues and reciprocity status disagree.');
  const isolated=v.components.filter(n=>n.connectionsComplete&&n.connections.length===0).map(n=>n.elementId);
  if(!isDeepStrictEqual(isolated,v.graph.isolatedComponentIds))bad('Unknown components cannot be labeled isolated.');
  if(v.graph.issues.some(i=>!byId.has(i.elementId)))bad('Graph issue source is not a native component.');
});
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function pinned(context,input){
  const d=context?.document;
  if(context?.active!==true||!d||typeof d.identity!=='string'||!Number.isSafeInteger(d.revision)||typeof d.path!=='string'||typeof d.isModified!=='boolean'||typeof d.isReadOnly!=='boolean')fail('stairs_connections_context_invalid','Read a complete active project context first.');
  if(d.identity!==input.documentIdentity)fail('document_changed','The reviewed stair document changed.');
  if(d.revision!==input.expectedRevision)fail('document_revision_changed','The reviewed stair revision changed.');
  return structuredClone({document:d,counts:context.counts});
}
export async function readStairConnections(input,call,signal){
  const request=stairConnectionsRequestSchema.parse(input);
  signal?.throwIfAborted();
  const before=pinned(await call('revit.context.get',{},signal),request);
  signal?.throwIfAborted();
  const native=await call('revit.stairs.connections',request,signal);
  if(Buffer.byteLength(JSON.stringify(native),'utf8')>2*1024*1024)fail('stairs_connections_response_too_large','The native connection report exceeds its wire budget.');
  const parsed=stairConnectionsResponseSchema.safeParse(native);
  if(!parsed.success)fail('stairs_connections_response_invalid','Native stair connection evidence is malformed or contradicts its declared scope.');
  const report=parsed.data;
  if(report.documentIdentity!==request.documentIdentity)fail('document_changed','Native stair evidence belongs to another document.');
  if(report.documentRevision!==request.expectedRevision)fail('document_revision_changed','Native stair evidence belongs to another revision.');
  if(report.stair.id!==request.stairId)fail('stairs_connections_scope_mismatch','The report belongs to another stair.');
  signal?.throwIfAborted();
  const after=pinned(await call('revit.context.get',{},signal),request);
  if(!isDeepStrictEqual(before,after))fail('stairs_connections_state_changed','Document state or counts changed during stair connection reads.');
  signal?.throwIfAborted();
  return report;
}
