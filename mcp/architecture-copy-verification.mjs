import assert from 'node:assert/strict';

// ModelExecutor wraps ArchitectureTypeCopyService's result with placement
// verification. Reading the service result as the outer object loses evidence.
export function readFinalArchitectureCopyVerification(wrapper,copyCount,placementCount){
  assert.ok(wrapper&&typeof wrapper==='object'&&!Array.isArray(wrapper),'Missing final architecture verification wrapper.');
  assert.equal(wrapper.copiedPlacementCount,placementCount,'The final placement count differs.');
  assert.equal(wrapper.actualPlacedTypesVerifiedBeforeCommit,true,'Final placement verification is missing.');
  const copied=wrapper.copiedTypes;
  assert.ok(copied&&typeof copied==='object'&&!Array.isArray(copied),'Missing nested copied-type verification.');
  assert.equal(copied.completedCopyCount,copyCount,'The completed type-copy count differs.');
  assert.equal(copied.reviewedCopyCount,copyCount,'The reviewed type-copy count differs.');
  for(const key of ['reviewedCopiesComplete','sourceBaselinesComplete','sourceTypesUnchanged','copiedDimensionsVerified','verifiedBeforeTransactionCommit'])
    assert.equal(copied[key],true,'Final copied-type evidence is incomplete: '+key);
  assert.equal(copied.sideEffectsVerified,false,'Final copied-type evidence cannot certify all side effects.');
  assert.ok(Array.isArray(copied.copies)&&copied.copies.length===copyCount,'Final copied-type rows are incomplete.');
  return copied;
}

// RevitQueryService.Context intentionally samples only Take(400) FamilySymbols.
// Full category/type pagination and a separate new-type inspect are mandatory
// in the caller; this function certifies only the unchanged context sample.
export function assertCopyContextTypeSample(actual,before,newTypeId){
  assert.ok(Array.isArray(actual)&&Array.isArray(before)&&before.length<=400&&actual.length<=400,'Invalid context family-type sample.');
  for(const rows of [actual,before])assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'Duplicate context type ID.');
  assert.equal(before.some(row=>row.id===newTypeId),false,'The reported copy existed in the context baseline.');
  if(before.length===400){
    assert.deepEqual(actual,before,'The capped context sample changed.');
    return {sampleLimit:400,sampleCapped:true,newTypePresent:false,fullMembershipVerificationRequired:true};
  }
  assert.equal(actual.filter(row=>row.id===newTypeId).length,1,'The uncapped context sample is missing the new type.');
  assert.deepEqual(actual.filter(row=>row.id!==newTypeId),before,'Existing context types changed.');
  return {sampleLimit:400,sampleCapped:false,newTypePresent:true,fullMembershipVerificationRequired:true};
}
