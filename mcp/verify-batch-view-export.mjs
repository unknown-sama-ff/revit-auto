import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callRevit} from './bridge.mjs';
import {exportViewImages} from './view-export.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';

// Local acceptance probe: only registered read commands and local evidence output.
const root=path.resolve(import.meta.dirname,'..');
const baselineFile=path.join(root,'runtime','parity-postregistration-reopen-verified-1791626912602.json');
const evidenceFile=path.join(root,'runtime',`parity-batch-export-${Date.now()}.json`);
const viewIds=[2296031,1042869];
const recoverExportFile=process.argv[2]?path.resolve(process.argv[2]):null;
const record={status:'READ_PROBE_STARTED',checkedAt:new Date().toISOString(),baselineFile,
  modelWritesRequested:false,confirmationCalls:0,automaticSave:false,
  allModelSideEffectsVerified:false,wholeSheetLayoutAccepted:false,negativeZeroCanonicalized:true};

function stableContext(actual,expected){
  assert.equal(actual.active,true);
  assert.deepEqual(actual.document,expected.document,'Active saved document state changed.');
  assert.equal(actual.revitVersion,expected.revitVersion);
  assert.equal(actual.revitBuild,expected.revitBuild);
  for(const key of ['counts','levels','familyTypes','elementTypes'])
    assert.deepEqual(actual[key],expected[key],`${key} changed.`);
}
async function inspectScope(expected){
  const ids=expected.items.map(item=>item.summary.id);
  assert.equal(new Set(ids).size,ids.length);
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const requested=ids.slice(offset,offset+100);
    const result=await callRevit('revit.inspect',{elementIds:requested});
    assert.equal(result.items.length,requested.length,'Inspection response was incomplete.');
    assert.deepEqual(result.items.map(item=>item.summary?.id),requested,'Inspection IDs changed or disappeared.');
    items.push(...result.items);
  }
  return {items};
}
async function fileEvidence(file){
  const data=await fs.readFile(file);
  return {path:file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
}
try{
  const baseline=JSON.parse(await fs.readFile(baselineFile,'utf8'));
  assert.equal(baseline.status,'LOADED_AND_SAVED_REOPEN_READ_SCOPES_VERIFIED');
  assert.equal(baseline.after.document.isModified,false);
  record.bridge=await callRevit('revit.bridge.info');
  assert.equal(record.bridge.moduleVersionId,baseline.bridge.moduleVersionId);
  assert.ok(record.bridge.features.includes('batch-view-image-export'));
  record.before=await callRevit('revit.context.get');
  stableContext(record.before,baseline.after);
  record.savedFileBefore=await fileEvidence(record.before.document.path);
  record.fullScope=await inspectScope(baseline.fullScope);
  record.architectureScope=await inspectScope(baseline.architectureScope);
  assertSameInspectionScope(record.fullScope,baseline.fullScope,'Full saved read scope');
  assertSameInspectionScope(record.architectureScope,baseline.architectureScope,'Architecture saved read scope');
  record.input={documentIdentity:record.before.document.identity,
    expectedRevision:record.before.document.revision,viewIds,pixelSize:4096,resolutionDpi:300};
  if(recoverExportFile){
    assert.equal(path.dirname(recoverExportFile).toLowerCase(),path.join(root,'runtime').toLowerCase());
    const prior=JSON.parse(await fs.readFile(recoverExportFile,'utf8'));
    assert.equal(prior.status,'READ_PROBE_STOPPED');
    assert.equal(prior.error?.message,'Unexpected export location.');
    assert.equal(prior.baselineFile,baselineFile);
    assert.deepEqual(prior.input,record.input);
    assert.deepEqual(prior.bridge,record.bridge);
    stableContext(record.before,prior.before);
    assert.deepEqual(prior.savedFileBefore,record.savedFileBefore);
    assertSameInspectionScope(record.fullScope,prior.fullScope,'Recovered export full scope');
    assertSameInspectionScope(record.architectureScope,prior.architectureScope,'Recovered export architecture scope');
    record.exportResult=prior.exportResult;
    record.recoveredExportEvidence=recoverExportFile;
    record.exportRepeated=false;
  }else{
    record.exportResult=await exportViewImages(record.input,callRevit);
    record.exportRepeated=false;
  }
  assert.equal(record.exportResult.documentIdentity,record.input.documentIdentity);
  assert.equal(record.exportResult.documentRevision,record.input.expectedRevision);
  assert.equal(record.exportResult.requestedPixelSize,record.input.pixelSize);
  assert.equal(record.exportResult.requestedResolutionDpi,record.input.resolutionDpi);
  assert.equal(record.exportResult.savedModel,false);
  assert.equal(record.exportResult.modelRevisionUnchanged,true);
  assert.equal(record.exportResult.savedStateUnchanged,true);
  assert.deepEqual(record.exportResult.exports.map(item=>item.viewId),viewIds);
  record.pngFiles=[];
  // RuntimeFiles.Root is the package root; DirectoryPath separately names runtime/.
  const exportsRoot=path.join(root,'exports');
  const output=path.resolve(record.exportResult.outputDirectory);
  assert.equal(path.dirname(output).toLowerCase(),exportsRoot.toLowerCase(),'Unexpected export location.');
  assert.match(path.basename(output),/^[a-f0-9]{32}$/);
  assert.equal((await fs.realpath(output)).toLowerCase(),output.toLowerCase());
  const seenFiles=new Set();
  for(const item of record.exportResult.exports){
    const file=path.resolve(item.file);
    assert.equal(path.dirname(file).toLowerCase(),path.join(output,`view-${item.viewId}`).toLowerCase());
    assert.equal((await fs.realpath(file)).toLowerCase(),file.toLowerCase());
    assert.equal(seenFiles.has(file.toLowerCase()),false,'Two views reused the same PNG.');
    seenFiles.add(file.toLowerCase());
    const expectedSheet=record.fullScope.items.find(row=>row.summary.id===item.viewId).summary;
    assert.equal(expectedSheet.className,'ViewSheet');
    assert.equal(item.viewName,expectedSheet.name);assert.equal(item.sheetNumber,expectedSheet.sheetNumber);
    const bytes=await fs.readFile(file);
    assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(bytes.toString('ascii',12,16),'IHDR');
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    assert.equal(item.widthPixels,width);assert.equal(item.heightPixels,height);
    assert.equal(item.fileBytes,bytes.length);assert.ok(width>0&&height>0);
    assert.equal(width,record.input.pixelSize,'Native horizontal PNG size differs from request.');
    record.pngFiles.push({...item,sha256:createHash('sha256').update(bytes).digest('hex'),
      headerAndDimensionsVerified:true,nonblankContentVerified:false,layoutAccepted:false});
  }
  record.afterFullScope=await inspectScope(record.fullScope);
  record.afterArchitectureScope=await inspectScope(record.architectureScope);
  assertSameInspectionScope(record.afterFullScope,record.fullScope,'Full scope after PNG export');
  assertSameInspectionScope(record.afterArchitectureScope,record.architectureScope,'Architecture scope after PNG export');
  record.after=await callRevit('revit.context.get');
  stableContext(record.after,record.before);
  record.afterBridge=await callRevit('revit.bridge.info');
  assert.deepEqual(record.afterBridge,record.bridge,'Loaded bridge changed.');
  record.savedFileAfter=await fileEvidence(record.after.document.path);
  assert.deepEqual(record.savedFileAfter,record.savedFileBefore,'Saved RVT bytes changed during export.');
  record.movementPosition=record.afterFullScope.items.find(item=>item.summary.id===2296037).drawing.position;
  assert.deepEqual(record.movementPosition,baseline.movementPosition);
  record.readScopesUnchanged=true;record.savedFileUnchanged=true;
  record.status='BATCH_PNG_EXPORTED_READ_SCOPES_AND_SAVED_FILE_VERIFIED_VISUAL_PENDING';
}catch(error){
  record.status='READ_PROBE_STOPPED';
  record.error={code:error.code??null,message:error.message};
  process.exitCode=1;
}finally{
  await fs.writeFile(evidenceFile,JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidenceFile,error:record.error,
    fullScopeCount:record.fullScope?.items.length,architectureScopeCount:record.architectureScope?.items.length,
    document:record.after?.document??record.before?.document,pngFiles:record.pngFiles,
    movementPosition:record.movementPosition,modelWritesRequested:false,automaticSave:false},null,2));
}
