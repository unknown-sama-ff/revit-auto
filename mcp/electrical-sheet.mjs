import { z } from 'zod';
import {drawingPlacementMoveSchema,viewportLabelMoveSchema,parseDrawingPlacementInput,drawingPlacementOperations,inspectDrawingPlacementScope,reviewDrawingPlacementScope} from './drawing-placement.mjs';
import {titleBlockChangeSchema,parseTitleBlockChangeInput,titleBlockChangeOperations,validateTitleBlockChangePlan,inspectTitleBlockChangeScope} from './titleblock-change.mjs';

// The existing creation rows remain explicit native operation inputs. Metadata
// changes have a separate closed contract and never accept arbitrary parameters.
const elementId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text=z.string().min(1).max(200).refine(value=>value.trim().length>0,'Text must not be blank.');
const operationId=z.string().min(1).max(80).refine(value=>value.trim().length>0,'Operation IDs must not be blank.');
const reference=z.union([elementId,z.string().startsWith('@').min(2).max(81)]);
const coordinate=z.number().finite().min(-1e8).max(1e8);
const point=z.object({xMm:coordinate,yMm:coordinate,zMm:coordinate.optional()}).strict();
const xy=z.object({xMm:coordinate,yMm:coordinate}).strict();
const common={id:operationId.optional(),dependencies:z.array(operationId).max(1000).optional()};
const parameters=z.record(z.string(),z.unknown());
const creation={...common,parameters:parameters.optional(),mark:text.optional()};
const scale=z.number().int().positive().max(2147483647);

const view=z.object({...creation,viewFamilyTypeId:reference,levelId:reference.optional(),level:text.optional(),name:text.optional(),scale:scale.optional()}).strict().refine(row=>(row.levelId!==undefined)!==(row.level!==undefined),'View creation requires exactly one levelId or exact level name.');
const settings=['viewRange','crop','discipline','lightingCategories','displayStyle','detailLevel','partsVisibility'];
const configuration=z.object({
  ...common,viewId:reference,referenceViewId:reference,
  settings:z.array(z.enum(settings)).min(1).max(settings.length),
  discipline:z.enum(['Architectural','Structural','Mechanical','Electrical','Plumbing','Coordination']).optional(),
  viewportId:reference.optional(),paperPoint:point.optional(),
  cropBounds:z.object({min:xy,max:xy}).strict().optional()
}).strict().superRefine((row,ctx)=>{
  if(new Set(row.settings).size!==row.settings.length)ctx.addIssue({code:'custom',path:['settings'],message:'View settings must be unique.'});
  if(row.discipline!==undefined&&!row.settings.includes('discipline'))ctx.addIssue({code:'custom',path:['discipline'],message:'Explicit discipline requires the discipline setting.'});
  if((row.viewportId!==undefined)!==(row.paperPoint!==undefined))ctx.addIssue({code:'custom',path:['paperPoint'],message:'Viewport recentering requires viewportId and paperPoint together.'});
  if(row.paperPoint?.zMm!==undefined&&row.paperPoint.zMm!==0)ctx.addIssue({code:'custom',path:['paperPoint','zMm'],message:'Paper points require zero Z.'});
  if(row.cropBounds!==undefined){
    if(!row.settings.includes('crop'))ctx.addIssue({code:'custom',path:['cropBounds'],message:'cropBounds requires the crop setting.'});
    if(row.cropBounds.max.xMm-row.cropBounds.min.xMm<1||row.cropBounds.max.yMm-row.cropBounds.min.yMm<1)ctx.addIssue({code:'custom',path:['cropBounds'],message:'Crop bounds must be ordered and at least 1 mm wide/high.'});
  }
});
const schedule=z.object({...creation,category:text,fields:z.array(z.union([text,z.number().int().safe()])).min(1).max(1000),name:text.optional()}).strict();
const panelSchedule=z.object({...creation,panelId:reference,name:text.optional()}).strict();
const sheet=z.object({...creation,titleBlockId:reference.optional(),number:text,name:text}).strict();
const placement=z.object({...creation,sheetId:reference,viewId:reference,xMm:coordinate,yMm:coordinate,zMm:coordinate.optional()}).strict().refine(row=>(row.zMm??0)===0,'Paper placement requires zero Z.');
const tag=z.object({...creation,elementId:reference,viewId:reference,tagTypeId:reference.optional(),leader:z.boolean().optional(),xMm:coordinate,yMm:coordinate,zMm:coordinate.optional()}).strict();
const dimension=z.object({...creation,viewId:reference,dimensionTypeId:reference.optional(),references:z.array(text).min(2).max(1000),start:point,end:point}).strict();
const sheetChange=z.object({sheetId:elementId,name:text.optional(),number:text.optional()}).strict().refine(row=>row.name!==undefined||row.number!==undefined,'Sheet change requires a name or number.');
const viewChange=z.object({viewId:elementId,name:text.optional(),scale:scale.optional()}).strict().refine(row=>row.name!==undefined||row.scale!==undefined,'View change requires a name or scale.');
export const electricalSheetInputSchema=z.object({
  documentIdentity:text.optional(),expectedRevision:revision.optional(),
  views:z.array(view).max(1000).optional(),viewConfigurations:z.array(configuration).max(1000).optional(),
  schedules:z.array(schedule).max(1000).optional(),panelSchedules:z.array(panelSchedule).max(1000).optional(),
  sheets:z.array(sheet).max(1000).optional(),viewports:z.array(placement).max(1000).optional(),
  tags:z.array(tag).max(1000).optional(),dimensions:z.array(dimension).max(1000).optional(),
  sheetChanges:z.array(sheetChange).max(1000).optional(),viewChanges:z.array(viewChange).max(1000).optional(),
  placementMoves:z.array(drawingPlacementMoveSchema).max(1000).optional(),
  viewportLabelMoves:z.array(viewportLabelMoveSchema).max(1000).optional(),
  titleBlockChanges:z.array(titleBlockChangeSchema).max(1).optional()
}).strict();

function fail(code,message,details){const error=new Error(message);error.code=code;if(details!==undefined)error.details=details;throw error;}
export function parseElectricalSheetInput(input={}){
  const parsed=electricalSheetInputSchema.parse(input);
  parseDrawingPlacementInput({placementMoves:parsed.placementMoves,viewportLabelMoves:parsed.viewportLabelMoves});
  parseTitleBlockChangeInput({titleBlockChanges:parsed.titleBlockChanges});
  if(parsed.titleBlockChanges?.length&&Object.keys(parsed).some(key=>!['documentIdentity','expectedRevision','titleBlockChanges'].includes(key)&&parsed[key]?.length))
    fail('titleblock_change_requires_single_operation','Titleblock type changes cannot share a reviewed plan with metadata, creation or placement operations.');
  const targets=[...(parsed.sheetChanges??[]).map(row=>row.sheetId),...(parsed.viewChanges??[]).map(row=>row.viewId)];
  if(new Set(targets).size!==targets.length)fail('duplicate_sheet_metadata_target','A metadata target may appear only once in a reviewed sheet plan.');
  const newNumbers=(parsed.sheets??[]).map(row=>row.number);
  if(new Set(newNumbers).size!==newNumbers.length)
    fail('sheet_number_conflict','New sheets in one reviewed plan must have distinct numbers.');
  return parsed;
}

// Tags/dimensions are added by the shared workflow builder after this domain list.
export function electricalSheetOperations(input){
  const parsed=parseElectricalSheetInput(input),operations=[];
  for(const [index,row] of (parsed.sheetChanges??[]).entries()){
    if(row.number!==undefined)operations.push({operationType:'set_parameter',id:'sheetNumber'+(index+1),elementId:row.sheetId,parameter:'BIP:SHEET_NUMBER',value:row.number});
    if(row.name!==undefined)operations.push({operationType:'set_parameter',id:'sheetName'+(index+1),elementId:row.sheetId,parameter:'BIP:SHEET_NAME',value:row.name});
  }
  for(const [index,row] of (parsed.viewChanges??[]).entries()){
    if(row.name!==undefined)operations.push({operationType:'set_parameter',id:'viewName'+(index+1),elementId:row.viewId,parameter:'BIP:VIEW_NAME',value:row.name});
    if(row.scale!==undefined)operations.push({operationType:'set_parameter',id:'viewScale'+(index+1),elementId:row.viewId,parameter:'BIP:VIEW_SCALE_PULLDOWN_METRIC',value:row.scale});
  }
  const add=(rows,operationType,prefix)=>{for(const [index,row] of (rows??[]).entries())operations.push({...row,operationType,id:row.id||prefix+(index+1)});};
  add(parsed.views,'create_view_plan','view');add(parsed.viewConfigurations,'configure_view','viewConfiguration');
  add(parsed.schedules,'create_schedule','schedule');add(parsed.panelSchedules,'create_panel_schedule','panelSchedule');
  add(parsed.sheets,'create_sheet','sheet');add(parsed.viewports,'place_viewport','viewport');
  operations.push(...drawingPlacementOperations({placementMoves:parsed.placementMoves,viewportLabelMoves:parsed.viewportLabelMoves}));
  operations.push(...titleBlockChangeOperations({titleBlockChanges:parsed.titleBlockChanges}));
  validateTitleBlockChangePlan(operations);
  return operations;
}

// These IDs are verified against Autodesk Revit 2027's BuiltInParameter enum.
// VIEW_SCALE (-1005150) is a read-only display parameter in the inspected model;
// the verified writable integer scale is VIEW_SCALE_PULLDOWN_METRIC (-1005151).
const parameterSpecs={
  SHEET_NUMBER:{id:-1007401,storageType:'String'},SHEET_NAME:{id:-1007400,storageType:'String'},
  VIEW_NAME:{id:-1005112,storageType:'String'},VIEW_SCALE_PULLDOWN_METRIC:{id:-1005151,storageType:'Integer'}
};
function inspectRows(report,requested){
  if(!Array.isArray(report?.items)||report.items.length!==requested.length)fail('sheet_scope_unknown','Native inspection did not return the complete requested metadata scope.');
  const wanted=new Set(requested),map=new Map();
  for(const item of report.items){
    const id=item?.summary?.id??item?.id;
    if(!wanted.has(id)||map.has(id)||item.exists===false||!item.summary)fail('sheet_scope_unknown','Missing, duplicate or unexpected metadata inspection element.',{elementId:id});
    map.set(id,item);
  }
  return map;
}
function reviewParameter(item,parameterName,after){
  const spec=parameterSpecs[parameterName];
  if(!Array.isArray(item.parameters))fail('sheet_metadata_parameter_unknown','Native metadata parameters must be a complete inspected list.',{elementId:item.summary.id,parameter:'BIP:'+parameterName});
  const matches=item.parameters.filter(parameter=>{
    const named=parameter.builtInParameter===parameterName||parameter.builtInParameter==='BIP:'+parameterName;
    return named||parameter.id===spec.id;
  });
  const parameter=matches[0];
  const known=parameter?.hasValue===false||parameter?.hasValue===true&&(spec.storageType==='String'?typeof parameter.value==='string':Number.isInteger(parameter.value)&&parameter.value>0&&parameter.value<=2147483647);
  if(matches.length!==1||parameter.storageType!==spec.storageType||parameter.readOnly!==false||parameter.valueSupported!==true||!known||
    (parameter.id!==undefined&&parameter.id!==spec.id)||(parameter.builtInParameter!==undefined&&!['BIP:'+parameterName,parameterName].includes(parameter.builtInParameter)))
    fail('sheet_metadata_parameter_unknown','Metadata parameter evidence is missing, ambiguous, unsupported or not writable.',{elementId:item.summary.id,parameter:'BIP:'+parameterName});
  return {elementId:item.summary.id,parameter:'BIP:'+parameterName,parameterId:spec.id,before:parameter.hasValue?parameter.value:null,beforeHasValue:parameter.hasValue,after,noOp:parameter.hasValue&&parameter.value===after};
}
async function sheetCatalog(call,signal){
  const items=[],seenIds=new Set(),seenNumbers=new Set();let offset=0;
  while(offset<10000){
    signal?.throwIfAborted();
    const page=await call('revit.search',{category:'OST_Sheets',limit:500,offset},signal);
    signal?.throwIfAborted();
    if(!Array.isArray(page?.items)||page.items.length>500||typeof page.hasMore!=='boolean'||page.truncated===true||
      page.offset!==undefined&&page.offset!==offset||page.limit!==undefined&&page.limit!==500)
      fail('sheet_number_catalog_unknown','Sheet-number catalog evidence is missing, malformed or truncated.');
    if(page.hasMore&&!page.items.length)fail('sheet_number_catalog_unknown','Sheet pagination cannot make progress.');
    for(const item of page.items){
      if(!Number.isSafeInteger(item?.id)||item.id<=0||item.className!=='ViewSheet'||typeof item.sheetNumber!=='string'||!item.sheetNumber.trim()||seenIds.has(item.id)||seenNumbers.has(item.sheetNumber))
        fail('sheet_number_catalog_unknown','Sheet-number catalog contains missing, duplicate or invalid native evidence.');
      seenIds.add(item.id);seenNumbers.add(item.sheetNumber);items.push(item);
    }
    if(!page.hasMore)return items;
    offset+=page.items.length;
  }
  fail('sheet_number_catalog_truncated','Sheet-number catalog exceeds the reviewed 10000-item bound.');
}
async function inspectSheetNumbers(input,sheetChanges,call,signal){
  if(!input.sheets?.length&&!sheetChanges.some(row=>row.number!==undefined))return null;
  const catalog=await sheetCatalog(call,signal);
  const byId=new Map(catalog.map(row=>[row.id,row])),occupied=new Map(catalog.map(row=>[row.sheetNumber,row.id])),requestedNumbers=new Set();
  for(const row of sheetChanges.filter(row=>row.number!==undefined)){
    const current=byId.get(row.sheetId),review=row.parameters.find(parameter=>parameter.parameter==='BIP:SHEET_NUMBER');
    if(!current||review.beforeHasValue!==true||current.sheetNumber!==review.before)
      fail('sheet_number_catalog_unknown','Native sheet-number catalog does not agree with the inspected target.',{elementId:row.sheetId});
    if(requestedNumbers.has(row.number)||occupied.has(row.number)&&occupied.get(row.number)!==row.sheetId)
      fail('sheet_number_conflict','A requested sheet number is already occupied; no number is guessed or temporarily reassigned.',{elementId:row.sheetId,number:row.number});
    requestedNumbers.add(row.number);
  }
  for(const row of input.sheets??[]){
    if(requestedNumbers.has(row.number)||occupied.has(row.number))
      fail('sheet_number_conflict','A new sheet number conflicts with existing or requested sheet metadata.',{number:row.number});
    requestedNumbers.add(row.number);
  }
  return {complete:true,count:catalog.length,items:catalog};
}
export async function inspectElectricalSheetScope(input,call,signal){
  signal?.throwIfAborted();input=parseElectricalSheetInput(input);
  const titleBlockReview=await inspectTitleBlockChangeScope({titleBlockChanges:input.titleBlockChanges},call,signal);
  if(titleBlockReview)return {workflowId:'electrical.sheet',...titleBlockReview,fullLegacyParityVerified:false};
  const metadataIds=[...(input.sheetChanges??[]).map(row=>row.sheetId),...(input.viewChanges??[]).map(row=>row.viewId)];
  const placementIds=[...(input.placementMoves??[]).flatMap(row=>[row.placementId,row.sheetId,row.viewId]),...(input.viewportLabelMoves??[]).flatMap(row=>[row.viewportId,row.sheetId,row.viewId])];
  if(!metadataIds.length){
    const placementReview=await inspectDrawingPlacementScope({placementMoves:input.placementMoves,viewportLabelMoves:input.viewportLabelMoves},call,signal);
    if(input.sheets?.length){
      const numbering=await inspectSheetNumbers(input,[],call,signal);
      return {workflowId:'electrical.sheet',...(placementReview??{}),
        scope:placementReview?'new-sheet-number-catalog-and-existing-drawing-placements':'new-sheet-number-catalog-only',
        selectedScopeVerified:true,numberScopeVerified:true,
        inspectedElementCount:placementReview?.inspectedElementCount??0,inspectedElementIds:placementReview?.inspectedElementIds??[],
        inspectionBatches:placementReview?.inspectionBatches??0,
        sheetNumberCatalog:numbering,newSheetNumbers:input.sheets.map(row=>row.number),
        nativeCreationAccepted:false,automaticSave:false,fullLegacyParityVerified:false,
        warnings:[...(placementReview?.warnings??[]),'仅核对新图纸编号与已声明放置范围；图框类型兼容及原生创建仍由plan.create验证，未执行模型写入。']};
    }
    return placementReview?{workflowId:'electrical.sheet',...placementReview,inspectionDeduplicated:placementReview.inspectedElementCount<placementIds.length,fullLegacyParityVerified:false}:null;
  }
  const requested=[...new Set([...metadataIds,...placementIds])];
  if(!requested.length)return null;
  const inspected=new Map();
  let inspectionBatches=0;
  for(let offset=0;offset<requested.length;offset+=100){
    signal?.throwIfAborted();const batch=requested.slice(offset,offset+100);
    const response=await call('revit.inspect',{elementIds:batch},signal);
    signal?.throwIfAborted();
    const map=inspectRows(response,batch);
    for(const [id,item] of map)inspected.set(id,item);
    inspectionBatches++;
  }
  const placementReview=placementIds.length?reviewDrawingPlacementScope({placementMoves:input.placementMoves,viewportLabelMoves:input.viewportLabelMoves},inspected):null;
  const sheetChanges=(input.sheetChanges??[]).map(row=>{
    const item=inspected.get(row.sheetId);
    if(item.summary.className!=='ViewSheet')fail('sheet_metadata_target_mismatch','sheetId must identify an existing ViewSheet.',{elementId:row.sheetId});
    const parameters=[];
    if(row.number!==undefined)parameters.push(reviewParameter(item,'SHEET_NUMBER',row.number));
    if(row.name!==undefined)parameters.push(reviewParameter(item,'SHEET_NAME',row.name));
    return {...row,parameters};
  });
  const viewChanges=(input.viewChanges??[]).map(row=>{
    const item=inspected.get(row.viewId);
    if(item.summary.className!=='ViewPlan'||item.summary.isViewTemplate!==false)
      fail('sheet_metadata_target_mismatch','viewId must identify a verified non-template ViewPlan.',{elementId:row.viewId});
    const parameters=[];
    if(row.name!==undefined)parameters.push(reviewParameter(item,'VIEW_NAME',row.name));
    if(row.scale!==undefined)parameters.push(reviewParameter(item,'VIEW_SCALE_PULLDOWN_METRIC',row.scale));
    return {...row,parameters};
  });
  const numbering=await inspectSheetNumbers(input,sheetChanges,call,signal);
  return {
    workflowId:'electrical.sheet',selectedScopeVerified:true,scope:placementReview?'existing-sheet-plan-view-metadata-and-drawing-placements':'existing-sheet-and-plan-view-metadata-only',
    ...(placementReview?{drawingPlacementReview:placementReview,placementMoves:placementReview.placementMoves,viewportLabelMoves:placementReview.viewportLabelMoves,requiredNativeFeature:placementReview.requiredNativeFeature}:{}),
    inspectedElementCount:requested.length,inspectedElementIds:requested,inspectionBatches,inspectionDeduplicated:requested.length<metadataIds.length+placementIds.length,inspectionSnapshotShared:placementIds.length>0,sheetChanges,viewChanges,
    sheetNumberCatalog:numbering,
    ...(input.sheets?.length?{newSheetNumbers:input.sheets.map(row=>row.number),numberScopeVerified:true,nativeCreationAccepted:false}:{}),
    warnings:['本次元数据预检覆盖明确的既有图纸/平面视图；图框、裁剪及出图仍需独立执行后核验。',...(placementReview?.warnings??[])],
    automaticSave:false,fullLegacyParityVerified:false
  };
}
