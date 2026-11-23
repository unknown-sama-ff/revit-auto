import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCeilingCreation,requireCeilingHostFeature} from '../ceiling-creation.mjs';
const point=(xMm,yMm,zMm=6500)=>({xMm,yMm,zMm});
const operation=()=>({operationType:'create_ceiling',id:'ceiling1',dependencies:[],ceilingTypeId:10,levelId:20,boundary:[point(0,0),point(4000,0),point(4000,3000),point(0,3000)]});
const invalid=op=>assert.throws(()=>validateCeilingCreation(op),error=>error.code==='invalid_ceiling_creation');

test('ceiling accepts one explicit absolute XYZ polygon without mutating or flattening it',()=>{
 const op=operation(),before=structuredClone(op);assert.equal(validateCeilingCreation(op),op);assert.deepEqual(op,before);
 assert.doesNotThrow(()=>validateCeilingCreation({...op,boundary:[...op.boundary].reverse()}));
 assert.doesNotThrow(()=>validateCeilingCreation({...op,boundary:[point(0,0,-500),point(4000,0,-500),point(4000,3000,-500)]}));
 assert.doesNotThrow(()=>validateCeilingCreation({...op,ceilingTypeId:Number.MAX_SAFE_INTEGER,levelId:Number.MAX_SAFE_INTEGER}));
 const concave=[point(0,0),point(4000,0),point(4000,4000),point(2000,2000),point(0,4000)];assert.doesNotThrow(()=>validateCeilingCreation({...op,boundary:concave}));
});
test('ceiling rejects missing unsafe deferred or inferred native type and level IDs',()=>{
 for(const field of ['ceilingTypeId','levelId'])for(const value of [undefined,null,0,-1,1.5,'@new',Number.MAX_SAFE_INTEGER+1,NaN,Infinity])invalid({...operation(),[field]:value});
 for(const field of ['typeName','level','offsetMm','holes','curves','structural'])invalid({...operation(),[field]:field==='holes'?[]:1});
 invalid({...operation(),operationType:'create_roof'});invalid(null);
});
test('ceiling requires complete finite bounded XYZ with exact point fields',()=>{
 for(const value of [NaN,Infinity,-Infinity,1e8+1,'6500',null,undefined]){const op=operation();op.boundary[0].zMm=value;invalid(op);}
 for(const coordinate of ['xMm','yMm','zMm']){const op=operation();delete op.boundary[0][coordinate];invalid(op);}
 const extra=operation();extra.boundary[0].z=6500;invalid(extra);
 const tilted=operation();tilted.boundary[1].zMm+=0.011;invalid(tilted);
 for(const boundary of [undefined,[],[point(0,0),point(1,0)],Array(129).fill(point(0,0)),[[point(0,0),point(1,0),point(0,1)]]])invalid({...operation(),boundary});
});
test('ceiling rejects self intersections touching edges repeated closure collinearity and degeneracy',()=>{
 const polygons=[
  [point(0,0),point(4000,3000),point(4000,0),point(0,3000)],
  [...operation().boundary,point(0,0)],
  [point(0,0),point(2000,0),point(4000,0),point(4000,3000),point(0,3000)],
  [point(0,0),point(0.5,0),point(100,100)],
  [point(0,0),point(10,0),point(20,0)],
  [point(0,0),point(4000,0),point(4000,4000),point(2000,0),point(0,4000)]
 ];for(const boundary of polygons)invalid({...operation(),boundary});
});
test('ceiling metadata is explicit bounded distinct and cannot self depend',()=>{
 for(const id of ['', ' padded', 'bad\nname',4])invalid({...operation(),id});
 for(const dependencies of [null,['ceiling1'],['a','a'],[4],[''],Array(1001).fill('a')])invalid({...operation(),dependencies});
 assert.doesNotThrow(()=>validateCeilingCreation({...operation(),dependencies:['earlier']}));
});
test('ceiling host feature gate reports staged availability without creating plans',async()=>{
 const calls=[],signal=new AbortController().signal;
 const call=async(method,args,actualSignal)=>{calls.push({method,args});assert.equal(actualSignal,signal);return{features:['controlled-ceiling-creation'],moduleVersionId:'candidate'};};
 assert.deepEqual(await requireCeilingHostFeature(call,signal),{requiredFeature:'controlled-ceiling-creation',moduleVersionId:'candidate',nativeAcceptance:false});
 assert.deepEqual(calls,[{method:'revit.bridge.info',args:{}}]);
 for(const host of [null,{}, {features:[]},{features:['controlled-structural-elements']}])await assert.rejects(requireCeilingHostFeature(async()=>host),error=>error.code==='ceiling_native_feature_unavailable');
});
