import test from 'node:test';import assert from 'node:assert/strict';
import {buildLightingScene} from '../lighting-scene.mjs';
const room={id:10,name:'办公室1',areaM2:24,layoutEligible:true,levelId:311,levelElevationMm:0,boundaryLoops:[[{xMm:0,yMm:0},{xMm:6000,yMm:0},{xMm:6000,yMm:4000},{xMm:0,yMm:4000}]]};
const input={symbolId:123,rows:2,columns:2,heightAboveLevelMm:3000,marginMm:500,markPrefix:'SCENE'};
test('lighting scene combines 4 fixtures, circuit, wires and view in one reference-valid plan',()=>{
 const p=buildLightingScene(room,{...input,circuit:{panelId:400,name:'AI办公室照明'},wiring:{wireTypeId:500},newView:{viewFamilyTypeId:600,name:'AI照明平面',scale:100},schedule:{name:'AI灯具表',fields:['标记']}});
 assert.deepEqual(p.expected,{lightingFixtures:4,lightingDevices:0,circuits:1,wires:3,views:1,schedules:1,panelSchedules:0,sheets:0,viewports:0});assert.equal(p.operations.length,10);assert.equal(p.operations.find(x=>x.operationType==='create_circuit').elementIds[0],'@room10_light1');
});
test('panel wire is never added without an explicit inspected connector',()=>{const p=buildLightingScene(room,{...input,circuit:{panelId:400,name:'AI照明'},wiring:{wireTypeId:500,viewId:600}});assert.equal(p.expected.wires,3);assert.ok(p.operations.filter(x=>x.operationType==='create_wire').every(w=>typeof w.firstElementId==='string'));});
test('explicit panel connector creates exactly one additional panel wire',()=>{const p=buildLightingScene(room,{...input,circuit:{panelId:400,name:'AI照明'},wiring:{wireTypeId:500,viewId:600,panelConnectorId:0}});assert.equal(p.expected.wires,4);assert.equal(p.operations.find(o=>o.firstElementId===400).firstConnectorId,0);});
test('wiring without circuit or a specified view is rejected',()=>{assert.throws(()=>buildLightingScene(room,{...input,wiring:{wireTypeId:500,viewId:600}}),/circuit/);assert.throws(()=>buildLightingScene(room,{...input,circuit:{panelId:400,name:'AI照明'},wiring:{wireTypeId:500}}),/viewId/);});
test('missing schedule fields do not silently produce an empty schedule',()=>assert.throws(()=>buildLightingScene(room,{...input,schedule:{name:'AI表',fields:[]}}),/fields/));


const explicitSwitch={symbolId:700,hostElementId:800,hostSide:'interior',point:{xMm:1000,yMm:4000,zMm:1400},mark:'SCENE-SW',switchId:'K7',wireToLightIndex:1};
const explicitSheet={number:'AI-E101',name:'AI照明平面图',titleBlockId:900,point:{xMm:420,yMm:297,zMm:0}};
test('full lighting scene retains legacy switch circuit membership and explicit control label',()=>{
 const p=buildLightingScene(room,{...input,switches:[explicitSwitch],circuit:{panelId:400,name:'AI办公室照明'},wiring:{wireTypeId:500},newView:{viewFamilyTypeId:600,name:'AI照明平面'}});
 assert.equal(p.expected.lightingDevices,1);assert.equal(p.expected.wires,4);
 const sw=p.operations.find(x=>x.category==='OST_LightingDevices');assert.equal(sw.hostElementId,800);assert.equal(sw.hostSide,'interior');assert.equal(sw.parameters['BIP:RBS_ELEC_SWITCH_ID_PARAM'],'K7');
 assert.deepEqual(p.operations.find(x=>x.operationType==='create_circuit').switchIds,['@room10_switch1']);
 const w=p.operations.find(x=>x.id==='room10_switch_wire1');assert.equal(w.firstElementId,'@room10_switch1');assert.equal(w.secondElementId,'@room10_light1');
});
test('lighting and panel schedules can be placed on distinct titled sheets in the same plan',()=>{
 const p=buildLightingScene(room,{...input,circuit:{panelId:400,name:'AI照明'},newView:{viewFamilyTypeId:600,name:'AI照明平面'},sheet:explicitSheet,panelSchedule:{name:'AI-AL1 配电盘明细表',sheet:{...explicitSheet,number:'AI-E102',name:'AI配电盘明细表'}}});
 assert.equal(p.expected.sheets,2);assert.equal(p.expected.panelSchedules,1);assert.equal(p.expected.viewports,2);
 const ps=p.operations.find(x=>x.operationType==='create_panel_schedule');assert.equal(ps.name,'AI-AL1 配电盘明细表');
 const placements=p.operations.filter(x=>x.operationType==='place_viewport');assert.deepEqual({xMm:placements[0].xMm,yMm:placements[0].yMm,zMm:placements[0].zMm},explicitSheet.point);assert.equal(placements[1].viewId,'@room10_panel_schedule');
});
test('switch placement never guesses wall, side, coordinates or target light',()=>{
 assert.throws(()=>buildLightingScene(room,{...input,switches:[{...explicitSwitch,hostElementId:undefined}]}),/hostElementId/);
 assert.throws(()=>buildLightingScene(room,{...input,switches:[{...explicitSwitch,hostSide:undefined}]}),/hostSide/);
 assert.throws(()=>buildLightingScene(room,{...input,switches:[{...explicitSwitch,point:{xMm:0,yMm:0}}]}),/coordinates/);
 assert.throws(()=>buildLightingScene(room,{...input,switches:[explicitSwitch]}),/requires wiring/);
 assert.throws(()=>buildLightingScene(room,{...input,switches:[{...explicitSwitch,wireToLightIndex:5}],circuit:{panelId:400,name:'AI照明'},wiring:{wireTypeId:500,viewId:600}}),/fixture index/);
});
test('duplicate proposed marks and sheet numbers are rejected before native preview',()=>{
 assert.throws(()=>buildLightingScene(room,{...input,switches:[{...explicitSwitch,mark:'SCENE-01',wireToLightIndex:undefined}]}),/Duplicate proposed mark/);
 assert.throws(()=>buildLightingScene(room,{...input,circuit:{panelId:400,name:'AI照明'},newView:{viewFamilyTypeId:600,name:'AI照明'},sheet:explicitSheet,panelSchedule:{name:'AI配电盘',sheet:explicitSheet}}),/Duplicate proposed sheet/);
});
test('paper placement and title block are explicit, never inferred from model coordinates',()=>{
 assert.throws(()=>buildLightingScene(room,{...input,sheet:explicitSheet}),/requires newView/);
 assert.throws(()=>buildLightingScene(room,{...input,newView:{viewFamilyTypeId:600,name:'AI照明'},sheet:{...explicitSheet,titleBlockId:undefined}}),/titleBlockId/);
 assert.throws(()=>buildLightingScene(room,{...input,newView:{viewFamilyTypeId:600,name:'AI照明'},sheet:{...explicitSheet,point:{xMm:420,yMm:297,zMm:Infinity}}}),/coordinates/);
 assert.throws(()=>buildLightingScene(room,{...input,panelSchedule:{name:'AI配电盘'}}),/circuit.panelId/);
});



test('reference-backed new lighting view emits configure before circuit/wiring and does not invent a reference',()=>{
 const p=buildLightingScene(room,{...input,circuit:{panelId:400,name:'AI照明'},wiring:{wireTypeId:500},newView:{viewFamilyTypeId:600,name:'AI照明视图',referenceViewId:601,discipline:'Electrical'}});
 const configure=p.operations.findIndex(op=>op.operationType==='configure_view');assert.ok(configure>0);assert.ok(configure<p.operations.findIndex(op=>op.operationType==='create_circuit'));assert.equal(p.operations[configure].viewId,'@room10_lighting_view');assert.equal(p.operations[configure].referenceViewId,601);assert.equal(p.operations[configure].discipline,'Electrical');assert.equal(p.expected.lightingFixtures,4);
 assert.throws(()=>buildLightingScene(room,{...input,newView:{viewFamilyTypeId:600,name:'AI照明',discipline:'Electrical'}}),/referenceViewId/);
});
