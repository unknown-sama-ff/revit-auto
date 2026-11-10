import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {sheetLayoutSchema,diagnoseSheetLayout} from '../sheet-layout.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const input={documentIdentity:'doc-a',expectedRevision:3,sheetId:20};
const known=(min,max)=>({status:'known',min,max,error:null});
const unknown=(error='bbox-unavailable')=>({status:'unknown',min:null,max:null,error});
const context={active:true,document:{identity:'doc-a',revision:3,path:'model.rvt',isModified:false,isReadOnly:false}};
const native={documentIdentity:'doc-a',documentRevision:3,sheetId:20,outline:{min:{xMm:0,yMm:0},max:{xMm:841,yMm:594}},titleBlocks:[{id:1,ownerViewId:20,geometry:known({xMm:0,yMm:0},{xMm:841,yMm:594})}],viewports:[{id:101,ownerViewId:20,viewId:30,content:known({xMm:100,yMm:100},{xMm:300,yMm:250}),label:known({xMm:100,yMm:250},{xMm:300,yMm:270})}],schedulePlacements:[{id:201,className:'ScheduleSheetInstance',ownerViewId:20,viewId:301,geometry:known({xMm:300,yMm:250},{xMm:500,yMm:400})},{id:202,className:'PanelScheduleSheetInstance',ownerViewId:20,viewId:302,geometry:unknown()}],annotationPlacements:[{id:401,className:'TextNote',kind:'text-note',ownerViewId:20,geometry:known({xMm:520,yMm:100},{xMm:620,yMm:120})},{id:402,className:'IndependentTag',kind:'independent-tag',ownerViewId:20,geometry:unknown('tag-bbox-unavailable')}],modelWritesRequested:false,automaticSave:false,allModelSideEffectsVerified:false};

test('sheet layout schema is strict and requires explicit identity, revision and sheet',()=>{
  assert.deepEqual(sheetLayoutSchema.parse(input),input);
  for(const value of [{...input,sheetNumber:'E101'},{...input,sheetId:0},{...input,expectedRevision:-1},{...input,documentIdentity:' '},{...input,extra:true}]) assert.equal(sheetLayoutSchema.safeParse(value).success,false);
});

test('diagnostic reports positive-area candidates, out-of-sheet items, and unknown geometry',async()=>{
  const calls=[]; const result=await diagnoseSheetLayout(input,async(method,args)=>{calls.push({method,args});return method==='revit.context.get'?structuredClone(context):structuredClone(native);});
  assert.deepEqual(calls.map(call=>call.method),['revit.context.get','revit.sheet.layout','revit.context.get']);
  assert.equal(result.complete,false); assert.deepEqual(result.unknownGeometry,[{id:202,kind:'panel-schedule',error:'bbox-unavailable'},{id:402,kind:'independent-tag',error:'tag-bbox-unavailable'}]);
  assert.deepEqual(result.outOfSheet,[]); assert.equal(result.intersectionCandidates.some(row=>row.firstId===101&&row.secondId===201&&row.areaMm2===0),false);
  assert.equal(result.intersectionCandidates.some(row=>row.firstId===1||row.secondId===1),false);
  assert.equal(result.modelWritesRequested,false); assert.equal(result.automaticSave,false);
});

test('edge touching is not an intersection and out-of-sheet sides are explicit',async()=>{
  const fixture=structuredClone(native);fixture.titleBlocks=[];fixture.schedulePlacements=[{id:201,className:'ScheduleSheetInstance',ownerViewId:20,viewId:301,geometry:known({xMm:841,yMm:0},{xMm:900,yMm:10})}];
  const result=await diagnoseSheetLayout(input,async(method)=>method==='revit.context.get'?structuredClone(context):fixture);
  assert.deepEqual(result.intersectionCandidates,[]); assert.deepEqual(result.outOfSheet,[{id:201,kind:'schedule',sides:['right']}]);
});

test('overlapping viewport labels and schedules are positive-area candidates',async()=>{
  const fixture=structuredClone(native);fixture.schedulePlacements[0].geometry=known({xMm:250,yMm:260},{xMm:500,yMm:400});
  const result=await diagnoseSheetLayout(input,async(method)=>method==='revit.context.get'?structuredClone(context):fixture);
  assert.ok(result.intersectionCandidates.some(row=>row.firstId===101&&row.firstKind==='viewport-label'&&row.secondId===201&&row.secondKind==='schedule'&&row.areaMm2===500));
});

test('intersection candidates are bounded and truncation prevents complete status',async()=>{
  const fixture=structuredClone(native);fixture.titleBlocks=[];fixture.schedulePlacements=[];
  fixture.viewports=Array.from({length:80},(_,index)=>({id:1000+index,ownerViewId:20,viewId:3000+index,content:known({xMm:10,yMm:10},{xMm:20,yMm:20}),label:known({xMm:10,yMm:10},{xMm:20,yMm:20})}));
  const result=await diagnoseSheetLayout(input,async method=>method==='revit.context.get'?context:fixture);
  assert.equal(result.intersectionCandidateCount,12720);assert.equal(result.intersectionCandidates.length,5000);assert.equal(result.intersectionCandidatesTruncated,true);assert.equal(result.complete,false);
});

test('context and native scope races are rejected without retry',async()=>{
  await assert.rejects(diagnoseSheetLayout(input,async method=>method==='revit.context.get'?{...context,document:{...context.document,revision:4}}:native),error=>error.code==='document_revision_changed');
  await assert.rejects(diagnoseSheetLayout(input,async method=>method==='revit.context.get'?context:{...native,sheetId:21}),error=>error.code==='sheet_layout_scope_mismatch');
});

test('malformed native collections, duplicate IDs and wrong owners fail closed',async()=>{
  for(const response of [{...native,viewports:null},{...native,titleBlocks:[...native.titleBlocks,...native.titleBlocks]},{...native,viewports:[{...native.viewports[0],ownerViewId:99}]}])
    await assert.rejects(diagnoseSheetLayout(input,async method=>method==='revit.context.get'?context:response));
});

test('the same native placement cannot appear across title blocks, viewports or schedules',async()=>{
  const fixture=structuredClone(native);
  fixture.titleBlocks=[];
  fixture.viewports=[{...fixture.viewports[0],id:201}];
  await assert.rejects(diagnoseSheetLayout(input,async method=>method==='revit.context.get'?context:fixture),error=>error.code==='sheet_layout_scope_unknown');
});

test('empty native placement collections remain valid and produce a complete clean report',async()=>{
  const fixture={...structuredClone(native),titleBlocks:[],viewports:[],schedulePlacements:[],annotationPlacements:[]};
  const result=await diagnoseSheetLayout(input,async method=>method==='revit.context.get'?context:fixture);
  assert.equal(result.complete,true);
  assert.deepEqual(result.unknownGeometry,[]);
  assert.deepEqual(result.outOfSheet,[]);
  assert.deepEqual(result.intersectionCandidates,[]);
  assert.equal(result.intersectionCandidateCount,0);
});

test('text notes and independent tags participate in overlap and out-of-sheet diagnostics',async()=>{
  const fixture=structuredClone(native);
  fixture.annotationPlacements[0].geometry=known({xMm:250,yMm:260},{xMm:500,yMm:400});
  fixture.annotationPlacements[1].geometry=known({xMm:-1,yMm:10},{xMm:2,yMm:12});
  const result=await diagnoseSheetLayout(input,async method=>method==='revit.context.get'?context:fixture);
  assert.ok(result.intersectionCandidates.some(row=>row.firstId===201&&row.firstKind==='schedule'&&row.secondId===401&&row.secondKind==='text-note'));
  assert.deepEqual(result.outOfSheet,[{id:402,kind:'independent-tag',sides:['left']}]);
});

test('annotation collection rejects unsupported classes, invalid kinds and owner drift',async()=>{
  for(const mutate of [
    row=>{row.className='Dimension';row.kind='text-note';},
    row=>{row.kind='annotation';},
    row=>{row.ownerViewId=99;}
  ]){
    const fixture=structuredClone(native);mutate(fixture.annotationPlacements[0]);
    await assert.rejects(diagnoseSheetLayout(input,async method=>method==='revit.context.get'?context:fixture),error=>['sheet_layout_scope_mismatch','sheet_layout_scope_unknown'].includes(error.code));
  }
});

test('path and saved-state changes discard otherwise valid geometry',async()=>{
  let contextCalls=0;
  await assert.rejects(diagnoseSheetLayout(input,async method=>{
    if(method==='revit.sheet.layout')return native;
    contextCalls++;return contextCalls===1?context:{...context,document:{...context.document,path:'saved-as.rvt',isModified:true}};
  }),error=>error.code==='sheet_layout_state_changed');
});

async function fixture(t,{features=['sheet-layout-diagnostics'],result=native,error}={}){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'revit-sheet-layout-test-')); const token='sheet-layout-test-token-'.repeat(4); const requests=[]; const sockets=new Set();
  const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(!buffer.includes('\n'))return;const request=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));requests.push({method:request.method,params:request.params});const response=request.method==='revit.bridge.info'?{ok:true,result:{protocol:'revit-auto-2027-v2',version:'0.4.0',features,confirmationMode:'chat'}}:request.method==='revit.context.get'?{ok:true,result:context}:error?{ok:false,error}:{ok:true,result};socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',...response})+'\n');});});
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>bridge.close(resolve));await fs.rm(folder,{recursive:true,force:true});}); await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
  const config=path.join(folder,'bridge.json');await fs.writeFile(config,JSON.stringify({port:bridge.address().port,token})); const client=new Client({name:'sheet-layout-contract-test',version:'1.0'}); t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],env:{REVIT_AI_CONFIG:config},stderr:'pipe'})); return {client,requests};
}

test('MCP tool is discoverable, read-only, strict, and forwards only native read',async t=>{
  const {client,requests}=await fixture(t); const tools=await client.listTools(); const tool=tools.tools.find(item=>item.name==='revit_sheet_layout');
  assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.inputSchema.additionalProperties,false);
  const response=await client.callTool({name:'revit_sheet_layout',arguments:input}); assert.equal(response.isError,undefined); const payload=JSON.parse(response.content[0].text); assert.equal(payload.status,'read_only_result'); assert.deepEqual(payload.documentIdentity,input.documentIdentity); assert.equal(payload.sheetId,input.sheetId); assert.equal(payload.modelWritesRequested,false); assert.deepEqual(requests.map(row=>row.method),['revit.bridge.info','revit.context.get','revit.bridge.info','revit.sheet.layout','revit.bridge.info','revit.context.get']);
});

test('MCP refuses old plugin before native sheet query',async t=>{const {client,requests}=await fixture(t,{features:[]});const response=await client.callTool({name:'revit_sheet_layout',arguments:input});assert.equal(response.isError,true);assert.equal(JSON.parse(response.content[0].text).code,'feature_not_loaded');assert.deepEqual(requests.map(row=>row.method),['revit.bridge.info','revit.context.get','revit.bridge.info']);});

test('native sheet diagnostics use frozen bounded evidence and contain no write path',async()=>{
  const source=await fs.readFile(path.join(root,'v27/SheetLayoutService.cs'),'utf8');
  assert.match(source,/get_BoundingBox\(sheet\)/);assert.match(source,/OwnerViewId == sheet\.Id/);assert.match(source,/NativeReadSnapshot\.Freeze/);assert.match(source,/sheet_layout_response_too_large/);assert.match(source,/foreach \(var z in new\[\] \{ box\.Min\.Z, box\.Max\.Z \}\)/);
  assert.match(source,/OfClass\(typeof\(TextNote\)\)/);assert.match(source,/OfClass\(typeof\(IndependentTag\)\)/);assert.match(source,/annotationPlacements/);
  assert.doesNotMatch(source,/new Transaction|\.Save\(|\.SaveAs\(|\.Delete\(|\.Regenerate\(/);
});
