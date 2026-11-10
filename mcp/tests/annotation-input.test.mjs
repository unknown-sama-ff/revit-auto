import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOperations} from '../workflows.mjs';
const tag=()=>({operationType:'create_tag',elementId:1,viewId:2,xMm:0,yMm:0});
const dimension=()=>({operationType:'create_dimension',viewId:2,start:{xMm:0,yMm:0},end:{xMm:100,yMm:0},references:['a','b']});
test('tag rejects ignored fields with bounded key-only spelling diagnostics',()=>{
 const op={...tag(),tagtypeid:4,hasLeader:true,ignored:'never-echo'};
 assert.throws(()=>validateOperations([op]),e=>e.code==='invalid_annotation_input'&&e.details.valuesIncluded===false&&
  e.details.unknown.some(k=>k.key==='tagtypeid'&&k.did_you_mean==='tagTypeId')&&!JSON.stringify(e.details).includes('never-echo'));
});
test('annotation optional type IDs reject explicit null and coercion',()=>{
 for(const value of [null,undefined,true,{},[],'','@']){
  assert.throws(()=>validateOperations([{...tag(),tagTypeId:value}]));
  assert.throws(()=>validateOperations([{...dimension(),dimensionTypeId:value}]));
 }
});
test('tag valid parameters mark and false leader are preserved without coercion',()=>{
 const op={...tag(),tagTypeId:3,leader:false,mark:'T',parameters:{Comments:'ok'}};
 assert.deepEqual(validateOperations([op]),[op]);
});
test('dimension rejects nonarray empty nonstring blank and duplicate references',()=>{
 for(const references of [undefined,null,'not-an-array',{},[],['a'],['a',null],[1,2],['','b'],[' ','b'],['a','a']])
  assert.throws(()=>validateOperations([{...dimension(),references}]),e=>e.code==='invalid_annotation_input');
});
test('dimension preserves distinct case-sensitive native references without cleanup',()=>{
 const op={...dimension(),references:['a','A'],dimensionTypeId:3,parameters:{},mark:'D'};
 assert.deepEqual(validateOperations([op]),[op]);
 assert.throws(()=>validateOperations([{...op,dimensionStyle:3}]),e=>e.code==='invalid_annotation_input');
});
test('dimension bounds references before native dispatch and preserves exact boundary strings',()=>{
 const refs=Array.from({length:128},(_,i)=>'ref-'+i);
 assert.doesNotThrow(()=>validateOperations([{...dimension(),references:refs}]));
 assert.throws(()=>validateOperations([{...dimension(),references:[...refs,'ref-129']}]),{code:'invalid_annotation_input'});
 const references=['x'.repeat(4096),'b'];assert.deepEqual(validateOperations([{...dimension(),references}])[0].references,references);
 assert.throws(()=>validateOperations([{...dimension(),references:['x'.repeat(4097),'b']}]),{code:'invalid_annotation_input'});
});
test('annotation operation ids and prior dependencies remain valid',()=>{
 const first={operationType:'create_level',id:'level',name:'L',elevationMm:0};
 assert.doesNotThrow(()=>validateOperations([first,{...tag(),id:'tag',dependencies:['level']} ]));
 assert.doesNotThrow(()=>validateOperations([{operationType:'duplicate_type',id:'t',sourceTypeId:3,name:'T'},{...tag(),tagTypeId:'@t'}]));
});
