import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySinglePipeConnection,verifyPipeConnectionPersistence} from '../pipe-connection-verification.mjs';

const point = xMm => ({xMm,yMm:50000,zMm:1000});
const port = (elementId,connectorId,xMm,connected,peers=[]) => ({
  elementId,connectorId,connectorType:'End',domainSupported:true,domain:'DomainPiping',
  shapeSupported:true,shape:'Round',originSupported:true,...point(xMm),
  connectionStatusSupported:true,connected,peerReferencesSupported:true,peers
});
const pipe = (id,start,end,connectors,systemTypeId=20) => ({
  summary:{id,uniqueId:'native-'+id,className:'Pipe',categoryId:-2008044,typeId:10,levelId:30,
    location:{kind:'curve',curveType:'Line',start:point(start),end:point(end)}},
  piping:{systemTypeId,systemClassification:'SupplyHydronic',diameterMm:80},
  connectors
});

function fixture(){
  const beforeFirst=pipe(101,56000,60000,[port(101,0,56000,false),port(101,1,60000,false)]);
  const beforeSecond=pipe(202,60000,61921.8,[
    port(202,0,60000,false),port(202,1,61921.8,true,[{elementId:303,connectorId:1}])
  ]);
  const first=structuredClone(beforeFirst);
  const second=structuredClone(beforeSecond);
  first.connectors[1]=port(101,1,60000,true,[{elementId:202,connectorId:0}]);
  second.connectors[0]=port(202,0,60000,true,[{elementId:101,connectorId:1}]);
  return {
    plan:{planId:'connect-plan',documentIdentity:'doc-1',documentRevision:4,operations:[{
      operationType:'connect_elements',flowIntent:'neutral',firstElementId:101,
      firstConnector:{domain:'DomainPiping',shape:'Round',point:point(60000),toleranceMm:1},
      secondElementId:202,
      secondConnector:{domain:'DomainPiping',shape:'Round',point:point(60000),toleranceMm:1}
    }]},
    receipt:{planId:'connect-plan',status:'committed',completedOperationCount:1,saved:false,automaticSave:false,
      createdElementIds:[],nativeChanges:{documentIdentity:'doc-1',startRevision:4,endRevision:5,
        executionOutcome:'committed',observedAddedElementIds:[],observedModifiedElementIds:[101,202,400],
        observedDeletedElementIds:[500,501],captureComplete:true,netModelDiffVerified:false}},
    beforeContext:{active:true,document:{identity:'doc-1',path:'C:/test/isolated.rvt',revision:4,isModified:false}},
    afterContext:{active:true,document:{identity:'doc-1',path:'C:/test/isolated.rvt',revision:5,isModified:true}},
    beforeFirstPipe:beforeFirst,beforeSecondPipe:beforeSecond,firstPipe:first,secondPipe:second,
    systemDiagnostic:{documentIdentity:'doc-1',documentRevision:5,
      system:{element:{id:404,className:'PipingSystem',typeId:20},networkSupported:true,memberIds:[101,202,303],memberCount:3},
      members:[...[first,second].map(p=>({element:{...p.summary},
        location:{start:structuredClone(p.summary.location.start),end:structuredClone(p.summary.location.end)},
        connectors:p.connectors.map(c=>({...structuredClone(c),peersSupported:true}))})),
      {element:{id:303,className:'FamilyInstance'}}]}
  };
}

test('single pipe connection verifies reciprocal peers, preserved geometry and system membership but not side effects',()=>{
  const input=fixture();
  const result=verifySinglePipeConnection(input);
  assert.equal(result.status,'SINGLE_PIPE_CONNECTION_NATIVE_VERIFIED');
  assert.deepEqual(result.connectorIds,{first:1,second:0});
  assert.equal(result.reciprocalPeersVerified,true);
  assert.equal(result.systemId,404);
  assert.equal(result.systemTypeId,20);
  assert.deepEqual(result.systemMemberIds,[101,202,303]);
  assert.deepEqual(result.nativeChanges.deletedElementIds,[500,501]);
  assert.equal(result.sideEffectsVerified,false);
  assert.equal(result.persistenceVerified,false);
  assert.equal(result.hydraulicDirectionVerified,false);
});

test('rejects stale sessions, changed geometry, ambiguous criteria and asymmetric peers',()=>{
  const mutations=[
    v=>{v.afterContext.document.identity='other';},
    v=>{v.afterContext.document.revision=4;v.receipt.nativeChanges.endRevision=4;},
    v=>{v.firstPipe.summary.location.end.xMm+=10;},
    v=>{v.secondPipe.piping.diameterMm=100;},
    v=>{v.firstPipe.connectors[1].peers=[];},
    v=>{v.secondPipe.connectors[0].connected=false;},
    v=>{v.firstPipe.connectors.push(port(101,2,60000,true));},
    v=>{v.systemDiagnostic.system.memberIds=[101,303];v.systemDiagnostic.system.memberCount=2;},
    v=>{v.systemDiagnostic.system.memberIds=[101,202,202];},
    v=>{v.systemDiagnostic.system.element.typeId=21;},
    v=>{v.secondPipe.piping.systemTypeId=21;},
    v=>{v.receipt.createdElementIds=[900];}
  ];
  for(const mutate of mutations){
    const input=fixture();mutate(input);
    assert.throws(()=>verifySinglePipeConnection(input),{code:'pipe_connection_not_verified'});
  }
});

test('native additions are disclosed without upgrading full side-effect acceptance',()=>{
  const input=fixture();
  input.receipt.nativeChanges.observedAddedElementIds=[900];
  const result=verifySinglePipeConnection(input);
  assert.deepEqual(result.nativeChanges.addedElementIds,[900]);
  assert.equal(result.sideEffectsVerified,false);
});

test('unknown or occupied prewrite ports do not pass',()=>{
  for(const mutation of [
    v=>{v.beforeFirstPipe.connectors[1].connectionStatusSupported=false;},
    v=>{v.beforeFirstPipe.connectors[1].connected=true;v.beforeFirstPipe.connectors[1].peers=[{elementId:999,connectorId:0}];},
    v=>{v.plan.operations[0].firstConnector.toleranceMm=NaN;},
    v=>{v.plan.operations[0].flowIntent='unknown';},
    v=>{v.plan.operations[0].firstConnector.connectorId=8;}
  ]){
    const input=fixture();mutation(input);
    assert.throws(()=>verifySinglePipeConnection(input),{code:'pipe_connection_not_verified'});
  }
});

test('missing type and level evidence cannot compare equal by omission',()=>{
  const input=fixture();
  for(const pipe of [input.beforeFirstPipe,input.firstPipe]){
    delete pipe.summary.typeId;
    delete pipe.summary.levelId;
  }
  assert.throws(()=>verifySinglePipeConnection(input),{code:'pipe_connection_not_verified'});
});

test('a system member list without a pinned native diagnostic is not system evidence',()=>{
  const input=fixture();
  input.system={id:404,typeId:20,memberIds:[101,202,303],memberCount:3};
  delete input.systemDiagnostic;
  assert.throws(()=>verifySinglePipeConnection(input),{code:'pipe_connection_not_verified'});
});

test('system diagnostics from another document, revision or network cannot authorize acceptance',()=>{
  for(const mutate of [
    v=>{v.systemDiagnostic.documentIdentity='other';},
    v=>{v.systemDiagnostic.documentRevision=4;},
    v=>{v.systemDiagnostic.system.networkSupported=false;},
    v=>{v.systemDiagnostic.members.pop();},
    v=>{v.systemDiagnostic.members[0].connectors[1].peersSupported=false;},
    v=>{v.systemDiagnostic.members[0].location.end.zMm+=1;},
    v=>{v.systemDiagnostic.members[0].element.uniqueId='different';},
    v=>{v.systemDiagnostic.system.memberIds.push(999);v.systemDiagnostic.system.memberCount++;}
  ]){
    const input=fixture();mutate(input);
    assert.throws(()=>verifySinglePipeConnection(input),{code:'pipe_connection_not_verified'});
  }
});

test('rejects malformed or unknown physical endpoint evidence and non-finite geometry',()=>{
  for(const mutate of [
    v=>{v.firstPipe.connectors[0]=null;},
    v=>{v.firstPipe.connectors[0].elementId=202;},
    v=>{v.firstPipe.connectors[0].connected=undefined;},
    v=>{v.firstPipe.connectors[0].originSupported=false;},
    v=>{v.firstPipe.connectors[0].peers=[{elementId:0,connectorId:0}];},
    v=>{v.firstPipe.connectors[1].xMm=Infinity;},
    v=>{v.firstPipe.connectors.push({...v.firstPipe.connectors[1],connectorId:2,domainSupported:false});},
    v=>{v.beforeFirstPipe.summary.location.start.xMm=NaN;},
    v=>{v.firstPipe.summary.uniqueId='other-native';},
    v=>{for(const p of [v.beforeFirstPipe,v.firstPipe])p.piping.systemClassification='unknown';},
    v=>{v.receipt.nativeChanges.observedDeletedElementIds.push(101);},
    v=>{v.receipt.nativeChanges.observedAddedElementIds=[-1];}
  ]){
    const input=fixture();mutate(input);
    assert.throws(()=>verifySinglePipeConnection(input),{code:'pipe_connection_not_verified'});
  }
});

test('ID selectors use real origin/owner evidence and do not mutate their input',()=>{
  const input=fixture(),op=input.plan.operations[0];
  delete op.firstConnector;delete op.secondConnector;
  op.firstConnectorId=1;op.secondConnectorId=0;
  const original=structuredClone(input);
  assert.equal(verifySinglePipeConnection(input).reciprocalPeersVerified,true);
  assert.deepEqual(input,original);
  for(const mutate of [
    v=>{v.plan.operations[0].firstConnectorId=-1;},
    v=>{v.plan.operations[0].firstConnector=null;},
    v=>{for(const p of [v.beforeFirstPipe,v.firstPipe])p.connectors[1].xMm+=100;}
  ]){
    const changed=structuredClone(input);mutate(changed);
    assert.throws(()=>verifySinglePipeConnection(changed),{code:'pipe_connection_not_verified'});
  }
});

function persistenceFixture(){
  const input=fixture();
  const savedDocument=structuredClone(input.afterContext.document);savedDocument.isModified=false;
  const beforeContext={active:true,document:{...savedDocument,identity:'reopened',revision:0}};
  input.systemDiagnostic.documentIdentity='reopened';input.systemDiagnostic.documentRevision=0;
  return {plan:input.plan,savedDocument,
    savedConnection:{firstElementId:101,firstConnectorId:1,firstConnected:true,firstPeers:[{elementId:202,connectorId:0}],
      secondElementId:202,secondConnectorId:0,secondConnected:true,secondPeers:[{elementId:101,connectorId:1}]},
    beforeContext,afterContext:structuredClone(beforeContext),firstPipe:input.firstPipe,secondPipe:input.secondPipe,
    systemDiagnostic:input.systemDiagnostic};
}

test('reopened native relationship has a separate narrow persistence acceptance',()=>{
  const input=persistenceFixture(),original=structuredClone(input);
  const result=verifyPipeConnectionPersistence(input);
  assert.equal(result.status,'PIPE_CONNECTION_RELATION_PERSISTENCE_VERIFIED');
  assert.equal(result.persistenceVerified,true);
  assert.equal(result.fullSnapshotPersistenceVerified,false);
  assert.equal(result.sideEffectsVerified,false);
  assert.deepEqual(input,original);
});

test('persistence refuses an unchanged session, wrong file, unsaved state or changed saved relation',()=>{
  for(const mutate of [
    v=>{v.beforeContext.document.identity='doc-1';v.afterContext.document.identity='doc-1';},
    v=>{v.savedDocument.path='C:/wrong.rvt';},
    v=>{v.savedDocument.isModified=true;},
    v=>{v.afterContext.document.isModified=true;},
    v=>{v.afterContext.document.revision=1;},
    v=>{v.savedConnection.firstConnectorId=0;},
    v=>{v.savedConnection.firstPeers=[];},
    v=>{v.firstPipe.connectors[1].connected=false;},
    v=>{v.systemDiagnostic.documentRevision=5;}
  ]){
    const input=persistenceFixture();mutate(input);
    assert.throws(()=>verifyPipeConnectionPersistence(input),{code:'pipe_connection_not_verified'});
  }
});
