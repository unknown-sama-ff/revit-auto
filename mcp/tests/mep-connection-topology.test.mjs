import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperations} from '../workflows.mjs';
import {buildRegisteredWorkflow} from '../workflow-adapter.mjs';
const two=()=>({operationType:'create_fitting',fittingType:'elbow',firstElementId:1,firstConnectorId:11,secondElementId:2,secondConnectorId:22});
const tee=()=>({...two(),fittingType:'tee',thirdElementId:3,thirdConnectorId:33});
const cross=()=>({...tee(),fittingType:'cross',fourthElementId:4,fourthConnectorId:44});
const criteria=()=>({domain:'DomainPiping',shape:'Round',point:{xMm:0,yMm:0,zMm:1000},toleranceMm:1});
test('tee and cross preserve explicit ordered endpoint contracts and legacy two-port fittings',()=>{
 for(const op of [two(),tee(),cross()])assert.deepEqual(validateOperations([op]),[op]);
 const defaultElbow=two();delete defaultElbow.fittingType;assert.deepEqual(validateOperations([defaultElbow]),[defaultElbow]);
});
test('fitting kind is exact and all3 or4 endpoint selections are mandatory',()=>{
 for(const fittingType of [null,undefined,'TEE',' Tee','wye',''])assert.throws(()=>validateOperations([{...two(),fittingType}]),/fittingType|fitting kind/i);
 for(const op of [tee(),cross()])for(const prefix of op.fittingType==='tee'?['first','second','third']:['first','second','third','fourth']){
  const noOwner={...op};delete noOwner[prefix+'ElementId'];assert.throws(()=>validateOperations([noOwner]),/ElementId|required/i);
  const noPort={...op};delete noPort[prefix+'ConnectorId'];assert.throws(()=>validateOperations([noPort]),/connector/i);
 }
});
test('unused fitting endpoint fields and duplicate owners cannot be silently ignored',()=>{
 for(const op of [{...two(),thirdElementId:3,thirdConnectorId:33},{...tee(),fourthElementId:4,fourthConnectorId:44},{...cross(),fourthElementId:1}])assert.throws(()=>validateOperations([op]),/endpoint|owner|distinct|unused/i);
 const connect={...two(),operationType:'connect_elements',thirdConnectorId:33};delete connect.fittingType;assert.throws(()=>validateOperations([connect]),/endpoint|unused/i);
});
test('third and fourth selectors reuse the existing full native connector criteria contract',()=>{
 for(const prefix of ['third','fourth']){
  const op=cross();delete op[prefix+'ConnectorId'];op[prefix+'Connector']=criteria();assert.deepEqual(validateOperations([op]),[op]);
  assert.throws(()=>validateOperations([{...op,[prefix+'ConnectorId']:0}]),/connector/i);
  for(const c of [null,{...criteria(),toleranceMm:0},{...criteria(),point:{xMm:0,yMm:0}},{...criteria(),shape:'Triangle'}])assert.throws(()=>validateOperations([{...op,[prefix+'Connector']:c}]),/connector|tolerance|finite/i);
 }
});
test('tee third and cross fourth endpoint reservations are exclusive across a whole plan',()=>{
 for(const op of [tee(),cross()]){
  const prefix=op.fittingType==='tee'?'third':'fourth';
  const second={operationType:'connect_elements',firstElementId:op[prefix+'ElementId'],firstConnectorId:op[prefix+'ConnectorId'],secondElementId:9,secondConnectorId:99};
  assert.throws(()=>validateOperations([op,second]),/reserved|occupied|consume/i);
 }
});
test('known-unassigned permission is explicit boolean and only belongs to connect_elements',()=>{
 const connect={...two(),operationType:'connect_elements'};delete connect.fittingType;
 for(const allowUnassignedEquipmentPort of [true,false])assert.deepEqual(validateOperations([{...connect,allowUnassignedEquipmentPort}]),[{...connect,allowUnassignedEquipmentPort}]);
 for(const value of [null,undefined,'true',1,{},[]])assert.throws(()=>validateOperations([{...connect,allowUnassignedEquipmentPort:value}]),/allowUnassignedEquipmentPort|boolean/i);
 for(const value of [true,false])assert.throws(()=>validateOperations([{...two(),allowUnassignedEquipmentPort:value}]),/allowUnassignedEquipmentPort|connect_elements/i);
});
test('unassigned opt-in cannot pretend deferred elements have already been natively inspected',()=>{
 const pipe={operationType:'create_pipe',id:'pipe',pipeTypeId:1,systemTypeId:2,levelId:3,diameterMm:100,start:{xMm:0,yMm:0,zMm:1000},end:{xMm:1000,yMm:0,zMm:1000}};
 const op={operationType:'connect_elements',firstElementId:1,firstConnectorId:11,secondElementId:'@pipe',secondConnector:criteria(),allowUnassignedEquipmentPort:true};
 assert.throws(()=>validateOperations([pipe,op]),/existing|inspected|deferred/i);
});
test('pump build keeps tee and cross endpoint order in the existing workflow',()=>{
 for(const op of [tee(),cross()]){const {operationType,...row}=op;const built=buildRegisteredWorkflow('pump_room.build',{fittings:[row]});const {id,...actual}=built.operations[0];assert.deepEqual(actual,op);}
});
