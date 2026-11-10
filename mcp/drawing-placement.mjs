import {z} from 'zod';

const elementId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const coordinate=z.number().finite().min(-1e8).max(1e8);
export const drawingPlacementMoveSchema=z.object({
  placementId:elementId,sheetId:elementId,viewId:elementId,
  xMm:coordinate,yMm:coordinate,zMm:z.literal(0).optional()
}).strict();
export const viewportLabelMoveSchema=z.object({
  viewportId:elementId,sheetId:elementId,viewId:elementId,
  labelOffsetXMm:coordinate,labelOffsetYMm:coordinate,labelOffsetZMm:z.literal(0).optional(),
  labelLineLengthMm:coordinate.optional()
}).strict();
export const drawingPlacementInputSchema=z.object({
  placementMoves:z.array(drawingPlacementMoveSchema).max(1000).optional(),
  viewportLabelMoves:z.array(viewportLabelMoveSchema).max(1).optional()
}).strict();

function fail(code,message,details){const error=new Error(message);error.code=code;if(details!==undefined)error.details=details;throw error;}
export function parseDrawingPlacementInput(input={}){
  const parsed=drawingPlacementInputSchema.parse(input),claimed=new Set();
  if(parsed.viewportLabelMoves?.length&&parsed.placementMoves?.length)fail('viewport_label_requires_single_operation','Viewport label changes must be the only operation in a reviewed plan.');
  for(const row of parsed.placementMoves??[]){
    if(claimed.has(row.placementId))fail('duplicate_drawing_placement','An existing placement may move only once in a reviewed plan.',{placementId:row.placementId});
    if(new Set([row.placementId,row.sheetId,row.viewId]).size!==3)fail('drawing_placement_scope_mismatch','Placement, sheet and source view must be distinct existing elements.');
    claimed.add(row.placementId);
  }
  const labelClaimed=new Set();
  for(const row of parsed.viewportLabelMoves??[]){
    if(labelClaimed.has(row.viewportId))fail('duplicate_viewport_label_move','A viewport label may move only once in a reviewed plan.',{viewportId:row.viewportId});
    if(new Set([row.viewportId,row.sheetId,row.viewId]).size!==3)fail('drawing_placement_scope_mismatch','Viewport, owner sheet and source view must be distinct existing elements.');
    if(claimed.has(row.viewportId))fail('drawing_placement_scope_mismatch','A viewport cannot be moved and have its label moved in the same reviewed plan.');
    labelClaimed.add(row.viewportId);
  }
  return parsed;
}
export function drawingPlacementOperations(input={}){
  const parsed=parseDrawingPlacementInput(input),operations=[];
  operations.push(...(parsed.placementMoves??[]).map((row,index)=>({...row,operationType:'move_drawing_placement',id:'placementMove'+(index+1)})));
  operations.push(...(parsed.viewportLabelMoves??[]).map((row,index)=>({...row,operationType:'move_viewport_label',id:'viewportLabelMove'+(index+1)})));
  return operations;
}
function inspectRows(response,requested){
  if(!Array.isArray(response?.items)||response.items.length!==requested.length)fail('drawing_placement_scope_unknown','Native inspection must return the complete placement/sheet/view scope.');
  const wanted=new Set(requested),items=new Map();
  for(const item of response.items){
    const id=item?.summary?.id??item?.id;
    if(!wanted.has(id)||items.has(id)||item.exists===false||!item.summary)fail('drawing_placement_scope_unknown','Missing, duplicate, disappeared or unexpected placement-scope element.',{elementId:id});
    items.set(id,item);
  }
  return items;
}
function reviewInspectedRows(nativeItems,requested){
  if(!(nativeItems instanceof Map))fail('drawing_placement_scope_unknown','Placement review requires an inspected native item Map.');
  const items=new Map();
  for(const id of requested){
    const item=nativeItems.get(id);
    if(!item||typeof item!=='object'||Array.isArray(item)||item.exists===false||!item.summary||item.summary.id!==id)
      fail('drawing_placement_scope_unknown','Inspected placement/sheet/view scope is missing or inconsistent.',{elementId:id});
    items.set(id,item);
  }
  return items;
}
function requestedIds(input){
  return [...new Set([...(input.placementMoves??[]).flatMap(row=>[row.placementId,row.sheetId,row.viewId]),...(input.viewportLabelMoves??[]).flatMap(row=>[row.viewportId,row.sheetId,row.viewId])])];
}
function nativePoint(point){
  return point&&['xMm','yMm','zMm'].every(key=>typeof point[key]==='number'&&Number.isFinite(point[key]));
}
function nativeLabelOffset(offset){
  return offset&&['xMm','yMm','zMm'].every(key=>typeof offset[key]==='number'&&Number.isFinite(offset[key]));
}
const placementClasses=new Set(['Viewport','PanelScheduleSheetInstance','ScheduleSheetInstance']);
const ordinaryViewClasses=new Set(['View','ViewPlan','View3D','ViewSection','ViewDrafting']);
function review(row,items){
  const placement=items.get(row.placementId),sheet=items.get(row.sheetId),view=items.get(row.viewId);
  if(!placementClasses.has(placement.summary.className))fail('drawing_placement_class_mismatch','Only known viewport, panel-schedule and ordinary schedule placements may move.',{placementId:row.placementId,className:placement.summary.className});
  if(sheet.summary.className!=='ViewSheet')fail('drawing_placement_sheet_mismatch','sheetId must identify the exact existing ViewSheet.',{sheetId:row.sheetId});
  if(placement.summary.ownerViewId!==row.sheetId||placement.drawing?.sheetId!==row.sheetId||placement.drawing?.viewId!==row.viewId)
    fail('drawing_placement_relationship_mismatch','The native placement owner/source view differs from the reviewed sheet and view.',{placementId:row.placementId,sheetId:row.sheetId,viewId:row.viewId});
  if(view.summary.isViewTemplate!==false)fail('drawing_placement_view_unknown','Source view must be verified as a non-template native view.',{viewId:row.viewId});
  if(placement.summary.className==='PanelScheduleSheetInstance'&&view.summary.className!=='PanelScheduleView'||
    placement.summary.className==='ScheduleSheetInstance'&&view.summary.className!=='ViewSchedule'||
    placement.summary.className==='Viewport'&&!ordinaryViewClasses.has(view.summary.className))
    fail('drawing_placement_view_mismatch','Placement class and referenced native view class are incompatible.',{placementId:row.placementId,viewId:row.viewId});
  if(placement.summary.pinned===true||placement.summary.isReadOnly===true||placement.drawing.isTitleblockRevisionSchedule===true)
    fail('drawing_placement_read_only','The placement is pinned, read-only or a title-block revision schedule.',{placementId:row.placementId});
  if(!nativePoint(placement.drawing.position))fail('drawing_placement_position_unknown','Native paper position requires finite complete XY/Z evidence.',{placementId:row.placementId});
  const before={...placement.drawing.position},after={xMm:row.xMm,yMm:row.yMm,zMm:0};
  return {
    ...row,className:placement.summary.className,before,after,
    noOp:Math.hypot(before.xMm-after.xMm,before.yMm-after.yMm)<=0.0000003048,
    coordinateFrame:'sheet-paper-XY-mm',nativeDepthIsPaperOffset:false,
    pinStateVerified:typeof placement.summary.pinned==='boolean',
    writeabilityVerified:placement.summary.isReadOnly===false&&placement.summary.pinned===false&&
      (placement.summary.className!=='ScheduleSheetInstance'||placement.drawing.isTitleblockRevisionSchedule===false)
  };
}
function reviewLabel(row,items){
  const viewport=items.get(row.viewportId),sheet=items.get(row.sheetId),view=items.get(row.viewId);
  if(viewport.summary.className!=='Viewport')fail('drawing_placement_class_mismatch','Viewport label moves require an existing Viewport.',{viewportId:row.viewportId});
  if(sheet.summary.className!=='ViewSheet')fail('drawing_placement_sheet_mismatch','sheetId must identify the exact existing ViewSheet.',{sheetId:row.sheetId});
  if(!viewport.drawing||typeof viewport.drawing!=='object'||Array.isArray(viewport.drawing))fail('drawing_placement_label_unknown','Native viewport drawing evidence is missing or malformed.',{viewportId:row.viewportId,requiredNativeFeature:'viewport-label-offset'});
  if(viewport.summary.ownerViewId!==row.sheetId||viewport.drawing?.sheetId!==row.sheetId||viewport.drawing?.viewId!==row.viewId)
    fail('drawing_placement_relationship_mismatch','The native viewport owner/source view differs from the reviewed sheet and view.',{viewportId:row.viewportId,sheetId:row.sheetId,viewId:row.viewId});
  if(view.summary.isViewTemplate!==false)fail('drawing_placement_view_unknown','Source view must be verified as a non-template native view.',{viewId:row.viewId});
  if(!ordinaryViewClasses.has(view.summary.className))fail('drawing_placement_view_mismatch','Viewport label moves require an ordinary placeable view.',{viewportId:row.viewportId,viewId:row.viewId});
  const drawing=viewport.drawing;
  if(!drawing||typeof drawing!=='object'||Array.isArray(drawing))fail('drawing_placement_label_unknown','Native viewport drawing evidence is missing or malformed.',{viewportId:row.viewportId,requiredNativeFeature:'viewport-label-offset'});
  if(viewport.summary.pinned===true||viewport.summary.isReadOnly===true||drawing.pinned===true||drawing.isReadOnly===true)fail('drawing_placement_read_only','The viewport is pinned or its document is read-only; its label will not be moved.',{viewportId:row.viewportId});
  if(drawing.pinned!==false||drawing.isReadOnly!==false)fail('drawing_placement_label_unknown','Native viewport pin or document read-only state is unavailable.',{viewportId:row.viewportId,requiredNativeFeature:'viewport-label-offset'});
  if(drawing.rotation!=='None')fail('drawing_placement_label_rotation','Viewport label changes support only a verified unrotated viewport.',{viewportId:row.viewportId});
  if(drawing.labelOffsetSupported!==true||!nativeLabelOffset(drawing.labelOffset)||typeof drawing.labelLineLengthMm!=='number'||!Number.isFinite(drawing.labelLineLengthMm))fail('drawing_placement_label_unknown','Native viewport label offset or line length is unknown or non-finite.',{viewportId:row.viewportId,requiredNativeFeature:'viewport-label-offset'});
  if(drawing.geometrySupported!==true||!nativePoint(drawing.position)||!nativePoint(drawing.labelMin)||!nativePoint(drawing.labelMax)||drawing.labelMax.xMm<=drawing.labelMin.xMm||drawing.labelMax.yMm<=drawing.labelMin.yMm)fail('drawing_placement_label_unknown','The viewport has no verified nonempty label bounds.',{viewportId:row.viewportId});
  const before={...drawing.labelOffset},after={xMm:row.labelOffsetXMm,yMm:row.labelOffsetYMm,zMm:0};
  const beforeLineLengthMm=drawing.labelLineLengthMm,afterLineLengthMm=row.labelLineLengthMm??beforeLineLengthMm;
  return {...row,className:'Viewport',before,after,beforeLineLengthMm,afterLineLengthMm,lineLengthExplicit:row.labelLineLengthMm!==undefined,noOp:Math.hypot(before.xMm-after.xMm,before.yMm-after.yMm)<=0.0000003048&&Math.abs(beforeLineLengthMm-afterLineLengthMm)<=0.0000003048,coordinateFrame:'offset-from-unrotated-viewport-bottom-left-mm',contentPosition:{...drawing.position},labelBounds:{min:{...drawing.labelMin},max:{...drawing.labelMax}},rotation:drawing.rotation,pinStateVerified:true,documentWriteabilityVerified:true};
}
export async function inspectDrawingPlacementScope(input={},call,signal){
  signal?.throwIfAborted();input=parseDrawingPlacementInput(input);
  const requested=requestedIds(input);
  if(!requested.length)return null;
  const items=new Map();
  let inspectionBatches=0;
  for(let offset=0;offset<requested.length;offset+=100){
    signal?.throwIfAborted();const batch=requested.slice(offset,offset+100);
    const response=await call('revit.inspect',{elementIds:batch},signal);
    signal?.throwIfAborted();
    const inspected=inspectRows(response,batch);
    for(const [id,item] of inspected)items.set(id,item);
    inspectionBatches++;
  }
  return {...reviewDrawingPlacementScope(input,items),inspectionBatches,inspectionSnapshotShared:false};
}

// Pure relationship/geometry review. This does not certify document freshness;
// the owning workflow must capture these rows in its current pinned invocation.
export function reviewDrawingPlacementScope(input={},nativeItems){
  input=parseDrawingPlacementInput(input);
  const requested=requestedIds(input);
  if(!requested.length)return null;
  const items=reviewInspectedRows(nativeItems,requested);
  const placementMoves=(input.placementMoves??[]).map(row=>review(row,items));
  const viewportLabelMoves=(input.viewportLabelMoves??[]).map(row=>reviewLabel(row,items));
  return {
    selectedScopeVerified:true,scope:'explicit-existing-drawing-placements',
    inspectedElementIds:requested,inspectedElementCount:requested.length,placementMoves,viewportLabelMoves,
    requiredNativeFeature:viewportLabelMoves.length?'viewport-label-offset':'drawing-placement-move',nativeMovementAccepted:false,
    warnings:[
      '仅移动已明确的图纸放置实例；图纸、视图、配电盘表定义和比例不会随此操作自动修改。',
      '当前原生查询可能未暴露固定/修订表/可写状态；未暴露字段保留为未知，原生预览必须再次验证，不能据此认定可写。',
      '纸面位置使用XY；原生返回Z只保留为证据。标签偏移为未旋转视口左下角到标签引线左端点的二维毫米向量，Z忽略；仅明确给出的引线长度可修改。移动后的边界、标签、图框相交及PNG版面需独立核验。'
    ],
    automaticSave:false,allModelSideEffectsVerified:false
  };
}
