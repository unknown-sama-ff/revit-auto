import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRoomLighting} from '../room-lighting.mjs';
const room={id:10,name:'办公室',number:'101',areaM2:24,layoutEligible:true,levelId:311,levelElevationMm:0,boundaryLoops:[[{xMm:0,yMm:0},{xMm:6000,yMm:0},{xMm:6000,yMm:4000},{xMm:0,yMm:4000}]]};
test('room lighting preview creates an explicit grid of family operations',()=>{const result=buildRoomLighting(room,{symbolId:123,rows:2,columns:3,heightAboveLevelMm:3000,marginMm:500,markPrefix:'L101'});assert.equal(result.operations.length,6);assert.equal(result.operations[0].operationType,'create_family_instance');assert.equal(result.operations[5].mark,'L101-06');assert.equal(result.layout.fixtureCount,6);});
test('room lighting preview uses absolute level plus height',()=>{const result=buildRoomLighting({...room,levelElevationMm:7000},{symbolId:123,rows:1,columns:1,heightAboveLevelMm:2800,marginMm:500,markPrefix:'L2'});assert.equal(result.operations[0].zMm,9800);});
test('room lighting preview rejects points that violate the margin',()=>{assert.throws(()=>buildRoomLighting(room,{symbolId:123,rows:1,columns:1,heightAboveLevelMm:3000,marginMm:3500,markPrefix:'bad'}),/margin/);});
test('room lighting preview rejects ambiguous room boundary',()=>{assert.throws(()=>buildRoomLighting({...room,layoutEligible:false},{symbolId:123,rows:1,columns:1,heightAboveLevelMm:3000,marginMm:500,markPrefix:'bad'}),/boundary/);});

test('room lighting rejects a center point inside a shaft/hole',()=>{
 const hole=[{xMm:2500,yMm:1500},{xMm:3500,yMm:1500},{xMm:3500,yMm:2500},{xMm:2500,yMm:2500}];
 assert.throws(()=>buildRoomLighting({...room,boundaryLoops:[...room.boundaryLoops,hole]},{symbolId:123,rows:1,columns:1,heightAboveLevelMm:3000,marginMm:200,markPrefix:'hole'}),/outside/);
});
test('room lighting never silently drops grid points from concave rooms',()=>{
 const lShape=[{xMm:0,yMm:0},{xMm:6000,yMm:0},{xMm:6000,yMm:1000},{xMm:1000,yMm:1000},{xMm:1000,yMm:4000},{xMm:0,yMm:4000}];
 assert.throws(()=>buildRoomLighting({...room,boundaryLoops:[lShape]},{symbolId:123,rows:2,columns:2,heightAboveLevelMm:3000,marginMm:200,markPrefix:'concave'}),/outside/);
});
test('room lighting requires an explicit valid family id and mark prefix',()=>{
 assert.throws(()=>buildRoomLighting(room,{symbolId:0,rows:2,columns:2,heightAboveLevelMm:3000,marginMm:500,markPrefix:'bad'}),/symbolId/);
 assert.throws(()=>buildRoomLighting(room,{symbolId:123,rows:2,columns:2,heightAboveLevelMm:3000,marginMm:500,markPrefix:''}),/markPrefix/);
});
