import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySinglePipeRouteCreation} from '../pipe-route-verification.mjs';

const fixture=()=>{
 const point=x=>({xMm:x,yMm:5000,zMm:1000});
 const port=(id,x)=>({connectorId:id,connectorType:'End',domainSupported:true,domain:'DomainPiping',shapeSupported:true,shape:'Round',originSupported:true,...point(x),connectionStatusSupported:true,connected:false});
 return {
  plan:{planId:'pipe-plan',documentIdentity:'pipe-doc',documentRevision:3,operations:[{operationType:'create_pipe',id:'route-1',pipeTypeId:10,systemTypeId:20,levelId:30,diameterMm:80,start:point(0),end:point(4000)}]},
  receipt:{planId:'pipe-plan',status:'committed',completedOperationCount:1,saved:false,createdElementIds:[400],references:{'route-1':400},nativeChanges:{documentIdentity:'pipe-doc',startRevision:3,endRevision:4,captureComplete:true}},
  beforeContext:{active:true,document:{identity:'pipe-doc',path:'C:/test/isolated.rvt',revision:3,isModified:false},counts:{OST_PipeCurves:7,OST_Wire:57}},
  afterContext:{active:true,document:{identity:'pipe-doc',path:'C:/test/isolated.rvt',revision:4,isModified:true},counts:{OST_PipeCurves:8,OST_Wire:57}},
  pipe:{summary:{id:400,className:'Pipe',categoryId:-2008044,typeId:10,levelId:30,location:{kind:'curve',curveType:'Line',start:point(0),end:point(4000)}},piping:{systemTypeId:20,systemClassification:'SupplyHydronic',diameterMm:80},connectors:[port(44,4000),port(9,0)]},
  systemType:{summary:{id:20,className:'PipingSystemType'},piping:{systemTypeId:20,systemClassification:'SupplyHydronic'}}
 };
};

test('single pipe route verifies native geometry and assigned type without predicting connector IDs',()=>{
 const input=fixture(),original=structuredClone(input);
 const result=verifySinglePipeRouteCreation(input);
 assert.equal(result.pipeId,400);assert.equal(result.lengthMm,4000);assert.equal(result.diameterMm,80);
 assert.deepEqual(result.connectorIds,{start:9,end:44});
 assert.equal(result.systemClassification,'SupplyHydronic');assert.equal(result.allModelSideEffectsVerified,false);
 assert.equal(result.hydraulicDirectionVerified,false);assert.deepEqual(input,original);
});

test('single pipe route rejects wrong geometry, classifications, ports and unrelated model changes',()=>{
 for(const mutate of [
  v=>{v.pipe.summary.typeId=99;},v=>{v.pipe.summary.categoryId=-1;},v=>{v.pipe.summary.levelId=31;},
  v=>{delete v.plan.operations[0].pipeTypeId;delete v.pipe.summary.typeId;},
  v=>{delete v.plan.operations[0].levelId;delete v.pipe.summary.levelId;},
  v=>{delete v.plan.operations[0].systemTypeId;delete v.systemType.summary.id;delete v.systemType.piping.systemTypeId;delete v.pipe.piping.systemTypeId;},
  v=>{v.pipe.piping.diameterMm=100;},v=>{v.pipe.piping.diameterMm=NaN;},
  v=>{v.plan.operations[0].diameterMm=0.001;v.pipe.piping.diameterMm=0;},
  v=>{v.pipe.summary.location.end.zMm+=10;},v=>{v.pipe.summary.location.curveType='Arc';},
  v=>{delete v.pipe.piping.systemTypeId;},v=>{v.pipe.piping.systemClassification='ReturnHydronic';},
  v=>{delete v.systemType.piping.systemClassification;},v=>{v.systemType.summary.className='MechanicalSystemType';},
  v=>{v.pipe.connectors.pop();},v=>{v.pipe.connectors[0].originSupported=false;},
  v=>{v.pipe.connectors={};},v=>{v.pipe.connectors[0]=null;},
  v=>{v.pipe.connectors[0].xMm+=100;},v=>{v.pipe.connectors[0].connectorId=9;},
  v=>{v.afterContext.counts.OST_Wire++;},v=>{v.afterContext.document.identity='other';},
  v=>{v.afterContext.document.path='C:/other.rvt';},v=>{v.receipt.nativeChanges.endRevision=5;},
  v=>{v.receipt.saved=true;},v=>{v.receipt.references['route-1']=401;},
  v=>{v.plan.operations.push({...v.plan.operations[0],id:'extra'});}
 ]){const input=fixture();mutate(input);assert.throws(()=>verifySinglePipeRouteCreation(input),{code:'pipe_route_not_verified'});}
});

test('single pipe route retains unknown connectivity and incomplete native event coverage',()=>{
 const input=fixture();input.pipe.connectors[0].connectionStatusSupported=false;delete input.pipe.connectors[0].connected;
 input.receipt.nativeChanges.captureComplete=false;
 const result=verifySinglePipeRouteCreation(input);
 assert.equal(result.endpointConnections.end.known,false);assert.equal(result.endpointConnections.end.connected,null);
 assert.equal(result.nativeCaptureComplete,false);assert.equal(result.allModelSideEffectsVerified,false);
});
