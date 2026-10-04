import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildLightingScene} from '../lighting-scene.mjs';
import {verifyLightingPlan} from '../lighting-verification.mjs';
function fixture(){
 const room={id:10,levelId:311,levelElevationMm:0,name:'Office',areaM2:24,layoutEligible:true,boundaryLoops:[[{xMm:0,yMm:0},{xMm:6000,yMm:0},{xMm:6000,yMm:4000},{xMm:0,yMm:4000}]]};
 const sheet={titleBlockId:900,number:'AI-E101',name:'照明平面图',point:{xMm:420,yMm:297,zMm:0}};
 const proposal=buildLightingScene(room,{symbolId:123,rows:1,columns:2,heightAboveLevelMm:3000,marginMm:500,markPrefix:'AI',placementMode:'legacyPoint',switches:[{symbolId:700,hostElementId:800,hostSide:'interior',point:{xMm:1000,yMm:4000,zMm:1400},mark:'AI-SW',switchId:'K7',wireToLightIndex:1}],circuit:{panelId:400,name:'Office lighting'},wiring:{wireTypeId:500,panelConnectorId:0},newView:{viewFamilyTypeId:600,name:'AI照明视图',scale:100},schedule:{name:'AI灯具表',fields:['标记']},sheet,panelSchedule:{name:'AI配电盘表',sheet:{...sheet,number:'AI-E102',name:'AI配电盘图纸'}}});
 const references=Object.fromEntries(proposal.operations.map((op,index)=>[op.id,1000+index]));
 const native=value=>typeof value==='string'?references[value.slice(1)]:value;
 const circuitId=references.room10_lighting_circuit;
 const items=proposal.operations.map(op=>{
  const item={summary:{id:references[op.id],name:op.name},parameters:[],connectors:[]};const summary=item.summary;
  switch(op.operationType){
   case 'create_family_instance':summary.className='FamilyInstance';summary.typeId=native(op.symbolId);summary.categoryId=op.category==='OST_LightingDevices'?-2008087:-2001120;summary.mark=op.mark;summary.location=op.point??{xMm:op.xMm,yMm:op.yMm,zMm:op.zMm};summary.hostId=op.hostElementId??null;summary.levelId=-1;item.electrical={systemIds:[circuitId]};if(op.parameters)item.parameters=[{id:-1140110,name:'任意语言名称',value:'K7'}];break;
   case 'create_circuit':summary.className='ElectricalSystem';item.electrical={memberIds:[...op.elementIds,...op.switchIds].map(native),panelId:400,loadName:op.name};break;
   case 'create_wire':summary.className='Wire';summary.typeId=500;summary.ownerViewId=native(op.viewId);item.electrical={verticesComplete:true,vertexCount:2,vertices:[]};item.connectors=[{connectorId:0,peerReferencesSupported:true,peers:[{elementId:native(op.firstElementId),connectorId:op.firstConnectorId??0}]},{connectorId:1,peerReferencesSupported:true,peers:[{elementId:native(op.secondElementId),connectorId:op.secondConnectorId??0}]}];break;
   case 'create_view_plan':summary.className='ViewPlan';summary.typeId=600;summary.levelId=311;summary.isViewTemplate=false;summary.viewScale=100;break;
   case 'create_schedule':summary.className='ViewSchedule';item.drawing={scheduleCategoryId:-2001120,fieldNames:['标记'],fieldParameterIds:[-1001203]};break;
   case 'create_panel_schedule':summary.className='PanelScheduleView';item.drawing={panelId:400};break;
   case 'create_sheet':summary.className='ViewSheet';summary.sheetNumber=op.number;item.drawing={titleBlockTypeIds:[900]};break;
   case 'place_viewport':summary.className='Viewport';item.drawing={sheetId:native(op.sheetId),viewId:native(op.viewId),position:{xMm:op.xMm,yMm:op.yMm,zMm:op.zMm}};break;
  }return item;
 });
 const baseline={OST_LightingFixtures:44,OST_LightingDevices:7,OST_ElectricalEquipment:1,OST_ElectricalCircuit:3,OST_Wire:51,OST_Sheets:2,OST_Walls:9};
 const context={active:true,document:{identity:'test-session'},counts:{...baseline,OST_LightingFixtures:46,OST_LightingDevices:8,OST_ElectricalCircuit:4,OST_Wire:54,OST_Sheets:4}};
 const plan={planId:'scene',status:'committed',documentIdentity:'test-session',operations:proposal.operations,receipt:{status:'committed',saved:false,completedOperationCount:proposal.operations.length,references,createdElementIds:Object.values(references)}};
 return {plan,context,items,baseline,find:kind=>items.find(item=>item.summary.id===references[proposal.operations.find(op=>op.operationType===kind).id])};
}
const verify=f=>verifyLightingPlan(f.plan,f.context,f.items,f.baseline);
test('lighting verifier checks a complete native-evidence scene including switch, circuit, wires, schedules and sheets (synthetic data)',()=>{const f=fixture();const result=verify(f);assert.equal(result.status,'PASS');assert.equal(result.checks.length,f.plan.operations.length);assert.equal(result.categoryDeltas.OST_Wire,3);});
test('pending and failed previews cannot pass scene acceptance',()=>{for(const status of ['pending','failed']){const f=fixture();f.plan.status=status;assert.throws(()=>verify(f),/not evidence/);}});
test('same element counts with a wrong fixture height or type are rejected',()=>{for(const field of ['height','type']){const f=fixture();const fixtureItem=f.find('create_family_instance');if(field==='height')fixtureItem.summary.location.zMm=3500;else fixtureItem.summary.typeId=999;assert.throws(()=>verify(f),/XYZ|family type/);}});
test('circuit panel, load name and exact switch membership require native proof',()=>{for(const field of ['panel','name','switch']){const f=fixture();const c=f.find('create_circuit');if(field==='panel')c.electrical.panelId=999;if(field==='name')c.electrical.loadName='Other';if(field==='switch')c.electrical.memberIds.pop();assert.throws(()=>verify(f),/panel|membership|name/);}});
test('load-side electrical system association must agree with circuit membership',()=>{const f=fixture();f.find('create_family_instance').electrical.systemIds=[];assert.throws(()=>verify(f),/load side/);});
test('a visually present wire with wrong or unsupported endpoint references does not pass',()=>{for(const field of ['unknown','wrongPort','wrongOwner']){const f=fixture();const w=f.find('create_wire');if(field==='unknown')w.connectors[0].peerReferencesSupported=false;if(field==='wrongPort')w.connectors[0].peers[0].connectorId=99;if(field==='wrongOwner')w.connectors[0].peers[0].elementId=999;const op=f.plan.operations.find(x=>x.id===Object.keys(f.plan.receipt.references).find(key=>f.plan.receipt.references[key]===w.summary.id));if(field==='wrongPort')op.firstConnectorId=0;assert.throws(()=>verify(f),/endpoint/);}});
test('schedule fields/category and title block are verified rather than inferred from names',()=>{for(const field of ['category','fields','titleblock']){const f=fixture();if(field==='category')f.find('create_schedule').drawing.scheduleCategoryId=0;else if(field==='fields')f.find('create_schedule').drawing.fieldNames=[];else f.find('create_sheet').drawing.titleBlockTypeIds=[];assert.throws(()=>verify(f),/Schedule category|schedule field|title block/);}});
test('sheet relationship and paper placement must both match',()=>{for(const field of ['view','point']){const f=fixture();const p=f.find('place_viewport');if(field==='view')p.drawing.viewId=999;else p.drawing.position.xMm+=50;assert.throws(()=>verify(f),/placement/);}});
test('unexpected model additions, wrong session and missing created receipt ids are rejected',()=>{for(const field of ['counts','session','receipt']){const f=fixture();if(field==='counts')f.context.counts.OST_Walls++;else if(field==='session')f.context.document.identity='other';else f.plan.receipt.createdElementIds.pop();assert.throws(()=>verify(f),/count change|document session|Receipt-created/);}});
test('unknown acceptance evidence cannot silently become a success claim',()=>{const f=fixture();delete f.find('create_wire').electrical.verticesComplete;assert.throws(()=>verify(f),/incomplete/);});
test('lighting acceptance runner never automatically confirms or commits a plan',async()=>{const source=await fs.readFile(new URL('../lighting-acceptance.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/call\(['"](?:revit_plan_confirm|revit_import_commit)['"]/);assert.match(source,/status:'PREVIEW_ONLY'/);assert.match(source,/verifyLightingPlan/);});

test('actual Revit viewport evidence with matching paper XY and nonzero returned Z passes without changing the model',async t=>{
 const root=new URL('../../acceptance/',import.meta.url);let evidence,record;
 try{evidence=JSON.parse(await fs.readFile(new URL('lighting-scene-v036-20261003-pid57272.json.native-inspection.json',root),'utf8'));record=JSON.parse((await fs.readFile(new URL('lighting-scene-v036-20261003-pid57272.json',root),'utf8')).replace(/^\uFEFF/,''));}
 catch(error){if(error.code==='ENOENT'){t.skip('Local native acceptance capture is unavailable on this host.');return;}throw error;}
 const placement=evidence.inspected.items.find(item=>item.summary.id===2295745);assert.equal(placement.drawing.position.xMm,420);assert.ok(Math.abs(placement.drawing.position.yMm-280)<1e-6);assert.ok(Math.abs(placement.drawing.position.zMm-23)<1e-6);
 const result=verifyLightingPlan(evidence.plan,evidence.context,evidence.inspected.items,record.baselineCounts);assert.equal(result.status,'PASS');assert.equal(result.checks.length,15);
});

test('paper Z does not mask wrong XY placement',()=>{const f=fixture();const drawing=f.find('place_viewport').drawing;drawing.position.zMm=23;drawing.position.xMm=430;assert.throws(()=>verify(f),/placement/);});
test('model fixture height remains strict while native sheet depth is ignored',()=>{const f=fixture();f.find('place_viewport').drawing.position.zMm=23;f.find('create_family_instance').summary.location.zMm=3030;assert.throws(()=>verify(f),/XYZ/);});
test('nonzero requested paper Z and invalid native coordinate evidence cannot pass',()=>{for(const scenario of ['requestedZ','nativeInvalidZ']){const f=fixture();if(scenario==='requestedZ')f.plan.operations.find(op=>op.operationType==='place_viewport').zMm=23;else f.find('place_viewport').drawing.position.zMm=Infinity;assert.throws(()=>verify(f),/placement/);}});
