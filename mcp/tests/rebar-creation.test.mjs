import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRebarCreation,requireRebarHostFeature} from '../rebar-creation.mjs';
const point=(xMm=0,yMm=0,zMm=3000)=>({xMm,yMm,zMm});
const straight=()=>({operationType:'create_rebar_set',hostElementId:10,barTypeId:20,start:point(),end:point(2000,0,4200),normal:{x:0,y:1,z:0},layout:{rule:'Single'}});
const stirrup=()=>({operationType:'create_rebar_stirrup',hostElementId:10,barTypeId:20,shapeId:30,origin:point(),xDirection:{x:1,y:0,z:0},yDirection:{x:0,y:0,z:1},layout:{rule:'Single'}});
const fixed=()=>({rule:'FixedNumber',quantity:5,arrayLengthMm:1000,barsOnNormalSide:false,includeFirstBar:true,includeLastBar:false});
const maximum=()=>({rule:'MaximumSpacing',spacingMm:200,arrayLengthMm:1000,barsOnNormalSide:true,includeFirstBar:false,includeLastBar:true});
const reject=op=>assert.throws(()=>validateRebarCreation(op),error=>error.code==='invalid_rebar_creation');
test('rebar accepts explicit sloping XYZ and vertical stirrup basis without mutation',()=>{
 for(const source of [straight(),stirrup()])for(const layout of [{rule:'Single'},fixed(),maximum()]){const op={...source,layout},before=structuredClone(op);assert.equal(validateRebarCreation(op),op);assert.deepEqual(op,before);}
 const vertical=straight();vertical.end=point(0,0,9000);vertical.normal={x:1,y:0,z:0};validateRebarCreation(vertical);
});
test('IDs require existing positive safe integers and coordinates require every finite bounded axis',()=>{
 for(const source of [straight(),stirrup()]){
  for(const field of ['hostElementId','barTypeId',...(source.shapeId?['shapeId']:[])])for(const value of [null,0,-1,1.2,'@earlier',{},Number.MAX_SAFE_INTEGER+1])reject({...source,[field]:value});
  for(const field of source.shapeId?['origin']:['start','end'])for(const axis of ['xMm','yMm','zMm'])for(const value of [null,undefined,'0',NaN,Infinity,1e8+1])reject({...source,[field]:{...source[field],[axis]:value}});
 }
 reject({...straight(),start:{xMm:0,yMm:0}});reject({...stirrup(),origin:{...point(),z:0}});
});
test('normal and basis are explicit near-unit finite orthogonal complete vectors',()=>{
 for(const field of ['normal','xDirection','yDirection']){const source=field==='normal'?straight():stirrup();for(const value of [null,{}, {x:0,y:0,z:0},{x:2,y:0,z:0},{x:1,y:0},{x:1,y:0,z:0,w:1},{x:Infinity,y:0,z:0}])reject({...source,[field]:value});}
 reject({...straight(),normal:{x:1,y:0,z:0}});reject({...stirrup(),yDirection:{x:1,y:0,z:0}});
 reject({...straight(),end:{...straight().start}});reject({...straight(),end:point(0.5,0,3000)});
});
test('layout rules use exact spelling and disjoint explicit fields',()=>{
 for(const layout of [undefined,null,{}, {rule:'single'},{rule:'FIxedNumber'},{rule:'Single',quantity:1},{rule:'Single',spacingMm:100}, {...fixed(),spacingMm:10},{...maximum(),quantity:4}])reject({...straight(),layout});
 for(const source of [fixed(),maximum()])for(const field of ['arrayLengthMm','barsOnNormalSide','includeFirstBar','includeLastBar']){const layout={...source};delete layout[field];reject({...stirrup(),layout});}
 for(const source of [fixed(),maximum()])for(const field of ['barsOnNormalSide','includeFirstBar','includeLastBar'])for(const value of [null,0,'true'])reject({...straight(),layout:{...source,[field]:value}});
});
test('layout count bounds include excluded endpoints and prevent empty sets',()=>{
 for(const quantity of [null,1,1.5,1001])reject({...straight(),layout:{...fixed(),quantity}});
 for(const arrayLengthMm of [null,0,-1,1e8+1,Infinity])reject({...straight(),layout:{...fixed(),arrayLengthMm}});
 for(const spacingMm of [null,0,-1,1e8+1,Infinity])reject({...straight(),layout:{...maximum(),spacingMm}});
 reject({...straight(),layout:{...maximum(),spacingMm:1,arrayLengthMm:1000}});
 validateRebarCreation({...straight(),layout:{...maximum(),spacingMm:1,arrayLengthMm:999}});
 reject({...straight(),layout:{...fixed(),quantity:2,includeFirstBar:false,includeLastBar:false}});
 validateRebarCreation({...straight(),layout:{...fixed(),quantity:1000}});
});
test('unknown fields and null/duplicate/self metadata cannot smuggle unreviewed defaults',()=>{
 for(const extra of [{style:'Standard'},{hookTypeId:30},{parameters:{}},{spacingMm:100},{shapeId:30},{normal:null}])reject({...straight(),...extra});
 for(const id of [null,'',' padded','bad\nname',5])reject({...straight(),id});
 for(const dependencies of [null,{},'earlier',['x','x'],['self'],[null],Array(1001).fill('x')])reject({...straight(),id:'self',dependencies});
 validateRebarCreation({...straight(),id:'rebar1',dependencies:['earlier']});
});
test('straight new-shape creation requires an explicit boolean opt-in and is not valid for stirrups',()=>{
 for(const allowNewShape of [true,false]){const op={...straight(),allowNewShape};assert.equal(validateRebarCreation(op),op);}
 for(const allowNewShape of [null,undefined,0,'true',{}])reject({...straight(),allowNewShape});
 reject({...stirrup(),allowNewShape:true});
});
test('native feature gate is one read and makes no plan or write request',async()=>{
 const signal=new AbortController().signal,calls=[];
 const call=async(method,args,actualSignal)=>{calls.push({method,args});assert.equal(actualSignal,signal);return{features:['controlled-rebar-creation'],moduleVersionId:'candidate'};};
 assert.deepEqual(await requireRebarHostFeature(call,signal),{requiredFeature:'controlled-rebar-creation',moduleVersionId:'candidate',nativeAcceptance:false});
 assert.deepEqual(calls,[{method:'revit.bridge.info',args:{}}]);
 for(const host of [null,{}, {features:[]},{features:['controlled-structural-elements']}])await assert.rejects(requireRebarHostFeature(async()=>host),error=>error.code==='rebar_native_feature_unavailable');
});
