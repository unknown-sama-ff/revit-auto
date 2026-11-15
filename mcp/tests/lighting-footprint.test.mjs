import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRoomLighting} from '../room-lighting.mjs';
import {footprintBoundaryDistance,footprintsOverlap} from '../lighting-footprint.mjs';
const room={id:10,name:'Measured room',areaM2:15.21,layoutEligible:true,levelId:311,levelElevationMm:0,boundaryLoops:[[{xMm:42050,yMm:1050},{xMm:45950,yMm:1050},{xMm:45950,yMm:4950},{xMm:42050,yMm:4950}]]};
const footprint={symbolId:123,rotationDegrees:0,minOffsetXMm:0,maxOffsetXMm:1200,minOffsetYMm:-413,maxOffsetYMm:113};
const input={symbolId:123,rows:2,columns:2,heightAboveLevelMm:2800,marginMm:200,markPrefix:'SAFE',fixtureFootprint:footprint};
const rectLoop=(xmin,ymin,xmax,ymax)=>[{xMm:xmin,yMm:ymin},{xMm:xmax,yMm:ymin},{xMm:xmax,yMm:ymax},{xMm:xmin,yMm:ymax}];

test('measured asymmetric origin is converted from envelope centers to insertion points without changing Z',()=>{
  const r=buildRoomLighting(room,input);
  assert.deepEqual(r.operations.map(o=>[o.xMm,o.yMm,o.zMm]),[[42250,1663,2800],[44550,1663,2800],[42250,4637,2800],[44550,4637,2800]]);
  assert.equal(r.layout.gridAnchor,'footprint-center');assert.equal(r.layout.marginAppliesTo,'reviewed-project-axis-envelope');
  assert.deepEqual(r.layout.footprints[0],{xmin:42250,xmax:43450,ymin:1250,ymax:1776});
  for(const rect of r.layout.footprints)assert.ok(footprintBoundaryDistance(rect,room.boundaryLoops)>=200-1e-6);
  assert.equal(r.operations[0].rotationDegrees,0);
});
test('legacy point mode keeps coordinates and explicitly declines envelope containment',()=>{
  const {fixtureFootprint,...legacy}=input;const r=buildRoomLighting(room,legacy);
  assert.deepEqual(r.operations[0].xMm,42250);assert.equal(r.operations[0].yMm,1250);
  assert.equal(r.layout.fixtureFootprint,undefined);assert.match(r.warnings.at(-1),/Only insertion points/);
});
test('footprint rejects incompatible type, unknown bounds, reversed, zero, nonfinite and excessive extents',()=>{
  for(const f of [null,[],{...footprint,symbolId:99},{...footprint,symbolId:1.2},{...footprint,maxOffsetXMm:0},{...footprint,maxOffsetYMm:-500},{...footprint,minOffsetXMm:NaN},{...footprint,maxOffsetYMm:Infinity},{...footprint,minOffsetYMm:-1e9},{...footprint,rotationDegrees:undefined}]){
    assert.throws(()=>buildRoomLighting(room,{...input,fixtureFootprint:f}),/fixtureFootprint/);
  }
});
test('project-axis evidence cannot be reused at another planned rotation',()=>{
  assert.throws(()=>buildRoomLighting(room,{...input,rotationDegrees:90}),/rotation/);
  assert.equal(buildRoomLighting(room,{...input,rotationDegrees:360}).operations.length,4);
});
test('center-inside does not hide a small room hole entirely inside the footprint',()=>{
  const box=rectLoop(0,0,6000,4000),hole=rectLoop(3200,1900,3300,2000);
  const r={...room,boundaryLoops:[box,hole]};
  assert.throws(()=>buildRoomLighting(r,{...input,rows:1,columns:1}),/footprint.*boundary\/hole/);
});
test('a concave notch crossing the envelope is rejected although its center and corners are inside',()=>{
  const notch=[{xMm:0,yMm:0},{xMm:6000,yMm:0},{xMm:6000,yMm:4000},{xMm:3400,yMm:4000},{xMm:3400,yMm:2100},{xMm:3300,yMm:2100},{xMm:3300,yMm:4000},{xMm:0,yMm:4000}];
  assert.throws(()=>buildRoomLighting({...room,boundaryLoops:[notch]},{...input,rows:1,columns:1,marginMm:100}),/footprint/);
});
test('diagonal boundary clearance uses segments rather than only the overall room box',()=>{
  const diamond=[{xMm:0,yMm:2000},{xMm:3000,yMm:0},{xMm:6000,yMm:2000},{xMm:3000,yMm:4000}];
  assert.throws(()=>buildRoomLighting({...room,boundaryLoops:[diamond]},input),/outside|footprint/);
});
test('too-large envelopes and dense overlapping grids are rejected as a whole',()=>{
  assert.throws(()=>buildRoomLighting(room,{...input,fixtureFootprint:{...footprint,maxOffsetXMm:4000}}),/no usable/);
  assert.throws(()=>buildRoomLighting(room,{...input,marginMm:800}),/overlap/);
});
test('asymmetric positive offsets and negative coordinates never force insertion points into the envelope',()=>{
  const r=buildRoomLighting({...room,boundaryLoops:[rectLoop(-6000,-4000,0,0)]},{...input,rows:1,columns:1,fixtureFootprint:{...footprint,minOffsetXMm:1000,maxOffsetXMm:2200,minOffsetYMm:2000,maxOffsetYMm:2600}});
  assert.equal(r.operations[0].xMm,-4600);assert.equal(r.operations[0].yMm,-4300);
  assert.equal(r.layout.footprints[0].xmin,-3600);
});
test('exact envelope clearance is accepted, touching/collinear/contained boundary segments are not',()=>{
  const rect={xmin:10,xmax:20,ymin:10,ymax:20};
  assert.equal(footprintBoundaryDistance(rect,[rectLoop(0,0,30,30)]),10);
  for(const line of [[{xMm:10,yMm:0},{xMm:10,yMm:30}],[{xMm:0,yMm:15},{xMm:30,yMm:15}],[{xMm:11,yMm:11},{xMm:12,yMm:12}]])
    assert.equal(footprintBoundaryDistance(rect,[line]),0);
});
test('adjacent envelopes may touch but positive area overlap is rejected',()=>{
  const a={xmin:0,xmax:10,ymin:0,ymax:10};
  assert.equal(footprintsOverlap(a,{xmin:10,xmax:20,ymin:0,ymax:10}),false);
  assert.equal(footprintsOverlap(a,{xmin:9,xmax:20,ymin:0,ymax:10}),true);
});
