import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperations, workflowOperations } from '../workflows.mjs';

test('rejects unsupported executable code operations', () => assert.throws(() => validateOperations([{operationType:'send_code_to_revit'}]), /Unsupported operation/));
test('rejects malformed or dangerous coordinates', () => assert.throws(() => validateOperations([{operationType:'create_level',name:'L',elevationMm:'3000'}]), /finite number/));
test('rejects missing explicit family type', () => assert.throws(() => validateOperations([{operationType:'create_family_instance',xMm:0,yMm:0}]), /family/));
test('accepts explicit millimeter point operation', () => assert.equal(validateOperations([{operationType:'create_level',id:'L',name:'L',elevationMm:0}]).length,1));
test('accepts references only to prior operations', () => assert.equal(validateOperations([{operationType:'create_level',id:'L',name:'L',elevationMm:0},{operationType:'create_room',levelId:'@L',xMm:1,yMm:2}]).length,2));
test('rejects forward references', () => assert.throws(() => validateOperations([{operationType:'create_room',levelId:'@L',xMm:1,yMm:2}]), /Invalid levelId/));
test('rejects duplicate operation ids', () => assert.throws(() => validateOperations([{operationType:'create_level',id:'x',name:'A',elevationMm:0},{operationType:'create_level',id:'x',name:'B',elevationMm:3000}]), /Duplicate/));
test('accepts connector id zero', () => assert.doesNotThrow(() => validateOperations([{operationType:'connect_elements',firstElementId:1,secondElementId:2,firstConnectorId:0,secondConnectorId:1}])));
test('rejects negative connector id', () => assert.throws(() => validateOperations([{operationType:'connect_elements',firstElementId:1,secondElementId:2,firstConnectorId:-1}]), /Connector ids/));
test('lighting workflow preserves explicit order and validates', () => assert.equal(workflowOperations('lighting.full',{lights:[{symbolId:1,levelId:2,xMm:1,yMm:2,id:'light'}]}).length,1));
test('architecture workflow generates walls', () => assert.equal(workflowOperations('architecture.build',{walls:[{wallTypeId:1,levelId:2,start:{xMm:0,yMm:0},end:{xMm:1000,yMm:0},heightMm:3000}]}).length,1));
test('pump workflow generates pipes', () => assert.equal(workflowOperations('pump_room.build',{pipes:[{pipeTypeId:1,systemTypeId:2,levelId:3,start:{xMm:0,yMm:0},end:{xMm:1000,yMm:0},diameterMm:50}]}).length,1));

test('stair workflow validates explicit straight runs and landing mode', () => assert.equal(workflowOperations('architecture.stairs',{stairs:[{baseLevelId:1,topLevelId:2,landingMode:'automaticBetweenRuns',runs:[{start:{xMm:0,yMm:0},end:{xMm:0,yMm:3000},widthMm:1200},{start:{xMm:1500,yMm:3000},end:{xMm:1500,yMm:0},widthMm:1200}]}]}).length,1));
test('stair operation rejects guessed or incomplete platform inputs', () => assert.throws(() => validateOperations([{operationType:'create_stair',baseLevelId:1,topLevelId:2,landingMode:'automaticBetweenRuns',runs:[{start:{xMm:0,yMm:0},end:{xMm:0,yMm:3000},widthMm:1200}]}]), /at least two runs/));

test('pump route expands only explicit points into straight pipe segments', () => {
  const ops=workflowOperations('pump_room.route',{routes:[{id:'r',pipeTypeId:1,systemTypeId:2,levelId:3,diameterMm:80,flowIntent:'supply',points:[{xMm:0,yMm:0,zMm:1000},{xMm:1000,yMm:0,zMm:1000},{xMm:1000,yMm:500,zMm:1000}]}]});
  assert.deepEqual(ops.map(op=>op.operationType),['create_pipe','create_pipe']); assert.equal(ops[0].id,'r-1'); assert.equal(ops[1].start.yMm,0); assert.equal(ops[1].end.yMm,500);
});
test('pump route refuses missing explicit route points', () => assert.throws(() => workflowOperations('pump_room.route',{routes:[{pipeTypeId:1,systemTypeId:2,levelId:3,diameterMm:80,flowIntent:'supply'}]}), /explicit points/));


test('pump connection workflow preserves explicit connector criteria and rejects missing selection', () => {
  const ops=workflowOperations('pump_room.connect',{connections:[{flowIntent:'supply',firstElementId:10,secondElementId:11,firstConnector:{domain:'DomainPiping',shape:'Round',point:{xMm:0,yMm:0,zMm:0},toleranceMm:2},secondConnector:{domain:'DomainPiping',shape:'Round',point:{xMm:100,yMm:0,zMm:0},toleranceMm:2}}]});
  assert.equal(ops[0].operationType,'connect_elements'); assert.equal(ops[0].firstConnector.domain,'DomainPiping');
  assert.throws(()=>workflowOperations('pump_room.connect',{connections:[{flowIntent:'supply',firstElementId:10,secondElementId:11}]}),/requires exactly one connector/);
});


test('pump route and connect reject omitted flow intent',()=>{ assert.throws(()=>workflowOperations('pump_room.route',{routes:[{pipeTypeId:1,systemTypeId:2,levelId:3,diameterMm:80,points:[{xMm:0,yMm:0,zMm:0},{xMm:100,yMm:0,zMm:0}]}]}),/flowIntent/); assert.throws(()=>workflowOperations('pump_room.connect',{connections:[{firstElementId:1,secondElementId:2,flowIntent:'unknown',firstConnectorId:1,secondConnectorId:2}]}),/flowIntent/); });


