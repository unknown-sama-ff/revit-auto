import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperations} from '../workflows.mjs';
import {validateRebarPlan} from '../rebar-creation.mjs';
import {validateCeilingPlan} from '../ceiling-creation.mjs';
const rebar={operationType:'create_rebar_set',hostElementId:10,barTypeId:20,start:{xMm:0,yMm:0,zMm:100},end:{xMm:1000,yMm:0,zMm:100},normal:{x:0,y:1,z:0},layout:{rule:'Single'}};
const ceiling={operationType:'create_ceiling',ceilingTypeId:10,levelId:20,boundary:[{xMm:0,yMm:0,zMm:3000},{xMm:4000,yMm:0,zMm:3000},{xMm:4000,yMm:3000,zMm:3000},{xMm:0,yMm:3000,zMm:3000}]};
for(const [name,creation,validator]of [['rebar',rebar,validateRebarPlan],['ceiling',ceiling,validateCeilingPlan]]){
 test(name+' refuses same-plan source mutation in either order through the actual operation validator',()=>{
  for(const elementId of [10,20])for(const operationType of ['set_parameter','delete_element']){
   const change={operationType,elementId,...(operationType==='set_parameter'?{parameter:'BIP:ALL_MODEL_INSTANCE_COMMENTS',value:'test'}:{})};
   assert.throws(()=>validateOperations([creation,change]));assert.throws(()=>validateOperations([change,creation]));
  }
  assert.throws(()=>validator([creation,{operationType:'load_family'}]));
  assert.doesNotThrow(()=>validateOperations([creation,{operationType:'delete_element',elementId:30}]));
 });
}
test('stirrup protects the exact selected shape in addition to host and bar type',()=>{
 const stirrup={operationType:'create_rebar_stirrup',hostElementId:10,barTypeId:20,shapeId:30,origin:{xMm:0,yMm:0,zMm:0},xDirection:{x:1,y:0,z:0},yDirection:{x:0,y:1,z:0},layout:{rule:'Single'}};
 assert.throws(()=>validateOperations([stirrup,{operationType:'set_parameter',elementId:30,parameter:'BIP:ALL_MODEL_INSTANCE_COMMENTS',value:'test'}]));
});
