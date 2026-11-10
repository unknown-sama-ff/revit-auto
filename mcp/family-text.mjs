import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';

const nonblank=z.string().min(1).max(200).refine(v=>v.trim().length>0);
const revision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nativeId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const cursorId=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ownerName=z.union([z.literal(''),nonblank]);
const inputBase=z.object({familyName:ownerName,familyDocumentTitle:nonblank.optional(),maxNotes:z.number().int().min(1).max(100).optional(),
 afterNoteId:cursorId.optional(),boundsViewId:nativeId.optional()}).strict();
const titleBound=schema=>schema.refine(v=>v.familyName!==''||v.familyDocumentTitle!==undefined,
 {message:'A known-empty native owner name requires an exact familyDocumentTitle.',path:['familyDocumentTitle']});
export const familyTextInputSchema=titleBound(inputBase);
export const familyTextRequestSchema=titleBound(inputBase.extend({documentIdentity:nonblank,expectedRevision:revision}).strict());
const finite=z.number().finite();
const point=z.object({xMm:finite,yMm:finite,zMm:finite}).strict();
const vector=z.object({x:finite,y:finite,z:finite}).strict();
const bounds=z.object({min:point,max:point,origin:point,basisX:vector,basisY:vector,basisZ:vector}).strict()
 .refine(b=>['xMm','yMm','zMm'].every(k=>b.min[k]<=b.max[k]));
const evidence=value=>z.discriminatedUnion('supported',[
 z.object({supported:z.literal(true),value}).strict(),
 z.object({supported:z.literal(false),value:z.null(),reason:nonblank}).strict()
]);
const textEvidence=z.discriminatedUnion('supported',[
 z.object({supported:z.literal(true),complete:z.boolean(),value:z.string().max(2048),
  originalLength:z.number().int().nonnegative().max(2147483647),truncated:z.boolean()}).strict()
  .refine(t=>t.value.isWellFormed()&&t.originalLength>=t.value.length&&
   t.complete===(t.originalLength===t.value.length)&&t.truncated===(t.originalLength>t.value.length)),
 z.object({supported:z.literal(false),complete:z.literal(false),value:z.null(),originalLength:z.null(),
  truncated:z.literal(false),reason:nonblank}).strict()
]);
const familyDocument=z.object({title:z.string(),path:z.string(),identity:nonblank,revision,
 isModified:z.boolean(),isReadOnly:z.boolean(),isFamilyDocument:z.literal(true)}).strict();
export const familyTextResponseSchema=z.object({
 documentIdentity:nonblank,documentRevision:revision,document:familyDocument,
 family:z.object({name:ownerName,uniqueId:nonblank,categoryId:z.literal(-2000280)}).strict(),
 notes:z.array(z.object({id:nativeId,uniqueId:nonblank,ownerViewId:z.union([nativeId,z.literal(-1)]),typeId:nativeId,
  text:textEvidence,coord:evidence(point),widthMm:evidence(finite.nonnegative()),heightMm:evidence(finite.nonnegative()),
  bounds:evidence(bounds),viewBounds:evidence(bounds).optional(),typeFont:evidence(nonblank),typeTextSizeMm:evidence(finite.positive()),
  typeWidthFactor:evidence(finite.positive())}).strict()).max(100),
 totalCount:z.number().int().nonnegative().max(2147483647),returnedCount:z.number().int().nonnegative().max(100),
 truncated:z.boolean(),complete:z.boolean(),textCharacterBudgetUsed:z.number().int().nonnegative().max(16384),
 page:z.object({afterNoteId:cursorId,skippedCount:z.number().int().nonnegative(),remainingCount:z.number().int().nonnegative(),nextAfterNoteId:nativeId.nullable()}).strict().optional(),
 boundsView:z.object({id:nativeId,uniqueId:nonblank,name:z.string(),viewType:nonblank}).strict().optional(),
 selectionOrder:nonblank,coordinateUnits:z.string().min(1).max(500),fontScope:z.string().min(1).max(500),coverage:z.string().min(1).max(500),
 readOnly:z.literal(true),planCreated:z.literal(false),modelWritesRequested:z.literal(false),automaticSave:z.literal(false),
 documentOpened:z.literal(false),documentClosed:z.literal(false),familyLoaded:z.literal(false),
 projectAssociationVerified:z.literal(false),visualAccepted:z.literal(false),allModelSideEffectsVerified:z.literal(false)
}).strict().superRefine((r,ctx)=>{
 const issue=message=>ctx.addIssue({code:'custom',message});
 if(r.documentIdentity!==r.document.identity||r.documentRevision!==r.document.revision)issue('Document envelope pins disagree.');
 if(r.returnedCount!==r.notes.length||r.totalCount<r.returnedCount||
    r.truncated!==(r.totalCount>r.returnedCount)||r.complete!==(r.totalCount===r.returnedCount))issue('Collection counts disagree.');
 if(new Set(r.notes.map(n=>n.id)).size!==r.notes.length||new Set(r.notes.map(n=>n.uniqueId)).size!==r.notes.length)issue('Duplicate notes.');
 if(r.page){
  const p=r.page,ids=r.notes.map(n=>n.id);
  if(p.skippedCount+r.returnedCount+p.remainingCount!==r.totalCount||
     (p.afterNoteId===0?p.skippedCount!==0:p.skippedCount<1)||
     ids.some((id,i)=>id<=p.afterNoteId||(i>0&&id<=ids[i-1]))||
     (p.remainingCount>0?ids.length===0||p.nextAfterNoteId!==ids.at(-1):p.nextAfterNoteId!==null))issue('Page cursor, order or counts disagree.');
 }
 for(const n of r.notes){
  if(Boolean(r.boundsView)!==Boolean(n.viewBounds))issue('View bounds require explicit view evidence for every note.');
  if(r.boundsView&&n.ownerViewId!==r.boundsView.id&&
     (n.viewBounds?.supported!==false||n.viewBounds?.reason!=='note_not_owned_by_bounds_view'))issue('View bounds cannot be borrowed from another owner view.');
 }
 if(r.notes.reduce((sum,n)=>sum+(n.text.supported?n.text.value.length:0),0)!==r.textCharacterBudgetUsed)issue('Text budget disagrees.');
});
function fail(code,message){throw Object.assign(new Error(message),{code});}
function pinned(context,request){
 const d=context?.document;
 if(context?.active!==true||!d||typeof d.identity!=='string'||!Number.isSafeInteger(d.revision)||
    typeof d.path!=='string'||typeof d.isModified!=='boolean'||typeof d.isReadOnly!=='boolean')
  fail('family_text_context_invalid','Read a complete native family-document context first.');
 if(d.identity!==request.documentIdentity)fail('document_changed','Family text query belongs to another active document.');
 if(d.revision!==request.expectedRevision)fail('document_revision_changed','Family text query source revision changed.');
 if(d.isFamilyDocument!==true)fail('family_document_required','Manually open the reviewed titleblock family in the family editor first; this query does not open it.');
 if(request.familyName===''){
  const scope=context.familyDocumentScope;
  if(scope?.ownerFamilyAvailable!==true||scope.familyName!==''||scope.categoryId!==-2000280||
     scope.documentTitle!==request.familyDocumentTitle||d.title!==request.familyDocumentTitle)
   fail('family_text_scope_mismatch','Known-empty owner scope requires the exact observed titleblock family metadata and document title.');
 }
 if(request.familyDocumentTitle!==undefined&&d.title!==request.familyDocumentTitle)
  fail('family_text_scope_mismatch','The active family document title differs from the reviewed request.');
 return structuredClone({identity:d.identity,revision:d.revision,path:d.path,isModified:d.isModified,isReadOnly:d.isReadOnly});
}
export async function readFamilyText(input,call,signal){
 const request=familyTextRequestSchema.parse(input);signal?.throwIfAborted();
 const before=pinned(await call('revit.context.get',{},signal),request);
 signal?.throwIfAborted();
 const report=await call('revit.family.text_notes',request,signal);
 if(!report||Buffer.byteLength(JSON.stringify(report),'utf8')>512*1024)
  fail('family_text_response_invalid','Family text response is missing or exceeds its byte budget.');
 if(report.documentIdentity!==request.documentIdentity)fail('document_changed','Native family text response has the wrong document.');
 if(report.documentRevision!==request.expectedRevision)fail('document_revision_changed','Native family text response has the wrong revision.');
 if(report.family?.name!==request.familyName||report.family?.categoryId!==-2000280)
  fail('family_text_scope_mismatch','Native family name/category differ from the reviewed titleblock family.');
 if(request.familyDocumentTitle!==undefined&&report.document?.title!==request.familyDocumentTitle)
  fail('family_text_scope_mismatch','Native family document title differs from the reviewed request.');
 if(!familyTextResponseSchema.safeParse(report).success||report.returnedCount>(request.maxNotes??50))
  fail('family_text_response_invalid','Native family text geometry, fields, counts or safety evidence are inconsistent.');
 if(report.page?.afterNoteId!==request.afterNoteId||report.boundsView?.id!==request.boundsViewId||
    (report.page&&report.returnedCount!==Math.min(request.maxNotes??50,report.totalCount-report.page.skippedCount)))
  fail('family_text_response_invalid','Native pagination or view evidence does not match the exact request.');
 const observed={identity:report.document.identity,revision:report.document.revision,path:report.document.path,
  isModified:report.document.isModified,isReadOnly:report.document.isReadOnly};
 if(!isDeepStrictEqual(before,observed))fail('family_text_state_changed','Native family-document state differs from its context.');
 signal?.throwIfAborted();
 const after=pinned(await call('revit.context.get',{},signal),request);
 if(!isDeepStrictEqual(before,after))fail('family_text_state_changed','Family document state changed during the text read.');
 signal?.throwIfAborted();return report;
}
export function runFamilyTextWorkflow(args,call,signal){
 const input=familyTextInputSchema.parse(args.input??{});
 return readFamilyText({...input,documentIdentity:args.documentIdentity,expectedRevision:args.expectedRevision},call,signal);
}
