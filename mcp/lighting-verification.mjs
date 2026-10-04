import {verifyViewConfiguration} from './view-configuration.mjs';
// Checks native post-execution evidence for the room-lighting scene. It never calls Revit or submits plans.
const categories={OST_LightingFixtures:-2001120,OST_LightingDevices:-2008087,OST_ElectricalEquipment:-2001040};
function requireEvidence(condition,message){if(!condition)throw new Error(message);}
function id(value,references){
 const resolved=typeof value==='string'&&value.startsWith('@')&&Object.hasOwn(references,value.slice(1))?references[value.slice(1)]:value;
 requireEvidence(Number.isSafeInteger(resolved)&&resolved>0,'Missing native id/reference '+value+'.');return resolved;
}
function sameIds(actual,expected){return Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&[...actual].sort((a,b)=>a-b).every((value,index)=>value===[...expected].sort((a,b)=>a-b)[index]);}
function near(actual,expected,tolerance=1){return typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance;}
function samePoint(actual,expected,tolerance=1){return actual&&['xMm','yMm','zMm'].every(key=>near(actual[key],expected[key]??0,tolerance));}
// A sheet's paper placement is UV/XY. Keep the native returned Z in inspection evidence,
// but do not treat Viewport.GetBoxCenter's nonzero Z as a paper offset. Model XYZ stays strict.
function samePaperPoint(actual,expected,tolerance=1){
 return actual&&(expected.zMm===undefined||expected.zMm===0)&&near(actual.xMm,expected.xMm,tolerance)&&near(actual.yMm,expected.yMm,tolerance)&&
  (actual.zMm===undefined||typeof actual.zMm==='number'&&Number.isFinite(actual.zMm));
}
export function verifyLightingPlan(plan,context,inspected,baselineCounts){
 requireEvidence(plan?.status==='committed'&&plan.receipt?.status==='committed','A pending or failed preview is not evidence of successful modeling.');
 requireEvidence(context.active&&context.document.identity===plan.documentIdentity,'The current Revit document session does not match the committed plan.');
 requireEvidence(plan.receipt.saved===false,'The receipt does not prove that no automatic model save was requested.');
 requireEvidence(plan.receipt.completedOperationCount===plan.operations.length,'Not every reviewed operation was completed.');
 requireEvidence(baselineCounts&&typeof baselineCounts==='object','An exact preview baseline is required; counts alone are not a scene acceptance.');
 const references=plan.receipt.references;requireEvidence(references&&typeof references==='object','The native execution receipt is missing created references.');
 const items=new Map(inspected.map(item=>[item.summary?.id,item]));const deltas={};const created=[];const checks=[];
 const bump=category=>{deltas[category]=(deltas[category]??0)+1;};
 for(const op of plan.operations){
  if(op.operationType==='configure_view'){
   const targetId=id(op.viewId,references),sourceId=id(op.referenceViewId,references);
   const viewport=op.viewportId!==undefined?items.get(id(op.viewportId,references))?.drawing:undefined;
   verifyViewConfiguration({...op,viewId:targetId,referenceViewId:sourceId},items.get(sourceId)?.drawing,items.get(targetId)?.drawing,viewport);
   checks.push({operationId:op.id??'configure-'+targetId,operationType:op.operationType,elementId:targetId,status:'PASS'});
   continue;
  }
  requireEvidence(op.id,'Scene operations need explicit ids to verify the returned native references.');
  const elementId=id('@'+op.id,references);created.push(elementId);
  const item=items.get(elementId);requireEvidence(item?.summary,'Created element '+elementId+' is missing from native inspection.');
  const summary=item.summary;const nativeId=value=>id(value,references);
  switch(op.operationType){
   case 'create_family_instance': {
    requireEvidence(summary.className==='FamilyInstance'&&summary.typeId===nativeId(op.symbolId),'Wrong family type on '+elementId+'.');
    const category=Object.entries(categories).find(([,value])=>value===summary.categoryId)?.[0];
    requireEvidence(category,'Unsupported lighting-scene family category on '+elementId+'.');
    if(op.category)requireEvidence(summary.categoryId===categories[op.category],'Family category differs from the reviewed operation.');
    bump(category);requireEvidence(summary.mark===op.mark,'Fixture/switch mark differs from the preview.');
    const point=op.point??op;
    if(op.hostElementId!==undefined){
     requireEvidence(summary.hostId===nativeId(op.hostElementId),'The requested host was not attached.');
     const tolerance=op.hostToleranceMm??500;
     requireEvidence(summary.location&&near(summary.location.zMm,point.zMm??0)&&Math.hypot(summary.location.xMm-point.xMm,summary.location.yMm-point.yMm)<=tolerance+1,'Hosted position exceeds reviewed wall projection tolerance.');
    }else{
     requireEvidence(samePoint(summary.location,point),'Fixture XYZ or installation height does not match the reviewed point.');
     if(op.placementMode==='legacyPoint')requireEvidence(summary.hostId===null||summary.hostId===undefined||summary.hostId<0,'Legacy point-only placement unexpectedly attached a host.');
     else requireEvidence(summary.levelId===nativeId(op.levelId),'Fixture level association differs from the plan.');
    }
    if(op.parameters?.['BIP:RBS_ELEC_SWITCH_ID_PARAM']!==undefined)requireEvidence(item.parameters?.some(p=>p.id===-1140110&&p.value===op.parameters['BIP:RBS_ELEC_SWITCH_ID_PARAM']),'The switch label was not observed in native parameters.');
    break;
   }
   case 'create_circuit': {
    bump('OST_ElectricalCircuit');requireEvidence(summary.className==='ElectricalSystem','A circuit operation did not create an ElectricalSystem.');
    const expected=[...op.elementIds,...(op.switchIds??[])].map(nativeId);
    requireEvidence(sameIds(item.electrical?.memberIds,expected),'Circuit load/switch membership differs from the reviewed plan.');
    requireEvidence(item.electrical?.panelId===nativeId(op.panelId),'The circuit is not attached to the reviewed panel.');
    if(op.name)requireEvidence(item.electrical.loadName===op.name,'Circuit load name differs from the reviewed plan.');
    for(const memberId of expected)requireEvidence(items.get(memberId)?.electrical?.systemIds?.includes(elementId),'Circuit membership was not confirmed from the load side.');
    break;
   }
   case 'create_wire': {
    bump('OST_Wire');requireEvidence(summary.className==='Wire'&&summary.typeId===nativeId(op.wireTypeId)&&summary.ownerViewId===nativeId(op.viewId),'Wire type/view differs from the reviewed plan.');
    const ends=item.connectors??[];requireEvidence(ends.length>=2&&ends.every(c=>c.peerReferencesSupported===true),'Wire endpoint references are unknown; connectivity cannot be certified.');
    const first=nativeId(op.firstElementId),second=nativeId(op.secondElementId);
    const attached=(end,owner,port)=>end.peers?.some(peer=>peer.elementId===owner&&(port===undefined||peer.connectorId===port));
    requireEvidence(ends.some(a=>attached(a,first,op.firstConnectorId)&&ends.some(b=>b.connectorId!==a.connectorId&&attached(b,second,op.secondConnectorId))),'Wire does not connect the two reviewed endpoint connectors.');
    requireEvidence(item.electrical?.verticesComplete===true&&item.electrical.vertexCount>=2,'Wire geometry evidence is incomplete.');
    for(const bend of op.bends??[])requireEvidence(item.electrical.vertices.some(p=>near(p.xMm,bend.xMm)&&near(p.yMm,bend.yMm)),'A reviewed wire bend is missing.');
    break;
   }
   case 'create_view_plan':
    requireEvidence(summary.className==='ViewPlan'&&summary.isViewTemplate===false&&summary.typeId===nativeId(op.viewFamilyTypeId)&&summary.levelId===nativeId(op.levelId),'Wrong view type/level or template status.');
    if(op.name)requireEvidence(summary.name===op.name,'View name differs from the plan.');
    if(op.scale)requireEvidence(summary.viewScale===op.scale,'View scale differs from the plan.');
    break;
   case 'create_schedule':
    requireEvidence(summary.className==='ViewSchedule'&&summary.name===op.name,'Fixture schedule was not created with the reviewed name.');
    requireEvidence(item.drawing?.scheduleCategoryId===categories[op.category]&&Array.isArray(item.drawing.fieldNames),'Schedule category/fields evidence is missing.');
    for(const field of op.fields){requireEvidence(typeof field==='string'?item.drawing.fieldNames.includes(field):item.drawing.fieldParameterIds?.includes(field),'A reviewed schedule field is missing.');}
    break;
   case 'create_panel_schedule':
    requireEvidence(summary.className==='PanelScheduleView'&&summary.name===op.name&&item.drawing?.panelId===nativeId(op.panelId),'Panel schedule name/panel relationship differs from the plan.');break;
   case 'create_sheet':
    bump('OST_Sheets');requireEvidence(summary.className==='ViewSheet'&&summary.sheetNumber===op.number&&summary.name===op.name,'Sheet name/number differs from the preview.');
    requireEvidence(item.drawing?.titleBlockTypeIds?.includes(nativeId(op.titleBlockId)),'The requested title block type is missing on the sheet.');break;
   case 'place_viewport':
    requireEvidence(item.drawing?.sheetId===nativeId(op.sheetId)&&item.drawing?.viewId===nativeId(op.viewId)&&samePaperPoint(item.drawing.position,op.point??op),'View/schedule placement on the sheet differs from the preview.');break;
   default:throw new Error('Scene verification is not implemented for '+op.operationType+'; no success claim is allowed.');
  }
  checks.push({operationId:op.id,operationType:op.operationType,elementId,status:'PASS'});
 }
 requireEvidence(sameIds(plan.receipt.createdElementIds,created),'Receipt-created elements differ from the reviewed scene operations.');
 for(const [category,count] of Object.entries(baselineCounts))requireEvidence(context.counts[category]===count+(deltas[category]??0),'Unexpected model count change in '+category+'.');
 return {status:'PASS',planId:plan.planId,checks,categoryDeltas:deltas,automaticSaveRequested:false,scope:'Native types, model XYZ/hosts, marks, circuit/panel associations, wire endpoints, schedule fields and sheet UV/XY placements. Native drawing Z is retained as evidence, not a paper offset. Not engineering/code compliance.'};
}
