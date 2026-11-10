import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyExistingElectricalCircuitCreation,verifySavedExistingElectricalCircuit,verifyLightingCircuitCreation,verifySavedLightingCircuitCreation} from '../circuit-creation-verification.mjs';

const existingPlan={operations:[{operationType:'create_circuit',id:'existingCircuit',elementIds:[301,302],switchIds:[401],panelId:501,name:'AI-EXISTING-CIRCUIT'}]};
const existingBeforeItems=[
 {summary:{id:301,className:'FamilyInstance',categoryId:-2001120,typeId:7001,location:{xMm:100,yMm:200,zMm:300}},parameters:[{id:10,value:'L1'}],electrical:{systemIds:[]}},
 {summary:{id:302,className:'FamilyInstance',categoryId:-2001120,typeId:7002,location:{xMm:110,yMm:200,zMm:300}},parameters:[{id:10,value:'L2'}],electrical:{systemIds:[]}},
 {summary:{id:401,className:'FamilyInstance',categoryId:-2008087,typeId:8001,location:{xMm:105,yMm:205,zMm:300}},parameters:[{id:11,value:'S1'}],electrical:{systemIds:[]}}
];
const existingAfterItems=existingBeforeItems.map(item=>({...item,electrical:{systemIds:[9001]}}));
const existingArgs=()=>({plan:structuredClone(existingPlan),receipt:{status:'committed',completedOperationCount:1,saved:false,createdElementIds:[9001],references:{existingCircuit:9001}},beforeItems:structuredClone(existingBeforeItems),afterItems:structuredClone(existingAfterItems),afterCircuit:{summary:{id:9001,className:'ElectricalSystem',categoryId:-2008037},electrical:{panelId:501,loadName:'AI-EXISTING-CIRCUIT',memberIds:[301,302,401]}},beforePanel:{summary:{id:501},electrical:{systemIds:[700]}},afterPanel:{summary:{id:501},electrical:{systemIds:[700,9001]}},beforeCounts:{OST_ElectricalCircuit:12,OST_LightingFixtures:8,OST_Wire:4},afterCounts:{OST_ElectricalCircuit:13,OST_LightingFixtures:8,OST_Wire:4}});

test('verifies a standalone existing-member circuit with exact panel and switch membership',()=>{
 const result=verifyExistingElectricalCircuitCreation(existingArgs());
 assert.deepEqual(result,{status:'EXISTING_ELECTRICAL_CIRCUIT_CREATION_VERIFIED',circuitId:9001,panelId:501,loadName:'AI-EXISTING-CIRCUIT',memberIds:[301,302,401],createdElementIds:[9001],automaticSave:false});
});

function existingArgsWithCircuitLabels(){
 const value=existingArgs();
 value.afterCircuit.electrical.panelName='P-TEST';
 value.afterCircuit.electrical.circuitNumber='14';
 for(const [id,name,afterValue] of [[-1140104,'配电盘','P-TEST'],[-1140103,'回路编号','14']]){
  const parameter={id,name,storageType:'String',readOnly:true,hasValue:true,valueSupported:true,value:'',formattedValue:''};
  value.beforeItems[0].parameters.push(parameter);
  value.afterItems[0].parameters.push({...parameter,value:afterValue,formattedValue:afterValue});
 }
 return value;
}

test('native circuit labels may update only to the actual panel name and circuit number',()=>{
 assert.equal(verifyExistingElectricalCircuitCreation(existingArgsWithCircuitLabels()).circuitId,9001);
});

test('native circuit labels accept explicitly known-empty values without dropping metadata',()=>{
 const value=existingArgsWithCircuitLabels();
 const before=value.beforeItems[0].parameters.find(p=>p.id===-1140103);
 before.hasValue=false;delete before.value;delete before.formattedValue;
 assert.equal(verifyExistingElectricalCircuitCreation(value).circuitId,9001);
 const changed=existingArgsWithCircuitLabels();
 changed.afterItems[0].parameters.find(p=>p.id===-1140103).unexpectedMetadata=true;
 assert.throws(()=>verifyExistingElectricalCircuitCreation(changed),{code:'circuit_creation_not_verified'});
});

test('native circuit labels reject wrong values, unknown metadata and unrelated parameter changes',()=>{
 for(const mutate of [
  v=>{v.afterItems[0].parameters.find(p=>p.id===-1140104).value='OTHER';},
  v=>{v.afterItems[0].parameters.find(p=>p.id===-1140103).value=v.plan.operations[0].name;},
  v=>{v.afterItems[0].parameters.find(p=>p.id===-1140103).formattedValue='WRONG';},
  v=>{v.beforeItems[0].parameters.find(p=>p.id===-1140103).value='OLD';},
  v=>{v.beforeItems[0].parameters.find(p=>p.id===-1140104).valueSupported=false;},
  v=>{v.afterItems[0].parameters.find(p=>p.id===-1140104).readOnly=false;},
  v=>{delete v.afterCircuit.electrical.circuitNumber;},
  v=>{v.afterItems[0].parameters.push({...v.afterItems[0].parameters.find(p=>p.id===-1140103)});},
  v=>{v.afterItems[0].parameters[0].value='UNREVIEWED';}
 ]){const value=existingArgsWithCircuitLabels();mutate(value);assert.throws(()=>verifyExistingElectricalCircuitCreation(value),{code:'circuit_creation_not_verified'});}
});

test('rejects existing circuit evidence with extra members, changed loads or unrelated counts',()=>{
 for(const mutate of [
  v=>{v.afterCircuit.electrical.memberIds.push(999);},
  v=>{v.afterItems[0].summary.location.xMm+=1;},
  v=>{v.afterItems[2].electrical.systemIds=[];},
  v=>{v.afterPanel.electrical.systemIds=[9001];},
  v=>{v.afterCounts.OST_LightingFixtures++;},
  v=>{v.receipt.createdElementIds.push(999);}
 ]){const value=existingArgs();mutate(value);assert.throws(()=>verifyExistingElectricalCircuitCreation(value),{code:'circuit_creation_not_verified'});}
});

test('rejects incomplete or overlapping existing circuit scope',()=>{
 for(const mutate of [
  v=>{v.plan.operations[0].elementIds=[301,401];},
  v=>{v.plan.operations[0].switchIds=[401,401];},
  v=>{v.beforeItems.pop();},
  v=>{v.plan.operations[0].panelId=301;},
  v=>{v.receipt.automaticSave=true;}
 ]){const value=existingArgs();mutate(value);assert.throws(()=>verifyExistingElectricalCircuitCreation(value),{code:'circuit_creation_not_verified'});}
});

test('verifies existing circuit manual-save boundary without claiming close/reopen persistence',()=>{
 const context=()=>({active:true,document:{identity:'doc-circuit',path:'C:/acceptance/circuit.rvt',revision:8,isModified:false}});
 assert.deepEqual(verifySavedExistingElectricalCircuit({beforeContext:context(),afterContext:context(),savedVerification:{documentIdentity:'doc-circuit',revision:8,saved:true,isModified:false,automaticSave:false,persistenceVerified:false},expectedDocumentIdentity:'doc-circuit',expectedRevision:8}),{status:'EXISTING_ELECTRICAL_CIRCUIT_POSTSAVE_VERIFIED',documentIdentity:'doc-circuit',revision:8,saved:true,isModified:false,closeReopenPersistenceVerified:false,automaticSave:false});
});

const plan={operations:[
 {operationType:'create_family_instance',id:'newFixture1',symbolId:1001,placementMode:'legacyPoint',point:{xMm:12000,yMm:3000,zMm:3000},mark:'TEST-LIGHT-01'},
 {operationType:'create_circuit',id:'newCircuit1',elementIds:['@newFixture1'],panelId:2001,name:'TEST_CIRCUIT'}
]};
const beforePanel={summary:{id:2001},electrical:{systemIds:[4001,4002,4003,4004]}};
const receipt={status:'committed',completedOperationCount:2,saved:false,createdElementIds:[3001,3002],references:{newFixture1:3001,newCircuit1:3002}};
const light={summary:{id:3001,className:'FamilyInstance',categoryId:-2001120,typeId:1001,location:{xMm:12000,yMm:3000,zMm:3000}},parameters:[{id:-1001203,storageType:'String',valueSupported:true,value:'TEST-LIGHT-01'}],electrical:{systemIds:[3002]}};
const circuit={summary:{id:3002,className:'ElectricalSystem',categoryId:-2008037},electrical:{panelId:2001,loadName:'TEST_CIRCUIT',memberIds:[3001]}};
const afterPanel={summary:{id:2001},electrical:{systemIds:[4001,4002,4003,4004,3002]}};
const args=()=>({plan:structuredClone(plan),receipt:structuredClone(receipt),items:[structuredClone(light),structuredClone(circuit)],beforePanel:structuredClone(beforePanel),afterPanel:structuredClone(afterPanel),beforeCounts:{OST_LightingFixtures:48,OST_ElectricalCircuit:4,OST_Wire:51},afterCounts:{OST_LightingFixtures:49,OST_ElectricalCircuit:5,OST_Wire:51}});

test('verifies one new fixture and one native circuit with panel/member relationships',()=>{
 const result=verifyLightingCircuitCreation(args());
 assert.deepEqual(result,{status:'LIGHTING_CIRCUIT_CREATION_VERIFIED',lightId:3001,circuitId:3002,mark:'TEST-LIGHT-01',panelId:2001,loadName:'TEST_CIRCUIT',memberIds:[3001],createdElementIds:[3001,3002],wiresCreated:false,automaticSave:false});
});

test('rejects receipt without stable references or with automatic save',()=>{
 for(const mutate of [r=>{delete r.references.newCircuit1;},r=>{r.saved=true;},r=>{r.completedOperationCount=1;},r=>{r.createdElementIds=[3001];}]){const input=args();mutate(input.receipt);assert.throws(()=>verifyLightingCircuitCreation(input),/Receipt|two-operation/);}
});

test('rejects wrong native type, point, member, panel, counts and unrelated membership',()=>{
 const cases=[
  {name:'type',mutate:input=>{input.items[0].summary.typeId=999;}},
  {name:'point',mutate:input=>{input.items[0].summary.location.xMm+=2;}},
  {name:'light membership',mutate:input=>{input.items[0].electrical.systemIds=[];}},
  {name:'circuit member',mutate:input=>{input.items[1].electrical.memberIds=[];}},
  {name:'circuit panel',mutate:input=>{input.items[1].electrical.panelId=999;}},
  {name:'circuit name',mutate:input=>{input.items[1].electrical.loadName='Other';}},
  {name:'panel membership',mutate:input=>{input.afterPanel={...afterPanel,electrical:{systemIds:[3002]}};}},
  {name:'counts',mutate:input=>{input.afterCounts={OST_LightingFixtures:48,OST_ElectricalCircuit:4,OST_Wire:51};}}
 ];
 for(const item of cases){const input=args();item.mutate(input);assert.throws(()=>verifyLightingCircuitCreation(input),/does not|differs|not a native|category counts|Receipt|changed outside/,{message:item.name});}
});

test('rejects duplicate native evidence and a plan without the reviewed reference',()=>{
 const duplicate=args();duplicate.items=[light,light,circuit];assert.throws(()=>verifyLightingCircuitCreation(duplicate),/duplicate/);
 const noCircuit=args();noCircuit.plan={operations:[plan.operations[0]]};assert.throws(()=>verifyLightingCircuitCreation(noCircuit),/one-light/);
});

test('verifies manual-save current-session state without claiming close/reopen persistence',()=>{
 const context=()=>({active:true,document:{identity:'doc-1',path:'C:/acceptance/test.rvt',revision:5,isModified:false}});
 const result=verifySavedLightingCircuitCreation({
  beforeContext:context(),afterContext:context(),
  savedVerification:{documentIdentity:'doc-1',revision:5,saved:true,isModified:false,automaticSave:false,persistenceVerified:false},
  expectedDocumentIdentity:'doc-1',expectedRevision:5
 });
 assert.deepEqual(result,{status:'LIGHTING_CIRCUIT_POSTSAVE_VERIFIED',documentIdentity:'doc-1',revision:5,saved:true,isModified:false,closeReopenPersistenceVerified:false,automaticSave:false});
});

test('rejects stale, unsaved or persistence-overclaiming saved evidence',()=>{
 const base={beforeContext:{active:true,document:{identity:'doc-1',path:'C:/acceptance/test.rvt',revision:5,isModified:false}},afterContext:{active:true,document:{identity:'doc-1',path:'C:/acceptance/test.rvt',revision:5,isModified:false}},savedVerification:{documentIdentity:'doc-1',revision:5,saved:true,isModified:false,automaticSave:false,persistenceVerified:false},expectedDocumentIdentity:'doc-1',expectedRevision:5};
 for(const mutate of [
  value=>{value.savedVerification.saved=false;},
  value=>{value.afterContext.document.isModified=true;},
  value=>{value.savedVerification.revision=4;},
  value=>{value.savedVerification.persistenceVerified=true;},
  value=>{value.afterContext.document.identity='doc-2';}
 ]){
  const input=structuredClone(base);mutate(input);assert.throws(()=>verifySavedLightingCircuitCreation(input),/saved|revision|document|persistence/i);
 }
});


test('missing or unknown saved evidence cannot certify a saved document',()=>{
 const base={beforeContext:{active:true,document:{identity:'doc-1',path:'C:/fixtures/test.rvt',revision:5,isModified:false}},afterContext:{active:true,document:{identity:'doc-1',path:'C:/fixtures/test.rvt',revision:5,isModified:false}},savedVerification:{documentIdentity:'doc-1',revision:5,saved:true,isModified:false,automaticSave:false,persistenceVerified:false},expectedDocumentIdentity:'doc-1',expectedRevision:5};
 for(const mutate of [
  v=>{delete v.expectedDocumentIdentity;delete v.beforeContext.document.identity;delete v.afterContext.document.identity;delete v.savedVerification.documentIdentity;},
  v=>{v.expectedRevision=-1;v.beforeContext.document.revision=-1;v.afterContext.document.revision=-1;v.savedVerification.revision=-1;},
  v=>{v.beforeContext.active=false;},
  v=>{v.beforeContext.document.isModified=true;},
  v=>{delete v.beforeContext.document.path;delete v.afterContext.document.path;},
  v=>{delete v.savedVerification.persistenceVerified;}
 ]){const v=structuredClone(base);mutate(v);assert.throws(()=>verifySavedLightingCircuitCreation(v),{code:'circuit_creation_not_verified'});}
});

test('narrow creation rejects extra memberships, extra operations and unknown counts',()=>{
 for(const mutate of [
  v=>{v.items[1].electrical.memberIds.push(777);},
  v=>{v.items[0].electrical.systemIds.push(778);},
  v=>{v.plan.operations.push({operationType:'delete_element',elementId:777});},
  v=>{delete v.beforeCounts;delete v.afterCounts;},
  v=>{delete v.beforeCounts.OST_Wire;delete v.afterCounts.OST_Wire;},
  v=>{v.receipt.createdElementIds.push(779);},
  v=>{v.afterPanel.summary.id=888;}
 ]){const v=args();mutate(v);assert.throws(()=>verifyLightingCircuitCreation(v),{code:'circuit_creation_not_verified'});}
});

test('native circuit number is not the requested load name and count key order is irrelevant',()=>{
 const input=args();input.items[1].summary.name='7';
 input.afterCounts={OST_Wire:51,OST_ElectricalCircuit:5,OST_LightingFixtures:49};
 assert.equal(verifyLightingCircuitCreation(input).loadName,'TEST_CIRCUIT');
 input.items[1].electrical.loadName='7';
 assert.throws(()=>verifyLightingCircuitCreation(input),{code:'circuit_creation_not_verified'});
});
