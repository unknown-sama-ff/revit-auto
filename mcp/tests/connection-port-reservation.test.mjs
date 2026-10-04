import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperations} from '../workflows.mjs';
const point=(x,y=0,z=500)=>({xMm:x,yMm:y,zMm:z});
const select=p=>({domain:'DomainPiping',shape:'Round',point:p,toleranceMm:1});
const pipe=(id,a,b)=>({operationType:'create_pipe',id,pipeTypeId:1887580,systemTypeId:1887577,levelId:311,start:a,end:b,diameterMm:200});
function route(reuse){const a=point(34000,18000),b=point(34500,18000);return [pipe('p4',a,b),{operationType:'create_fitting',fittingType:'elbow',firstElementId:101,firstConnectorId:1,secondElementId:'@p4',secondConnector:select(b)},{operationType:'create_fitting',fittingType:'transition',firstElementId:'@p4',firstConnector:select(reuse?b:a),secondElementId:2295838,secondConnectorId:0}];}
test('same new pipe endpoint used by elbow and transition fails before preview',()=>assert.throws(()=>validateOperations(route(true)),/port|endpoint|occupied/i));
test('separate endpoints of the same new pipe remain valid',()=>assert.equal(validateOperations(route(false)).length,3));
test('same native connector id cannot be consumed by two operations',()=>assert.throws(()=>validateOperations([{operationType:'connect_elements',firstElementId:1,firstConnectorId:3,secondElementId:2,secondConnectorId:0},{operationType:'create_fitting',firstElementId:1,firstConnectorId:3,secondElementId:4,secondConnectorId:1}]),/port|occupied/i));
test('different tolerances resolving to the same new endpoint are still duplicate',()=>{const ops=route(true);ops[2].firstConnector.point.xMm+=0.5;ops[2].firstConnector.toleranceMm=2;assert.throws(()=>validateOperations(ops),/port|endpoint|occupied/i);});
test('tolerance containing both ends is ambiguous, not a port id guess',()=>{const a=point(0),b=point(10);assert.throws(()=>validateOperations([pipe('p',a,b),{operationType:'connect_elements',firstElementId:1,firstConnectorId:3,secondElementId:'@p',secondConnector:{...select(point(5)),toleranceMm:20}}]),/endpoint|ambiguous/i);});
test('invalid selector on a new curve cannot silently pass to Revit',()=>assert.throws(()=>validateOperations([pipe('p',point(0),point(500)),{operationType:'connect_elements',firstElementId:1,firstConnectorId:3,secondElementId:'@p',secondConnectorId:0}]),/new|predict|endpoint/i));

import fs from 'node:fs/promises';
test('stored original failed route now rejects its reused endpoint, never re-submits',async t=>{let record;try{record=JSON.parse(await fs.readFile(new URL('../../acceptance/pump-connection-v0317-ed0438ffe69c44e19f5bef1dd5768e84.baseline.json',import.meta.url),'utf8'));}catch(e){if(e.code==='ENOENT'){t.skip('Local Revit rollback capture not present');return;}throw e;}assert.throws(()=>validateOperations(record.plan.operations),/endpoint|occupied/i);});
test('native execution uses evidence policy, not instantaneous enum-only equality',async()=>{const code=await fs.readFile(new URL('../../v27/ModelExecutor.cs',import.meta.url),'utf8');assert.match(code,/PipingCompatibilityRules\.RequireCompatible/);assert.doesNotMatch(code,/a\.PipeSystemType\s*!=\s*b\.PipeSystemType/);assert.match(code,/connectionPorts\.Reserve/);});
