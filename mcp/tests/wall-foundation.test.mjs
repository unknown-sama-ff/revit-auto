import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWallFoundation,validateWallFoundationPlan} from '../wall-foundation.mjs';
import {requireStructuralHostFeature} from '../structural-elements.mjs';
const foundation=()=>({operationType:'create_wall_foundation',hostElementId:10,foundationTypeId:20});
test('wall foundation retains exact existing host and native wall foundation type',()=>{const op=foundation();assert.equal(validateWallFoundation(op),op);validateWallFoundationPlan([op]);});
test('wall foundation rejects missing unsafe deferred source IDs and extra placement hints',()=>{
 for(const field of ['hostElementId','foundationTypeId'])for(const value of [undefined,null,0,-1,1.2,'10','@wall',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateWallFoundation({...foundation(),[field]:value}));
 for(const extra of [{levelId:311},{point:{xMm:0,yMm:0,zMm:0}},{parameters:{}},{hostElementId:20}])assert.throws(()=>validateWallFoundation({...foundation(),...extra}));
});
test('wall foundation cannot duplicate its host or mutate/delete its reviewed sources in one plan',()=>{
 assert.throws(()=>validateWallFoundationPlan([foundation(),foundation()]));
 for(const operationType of ['set_parameter','delete_element'])for(const elementId of [10,20])assert.throws(()=>validateWallFoundationPlan([foundation(),{operationType,elementId}]));
 validateWallFoundationPlan([foundation(),{operationType:'delete_element',elementId:30}]);
});
test('beam-only native capability does not falsely authorize wall foundation forwarding',async()=>{
 await assert.rejects(requireStructuralHostFeature(async()=>({features:['controlled-structural-elements']}),undefined,['controlled-wall-foundation']),e=>e.code==='structural_native_feature_unavailable');
});
