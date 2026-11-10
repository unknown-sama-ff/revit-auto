import test from 'node:test';
import assert from 'node:assert/strict';
import { electricalCircuitOperations, parseElectricalCircuitInput, inspectElectricalCircuitScope } from '../electrical-circuit.mjs';

const circuit={elementIds:[101,102],panelId:103,switchIds:[104],name:'办公室照明'};
const items=[
  {summary:{id:101,className:'FamilyInstance',categoryId:-2001120},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]},parameters:[]},
  {summary:{id:102,className:'FamilyInstance',categoryId:-2001120},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]},parameters:[]},
  {summary:{id:103,className:'FamilyInstance',categoryId:-2001040},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]},parameters:[{id:-1140064,storageType:'ElementId',readOnly:false,valueSupported:true,hasValue:true,value:105}]},
  {summary:{id:104,className:'FamilyInstance',categoryId:-2008087},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]},parameters:[]},
  {summary:{id:105,className:'DistributionSysType',categoryId:-2008041},connectors:[],parameters:[]}
];

test('circuit inputs reject mismatched parameter values, duplicate operation IDs and overlapping member reservations',()=>{
  for(const input of [
    {parameterChanges:[{elementId:201,parameter:'BIP:RBS_ELEC_CIRCUIT_NAME',value:105}]},
    {parameterChanges:[{elementId:103,parameter:'BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM',value:'105'}]},
    {circuits:[{...circuit,id:'duplicate'},{elementIds:[301],panelId:103,id:'duplicate'}]},
    {circuits:[{...circuit,id:'circuit2'},{elementIds:[301],panelId:103}]},
    {circuits:[circuit,{elementIds:[101],panelId:103}]},
    {circuits:[circuit,{elementIds:[301],switchIds:[104],panelId:103}]},
    {circuits:[{...circuit,switchIds:[103]}]},
    {circuits:[circuit,{elementIds:[104],panelId:103}]},
    {panelSchedules:[{panelId:103,name:'Panel',code:'unsafe'}]}
  ])assert.throws(()=>parseElectricalCircuitInput(input),JSON.stringify(input));
});

test('circuit adapter maps panel distribution, existing circuit names, circuit creation and panel schedules in deterministic order',()=>{
  const ops=electricalCircuitOperations({panelDistributionSystems:[{panelId:103,distributionSystemId:105}],parameterChanges:[{elementId:201,parameter:'BIP:RBS_ELEC_CIRCUIT_NAME',value:'Renamed'}],circuits:[circuit],panelSchedules:[{panelId:103,name:'AL1表'}]});
  assert.deepEqual(ops.map(op=>op.operationType),['set_parameter','set_parameter','create_circuit','create_panel_schedule']);
  assert.deepEqual(ops[0],{operationType:'set_parameter',id:'panelDistribution1',elementId:103,parameter:'BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM',value:105});
  assert.equal(ops[1].parameter,'BIP:RBS_ELEC_CIRCUIT_NAME');
  assert.deepEqual(ops[2],{...circuit,operationType:'create_circuit',id:'circuit1'});
});

test('circuit input rejects guessed or unsafe scope before native reads',()=>{
  for(const input of [
    {circuits:[{...circuit,elementIds:[101,101]}]},
    {circuits:[{...circuit,panelId:101}]},
    {circuits:[{...circuit,switchIds:[101]}]},
    {circuits:[{...circuit,code:'unsafe'}]},
    {circuits:[{...circuit,name:' '}]},
    {parameterChanges:[{elementId:201,parameter:'Comments',value:'bad'}]},
    {panelDistributionSystems:[{panelId:103,distributionSystemId:105}],parameterChanges:[{elementId:103,parameter:'BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM',value:105}]},
    {operations:[{operationType:'delete_element',elementId:1}]}
  ])assert.throws(()=>parseElectricalCircuitInput(input));
});

test('circuit scope inspection verifies panel, distribution type, electrical members, switches and no existing assignment',async()=>{
  const calls=[];const call=async(method,args)=>{calls.push({method,args});return {items:args.elementIds.map(id=>items.find(item=>item.summary.id===id))};};
  const result=await inspectElectricalCircuitScope({circuits:[circuit],panelDistributionSystems:[{panelId:103,distributionSystemId:105}]},call);
  assert.equal(result.selectedScopeVerified,true);assert.equal(result.inspectedElementCount,5);assert.deepEqual(calls[0].args.elementIds.sort((a,b)=>a-b),[101,102,103,104,105]);
});

test('circuit scope rejects wrong native types, missing electrical connectors and existing memberships',async()=>{
  const mutate=async(patch)=>{const next=items.map(item=>item.summary.id===patch.id?{...item,...patch}:item);const call=async(_,args)=>({items:args.elementIds.map(id=>next.find(item=>item.summary.id===id))});await assert.rejects(inspectElectricalCircuitScope({circuits:[circuit]},call));};
  await mutate({id:103,summary:{id:103,className:'Wall',categoryId:-2000011}});
  await mutate({id:101,connectors:[]});
  await mutate({id:101,electrical:{systemIds:[900]}});
});

test('circuit scope never treats unknown load or switch membership as unassigned and enforces switch category',async()=>{
  for(const [id,patch,code] of [
    [101,{electrical:undefined},'circuit_membership_unknown'],
    [101,{electrical:{systemIds:null}},'circuit_membership_unknown'],
    [101,{electrical:{systemIds:'unknown'}},'circuit_membership_unknown'],
    [101,{electrical:{systemIds:[-1]}},'circuit_membership_unknown'],
    [104,{electrical:undefined},'circuit_membership_unknown'],
    [104,{electrical:{systemIds:[900]}},'circuit_member_already_assigned'],
    [104,{summary:{id:104,className:'FamilyInstance',categoryId:-2001040}},'circuit_switch_mismatch']
  ]){
    const call=async(_,args)=>({items:args.elementIds.map(key=>{const item=items.find(i=>i.summary.id===key);return key===id?{...item,...patch}:item;})});
    await assert.rejects(inspectElectricalCircuitScope({circuits:[circuit]},call),e=>e.code===code);
  }
});

test('both distribution input forms inspect native type and expose verified before/after and no-op',async()=>{
  for(const input of [
    {panelDistributionSystems:[{panelId:103,distributionSystemId:105}]},
    {parameterChanges:[{elementId:103,parameter:'BIP:RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM',value:105}]}
  ]){
    const calls=[];
    const call=async(_,args)=>{calls.push(args);return {items:args.elementIds.map(id=>items.find(i=>i.summary.id===id))};};
    const result=await inspectElectricalCircuitScope(input,call);
    assert.deepEqual(calls[0].elementIds,[103,105]);
    const review=(result.panelDistributionSystems.length?result.panelDistributionSystems:result.parameterChanges)[0];
    assert.equal(review.before,105);assert.equal(review.after,105);assert.equal(review.noOp,true);
    for(const patch of [
      {id:105,summary:{id:105,className:'ElementType',categoryId:-2008041}},
      {id:103,parameters:[]},
      {id:103,parameters:[{...items[2].parameters[0],readOnly:true}]},
      {id:103,parameters:[{...items[2].parameters[0],valueSupported:false}]},
      {id:103,parameters:[{...items[2].parameters[0],value:undefined}]}
    ]){
      await assert.rejects(inspectElectricalCircuitScope(input,async(_,args)=>({items:args.elementIds.map(id=>{const item=items.find(i=>i.summary.id===id);return id===patch.id?{...item,...patch}:item;})})));
    }
  }
});

test('existing circuit names distinguish known empty values from missing or unsupported baselines',async()=>{
  const row={elementId:201,parameter:'BIP:RBS_ELEC_CIRCUIT_NAME',value:'Reviewed'};
  const baseline={id:-1140089,storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'Original'};
  const inspect=parameters=>async()=>({items:[{summary:{id:201,className:'ElectricalSystem'},parameters}]});
  const known=await inspectElectricalCircuitScope({parameterChanges:[row]},inspect([baseline]));
  assert.equal(known.parameterChanges[0].before,'Original');assert.equal(known.parameterChanges[0].noOp,false);
  const empty=await inspectElectricalCircuitScope({parameterChanges:[row]},inspect([{...baseline,hasValue:false,value:undefined}]));
  assert.equal(empty.parameterChanges[0].before,null);assert.equal(empty.parameterChanges[0].beforeHasValue,false);
  const same=await inspectElectricalCircuitScope({parameterChanges:[{...row,value:'Original'}]},inspect([baseline]));
  assert.equal(same.parameterChanges[0].noOp,true);
  for(const parameters of [[],[baseline,baseline],[{...baseline,storageType:'Integer'}],[{...baseline,readOnly:true}],[{...baseline,valueSupported:false}],[{...baseline,hasValue:undefined}],[{...baseline,value:undefined}]]){
    await assert.rejects(inspectElectricalCircuitScope({parameterChanges:[row]},inspect(parameters)),e=>e.code==='circuit_name_parameter_unknown');
  }
});

test('circuit native inspection rejects duplicate, unexpected and missing element evidence without retry',async()=>{
  const input={circuits:[{elementIds:[101],panelId:103}]};
  for(const response of [null,{items:[]},{items:[items[0],items[0]]},{items:[items[0],items[1]]},{items:[items[0],{id:103,exists:false}]}]){
    let count=0;
    await assert.rejects(inspectElectricalCircuitScope(input,async()=>{count++;return response;}),e=>e.code==='circuit_scope_unknown');
    assert.equal(count,1);
  }
});

test('panel schedule scope verifies the explicit panel and cancellation prevents any native read',async()=>{
  const input={panelSchedules:[{panelId:103,name:'Reviewed panel'}]};
  const review=await inspectElectricalCircuitScope(input,async(_,args)=>({items:args.elementIds.map(id=>items.find(i=>i.summary.id===id))}));
  assert.equal(review.inspectedElementCount,1);
  await assert.rejects(inspectElectricalCircuitScope(input,async()=>({items:[{summary:{id:103,className:'Wall'}}]})),e=>e.code==='circuit_scope_mismatch');
  const controller=new AbortController();controller.abort();let count=0;
  await assert.rejects(inspectElectricalCircuitScope(input,async()=>{count++;},controller.signal));assert.equal(count,0);
});

test('circuit inspection batches explicit scopes and refuses partial native results',async()=>{
  const many={elementIds:Array.from({length:101},(_,i)=>1000+i),panelId:2000};
  const call=async(_,args)=>({items:args.elementIds.map(id=>({summary:{id,className:'FamilyInstance',categoryId:id===2000?-2001040:-2001120},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]},parameters:[]}))});
  const result=await inspectElectricalCircuitScope({circuits:[many]},call);assert.equal(result.inspectedElementCount,102);
  const partial=async(_,args)=>({items:args.elementIds.slice(0,-1).map(id=>({summary:{id,className:'FamilyInstance',categoryId:-2001120},connectors:[{domain:'DomainElectrical',domainSupported:true}],electrical:{systemIds:[]},parameters:[]}))});
  await assert.rejects(inspectElectricalCircuitScope({circuits:[circuit]},partial),e=>e.code==='circuit_scope_unknown');
});
