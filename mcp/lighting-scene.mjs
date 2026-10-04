import {buildRoomLighting} from './room-lighting.mjs';
import {validateOperations} from './workflows.mjs';

const positiveId=(value,name)=>{if(!Number.isSafeInteger(value)||value<=0)throw new Error(name+' must be an explicit native id.');return value;};
const title=(value,name)=>{if(typeof value!=='string'||!value.trim()||value.length>200)throw new Error(name+' is required.');return value;};
const point=(value,name)=>{
 if(!value||!['xMm','yMm','zMm'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])&&Math.abs(value[key])<=1e8))throw new Error(name+' requires explicit finite xMm/yMm/zMm coordinates.');
 return {xMm:value.xMm,yMm:value.yMm,zMm:value.zMm};
};
export function buildLightingScene(room,input){
 const proposal=buildRoomLighting(room,input);
 const operations=[...proposal.operations];const references=operations.map(op=>'@'+op.id);
 const prefix='room'+room.id;const switches=[];const marks=new Set(operations.map(op=>op.mark));
 if(input.switches!==undefined&&(!Array.isArray(input.switches)||input.switches.length>50))throw new Error('switches must be an array of at most 50 explicit placements.');
 for(const [index,item] of (input.switches||[]).entries()){
  const mark=title(item.mark,'switch.mark');if(marks.has(mark))throw new Error('Duplicate proposed mark '+mark+'.');marks.add(mark);
  if(!['interior','exterior'].includes(item.hostSide))throw new Error('switch.hostSide must explicitly select interior or exterior.');
  const id=prefix+'_switch'+(index+1);
  const op={operationType:'create_family_instance',id,category:'OST_LightingDevices',symbolId:positiveId(item.symbolId,'switch.symbolId'),levelId:room.levelId,hostElementId:positiveId(item.hostElementId,'switch.hostElementId'),hostSide:item.hostSide,point:point(item.point,'switch.point'),mark};
  if(item.hostToleranceMm!==undefined){if(typeof item.hostToleranceMm!=='number'||!Number.isFinite(item.hostToleranceMm)||item.hostToleranceMm<=0)throw new Error('switch.hostToleranceMm must be positive.');op.hostToleranceMm=item.hostToleranceMm;}
  if(item.switchId!==undefined)op.parameters={'BIP:RBS_ELEC_SWITCH_ID_PARAM':title(item.switchId,'switch.switchId')};
  operations.push(op);switches.push({reference:'@'+id,wireToLightIndex:item.wireToLightIndex});
 }
 let viewId;
 if(input.newView){
  if(input.wiring?.viewId!==undefined)throw new Error('Choose either newView or an existing wiring.viewId, not both.');
  const id=prefix+'_lighting_view';
  if(input.newView.scale!==undefined&&(!Number.isSafeInteger(input.newView.scale)||input.newView.scale<=0))throw new Error('newView.scale must be a positive integer.');
  operations.push({operationType:'create_view_plan',id,viewFamilyTypeId:positiveId(input.newView.viewFamilyTypeId,'newView.viewFamilyTypeId'),levelId:room.levelId,name:title(input.newView.name,'newView.name'),scale:input.newView.scale??100});viewId='@'+id;
  if(input.newView.referenceViewId!==undefined){
   const configuration={operationType:'configure_view',viewId,referenceViewId:positiveId(input.newView.referenceViewId,'newView.referenceViewId'),settings:['viewRange','crop','discipline','lightingCategories','displayStyle','detailLevel','partsVisibility']};
   if(input.newView.discipline!==undefined)configuration.discipline=input.newView.discipline;
   operations.push(configuration);
  }else if(input.newView.discipline!==undefined)throw new Error('newView.discipline requires an explicit inspected referenceViewId; no display settings are guessed.');
 }else if(input.wiring){viewId=positiveId(input.wiring.viewId,'wiring.viewId');}
 if(input.circuit){
  const circuit={operationType:'create_circuit',id:prefix+'_lighting_circuit',elementIds:references,panelId:positiveId(input.circuit.panelId,'circuit.panelId'),name:title(input.circuit.name,'circuit.name')};
  if(switches.length)circuit.switchIds=switches.map(s=>s.reference);
  operations.push(circuit);
 }
 if(input.wiring){
  if(!input.circuit)throw new Error('Wiring requires an explicit circuit and panel association.');
  const wireTypeId=positiveId(input.wiring.wireTypeId,'wiring.wireTypeId');
  for(let index=1;index<references.length;index++)operations.push({operationType:'create_wire',id:prefix+'_wire'+index,firstElementId:references[index-1],secondElementId:references[index],wireTypeId,viewId});
  // Panel-to-light drawing is opt-in and must use a port chosen from inspect.
  if(input.wiring.panelConnectorId!==undefined){
   if(!Number.isSafeInteger(input.wiring.panelConnectorId)||input.wiring.panelConnectorId<0)throw new Error('panelConnectorId must be a nonnegative explicit connector id.');
   operations.push({operationType:'create_wire',id:prefix+'_panel_wire',firstElementId:input.circuit.panelId,firstConnectorId:input.wiring.panelConnectorId,secondElementId:references[0],wireTypeId,viewId});
  }
 }
 for(const [index,item] of switches.entries()){
  if(item.wireToLightIndex===undefined)continue;
  if(!input.wiring)throw new Error('switch.wireToLightIndex requires wiring settings.');
  if(!Number.isSafeInteger(item.wireToLightIndex)||item.wireToLightIndex<1||item.wireToLightIndex>references.length)throw new Error('switch.wireToLightIndex must select a 1-based fixture index from this preview.');
  operations.push({operationType:'create_wire',id:prefix+'_switch_wire'+(index+1),firstElementId:item.reference,secondElementId:references[item.wireToLightIndex-1],wireTypeId:input.wiring.wireTypeId,viewId});
 }
 if(input.schedule){
  if(!Array.isArray(input.schedule.fields)||input.schedule.fields.length===0)throw new Error('Schedule fields must be explicit native names or parameter ids; do not guess a missing field.');
  operations.push({operationType:'create_schedule',id:prefix+'_lighting_schedule',category:'OST_LightingFixtures',name:title(input.schedule.name,'schedule.name'),fields:input.schedule.fields});
 }
 const sheetNumbers=new Set();
 const addSheet=(settings,id,placedView)=>{
  if(!placedView)throw new Error('A sheet requires newView or an explicit existing wiring.viewId.');
  const number=title(settings.number,'sheet.number');if(sheetNumbers.has(number))throw new Error('Duplicate proposed sheet number '+number+'.');sheetNumbers.add(number);
  operations.push({operationType:'create_sheet',id,number,name:title(settings.name,'sheet.name'),titleBlockId:positiveId(settings.titleBlockId,'sheet.titleBlockId')});
  operations.push({operationType:'place_viewport',id:id+'_placement',sheetId:'@'+id,viewId:placedView,...point(settings.point,'sheet.point')});
 };
 if(input.sheet)addSheet(input.sheet,prefix+'_lighting_sheet',viewId);
 if(input.panelSchedule){
  if(!input.circuit)throw new Error('A panel schedule requires the explicit circuit.panelId.');
  const id=prefix+'_panel_schedule';
  // The native panel-schedule-naming capability sets this reviewed name during creation.
  operations.push({operationType:'create_panel_schedule',id,panelId:input.circuit.panelId,name:title(input.panelSchedule.name,'panelSchedule.name')});
  if(input.panelSchedule.sheet)addSheet(input.panelSchedule.sheet,prefix+'_panel_sheet','@'+id);
 }
 return {...proposal,operations:validateOperations(operations),expected:{lightingFixtures:references.length,lightingDevices:switches.length,circuits:input.circuit?1:0,wires:input.wiring?Math.max(0,references.length-1)+(input.wiring.panelConnectorId!==undefined?1:0)+switches.filter(s=>s.wireToLightIndex!==undefined).length:0,views:input.newView?1:0,schedules:input.schedule?1:0,panelSchedules:input.panelSchedule?1:0,sheets:sheetNumbers.size,viewports:sheetNumbers.size},notes:[...(input.newView&&!input.newView.referenceViewId?['A new view without referenceViewId uses Revit defaults and may not display lighting fixtures; inspect its range/categories and verify the image.']:[]),'Fixture wiring follows the supplied grid sequence; it is not automatic cable routing or circuit-load design.','Switches require explicit inspected host walls, face sides and absolute installation coordinates. Circuit membership does not prove an independent switch-control system.','Sheet points are explicit millimeters on paper, not model coordinates. No paper size or placement is guessed.','No panel wire is guessed; panelConnectorId must be explicitly inspected and reviewed.','Only chat approval of this exact preview permits submission.']};
}


