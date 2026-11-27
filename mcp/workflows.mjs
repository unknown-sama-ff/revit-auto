import {validateLightingMove} from './lighting-move.mjs';
import {validateStair} from './stair-rules.mjs';
import {validateOpening} from './opening-rules.mjs';
import {loadFamilyOperationSchema} from './family-load.mjs';
import {electricalWireOperations} from './electrical-wire.mjs';
import {electricalCircuitOperations} from './electrical-circuit.mjs';
import {electricalSheetOperations} from './electrical-sheet.mjs';
import {drawingPlacementMoveSchema,viewportLabelMoveSchema,drawingPlacementOperations,parseDrawingPlacementInput} from './drawing-placement.mjs';
import {validateStructuralColumn,validateGrid} from './architecture-rules.mjs';
import {validateTitleBlockChange,validateTitleBlockChangePlan,titleBlockChangeOperations} from './titleblock-change.mjs';
import {architectureTypeCopyOperations,validateArchitectureTypeCopy,validateArchitectureTypeCopyPlan} from './architecture-type-copy.mjs';
import {validateAnnotationInput} from './annotation-input.mjs';
import {validateStructuralElement} from './structural-elements.mjs';
import {validateWallFoundation,validateWallFoundationPlan} from './wall-foundation.mjs';
import {validateRebarCreation,validateRebarPlan} from './rebar-creation.mjs';
import {validateCeilingCreation,validateCeilingPlan} from './ceiling-creation.mjs';
import {validateMaterialCreation,validateMaterialAssignment,validateMaterialPlan} from './material-creation.mjs';
import {validateRoofCreation,validateRoofPlan} from './roof-creation.mjs';
import {validateAnnotationCreation,validateAnnotationCreationPlan} from './annotation-creation.mjs';
import {validateElectricalRun,validateElectricalRunPlan} from './electrical-runs.mjs';
import {connectionPrefixes,validateConnectionTopology} from './mep-connection-contracts.mjs';

export const OPERATIONS = new Set([
  'move_lighting_fixtures','create_family_instance','duplicate_type','duplicate_architecture_type','set_parameter','delete_element','load_family',
  'create_level','create_grid','create_structural_column','create_structural_beam','create_isolated_foundation','create_wall_foundation','create_rebar_set','create_rebar_stirrup','create_ceiling','create_wall','create_floor','create_opening','create_room','create_stair','create_material','duplicate_material','create_footprint_roof','assign_material','join_geometry',
  'create_circuit','create_wire','create_cable_tray','create_conduit','create_view_plan','create_sheet','create_schedule',
  'create_panel_schedule','configure_view','place_viewport','move_drawing_placement','move_viewport_label','change_titleblock_type','create_pipe','create_duct','connect_elements','create_fitting','create_tag','create_dimension','create_text_note','create_detail_line'
]);

function requireField(value, field) {
  if (value[field] === undefined || value[field] === null || value[field] === '') throw new Error(`${value.operationType}: ${field} is required.`);
}
const DOTNET_WHITESPACE = /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/u;
function isDotnetWhitespace(character) { return DOTNET_WHITESPACE.test(character); }
function validateRoomIdentity(op) {
  for (const field of ['name','number']) {
    const value=op[field];
    if (typeof value!=='string' || value.length===0 || isDotnetWhitespace(value[0]) || isDotnetWhitespace(value[value.length-1]) || [...value].every(isDotnetWhitespace))
      throw new Error(`create_room: ${field} must be a nonblank string without leading or trailing whitespace.`);
  }
}
function number(value, field, positive = false) {
  if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || Math.abs(value[field]) > 1e8 || positive && value[field] <= 0)
    throw new Error(`${field} must be a ${positive ? 'positive ' : ''}finite number. Geometry is in millimeters.`);
}
function validateDuctDimensions(op) {
  const diameter=Object.hasOwn(op,'diameterMm'),width=Object.hasOwn(op,'widthMm'),height=Object.hasOwn(op,'heightMm');
  for(const field of ['diameterMm','widthMm','heightMm'])if(Object.hasOwn(op,field))number(op,field,true);
  if(diameter ? width||height : !width||!height)
    throw new Error('create_duct requires either diameterMm or paired widthMm and heightMm, without mixing specifications.');
}
function point(p) { if (!p) throw new Error('Point coordinates are required.'); number(p, 'xMm'); number(p, 'yMm'); if (p.zMm !== undefined) number(p, 'zMm'); }
function validateCropBounds(op) {
  if (!Object.hasOwn(op,'cropBounds')) return;
  if (!op.settings.includes('crop')) throw new Error('cropBounds requires the explicit crop setting.');
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const b=op.cropBounds;
  if (!exact(b,['min','max']) || !exact(b.min,['xMm','yMm']) || !exact(b.max,['xMm','yMm'])) throw new Error('cropBounds accepts only min/max project XY points, no Z, rotation or implicit fields.');
  point(b.min); point(b.max);
  if (b.max.xMm-b.min.xMm<1 || b.max.yMm-b.min.yMm<1) throw new Error('cropBounds must be ordered and at least 1 mm wide and high.');
}
export function validateConnectorSelection(op,prefix){
 const id=prefix+'ConnectorId',selection=prefix+'Connector';
 if(Object.hasOwn(op,id)===Object.hasOwn(op,selection))throw new Error(prefix+' requires exactly one connector ID or criteria.');
 if(Object.hasOwn(op,id)){if(!Number.isSafeInteger(op[id])||op[id]<0||op[id]>2147483647)throw new Error('Connector IDs must be nonnegative 32-bit integers.');return;}
 const c=op[selection];
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).length!==4||Object.keys(c).some(k=>!['domain','shape','point','toleranceMm'].includes(k)))throw new Error('Connector criteria require exactly domain, shape, point and toleranceMm.');
 if(!['DomainPiping','DomainHvac','DomainElectrical','DomainCableTrayConduit'].includes(c.domain)||!['Round','Rectangular','Oval','Invalid'].includes(c.shape))throw new Error('Unknown connector domain or shape.');
 if(!c.point||typeof c.point!=='object'||Array.isArray(c.point)||Object.keys(c.point).length!==3||Object.keys(c.point).some(k=>!['xMm','yMm','zMm'].includes(k)))throw new Error('Connector point requires full XYZ in millimeters.');
 point(c.point);number(c.point,'zMm');
 if(typeof c.toleranceMm!=='number'||!Number.isFinite(c.toleranceMm)||c.toleranceMm<=0||c.toleranceMm>10000)throw new Error('Connector tolerance must be finite in (0,10000] mm.');
}
function validatePortReservations(operations){
 const created=new Map(),claimed=new Map();
 for(const [i,op] of operations.entries()){
  if(['connect_elements','create_fitting'].includes(op.operationType))for(const prefix of connectionPrefixes(op)){
   const owner=op[prefix+'ElementId'],selector=op[prefix+'Connector'];let key;
   const curve=typeof owner==='string'&&owner.startsWith('@')?created.get(owner.slice(1)):null;
   if(curve&&['create_pipe','create_duct','create_cable_tray','create_conduit'].includes(curve.operationType)){
    if(!selector)throw new Error(curve.operationType==='create_pipe'||curve.operationType==='create_duct'?'New pipe/duct endpoint requires criteria; never predict port IDs.':'New cable-tray/conduit endpoint requires criteria; never predict port IDs.');
    const domain=curve.operationType==='create_pipe'?'DomainPiping':curve.operationType==='create_duct'?'DomainHvac':'DomainCableTrayConduit';
    const shape=curve.operationType==='create_cable_tray'?'Rectangular':curve.operationType==='create_conduit'?'Round':(Object.hasOwn(curve,'diameterMm')?'Round':'Rectangular');
    const endpoints=['start','end'].filter(end=>{
     const p=curve[end],q=selector.point;const distance=(p.xMm-q.xMm)**2+(p.yMm-q.yMm)**2+((p.zMm??0)-q.zMm)**2;
     return selector.domain===domain&&selector.shape===shape&&distance<=selector.toleranceMm**2;
    });
    if(endpoints.length!==1)throw new Error('New curve endpoint selector is missing or ambiguous; '+endpoints.length+' endpoints match.');
    key=owner+':endpoint:'+endpoints[0];
   }else if(Object.hasOwn(op,prefix+'ConnectorId'))key=owner+':port:'+op[prefix+'ConnectorId'];
   else key=owner+':point:'+JSON.stringify([selector.domain,selector.shape,selector.point.xMm,selector.point.yMm,selector.point.zMm]);
   if(claimed.has(key))throw new Error('Endpoint '+key+' is occupied by operation '+claimed.get(key)+'; operation '+(i+1)+' cannot consume the same port again.');
   claimed.set(key,i+1);
  }
  if(op.id!==undefined)created.set(op.id,op);
 }
}
export function validateOperations(operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 1000) throw new Error('A plan needs 1..1000 operations.');
  if(operations.some(op=>op?.operationType==='move_viewport_label')&&operations.length!==1)throw new Error('Viewport label changes must be the only operation in a reviewed plan.');
  if(operations.some(op=>op?.operationType==='move_lighting_fixtures')&&operations.length!==1)throw new Error('A lighting move must be the only operation in the reviewed plan.');
  const known = new Set(),movedPlacements=new Set(),gridNames=new Set(),newSheetNumbers=new Set();
  for (const op of operations) {
    if(Object.hasOwn(op,'allowUnassignedEquipmentPort')&&op.operationType!=='connect_elements')throw new Error('allowUnassignedEquipmentPort belongs only to connect_elements.');
    if (!op || typeof op !== 'object' || !OPERATIONS.has(op.operationType)) throw new Error(`Unsupported operation '${op?.operationType}'.`);
    for (const [field, value] of Object.entries(op)) {
      if(op.operationType==='load_family'&&field==='expectedCategoryId')continue;
      if (field.endsWith('ConnectorId') && !(Number.isSafeInteger(value) && value >= 0)) throw new Error('Connector ids must be nonnegative integers.');
      const ids = field.endsWith('ConnectorId') ? [] : field.endsWith('Ids') && Array.isArray(value) ? value : field.endsWith('Id') ? [value] : [];
      for (const id of ids) {
        if (id === null || id === undefined) continue;
        if (!(Number.isSafeInteger(id) && id > 0) && !(typeof id === 'string' && id.startsWith('@') && known.has(id.slice(1)))) throw new Error(`Invalid ${field}: use a positive element id or @reference to an earlier operation.`);
      }
    }
    for (const dependency of op.dependencies || []) if (!known.has(dependency)) throw new Error(`Unresolved dependency '${dependency}'.`);
    if (op.id !== undefined) {
      if (typeof op.id !== 'string' || !op.id.trim() || op.id.length > 80 || known.has(op.id)) throw new Error(`Duplicate or invalid operation id '${op.id}'.`);
      known.add(op.id);
    }
    switch (op.operationType) {
      case 'move_lighting_fixtures': validateLightingMove(op); break;
      case 'load_family': loadFamilyOperationSchema.parse(op); break;
      case 'duplicate_architecture_type': validateArchitectureTypeCopy(op); break;
      case 'create_family_instance':
        if (op.symbolId === undefined) { requireField(op,'family'); requireField(op,'type'); }
        point(op.point || op);
        if(op.placementMode!==undefined&&(op.placementMode!=='legacyPoint'||op.hostElementId!==undefined))throw new Error('legacyPoint cannot be combined with a host and is the only supported explicit placementMode.');
        break;
      case 'create_level': number(op,'elevationMm'); requireField(op,'name'); break;
      case 'create_grid':
        validateGrid(op);
        if(gridNames.has(op.name))throw new Error('Grid names must be unique within the reviewed plan.');
        gridNames.add(op.name);break;
      case 'create_structural_column': validateStructuralColumn(op); break;
      case 'create_structural_beam': case 'create_isolated_foundation': validateStructuralElement(op); break;
      case 'create_wall_foundation': validateWallFoundation(op); break;
      case 'create_rebar_set': case 'create_rebar_stirrup': validateRebarCreation(op); break;
      case 'create_ceiling': validateCeilingCreation(op); break;
      case 'create_material': case 'duplicate_material': validateMaterialCreation(op); break;
      case 'assign_material': validateMaterialAssignment(op); break;
      case 'join_geometry': {
        const allowedJoin = new Set(['operationType','id','dependencies','firstElementId','secondElementId','action','ignoreAlreadyJoined','skipIfUnjoinable']);
        if (Object.keys(op).some(k => !allowedJoin.has(k))) throw new Error('join_geometry contains unsupported fields.');
        requireField(op,'firstElementId'); requireField(op,'secondElementId');
        if (String(op.firstElementId) === String(op.secondElementId)) throw new Error('join_geometry requires two distinct elements.');
        if (op.action !== undefined && !['join','unjoin','switch_order'].includes(op.action)) throw new Error('join_geometry action must be join, unjoin, or switch_order.');
        if (op.ignoreAlreadyJoined !== undefined && typeof op.ignoreAlreadyJoined !== 'boolean') throw new Error('join_geometry ignoreAlreadyJoined must be a boolean.');
        if (op.skipIfUnjoinable !== undefined && typeof op.skipIfUnjoinable !== 'boolean') throw new Error('join_geometry skipIfUnjoinable must be a boolean.');
        break;
      }
      case 'create_footprint_roof': validateRoofCreation(op); break;
      case 'create_text_note': case 'create_detail_line': validateAnnotationCreation(op); break;
      case 'create_cable_tray': case 'create_conduit': validateElectricalRun(op); break;
      case 'change_titleblock_type': validateTitleBlockChange(op); break;
      case 'create_wall': case 'create_pipe': case 'create_duct':
        point(op.start); point(op.end);
        if (op.operationType === 'create_wall') {
          requireField(op,'wallTypeId');
          if (op.topLevelId !== undefined) {
            if (op.heightMm !== undefined) number(op,'heightMm',true);
            if (op.topOffsetMm !== undefined) number(op,'topOffsetMm');
          } else {
            number(op,'heightMm',true);
          }
          for (const jf of ['disallowJoin','disallowJoinStart','disallowJoinEnd']) {
            if (op[jf] !== undefined && typeof op[jf] !== 'boolean') throw new Error(`create_wall: ${jf} must be a boolean.`);
          }
          for (const jt of ['joinTypeStart','joinTypeEnd']) {
            if (op[jt] !== undefined && !['abut','miter','square_off'].includes(op[jt])) throw new Error(`create_wall: ${jt} must be abut, miter, or square_off.`);
          }
          if (op.topologyPriority !== undefined) number(op,'topologyPriority');
        }
        if (op.operationType === 'create_pipe') { requireField(op,'pipeTypeId'); requireField(op,'systemTypeId'); number(op,'diameterMm',true); }
        if (op.operationType === 'create_duct') { requireField(op,'ductTypeId'); requireField(op,'systemTypeId'); validateDuctDimensions(op); }
        break;
      case 'create_floor':
        if (!Array.isArray(op.boundary) || op.boundary.length < 3) throw new Error('Floor needs at least three boundary points.');
        requireField(op,'floorTypeId'); op.boundary.forEach(point); break;
      case 'create_opening': validateOpening(op); break;
      case 'create_room': validateRoomIdentity(op); point(op); break;
      case 'create_stair': validateStair(op); break;
      case 'duplicate_type': requireField(op,'sourceTypeId'); requireField(op,'name'); break;
      case 'delete_element': requireField(op,'elementId'); break;
      case 'set_parameter': requireField(op,'elementId'); requireField(op,'parameter'); requireField(op,'value'); break;
      case 'create_circuit':
        if (!Array.isArray(op.elementIds) || !op.elementIds.length) throw new Error('A circuit needs elementIds.');
        requireField(op,'panelId'); break;
      case 'create_wire': ['firstElementId','secondElementId','viewId','wireTypeId'].forEach(f => requireField(op,f)); break;
      case 'create_view_plan': requireField(op,'viewFamilyTypeId'); break;
      case 'create_sheet':
        ['number','name'].forEach(f => requireField(op,f));
        if(typeof op.number!=='string'||!op.number.trim())throw new Error('A new sheet number must be explicit nonblank text.');
        if(newSheetNumbers.has(op.number))throw new Error('Duplicate new sheet number in one plan: '+op.number);
        newSheetNumbers.add(op.number);break;
      case 'create_schedule': ['category','fields'].forEach(f => requireField(op,f)); break;
      case 'create_panel_schedule': requireField(op,'panelId'); break;
      case 'configure_view': {
        ['viewId','referenceViewId'].forEach(f=>requireField(op,f));
        if(op.viewportId!==undefined){if(movedPlacements.has(op.viewportId))throw new Error('A drawing placement cannot be recentered and moved twice in one plan.');movedPlacements.add(op.viewportId);}
        const allowed=['viewRange','crop','discipline','lightingCategories','displayStyle','detailLevel','partsVisibility'];
        if(!Array.isArray(op.settings)||!op.settings.length||op.settings.some(s=>!allowed.includes(s))||new Set(op.settings).size!==op.settings.length)throw new Error('Provide explicit known unique view settings.');
        if(op.discipline!==undefined&&(!op.settings.includes('discipline')||!['Architectural','Structural','Mechanical','Electrical','Plumbing','Coordination'].includes(op.discipline)))throw new Error('Unknown or unrequested discipline.');
        if((op.viewportId!==undefined)!==(op.paperPoint!==undefined))throw new Error('Viewport recentering requires viewportId and paperPoint together.');
        if(op.paperPoint){point(op.paperPoint);if(op.paperPoint.zMm!==undefined&&op.paperPoint.zMm!==0)throw new Error('Paper points require zero Z.');}
        validateCropBounds(op);
        if(op.parameters!==undefined)throw new Error('Configure view does not accept ignored parameter maps.');
        break;
      }
      case 'create_tag': validateAnnotationInput(op); requireField(op,'elementId'); requireField(op,'viewId'); point(op);
        if(Object.hasOwn(op,'leader')&&typeof op.leader!=='boolean')throw new Error('create_tag: leader must be an explicit boolean.');
        break;
      case 'create_dimension': validateAnnotationInput(op); requireField(op,'viewId'); point(op.start); point(op.end); break;
      case 'place_viewport': ['sheetId','viewId'].forEach(f => requireField(op,f)); point(op); break;
      case 'move_drawing_placement': {
        const {operationType,id,dependencies,...row}=op;
        drawingPlacementMoveSchema.parse(row);parseDrawingPlacementInput({placementMoves:[row]});
        if(dependencies!==undefined&&(!Array.isArray(dependencies)||dependencies.length>1000||dependencies.some(value=>typeof value!=='string'||!value.trim()||value.length>80)))throw new Error('Movement dependencies require explicit operation IDs.');
        if(movedPlacements.has(row.placementId))throw new Error('An existing placement may move only once per plan.');
        movedPlacements.add(row.placementId);break;
      }
      case 'move_viewport_label': {
        const {operationType,id,dependencies,...row}=op;
        viewportLabelMoveSchema.parse(row);parseDrawingPlacementInput({viewportLabelMoves:[row]});
        if(dependencies!==undefined&&(!Array.isArray(dependencies)||dependencies.length>1000||dependencies.some(value=>typeof value!=='string'||!value.trim()||value.length>80)))throw new Error('Viewport label dependencies require explicit operation IDs.');
        if(movedPlacements.has(row.viewportId))throw new Error('A viewport cannot be moved and have its label moved twice in one plan.');
        movedPlacements.add(row.viewportId);break;
      }
      case 'create_fitting': case 'connect_elements': for(const prefix of validateConnectionTopology(op))validateConnectorSelection(op,prefix); break;
    }
  }
  validatePortReservations(operations);
  validateTitleBlockChangePlan(operations);
  validateArchitectureTypeCopyPlan(operations);
  validateWallFoundationPlan(operations);
  validateRebarPlan(operations);
  validateCeilingPlan(operations);
  validateMaterialPlan(operations);
  validateRoofPlan(operations);
  validateAnnotationCreationPlan(operations);
  validateElectricalRunPlan(operations);
  return operations;
}

export function workflowOperations(name, input = {}) {
  const ops = [];
  const add = (rows, type, prefix) => (rows || []).forEach((row,index) => ops.push({ ...row, operationType: type, id: row.id || `${prefix}${index + 1}` }));
  const placements = (rows,prefix,category) => add((rows || []).map(r => ({...r})), 'create_family_instance',prefix);
  const architecturePlacements = (rows,prefix,category) => placements((rows||[]).map(row=>{
    if(row.category!==undefined&&row.category!==category)throw new Error('Architecture placement category differs from its explicit door/window list.');
    return {...row,category};
  }),prefix,category);
  if (name === 'lighting.full' || name === 'lighting.place') {
    add(input.typeCopies,'duplicate_type','type');
    placements(input.panels,'panel','OST_ElectricalEquipment');
    placements(input.lights,'light','OST_LightingFixtures');
    placements(input.switches,'switch','OST_LightingDevices');
    add(input.parameterChanges,'set_parameter','param');
    add(input.circuits,'create_circuit','circuit');
    add(input.views,'create_view_plan','view');
    add(input.viewConfigurations,'configure_view','viewConfiguration');
    add(input.wires,'create_wire','wire');
    add(input.schedules,'create_schedule','schedule');
    add(input.panelSchedules,'create_panel_schedule','panelSchedule');
    add(input.sheets,'create_sheet','sheet');
    add(input.viewports,'place_viewport','viewport');
  } else if (name === 'electrical.circuit') {
    ops.push(...electricalCircuitOperations(input));
  } else if (name === 'electrical.wire') {
    ops.push(...electricalWireOperations(input));
  } else if (name === 'electrical.sheet') {
    ops.push(...electricalSheetOperations(input));
  } else if (name === 'architecture.stairs') {
    if(Object.keys(input).some(key=>key!=='stairs'))throw new Error('architecture.stairs accepts only explicit stairs input.');
    add(input.stairs,'create_stair','stair');
  } else if (name === 'architecture.rooms') {
    add(input.rooms,'create_room','room');
    add(input.views,'create_view_plan','view');
    add(input.schedules,'create_schedule','schedule');
    add(input.sheets,'create_sheet','sheet');
    add(input.viewports,'place_viewport','viewport');
  } else if (name === 'openings.create') {
    if(Object.keys(input).some(key=>key!=='openings')||!Array.isArray(input.openings)||!input.openings.length)throw new Error('openings.create requires only an explicit nonempty openings array.');
    add(input.openings,'create_opening','opening');
  } else if (name === 'architecture.openings') {
    ops.push(...architectureTypeCopyOperations({typeCopies:input.typeCopies}));
    architecturePlacements(input.doors,'door','OST_Doors'); architecturePlacements(input.windows,'window','OST_Windows');
    add(input.schedules,'create_schedule','schedule'); add(input.sheets,'create_sheet','sheet'); add(input.viewports,'place_viewport','viewport');
  } else if (name === 'architecture.documentation') {
    ops.push(...drawingPlacementOperations({placementMoves:input.placementMoves,viewportLabelMoves:input.viewportLabelMoves}));
    ops.push(...titleBlockChangeOperations({titleBlockChanges:input.titleBlockChanges}));
    add(input.views,'create_view_plan','view');
    add(input.viewConfigurations,'configure_view','viewConfiguration');
    add(input.schedules,'create_schedule','schedule');
    add(input.panelSchedules,'create_panel_schedule','panelSchedule');
    add(input.sheets,'create_sheet','sheet');
    add(input.viewports,'place_viewport','viewport');
  } else if (name === 'structure.build') {
    if(Object.keys(input).some(key=>!['columns','beams','isolatedFoundations','wallFoundations','floors','joins','documentIdentity','expectedRevision'].includes(key)))throw new Error('structure.build accepts only columns, beams, isolatedFoundations, wallFoundations, floors and joins with optional matching document pins.');
    for(const key of ['columns','beams','isolatedFoundations','wallFoundations','floors','joins'])if(input[key]!==undefined&&(!Array.isArray(input[key])||input[key].length>1000))throw new Error(key+' requires a bounded array.');
    add(input.columns,'create_structural_column','column');
    add(input.beams,'create_structural_beam','beam');
    add(input.isolatedFoundations,'create_isolated_foundation','foundation');
    add(input.wallFoundations,'create_wall_foundation','wallFoundation');
    add(input.floors,'create_floor','slab');
    add(input.joins,'join_geometry','join');
  } else if (name === 'structure.reinforcement') {
    if(Object.keys(input).some(key=>!['rebarSets','stirrups','documentIdentity','expectedRevision'].includes(key)))throw new Error('structure.reinforcement accepts only rebarSets and stirrups with optional matching document pins.');
    for(const key of ['rebarSets','stirrups'])if(input[key]!==undefined&&(!Array.isArray(input[key])||input[key].length>1000))throw new Error(key+' requires a bounded array.');
    add(input.rebarSets,'create_rebar_set','rebarSet');add(input.stirrups,'create_rebar_stirrup','stirrup');
  } else if (name === 'architecture.ceilings') {
    if(Object.keys(input).some(key=>!['ceilings','documentIdentity','expectedRevision'].includes(key)))throw new Error('architecture.ceilings accepts only ceilings with optional matching document pins.');
    if(input.ceilings!==undefined&&(!Array.isArray(input.ceilings)||input.ceilings.length>1000))throw new Error('ceilings requires a bounded array.');
    add(input.ceilings,'create_ceiling','ceiling');
  } else if (name === 'materials.create') {
    if (Object.keys(input).some(key => !['materials', 'copies', 'assignments', 'documentIdentity', 'expectedRevision'].includes(key))) throw new Error('materials.create accepts materials, copies and assignments with optional matching document pins.');
    add(input.materials, 'create_material', 'material');
    add(input.copies, 'duplicate_material', 'materialCopy');
    add(input.assignments, 'assign_material', 'materialAssignment');
  } else if (name === 'architecture.roofs') {
    if (Object.keys(input).some(key => !['roofs', 'documentIdentity', 'expectedRevision'].includes(key))) throw new Error('architecture.roofs accepts roofs with optional matching document pins.');
    add(input.roofs, 'create_footprint_roof', 'roof');
  } else if (name === 'documentation.annotations') {
    if (Object.keys(input).some(key => !['textNotes', 'detailLines', 'documentIdentity', 'expectedRevision'].includes(key))) throw new Error('documentation.annotations accepts only textNotes and detailLines with optional matching document pins.');
    for (const key of ['textNotes', 'detailLines']) if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 1000)) throw new Error(`${key} requires a bounded array.`);
    add(input.textNotes, 'create_text_note', 'textNote');
    add(input.detailLines, 'create_detail_line', 'detailLine');
  } else if (name === 'mep.electrical_runs') {
    if (Object.keys(input).some(key => !['cableTrays', 'conduits', 'fittings', 'connections', 'documentIdentity', 'expectedRevision'].includes(key))) throw new Error('mep.electrical_runs accepts only cableTrays, conduits, fittings and connections with optional matching document pins.');
    for (const key of ['cableTrays', 'conduits', 'fittings', 'connections']) if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 1000)) throw new Error(`${key} requires a bounded array.`);
    add(input.cableTrays, 'create_cable_tray', 'cableTray');
    add(input.conduits, 'create_conduit', 'conduit');
    add(input.fittings, 'create_fitting', 'fitting');
    add(input.connections, 'connect_elements', 'connection');
  } else if (name === 'architecture.build') {
    ops.push(...architectureTypeCopyOperations({typeCopies:input.typeCopies}));
    add(input.levels,'create_level','level'); add(input.grids,'create_grid','grid');
    add(input.columns,'create_structural_column','column');
    add(input.walls,'create_wall','wall'); add(input.joins,'join_geometry','join'); add(input.floors,'create_floor','floor');
    architecturePlacements(input.doors,'door','OST_Doors'); architecturePlacements(input.windows,'window','OST_Windows');
    add(input.rooms,'create_room','room'); add(input.views,'create_view_plan','view');
    add(input.schedules,'create_schedule','schedule'); add(input.sheets,'create_sheet','sheet'); add(input.viewports,'place_viewport','viewport');
  } else if (name === 'pump_room.route') {
    (input.routes || []).forEach((route, routeIndex) => {
      if (!Array.isArray(route.points) || route.points.length < 2 || route.points.length > 50) throw new Error('Each pump route needs 2..50 explicit points.');
      if (!['supply','return','neutral'].includes(route.flowIntent)) throw new Error('pump_room.route requires explicit flowIntent supply|return|neutral for every route.');
      for (let index = 0; index < route.points.length - 1; index++) {
        ops.push({...route, start:route.points[index], end:route.points[index + 1], points:undefined, operationType:'create_pipe', id:route.id ? `${route.id}-${index + 1}` : `route${routeIndex + 1}-${index + 1}`});
      }
    });
    add(input.connections,'connect_elements','connection');  } else if (name === 'pump_room.connect') {
    (input.connections || []).forEach(connection => {
      if (!['supply','return','neutral'].includes(connection.flowIntent)) throw new Error('pump_room.connect requires explicit flowIntent supply|return|neutral for every connection.');
    });
    add(input.connections,'connect_elements','connection');
  } else if (name === 'pump_room.build') {
    placements(input.equipment,'pump','OST_MechanicalEquipment');
    add(input.pipes,'create_pipe','pipe'); add(input.ducts,'create_duct','duct');
    add(input.fittings,'create_fitting','fitting'); add(input.connections,'connect_elements','connection');
    add(input.schedules,'create_schedule','schedule'); add(input.views,'create_view_plan','view');
  } else throw new Error(`Unknown workflow '${name}'.`);
  add(input.tags,'create_tag','tag');
  add(input.dimensions,'create_dimension','dimension');
  ops.push(...(input.operations || []));
  return validateOperations(ops);
}
