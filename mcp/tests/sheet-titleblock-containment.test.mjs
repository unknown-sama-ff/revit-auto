import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {diagnoseSheetLayout} from '../sheet-layout.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const fixtureFile=new URL('./fixtures/sheet-titleblock-al1-envelope.json',import.meta.url);
const provenanceFile=new URL('./fixtures/sheet-titleblock-al1-envelope.provenance.json',import.meta.url);
const fixtureBytes=await fs.readFile(fixtureFile);
const captured=JSON.parse(fixtureBytes);
const provenance=JSON.parse(await fs.readFile(provenanceFile,'utf8'));
const known=(x0,y0,x1,y1)=>({status:'known',min:{xMm:x0,yMm:y0},max:{xMm:x1,yMm:y1},error:null});
const unknown=error=>({status:'unknown',min:null,max:null,error});
const input={documentIdentity:'containment-test-document',expectedRevision:3,sheetId:20};
const context={active:true,document:{identity:input.documentIdentity,revision:3,path:'containment-fixture.rvt',isModified:false,isReadOnly:false}};
function nativeFixture(){return {documentIdentity:input.documentIdentity,documentRevision:3,sheetId:20,outline:{min:{xMm:-100,yMm:-100},max:{xMm:200,yMm:200}},titleBlocks:[{id:1,ownerViewId:20,geometry:known(0,0,100,100)}],viewports:[],schedulePlacements:[],annotationPlacements:[],modelWritesRequested:false,automaticSave:false,allModelSideEffectsVerified:false};}
const schedule=(id,geometry,className='ScheduleSheetInstance')=>({id,className,ownerViewId:20,viewId:id+1000,geometry});
const annotation=(id,geometry,className='TextNote')=>({id,className,kind:className==='TextNote'?'text-note':'independent-tag',ownerViewId:20,geometry});
async function replay(native,{request=input,state=context}={}){
  const methods=[];
  const report=await diagnoseSheetLayout(request,async method=>{methods.push(method);if(method==='revit.context.get')return state;if(method==='revit.sheet.layout')return native;throw Error('Unexpected native method '+method);});
  assert.deepEqual(methods,['revit.context.get','revit.sheet.layout','revit.context.get']);
  return report;
}
function assertReadonly(report){
  assert.equal(report.readOnly,true);assert.equal(report.planCreated,false);assert.equal(report.modelWritesRequested,false);assert.equal(report.automaticSave,false);assert.equal(report.allModelSideEffectsVerified,false);
  assert.equal(Object.hasOwn(report,'visualAccepted'),false);assert.equal(Object.hasOwn(report,'writeAccepted'),false);
}
function evaluated(native,{outOfBounds=[],unknownGeometry=[],complete=true}={}){
  return {schemaVersion:1,status:'evaluated',boundarySource:'single-native-titleblock-bounding-box',boundary:{titleBlockId:native.titleBlocks[0].id,min:native.titleBlocks[0].geometry.min,max:native.titleBlocks[0].geometry.max},outOfBounds,unknownGeometry,complete,reason:null};
}
function deepFreeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;}

test('captured containment fixture is portable, hash-pinned, anonymous and identifies its MCP-derived provenance',()=>{
  assert.equal(createHash('sha256').update(JSON.stringify(captured)).digest('hex'),provenance.fixtureSha256);
  assert.equal(createHash('sha256').update(JSON.stringify(JSON.parse(fixtureBytes.toString('utf8').replaceAll('\n','\r\n')))).digest('hex'),provenance.fixtureSha256);
  assert.equal(provenance.source.kind,'captured-mcp-derived-report-with-preserved-native-bounds');
  assert.equal(provenance.source.notRawBridgeResponse,true);
  assert.equal(provenance.source.scopeId,'first-target-sheet-layout');
  for(const key of ['fileSha256','scopeSha256','resultSha256'])assert.match(provenance.source[key],/^[a-f0-9]{64}$/);
  assert.equal(provenance.requiresPrivateEvidenceAtTestRuntime,false);
  assert.equal(provenance.privateEvidenceModified,false);
  assert.equal(provenance.extraction.numericRounding,'none');
  assert.doesNotMatch(fixtureBytes.toString('utf8'),/private-document-identity|Desktop|floor-side-effect-isolated|AI-E102-REUSE/);
  assert.deepEqual(captured.native.outline.min,{xMm:398.499999999924,yMm:43.27272727273289});
});

test('captured AL1 outside the A3 titleblock reports left/top although the sheet outline contains it',async()=>{
  const before=structuredClone(captured.native);
  const report=await replay(captured.native,{request:captured.input,state:captured.context});
  assert.deepEqual(report.titleBlockContainment,evaluated(captured.native,{outOfBounds:captured.expected.outOfBounds}));
  assert.equal(report.outOfSheetBoundary,'native-view-sheet-outline');
  assert.deepEqual(report.outOfSheet,captured.expected.outOfSheet);
  assert.deepEqual(report.intersectionCandidates,[]);assert.equal(report.intersectionCandidateCount,0);assert.equal(report.intersectionCandidatesTruncated,false);assert.equal(report.complete,true);assert.deepEqual(report.unknownGeometry,[]);
  for(const key of ['outline','titleBlocks','viewports','schedulePlacements','annotationPlacements'])assert.deepEqual(report[key],before[key]);
  assert.deepEqual(captured.native,before);assertReadonly(report);
});

test('all supported placement kinds are checked against the frame and the titleblock is excluded',async()=>{
  const native=nativeFixture();
  native.viewports=[{id:12,ownerViewId:20,viewId:300,content:known(-1,10,10,20),label:known(10,-1,20,0)}];
  native.schedulePlacements=[schedule(10,known(95,10,101,20)),schedule(11,known(10,95,20,101),'PanelScheduleSheetInstance')];
  native.annotationPlacements=[annotation(14,known(-1,-1,1,1),'IndependentTag'),annotation(13,known(99,99,101,101))];
  const report=await replay(native);
  assert.deepEqual(report.titleBlockContainment,evaluated(native,{outOfBounds:[
    {id:10,kind:'schedule',sides:['right']},
    {id:11,kind:'panel-schedule',sides:['top']},
    {id:12,kind:'viewport-content',sides:['left']},
    {id:12,kind:'viewport-label',sides:['bottom']},
    {id:13,kind:'text-note',sides:['right','top']},
    {id:14,kind:'independent-tag',sides:['left','bottom']}
  ]}));
  assert.deepEqual(report.outOfSheet,[]);assertReadonly(report);
});

test('a unique valid frame with no captured content is evaluated without certifying whole-sheet visual acceptance',async()=>{
  const native=nativeFixture(),report=await replay(native);
  assert.deepEqual(report.titleBlockContainment,evaluated(native));
  assert.equal(report.complete,true);assertReadonly(report);
});

test('edge touching is included and any exact overflow on each side is reported without tolerance',async()=>{
  const cases=[
    [known(0,0,100,100),[]],
    [known(100,100,100,100),[]],
    [known(-1e-10,10,1,20),['left']],
    [known(10,-1e-10,20,1),['bottom']],
    [known(99,10,100+1e-10,20),['right']],
    [known(10,99,20,100+1e-10),['top']],
    [known(-1,-1,101,101),['left','bottom','right','top']]
  ];
  for(const[geometry,sides]of cases){
    const native=nativeFixture();native.schedulePlacements=[schedule(10,geometry)];const report=await replay(native);
    assert.deepEqual(report.titleBlockContainment,evaluated(native,{outOfBounds:sides.length?[{id:10,kind:'schedule',sides}]:[]}));
  }
});

for(const scenario of [
  {name:'no titleblock',reason:'no-titleblock',frames:()=>[]},
  {name:'multiple titleblocks',reason:'multiple-titleblocks',frames:()=>[{id:1,ownerViewId:20,geometry:known(0,0,10,10)},{id:2,ownerViewId:20,geometry:known(100,100,200,200)}]},
  {name:'an unknown titleblock box',reason:'titleblock-bounds-unknown',frames:()=>[{id:1,ownerViewId:20,geometry:unknown('native-frame-box-unavailable')}]},
  {name:'a zero-width titleblock box',reason:'titleblock-bounds-degenerate',frames:()=>[{id:1,ownerViewId:20,geometry:known(10,0,10,100)}]},
  {name:'a zero-height titleblock box',reason:'titleblock-bounds-degenerate',frames:()=>[{id:1,ownerViewId:20,geometry:known(0,10,100,10)}]},
  {name:'a point titleblock box',reason:'titleblock-bounds-degenerate',frames:()=>[{id:1,ownerViewId:20,geometry:known(10,10,10,10)}]}
])test(`${scenario.name} stays unknown rather than choosing a frame, union or outline fallback`,async()=>{
  const native=nativeFixture();native.titleBlocks=scenario.frames();native.schedulePlacements=[schedule(10,known(50,50,60,60))];
  const report=await replay(native);
  assert.deepEqual(report.titleBlockContainment,{schemaVersion:1,status:'unknown',boundarySource:null,boundary:null,outOfBounds:[],unknownGeometry:[],complete:false,reason:scenario.reason});
  assert.equal(report.complete,scenario.reason!=='titleblock-bounds-unknown');assertReadonly(report);
});

test('unknown content is retained, known overflow still reports, and evaluated does not imply complete',async()=>{
  const native=nativeFixture();
  native.schedulePlacements=[schedule(13,unknown('panel-box-missing'),'PanelScheduleSheetInstance'),schedule(12,known(-10,0,10,20))];
  native.viewports=[{id:11,ownerViewId:20,viewId:301,content:unknown('viewport-box-missing'),label:known(10,10,20,20)}];
  native.annotationPlacements=[annotation(14,unknown('tag-box-missing'),'IndependentTag')];
  const report=await replay(native);
  assert.deepEqual(report.titleBlockContainment,evaluated(native,{complete:false,outOfBounds:[{id:12,kind:'schedule',sides:['left']}],unknownGeometry:[
    {id:11,kind:'viewport-content',error:'viewport-box-missing'},
    {id:13,kind:'panel-schedule',error:'panel-box-missing'},
    {id:14,kind:'independent-tag',error:'tag-box-missing'}
  ]}));
  assert.equal(report.complete,false);assert.equal(report.unknownGeometry.length,3);assertReadonly(report);
});

test('unknown frame status still retains unknown captured-content diagnostics',async()=>{
  const native=nativeFixture();native.titleBlocks=[];native.annotationPlacements=[annotation(11,unknown('note-box-missing'))];
  const report=await replay(native);
  assert.deepEqual(report.titleBlockContainment,{schemaVersion:1,status:'unknown',boundarySource:null,boundary:null,outOfBounds:[],unknownGeometry:[{id:11,kind:'text-note',error:'note-box-missing'}],complete:false,reason:'no-titleblock'});
});

test('containment results are stable under collection order and leave frozen raw geometry and projection evidence intact',async()=>{
  const native=nativeFixture();native.schedulePlacements=[schedule(19,known(-10,0,0,20)),schedule(12,known(100,100,110,110))];
  native.annotationPlacements=[annotation(15,unknown('a')),annotation(10,unknown('b'),'IndependentTag')];
  native.titleBlocks[0].geometry.projection={vertices:[{x:9,y:7},{x:2,y:1}],opaqueNativeField:'retain'};
  native.unrecognizedEvidence={projection:{vertices:[3,2,1]}};
  const original=structuredClone(native),other=structuredClone(native);other.schedulePlacements.reverse();other.annotationPlacements.reverse();
  const first=await replay(deepFreeze(native)),second=await replay(other);
  assert.deepEqual(first.titleBlockContainment,second.titleBlockContainment);
  assert.deepEqual(native,original);assert.deepEqual(first.titleBlocks,original.titleBlocks);assert.deepEqual(first.unrecognizedEvidence,original.unrecognizedEvidence);
  assert.notEqual(first.titleBlockContainment,undefined);
});

test('existing invalid native geometry, owner and duplicate guards still reject before deriving containment',async()=>{
  const mutations=[
    n=>{n.titleBlocks[0].ownerViewId=99;},
    n=>{n.titleBlocks[0].id=0;},
    n=>{n.titleBlocks[0].geometry.min.xMm=NaN;},
    n=>{n.titleBlocks[0].geometry.max.yMm=Infinity;},
    n=>{n.titleBlocks[0].geometry=known(10,10,1,1);},
    n=>{n.schedulePlacements=[schedule(1,known(0,0,1,1))];}
  ];
  for(const mutate of mutations){const native=nativeFixture();mutate(native);let calls=0;
    await assert.rejects(diagnoseSheetLayout(input,async method=>{calls++;return method==='revit.context.get'?context:native;}),e=>['sheet_layout_scope_mismatch','sheet_layout_scope_unknown','sheet_layout_geometry_invalid'].includes(e.code));assert.equal(calls,2);
  }
});

async function sdkFixture(t){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'revit-frame-containment-'));
  const token='frame-containment-readonly-mock-'.repeat(3),requests=[],sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
    socket.on('data',chunk=>{buffer+=chunk.toString('utf8');const newline=buffer.indexOf('\n');if(newline<0)return;
      const request=JSON.parse(buffer.slice(0,newline));assert.equal(request.token,token);requests.push({method:request.method,params:request.params});
      let result;if(request.method==='revit.bridge.info')result={protocol:'revit-auto-2027-v2',version:'0.4.0',features:['sheet-layout-diagnostics'],confirmationMode:'chat'};
      else if(request.method==='revit.context.get')result=captured.context;
      else if(request.method==='revit.sheet.layout')result=captured.native;
      else throw Error('Unexpected write or native query '+request.method);
      socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result})+'\n');
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const config=path.join(folder,'bridge.json');await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
  const client=new Client({name:'titleblock-containment-readonly-test',version:'1.0'});
  t.after(async()=>{
    await client.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));
    const cleanupPath=path.resolve(folder);
    assert.equal(path.dirname(cleanupPath),path.resolve(os.tmpdir()));
    assert.ok(path.basename(cleanupPath).startsWith('revit-frame-containment-'));
    await fs.rm(cleanupPath,{recursive:true,force:true});
  });
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],env:{REVIT_AI_CONFIG:config,REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS:'0'},stderr:'pipe'}));
  return {client,requests};
}

test('fresh real MCP SDK exposes the additive frame report and sends only pinned native reads',async t=>{
  const{client,requests}=await sdkFixture(t),tools=await client.listTools();
  const descriptor=tools.tools.find(tool=>tool.name==='revit_sheet_layout');
  assert.equal(descriptor.annotations.readOnlyHint,true);assert.equal(descriptor.annotations.destructiveHint,false);assert.equal(descriptor.inputSchema.additionalProperties,false);
  const response=await client.callTool({name:'revit_sheet_layout',arguments:captured.input});assert.equal(response.isError,undefined);
  const report=JSON.parse(response.content.find(c=>c.type==='text').text);
  assert.deepEqual(report.titleBlockContainment,evaluated(captured.native,{outOfBounds:captured.expected.outOfBounds}));
  assert.equal(report.outOfSheetBoundary,'native-view-sheet-outline');assert.deepEqual(report.outOfSheet,[]);assertReadonly(report);
  assert.deepEqual(requests.map(r=>r.method),['revit.bridge.info','revit.context.get','revit.bridge.info','revit.sheet.layout','revit.bridge.info','revit.context.get']);
  assert.deepEqual(requests.find(r=>r.method==='revit.sheet.layout').params,captured.input);
});
