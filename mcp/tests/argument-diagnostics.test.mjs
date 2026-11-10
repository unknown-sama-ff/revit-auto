import test from 'node:test';
import assert from 'node:assert/strict';
import {clipArgumentName,suggestArgumentName,describeArgumentKeys} from '../argument-diagnostics.mjs';
import {parseRuntimeDiagnosticArgs} from '../runtime-diagnostics.mjs';

test('ported naming vectors suggest canonical case and underscore spelling without correcting input',()=>{
 const expected=['documentIdentity','expectedRevision'];
 assert.equal(suggestArgumentName('DocumentIdentity',expected),'documentIdentity');
 assert.equal(suggestArgumentName('expected_revision',expected),'expectedRevision');
 assert.equal(suggestArgumentName('--EXPECTED_MVID',['--expected-mvid']),'--expected-mvid');
 assert.equal(suggestArgumentName('expectedRev',expected),null);
 const received=['DocumentIdentity'],copy=[...received];const r=describeArgumentKeys(received,expected,['documentIdentity']);
 assert.deepEqual(received,copy);assert.deepEqual(r.missing,['documentIdentity']);
 assert.deepEqual(r.unknown,[{key:'DocumentIdentity',did_you_mean:'documentIdentity'}]);
});
test('ambiguous normalized names never pick the first matching schema key',()=>{
 assert.equal(suggestArgumentName('ELEMENTID',['elementId','element_id']),null);
 assert.equal(suggestArgumentName('elementId',['elementId']),null);
 assert.equal(suggestArgumentName('---',['--expected-mvid']),null);
 assert.deepEqual(describeArgumentKeys(['ELEMENTID'],['elementId','element_id']).unknown,[{key:'ELEMENTID'}]);
});
test('key-only diagnostics retain exact missing names and explicit clipping counts',()=>{
 const r=describeArgumentKeys(Array.from({length:40},(_,i)=>'bad_'+i),['known'],['known']);
 assert.equal(r.unknown.length,32);assert.equal(r.counts.unknown,40);assert.equal(r.counts.received,40);
 assert.equal(r.keysTruncated,true);assert.equal(r.valuesIncluded,false);assert.deepEqual(r.missing,['known']);
 assert.throws(()=>describeArgumentKeys({secret:'do-not-log'},['known']),TypeError);
 assert.throws(()=>describeArgumentKeys([],['known'],['undeclared']),TypeError);
});
test('bounded diagnostic names do not split Unicode surrogate pairs',()=>{
 const name='A'.repeat(63)+'😀'+'tail',clipped=clipArgumentName(name);
 assert.equal(clipped,'A'.repeat(63));assert.equal(clipped.isWellFormed(),true);
 const r=describeArgumentKeys([name],['known']);assert.equal(r.namesClipped,true);assert.equal(r.unknown[0].key,clipped);
});
test('strict CLI rejection carries suggestions but never echoes a code value or accepts the alias',()=>{
 let failure;try{parseRuntimeDiagnosticArgs(['--EXPECTED_MVID','PRIVATE-VALUE-MARKER']);}catch(e){failure=e;}
 assert.equal(failure.code,'invalid_diagnostic_arguments');
 assert.deepEqual(failure.details.invalid_arguments.unknown,[{key:'--EXPECTED_MVID',did_you_mean:'--expected-mvid'}]);
 assert.ok(!JSON.stringify(failure.details).includes('PRIVATE-VALUE-MARKER'));
 let positional;try{parseRuntimeDiagnosticArgs(['PRIVATE-POSITIONAL-MARKER']);}catch(e){positional=e;}
 assert.ok(!JSON.stringify({message:positional.message,details:positional.details}).includes('PRIVATE-POSITIONAL-MARKER'));
});
test('missing duplicate and invalid-value failures retain named causes without raw values',()=>{
 for(const [args,key,value] of [
  [['--expected-mvid'],'missingValueFor','--expected-mvid'],
  [['--evidence','--evidence'],'duplicate','--evidence']]){
  assert.throws(()=>parseRuntimeDiagnosticArgs(args),e=>e.code==='invalid_diagnostic_arguments'&&e.details[key]===value);
 }
 assert.throws(()=>parseRuntimeDiagnosticArgs(['--expected-mvid','PRIVATE-INVALID-UUID']),e=>{
  assert.equal(e.details.valueErrors[0].field,'expectedMvid');
  assert.ok(!JSON.stringify(e.details).includes('PRIVATE-INVALID-UUID'));return true;
 });
});
