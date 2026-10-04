export const OPERATIONS = new Set([
  'create_family_instance','duplicate_type','set_parameter','delete_element',
  'create_level','create_grid','create_wall','create_floor','create_room',
  'create_circuit','create_wire','create_view_plan','create_sheet','create_schedule',
  'create_panel_schedule','configure_view','place_viewport','create_pipe','create_duct','connect_elements','create_fitting','create_tag','create_dimension'
]);

function requireField(value, field) {
  if (value[field] === undefined || value[field] === null || value[field] === '') throw new Error(`${value.operationType}: ${field} is required.`);
}
function number(value, field, positive = false) {
  if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || Math.abs(value[field]) > 1e8 || positive && value[field] <= 0)
    throw new Error(`${field} must be a ${positive ? 'positive ' : ''}finite number. Geometry is in millimeters.`);
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
 if(!['DomainPiping','DomainHvac','DomainElectrical'].includes(c.domain)||!['Round','Rectangular','Oval','Invalid'].includes(c.shape))throw new Error('Unknown connector domain or shape.');
 if(!c.point||typeof c.point!=='object'||Array.isArray(c.point)||Object.keys(c.point).length!==3||Object.keys(c.point).some(k=>!['xMm','yMm','zMm'].includes(k)))throw new Error('Connector point requires full XYZ in millimeters.');
 point(c.point);number(c.point,'zMm');
 if(typeof c.toleranceMm!=='number'||!Number.isFinite(c.toleranceMm)||c.toleranceMm<=0||c.toleranceMm>10000)throw new Error('Connector tolerance must be finite in (0,10000] mm.');
}
function validatePortReservations(operations){
 const created=new Map(),claimed=new Map();
 for(const [i,op] of operations.entries()){
  if(['connect_elements','create_fitting'].includes(op.operationType))for(const prefix of ['first','second']){
   const owner=op[prefix+'ElementId'],selector=op[prefix+'Connector'];let key;
   const curve=typeof owner==='string'&&owner.startsWith('@')?created.get(owner.slice(1)):null;
   if(curve&&['create_pipe','create_duct'].includes(curve.operationType)){
    if(!selector)throw new Error('New pipe/duct endpoint requires criteria; never predict port IDs.');
    const domain=curve.operationType==='create_pipe'?'DomainPiping':'DomainHvac',shape=Object.hasOwn(curve,'diameterMm')?'Round':'Rectangular';
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
  const known = new Set();
  for (const op of operations) {
    if (!op || typeof op !== 'object' || !OPERATIONS.has(op.operationType)) throw new Error(`Unsupported operation '${op?.operationType}'.`);
    for (const [field, value] of Object.entries(op)) {
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
      case 'create_family_instance':
        if (op.symbolId === undefined) { requireField(op,'family'); requireField(op,'type'); }
        point(op.point || op);
        if(op.placementMode!==undefined&&(op.placementMode!=='legacyPoint'||op.hostElementId!==undefined))throw new Error('legacyPoint cannot be combined with a host and is the only supported explicit placementMode.');
        break;
      case 'create_level': number(op,'elevationMm'); requireField(op,'name'); break;
      case 'create_grid': case 'create_wall': case 'create_pipe': case 'create_duct':
        point(op.start); point(op.end);
        if (op.operationType === 'create_wall') { requireField(op,'wallTypeId'); number(op,'heightMm',true); }
        if (op.operationType === 'create_pipe') { requireField(op,'pipeTypeId'); requireField(op,'systemTypeId'); number(op,'diameterMm',true); }
        if (op.operationType === 'create_duct') { requireField(op,'ductTypeId'); requireField(op,'systemTypeId'); }
        break;
      case 'create_floor':
        if (!Array.isArray(op.boundary) || op.boundary.length < 3) throw new Error('Floor needs at least three boundary points.');
        requireField(op,'floorTypeId'); op.boundary.forEach(point); break;
      case 'create_room': point(op); break;
      case 'duplicate_type': requireField(op,'sourceTypeId'); requireField(op,'name'); break;
      case 'delete_element': requireField(op,'elementId'); break;
      case 'set_parameter': requireField(op,'elementId'); requireField(op,'parameter'); requireField(op,'value'); break;
      case 'create_circuit':
        if (!Array.isArray(op.elementIds) || !op.elementIds.length) throw new Error('A circuit needs elementIds.');
        requireField(op,'panelId'); break;
      case 'create_wire': ['firstElementId','secondElementId','viewId','wireTypeId'].forEach(f => requireField(op,f)); break;
      case 'create_view_plan': requireField(op,'viewFamilyTypeId'); break;
      case 'create_sheet': ['number','name'].forEach(f => requireField(op,f)); break;
      case 'create_schedule': ['category','fields'].forEach(f => requireField(op,f)); break;
      case 'create_panel_schedule': requireField(op,'panelId'); break;
      case 'configure_view': {
        ['viewId','referenceViewId'].forEach(f=>requireField(op,f));
        const allowed=['viewRange','crop','discipline','lightingCategories','displayStyle','detailLevel','partsVisibility'];
        if(!Array.isArray(op.settings)||!op.settings.length||op.settings.some(s=>!allowed.includes(s))||new Set(op.settings).size!==op.settings.length)throw new Error('Provide explicit known unique view settings.');
        if(op.discipline!==undefined&&(!op.settings.includes('discipline')||!['Architectural','Structural','Mechanical','Electrical','Plumbing','Coordination'].includes(op.discipline)))throw new Error('Unknown or unrequested discipline.');
        if((op.viewportId!==undefined)!==(op.paperPoint!==undefined))throw new Error('Viewport recentering requires viewportId and paperPoint together.');
        if(op.paperPoint){point(op.paperPoint);if(op.paperPoint.zMm!==undefined&&op.paperPoint.zMm!==0)throw new Error('Paper points require zero Z.');}
        validateCropBounds(op);
        if(op.parameters!==undefined)throw new Error('Configure view does not accept ignored parameter maps.');
        break;
      }
      case 'create_tag': requireField(op,'elementId'); requireField(op,'viewId'); point(op); break;
      case 'create_dimension': requireField(op,'viewId'); requireField(op,'references'); point(op.start); point(op.end); break;
      case 'place_viewport': ['sheetId','viewId'].forEach(f => requireField(op,f)); point(op); break;
      case 'create_fitting': case 'connect_elements': ['firstElementId','secondElementId'].forEach(f => requireField(op,f)); validateConnectorSelection(op,'first'); validateConnectorSelection(op,'second'); break;
    }
  }
  validatePortReservations(operations);
  return operations;
}

export function workflowOperations(name, input = {}) {
  const ops = [];
  const add = (rows, type, prefix) => (rows || []).forEach((row,index) => ops.push({ ...row, operationType: type, id: row.id || `${prefix}${index + 1}` }));
  const placements = (rows,prefix,category) => add((rows || []).map(r => ({...r})), 'create_family_instance',prefix);
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
  } else if (name === 'architecture.build') {
    add(input.levels,'create_level','level'); add(input.grids,'create_grid','grid');
    add(input.walls,'create_wall','wall'); add(input.floors,'create_floor','floor');
    placements(input.doors,'door','OST_Doors'); placements(input.windows,'window','OST_Windows');
    add(input.rooms,'create_room','room'); add(input.views,'create_view_plan','view');
    add(input.schedules,'create_schedule','schedule'); add(input.sheets,'create_sheet','sheet'); add(input.viewports,'place_viewport','viewport');
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

