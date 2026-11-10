import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalInspectionItems} from '../acceptance-helpers.mjs';

const baseline=[{
 summary:{id:1,className:'FamilyInstance',location:{xMm:10,yMm:20,zMm:30}},
 parameters:[{id:2,value:'Lighting',valueSupported:true},{id:1,value:100,valueSupported:true}],
 connectors:[
  {connectorId:3,domain:'DomainElectrical',peers:[{elementId:9,connectorId:1},{elementId:8,connectorId:2}],peerReferencesSupported:true},
  {connectorId:2,domain:'DomainCableTrayConduit',peers:[],originSupported:false}
 ],
 electrical:{systemIds:[4,3],memberIds:[6,5],vertices:[{xMm:0,yMm:0,zMm:0},{xMm:100,yMm:0,zMm:0}]},
 piping:{applicable:false},otherEvidence:{orderedPoints:[1,2,3],supported:false}
},{id:7,exists:false}];

test('native evidence comparison ignores enumeration order only for known unordered collections',()=>{
 const changed=structuredClone(baseline);
 changed.reverse();const item=changed[1];item.parameters.reverse();item.connectors.reverse();item.connectors[1].peers.reverse();item.electrical.systemIds.reverse();item.electrical.memberIds.reverse();
 assert.deepEqual(canonicalInspectionItems(changed),canonicalInspectionItems(baseline));
});

test('native evidence comparison retains actual parameter, connector, peer and support-state changes',()=>{
 for(const mutate of [
  item=>{item.parameters[0].value='Changed';},
  item=>{item.connectors[0].connectorId=4;},
  item=>{item.connectors[0].peers[0].elementId=10;},
  item=>{item.connectors[0].peerReferencesSupported=false;},
  item=>{item.connectors[1].originSupported=true;},
  item=>{item.electrical.systemIds.push(4);},
  item=>{item.piping.applicable=true;},
  item=>{item.otherEvidence.supported=true;}
 ]){const changed=structuredClone(baseline);mutate(changed[0]);assert.notDeepEqual(canonicalInspectionItems(changed),canonicalInspectionItems(baseline));}
});

test('native evidence comparison does not sort geometry or unknown arrays',()=>{
 for(const mutate of [item=>item.electrical.vertices.reverse(),item=>item.otherEvidence.orderedPoints.reverse()]){
  const changed=structuredClone(baseline);mutate(changed[0]);assert.notDeepEqual(canonicalInspectionItems(changed),canonicalInspectionItems(baseline));
 }
});

test('native evidence comparison preserves missing evidence and never deduplicates elements',()=>{
 for(const mutate of [item=>{delete item.connectors;},item=>{delete item.piping;},item=>{item.parameters.push(structuredClone(item.parameters[0]));}]){
  const changed=structuredClone(baseline);mutate(changed[0]);assert.notDeepEqual(canonicalInspectionItems(changed),canonicalInspectionItems(baseline));
 }
 assert.notDeepEqual(canonicalInspectionItems([...baseline,baseline[0]]),canonicalInspectionItems(baseline));
});

test('native evidence normalization does not mutate captured raw evidence',()=>{
 const before=structuredClone(baseline);canonicalInspectionItems(baseline);assert.deepEqual(baseline,before);
});

test('native signed zero compares equally after JSON persistence without changing raw geometry',()=>{
 const raw=structuredClone(baseline);
 raw[0].summary.location.xMm=-0;
 raw[0].otherEvidence.orderedPoints=[-0,{direction:{x:-1,y:-0,z:-0}},0];
 const saved=JSON.parse(JSON.stringify(raw));
 assert.deepEqual(canonicalInspectionItems(raw),canonicalInspectionItems(saved));
 assert.equal(Object.is(raw[0].summary.location.xMm,-0),true);
 assert.equal(Object.is(raw[0].otherEvidence.orderedPoints[1].direction.y,-0),true);
});

test('signed zero normalization retains tiny changes, array order, fields and nonfinite values',()=>{
 const raw=structuredClone(baseline);
 raw[0].otherEvidence.orderedPoints=[-0,{unknown:NaN,limit:Infinity},1];
 const expected=canonicalInspectionItems(raw);
 assert.ok(Number.isNaN(expected[0].otherEvidence.orderedPoints[1].unknown));
 assert.equal(expected[0].otherEvidence.orderedPoints[1].limit,Infinity);
 for(const mutate of [
  item=>{item.summary.location.xMm=Number.MIN_VALUE;},
  item=>{item.otherEvidence.orderedPoints.reverse();},
  item=>{delete item.otherEvidence.orderedPoints[1].unknown;},
  item=>{item.otherEvidence.orderedPoints[1].unknown=null;}
 ]){const changed=structuredClone(raw);mutate(changed[0]);assert.notDeepEqual(canonicalInspectionItems(changed),expected);}
});
