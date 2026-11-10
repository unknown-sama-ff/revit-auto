import test from 'node:test';
import assert from 'node:assert/strict';
import {readFinalArchitectureCopyVerification,assertCopyContextTypeSample} from '../architecture-copy-verification.mjs';

const fixture=()=>({copiedTypes:{completedCopyCount:1,reviewedCopyCount:1,reviewedCopiesComplete:true,
  sourceBaselinesComplete:true,sourceTypesUnchanged:true,copiedDimensionsVerified:true,
  verifiedBeforeTransactionCommit:true,sideEffectsVerified:false,copies:[{createdTypeId:123}]},
  copiedPlacementCount:0,actualPlacedTypesVerifiedBeforeCommit:true});
test('final copy receipt reads the native ModelExecutor wrapper',()=>{
  const native=fixture();assert.equal(readFinalArchitectureCopyVerification(native,1,0),native.copiedTypes);
});
test('flattened service result cannot replace the final native wrapper',()=>{
  const native=fixture();assert.throws(()=>readFinalArchitectureCopyVerification(native.copiedTypes,1,0));
  assert.throws(()=>readFinalArchitectureCopyVerification({...native,copiedTypes:undefined},1,0));
});
test('missing final checks or unexpected placement cannot pass a copy-only receipt',()=>{
  for(const mutate of [row=>row.copiedPlacementCount=1,row=>row.actualPlacedTypesVerifiedBeforeCommit=false,
    row=>row.copiedTypes.verifiedBeforeTransactionCommit=false,row=>row.copiedTypes.sourceTypesUnchanged=false,
    row=>row.copiedTypes.completedCopyCount=0,row=>row.copiedTypes.copies=[],row=>row.copiedTypes.sideEffectsVerified=true]){
    const native=fixture();mutate(native);assert.throws(()=>readFinalArchitectureCopyVerification(native,1,0));
  }
});
test('a capped context sample stays unchanged while full type pagination proves the copy',()=>{
  const before=Array.from({length:400},(_,index)=>({id:index+1,name:'T'+index}));
  assert.deepEqual(assertCopyContextTypeSample(structuredClone(before),before,501),{
    sampleLimit:400,sampleCapped:true,newTypePresent:false,fullMembershipVerificationRequired:true});
  const changed=structuredClone(before);changed[3].name='Changed';assert.throws(()=>assertCopyContextTypeSample(changed,before,501));
});
test('an uncapped context sample must include exactly the new type and all prior rows',()=>{
  const before=[{id:1,name:'Existing'}],next=[...before,{id:501,name:'Copy'}];
  assert.equal(assertCopyContextTypeSample(next,before,501).newTypePresent,true);
  assert.throws(()=>assertCopyContextTypeSample(before,before,501));
  assert.throws(()=>assertCopyContextTypeSample([{id:1,name:'Changed'},next[1]],before,501));
});
test('malformed oversized duplicate or preexisting context samples cannot prove a new type',()=>{
  assert.throws(()=>assertCopyContextTypeSample([{id:1},{id:1}],[],1));
  assert.throws(()=>assertCopyContextTypeSample([{id:1}],[{id:1}],1));
  assert.throws(()=>assertCopyContextTypeSample([],Array.from({length:401},(_,index)=>({id:index+1})),501));
});
