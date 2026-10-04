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
