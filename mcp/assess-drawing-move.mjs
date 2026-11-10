import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

assert.ok(process.argv.includes('--png-reviewed'),'Run only after independently viewing the exported PNG.');
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const files=process.argv.slice(2,4).map(file=>path.resolve(root,file));
for(const file of files)assert.equal(path.dirname(file),runtime);
const [execution,saved]=await Promise.all(files.map(async file=>JSON.parse(await fs.readFile(file,'utf8'))));
assert.equal(execution.status,'MOVE_NATIVE_AND_COMPLETE_READ_SCOPES_VERIFIED_PNG_REVIEW_PENDING');
assert.equal(execution.confirmationCalls,1);
assert.equal(saved.status,'SAVED_CURRENT_SESSION_COMPLETE_MOVEMENT_READBACK_VERIFIED');
assert.equal(saved.planId,execution.planId);assert.equal(saved.manualSaveCurrentSessionVerified,true);
assert.deepEqual(saved.plan.receipt,execution.receipt);
assert.equal(execution.image.files.length,1);
await fs.access(execution.image.files[0]);
const result={
  status:'MOVE_COMMITTED_LAYOUT_TEST_PASSED_MANUAL_SAVE_READBACK_VERIFIED',
  assessedAt:new Date().toISOString(),planId:execution.planId,sourceExecution:files[0],sourceSavedReadback:files[1],
  confirmationCalls:execution.confirmationCalls,position:execution.move.requestedPosition,
  nativeMovementVerified:true,fullReadScopesVerified:true,electricalCount:execution.baseline.items.length,
  fullScopeCount:execution.afterFullScope.items.length,manualSaveCurrentSessionVerified:true,
  visualReview:{source:execution.image.files[0],method:'independent PNG visual inspection',
    leftSignatureStripOverlapResolved:true,panelTableVisibleInsidePaperBorder:true,
    wholeSheetAccepted:false,remainingIssue:'Existing right-side titleblock notes/text remain crowded; no titleblock editing was requested.',
    exactTableBoundingBoxVerified:false,automatedCollisionProof:false},
  automaticSave:false,automaticRetryPerformed:false,closeReopenPersistenceVerified:false,
  movementRollbackVerified:false,allModelSideEffectsVerified:false,fullLegacyParityVerified:false
};
const file=path.join(runtime,'drawing-move-assessment-'+execution.planId+'.json');
await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({status:result.status,file,position:result.position,manualSaveCurrentSessionVerified:true,
  leftSignatureStripOverlapResolved:true,wholeSheetAccepted:false,closeReopenPersistenceVerified:false},null,2));
