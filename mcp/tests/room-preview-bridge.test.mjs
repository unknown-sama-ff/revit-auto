import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const args={documentIdentity:'native-session',roomId:10,symbolId:123,rows:2,columns:2,heightAboveLevelMm:3000,marginMm:500,markPrefix:'AI-ROOM'};
const room={documentIdentity:'native-session',documentRevision:5,id:10,number:'103',name:'办公室1',areaM2:24,layoutEligible:true,levelId:311,levelElevationMm:0,boundaryLoops:[[{xMm:0,yMm:0},{xMm:6000,yMm:0},{xMm:6000,yMm:4000},{xMm:0,yMm:4000}]]};
async function fixture(t,{placement='OneLevelBased',categoryId=-2001120,roomIdentity='native-session',planRevision=5,switchCategoryId=-2008087}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'room-preview-contract-'));const calls=[];const sockets=new Set();
 const token='fixture-token-'.repeat(5);const reply=(socket,result)=>socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result})+'\n');
 const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let text='';socket.on('data',bytes=>{text+=bytes.toString();const newline=text.indexOf('\n');if(newline<0)return;const request=JSON.parse(text.slice(0,newline));assert.equal(request.token,token);calls.push(request);
 if(request.method==='revit.bridge.info')return reply(socket,{protocol:'revit-auto-2027-v2',confirmationMode:'chat',features:['room-boundaries','legacy-point-placement','panel-schedule-naming','view-configuration']});
 if(request.method==='revit.room.get')return reply(socket,{...room,documentIdentity:roomIdentity});
 if(request.method==='revit.inspect')return reply(socket,{items:request.params.elementIds.map(id=>({summary:{id,className:'FamilySymbol',categoryId:id===123?categoryId:switchCategoryId,placement:id===123?placement:'WorkPlaneBased'}}))});
 if(request.method==='revit.plan.create')return reply(socket,{planId:'preview-only',documentIdentity:'native-session',documentRevision:planRevision,status:'pending',operations:request.params.operations});
 if(request.method==='revit.plan.cancel')return reply(socket,{status:'cancelled'});
 throw new Error('Unexpected method '+request.method);
 });});
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const config=path.join(directory,'bridge.json');await fs.writeFile(config,JSON.stringify({token,port:bridge.address().port}));
 const c=new Client({name:'room-preview-contract',version:'1.0'});t.after(async()=>{await c.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>bridge.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 await c.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'}));
 return {calls,call:(extra={})=>c.callTool({name:'revit_room_lighting_preview',arguments:{...args,...extra}})};
}
test('room-language parameters traverse the real SDK bridge into native plan preview, never commit (mock native host)',async t=>{
 const f=await fixture(t);const result=await f.call();assert.ok(!result.isError);const payload=JSON.parse(result.content[0].text);assert.equal(payload.plan.operations.length,4);assert.equal(payload.layout.fixtureCount,4);
 const create=f.calls.find(request=>request.method==='revit.plan.create');assert.equal(create.params.expectedRevision,5);assert.equal(create.params.documentIdentity,'native-session');
 assert.equal(f.calls.filter(request=>request.method==='revit.plan.confirm'||request.method==='revit.import.commit').length,0);
});
test('hosted family refuses automatic unhosted grid without generating a plan',async t=>{const f=await fixture(t,{placement:'CurveBased'});const result=await f.call();assert.equal(result.isError,true);assert.match(result.content[0].text,/level-based|legacyPoint/);assert.equal(f.calls.filter(request=>request.method==='revit.plan.create').length,0);});
test('inspected WorkPlaneBased legacy fixture preserves the old point-only preview path',async t=>{
 const f=await fixture(t,{placement:'WorkPlaneBased'});const result=await f.call();
 assert.ok(!result.isError,result.content[0].text);const payload=JSON.parse(result.content[0].text);
 assert.equal(payload.plan.operations[0].placementMode,'legacyPoint');assert.equal(f.calls.filter(x=>x.method==='revit.plan.create').length,1);
});test('wrong family category never generates a lighting plan',async t=>{const f=await fixture(t,{categoryId:-2000014});const result=await f.call();assert.equal(result.isError,true);assert.equal(f.calls.filter(request=>request.method==='revit.plan.create').length,0);});
test('switching project between context and room response is detected before planning',async t=>{const f=await fixture(t,{roomIdentity:'other-session'});const result=await f.call();assert.equal(result.isError,true);assert.match(result.content[0].text,/project changed/);assert.equal(f.calls.filter(request=>request.method==='revit.plan.create').length,0);});
test('changed revision during preview cancels the pending plan instead of submitting it',async t=>{const f=await fixture(t,{planRevision:6});const result=await f.call();assert.equal(result.isError,true);assert.equal(f.calls.filter(request=>request.method==='revit.plan.cancel').length,1);assert.equal(f.calls.filter(request=>request.method==='revit.plan.confirm').length,0);});

test('natural-language lighting scene options survive SDK schema and preview assembly (mock native host)',async t=>{
 const f=await fixture(t);const result=await f.call({circuit:{panelId:400,name:'办公室新增回路'},wiring:{wireTypeId:500},newView:{viewFamilyTypeId:600,name:'AI照明视图'},schedule:{name:'AI灯具表',fields:['标记']}});
 assert.ok(!result.isError);const payload=JSON.parse(result.content[0].text);assert.equal(payload.expected.circuits,1);assert.equal(payload.expected.wires,3);assert.equal(payload.expected.views,1);assert.equal(payload.expected.schedules,1);
 const packet=f.calls.find(x=>x.method==='revit.plan.create');assert.equal(packet.params.operations.length,10);assert.equal(packet.params.expectedRevision,5);assert.equal(f.calls.filter(x=>x.method==='revit.plan.confirm').length,0);
});


test('switches, panel schedule and sheets survive real SDK schema and are preview-only (mock native host)',async t=>{
 const f=await fixture(t);const sheet={number:'AI-E101',name:'AI照明图',titleBlockId:900,point:{xMm:420,yMm:297,zMm:0}};
 const result=await f.call({switches:[{symbolId:700,hostElementId:800,hostSide:'interior',point:{xMm:1000,yMm:4000,zMm:1400},mark:'AI-SW',switchId:'K7',wireToLightIndex:1}],circuit:{panelId:400,name:'办公室照明'},wiring:{wireTypeId:500},newView:{viewFamilyTypeId:600,name:'AI照明视图'},sheet,panelSchedule:{name:'AI配电盘明细表',sheet:{...sheet,number:'AI-E102'}}});
 assert.ok(!result.isError,result.content[0].text);const payload=JSON.parse(result.content[0].text);assert.equal(payload.expected.lightingDevices,1);assert.equal(payload.expected.sheets,2);assert.equal(payload.expected.wires,4);assert.equal(payload.expected.panelSchedules,1);
 assert.deepEqual(f.calls.find(x=>x.method==='revit.inspect').params.elementIds,[123,700]);
 assert.deepEqual(payload.plan.operations.find(x=>x.operationType==='create_circuit').switchIds,['@room10_switch1']);assert.equal(f.calls.filter(x=>x.method==='revit.plan.confirm').length,0);
});
test('a wrong-category switch type is rejected before native plan creation',async t=>{
 const f=await fixture(t,{switchCategoryId:-2001120});const result=await f.call({switches:[{symbolId:700,hostElementId:800,hostSide:'interior',point:{xMm:1000,yMm:4000,zMm:1400},mark:'AI-SW'}]});
 assert.equal(result.isError,true);assert.match(result.content[0].text,/LightingDevices/);assert.equal(f.calls.filter(x=>x.method==='revit.plan.create').length,0);
});




test('reference view id and explicit electrical discipline survive the SDK into native configuration preview',async t=>{
 const f=await fixture(t);const result=await f.call({newView:{viewFamilyTypeId:600,name:'AI照明参考视图',referenceViewId:601,discipline:'Electrical'}});
 assert.ok(!result.isError,result.content[0].text);const data=JSON.parse(result.content[0].text),op=data.plan.operations.find(row=>row.operationType==='configure_view');
 assert.equal(op.referenceViewId,601);assert.equal(op.viewId,'@room10_lighting_view');assert.equal(op.discipline,'Electrical');assert.equal(op.settings.length,7);assert.equal(f.calls.filter(row=>row.method==='revit.plan.confirm').length,0);
});
