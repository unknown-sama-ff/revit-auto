import test from 'node:test';
import assert from 'node:assert/strict';
import {mapRows,parseDelimited,importInput} from '../imports.mjs';
import {previewParameterImport} from '../parameter-import.mjs';

const level=(id,name='Reviewed level')=>({operationType:'create_level',id,name,elevationMm:0});
const pipe=(id='pipe1')=>({operationType:'create_pipe',id,pipeTypeId:11,systemTypeId:12,levelId:13,diameterMm:80,start:{xMm:0,yMm:0,zMm:1000},end:{xMm:1000,yMm:0,zMm:1000}});
const selector=point=>({domain:'DomainPiping',shape:'Round',point,toleranceMm:1});

test('reports structural errors on every source row and never returns the valid subset',()=>{
  const result=mapRows([
    level('ok'),
    {operationType:'create_level',name:'Missing elevation'},
    {operationType:'create_sheet',number:'E101'},
    {operationType:'create_wall',wallTypeId:11,start:{xMm:0,yMm:0},end:{xMm:1000,yMm:0},heightMm:-1},
    {operationType:'unknown_model_write'}
  ]);
  assert.deepEqual(result.operations,[]);
  assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[3,'elevationMm'],[4,'name'],[5,'heightMm'],[6,'operationType']]);
});

test('numeric formulas, nonfinite conversion and invalid JSON identify row and destination field',()=>{
  const result=mapRows([
    {operationType:'create_family_instance',symbolId:'=1+2',xMm:'not a number',yMm:0,parameters:'{bad'},
    {operationType:'create_level',name:'Formula',elevationMm:'=SUM(1,2)'},
    {operationType:'create_level',name:'Overflow',elevationMm:'1e999'},
    {operationType:'create_floor',floorTypeId:5,boundary:'[bad]'}
  ]);
  assert.deepEqual(result.operations,[]);
  assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[2,'symbolId'],[2,'xMm'],[2,'parameters'],[3,'elevationMm'],[4,'elevationMm'],[5,'boundary']]);
  assert.ok(result.issues.filter(issue=>['parameters','boundary'].includes(issue.field)).every(issue=>/invalid JSON/.test(issue.message)));
});

test('nested geometry validation locates the failing point field',()=>{
  const result=mapRows([
    {operationType:'create_grid',name:'AX-1',start:{xMm:0,yMm:0},end:{xMm:'bad',yMm:0}},
    {operationType:'create_family_instance',symbolId:3,point:{xMm:NaN,yMm:0}},
    {operationType:'create_floor',floorTypeId:4,boundary:[{xMm:0,yMm:0},{xMm:100,yMm:0},{xMm:100}]}
  ]);
  assert.deepEqual(result.operations,[]);
  assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[2,'end.xMm'],[3,'point.xMm'],[4,'boundary.2.yMm']]);
});

test('mapping errors cover all missing columns on each row with destination and source names',()=>{
  const result=mapRows([{label:'A'},{height:'2000'},{label:'C',height:'bad'}],{name:'label',elevationMm:'height'},{operationType:'create_level'});
  assert.deepEqual(result.operations,[]);
  assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field,issue.column]),[[2,'elevationMm','height'],[3,'name','label'],[4,'elevationMm',undefined]]);
});

test('malformed mapping, defaults and nonobject rows are rejected as structured issues',()=>{
  assert.deepEqual(mapRows([{}],null).issues.map(issue=>issue.field),['mapping']);
  assert.deepEqual(mapRows([{}],{},[]).issues.map(issue=>issue.field),['defaults']);
  const result=mapRows([null,[],false]);assert.deepEqual(result.operations,[]);assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[2,'row'],[3,'row'],[4,'row']]);
});

test('valid prior references, dependencies and JSON ID arrays retain original operations',()=>{
  const rows=[
    level('L'),
    {operationType:'create_room',id:'R',levelId:'@L',xMm:'1000',yMm:'1000',name:'Room',number:'101',dependencies:['L']},
    {operationType:'create_family_instance',id:'light',symbolId:'21',levelId:'@L',xMm:'1000',yMm:'1000',zMm:'3000'},
    {operationType:'create_circuit',elementIds:'["@light"]',panelId:'23'}
  ];
  const result=mapRows(rows);
  assert.deepEqual(result.issues,[]);assert.equal(result.operations.length,4);
  assert.equal(result.operations[1].levelId,'@L');assert.deepEqual(result.operations[1].dependencies,['L']);
  assert.deepEqual(result.operations[3].elementIds,['@light']);assert.equal(result.operations[3].panelId,23);
  assert.ok(result.operations.every(operation=>operation.name!=='table-reference-validation'));
});

test('forward and nonexistent references identify source rows instead of being guessed',()=>{
  const result=mapRows([
    {operationType:'create_room',levelId:'@later',xMm:0,yMm:0},
    level('later'),
    {operationType:'create_family_instance',symbolId:'@missing',xMm:0,yMm:0},
    {operationType:'create_room',levelId:'@later',xMm:0,yMm:0,dependencies:['missing']}
  ]);
  assert.deepEqual(result.operations,[]);
  assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[2,'levelId'],[4,'symbolId'],[5,'dependencies']]);
});

test('all duplicate operation IDs retain row attribution and block the entire table',()=>{
  const result=mapRows([level('L'),level('L','Duplicate one'),level('L','Duplicate two')]);
  assert.deepEqual(result.operations,[]);assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[3,'id'],[4,'id']]);
});

test('full plan still detects connector reservations shared by otherwise valid rows',()=>{
  const result=mapRows([
    {operationType:'connect_elements',firstElementId:1,firstConnectorId:0,secondElementId:2,secondConnectorId:0},
    {operationType:'connect_elements',firstElementId:1,firstConnectorId:0,secondElementId:3,secondConnectorId:0}
  ]);
  assert.deepEqual(result.operations,[]);assert.equal(result.issues[0].row,3);assert.match(result.issues[0].message,/occupied/);
});

test('full plan retains new-curve endpoint resolution rather than treating prior IDs as existing elements',()=>{
  const result=mapRows([
    pipe(),
    {operationType:'connect_elements',firstElementId:'@pipe1',firstConnectorId:0,secondElementId:4,secondConnectorId:0}
  ]);
  assert.deepEqual(result.operations,[]);assert.equal(result.issues[0].row,3);assert.match(result.issues[0].message,/New pipe\/duct endpoint requires criteria/);
});

test('valid new-curve criteria succeed, but repeated endpoint criteria fail at the original row',()=>{
  const connection={operationType:'connect_elements',firstElementId:'@pipe1',firstConnector:selector({xMm:1000,yMm:0,zMm:1000}),secondElementId:4,secondConnectorId:0};
  assert.deepEqual(mapRows([pipe(),connection]).issues,[]);
  const result=mapRows([pipe(),connection,{...connection,secondElementId:5}]);
  assert.deepEqual(result.operations,[]);assert.equal(result.issues[0].row,4);assert.match(result.issues[0].message,/occupied/);
});

test('CSV source row offsets include the header and error reports survive importInput',async()=>{
  const rows=parseDelimited('operationType,name,elevationMm\ncreate_level,A,0\ncreate_level,B,bad\ncreate_level,C,=1+2\n');
  const result=await importInput({rows});assert.equal(result.candidateOnly,false);
  assert.deepEqual(result.operations,[]);assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[3,'elevationMm'],[4,'elevationMm']]);
});

test('parameter workflow returns the complete table report without creating any partial plan',async()=>{
  const calls=[];
  const result=await previewParameterImport({documentIdentity:'doc-a',input:{rows:[level('ok'),{operationType:'create_level',name:'Bad'}, {operationType:'create_sheet',number:'E101'}, {operationType:'create_circuit',elementIds:[],panelId:8}]}},async method=>{
    calls.push(method);assert.equal(method,'revit.context.get');return {active:true,document:{identity:'doc-a',revision:0,path:'C:\\test.rvt',isModified:false}};
  });
  assert.equal(result.planCreated,false);assert.deepEqual(result.operations,[]);
  assert.deepEqual(result.issues.map(issue=>issue.row),[3,4,5]);assert.deepEqual(calls,['revit.context.get','revit.context.get']);
});

test('sparse input rows and malformed dependency collections have explicit source locations',()=>{
  const sparse=[];sparse.length=2;sparse[1]=level('ok');
  const missing=mapRows(sparse);assert.deepEqual(missing.operations,[]);assert.deepEqual(missing.issues.map(issue=>[issue.row,issue.field]),[[2,'row']]);
  const result=mapRows([{operationType:'create_family_instance',symbolId:1,xMm:0,yMm:0,dependencies:3}]);
  assert.deepEqual(result.operations,[]);assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[2,'dependencies']]);
});

test('dependency JSON is parsed, but strings never become character-wise dependencies',()=>{
  const valid=mapRows([level('L'),{operationType:'create_room',levelId:'@L',xMm:0,yMm:0,name:'Room',number:'101',dependencies:'["L"]'}]);
  assert.deepEqual(valid.issues,[]);assert.deepEqual(valid.operations[1].dependencies,['L']);
  for(const dependencies of ['"L"','L',{},false]){
    const result=mapRows([level('L'),{operationType:'create_room',levelId:'@L',xMm:0,yMm:0,dependencies}]);
    assert.deepEqual(result.operations,[]);assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[3,'dependencies']]);
  }
});

test('connector geometry JSON retains nested numeric error locations',()=>{
  const result=mapRows([{operationType:'connect_elements',firstElementId:1,firstConnector:JSON.stringify(selector({xMm:'bad',yMm:0,zMm:0})),secondElementId:2,secondConnectorId:0}]);
  assert.deepEqual(result.operations,[]);assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[2,'firstConnector.point.xMm']]);
});

test('mapping prototype keys are reported rather than changing the operation object',()=>{
  const mapping=JSON.parse('{"__proto__":"payload"}');
  const result=mapRows([{payload:{operationType:'create_level',name:'Hidden',elevationMm:0}}],mapping);
  assert.deepEqual(result.operations,[]);assert.deepEqual(result.issues.map(issue=>[issue.row,issue.field]),[[2,'__proto__']]);
});
