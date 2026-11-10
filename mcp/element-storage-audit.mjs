import {z} from 'zod';

export const ELEMENT_STORAGE_AUDIT_MAX_ITEMS=20;
export const ELEMENT_STORAGE_AUDIT_MAX_SCHEMAS_PER_ITEM=32;
export const ELEMENT_STORAGE_AUDIT_MAX_TOTAL_SCHEMAS=128;
export const ELEMENT_STORAGE_AUDIT_MAX_FIELDS_PER_SCHEMA=128;
export const ELEMENT_STORAGE_AUDIT_MAX_TOTAL_FIELDS=512;

const documentIdentity=z.string().min(1).max(200).refine(value=>value.trim().length>0,'Document identity must not be blank.');
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const elementId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nativeId=z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const unique=values=>new Set(values).size===values.length;

export const elementStorageAuditRequestSchema=z.object({
  documentIdentity,
  expectedRevision:revision,
  elementIds:z.array(elementId).min(1).max(ELEMENT_STORAGE_AUDIT_MAX_ITEMS).refine(unique,'Element IDs must be unique.')
}).strict();

const fieldSchema=z.object({
  name:z.string().min(1),
  valueType:z.string().min(1),
  containerType:z.string().min(1),
  specTypeId:z.string().nullable()
}).strict();

const schemaMetadataSchema=z.object({
  guid:z.string().uuid(),
  metadataStatus:z.enum(['resolved','not_loaded','read_denied','metadata_unavailable']),
  schemaName:z.string().nullable(),
  vendorId:z.string().nullable(),
  applicationGuid:z.string().uuid().nullable(),
  readAccessLevel:z.string().nullable(),
  writeAccessLevel:z.string().nullable(),
  fields:z.array(fieldSchema).max(ELEMENT_STORAGE_AUDIT_MAX_FIELDS_PER_SCHEMA)
}).strict().superRefine((schema,context)=>{
  if(schema.metadataStatus==='resolved'){
    if(!schema.schemaName?.trim()||!schema.readAccessLevel||!schema.writeAccessLevel)
      context.addIssue({code:'custom',message:'Resolved schema metadata requires its name and access levels.'});
  }else if(schema.schemaName!==null||schema.vendorId!==null||schema.applicationGuid!==null||
    schema.readAccessLevel!==null||schema.writeAccessLevel!==null||schema.fields.length!==0){
    context.addIssue({code:'custom',message:'Unresolved schema metadata must not invent or partially expose schema definitions.'});
  }
});

const supportedSchemaEvidence=z.object({
  supported:z.literal(true),complete:z.literal(true),count:z.number().int().min(0),truncated:z.literal(false),
  schemas:z.array(schemaMetadataSchema).max(ELEMENT_STORAGE_AUDIT_MAX_SCHEMAS_PER_ITEM)
}).strict().superRefine((evidence,context)=>{
  if(evidence.count!==evidence.schemas.length)
    context.addIssue({code:'custom',message:'Schema evidence must contain every attached schema GUID.'});
});
const unsupportedSchemaEvidence=z.object({
  supported:z.literal(false),complete:z.literal(false),count:z.null(),truncated:z.literal(false),
  schemas:z.array(z.never()).length(0),reason:z.string().min(1)
}).strict();
const schemaEvidence=z.union([supportedSchemaEvidence,unsupportedSchemaEvidence]);

const summarySchema=z.object({
  id:elementId,uniqueId:z.string().min(1),name:z.string(),className:z.string().min(1),
  category:z.string().nullable(),categoryId:nativeId.nullable(),typeId:nativeId,ownerViewId:nativeId,levelId:nativeId
}).strict();
const itemSchema=z.object({elementId,exists:z.boolean(),summary:summarySchema.nullable(),schemaEvidence}).strict()
  .superRefine((item,context)=>{
    if(!item.exists){
      if(item.summary!==null||item.schemaEvidence.supported||item.schemaEvidence.reason!=='element_not_found')
        context.addIssue({code:'custom',message:'Missing elements require unknown element_not_found schema evidence.'});
    }else if(item.summary===null||item.summary.id!==item.elementId){
      context.addIssue({code:'custom',message:'Existing elements require their matching native summary.'});
    }
  });

export const elementStorageAuditResponseSchema=z.object({
  documentIdentity,documentRevision:revision,
  items:z.array(itemSchema).min(1).max(ELEMENT_STORAGE_AUDIT_MAX_ITEMS),
  schemaScope:z.literal('attached-extensible-storage-schema-definitions-only'),
  entityValuesReturned:z.literal(false),modelWritesRequested:z.literal(false),automaticSave:z.literal(false),
  allModelSideEffectsVerified:z.literal(false)
}).strict().superRefine((response,context)=>{
  if(!unique(response.items.map(item=>item.elementId)))
    context.addIssue({code:'custom',message:'Response element IDs must be unique.'});
  const schemaCount=response.items.reduce((sum,item)=>sum+(item.schemaEvidence.supported?item.schemaEvidence.schemas.length:0),0);
  const fieldCount=response.items.reduce((sum,item)=>sum+(item.schemaEvidence.supported
    ?item.schemaEvidence.schemas.reduce((schemaSum,schema)=>schemaSum+schema.fields.length,0):0),0);
  if(schemaCount>ELEMENT_STORAGE_AUDIT_MAX_TOTAL_SCHEMAS||fieldCount>ELEMENT_STORAGE_AUDIT_MAX_TOTAL_FIELDS)
    context.addIssue({code:'custom',message:'Schema metadata exceeds the bounded response budget.'});
});

const contextSchema=z.object({active:z.literal(true),document:z.object({
  identity:documentIdentity,revision,path:z.string(),isModified:z.boolean(),isReadOnly:z.boolean()
}).passthrough()}).passthrough();

function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function snapshot(context,request){
  if(context?.active===false)fail('no_active_document','Open the reviewed project before querying element storage schemas.');
  const parsed=contextSchema.safeParse(context);
  if(!parsed.success)fail('element_storage_schema_context_invalid','Native context lacks the pinned document identity, revision or state.');
  const document=parsed.data.document;
  if(document.identity!==request.documentIdentity)fail('document_changed','The active document differs from the reviewed storage schema request.');
  if(document.revision!==request.expectedRevision)fail('document_revision_changed','The document revision differs from the reviewed storage schema request.');
  return {identity:document.identity,revision:document.revision,path:document.path,isModified:document.isModified,isReadOnly:document.isReadOnly};
}

export async function readElementStorageSchemas(input,call,signal){
  const request=elementStorageAuditRequestSchema.parse(input);
  signal?.throwIfAborted();
  const before=snapshot(await call('revit.context.get',{},signal),request);
  signal?.throwIfAborted();
  const parsed=elementStorageAuditResponseSchema.safeParse(await call('revit.element.storage_schemas',request,signal));
  if(!parsed.success)fail('element_storage_schema_response_invalid','Native schema metadata is malformed, incomplete or exceeds its bounded contract; discard this report.');
  const report=parsed.data;
  if(report.documentIdentity!==request.documentIdentity)fail('document_changed','Schema metadata belongs to another document.');
  if(report.documentRevision!==request.expectedRevision)fail('document_revision_changed','Schema metadata belongs to another document revision.');
  if(report.items.length!==request.elementIds.length||report.items.some((item,index)=>item.elementId!==request.elementIds[index]))
    fail('element_storage_schema_scope_mismatch','Schema metadata must contain exactly the requested element IDs in order.');
  signal?.throwIfAborted();
  const after=snapshot(await call('revit.context.get',{},signal),request);
  if(after.path!==before.path||after.isModified!==before.isModified||after.isReadOnly!==before.isReadOnly)
    fail('element_storage_schema_state_changed','Document state changed during schema metadata reads; discard this report.');
  signal?.throwIfAborted();
  return report;
}
