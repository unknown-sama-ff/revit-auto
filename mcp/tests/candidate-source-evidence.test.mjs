import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {previewCandidateImport} from '../candidate-planning.mjs';
const calibration={scaleMmPerUnit:1,origin:{x:0,y:0},offsetMm:{x:0,y:0,z:0},rotationDegrees:0,levelId:1};
const args={name:'imports.dwg_candidate',documentIdentity:'doc',expectedRevision:1,planningMode:'explicit',input:{filePath:path.resolve('fixture.dwg'),calibration,layerMapping:{}}};
const extraction={exporter:'native-console',sourceSha256:'a'.repeat(64),manifestPath:path.resolve('mock-artifacts/manifest.json'),adapterStatePath:path.resolve('mock-artifacts/adapter.json'),scope:'selected-ModelSpace-main-graphical-entities',lineGeometryCount:1,unsupportedGeometryCount:1,readOnly:true,modelUploaded:false,sourceCopyMatched:true,modifiedStateBefore:0,modifiedStateAfter:0,wholeDrawingDecodeAccepted:false,designScaleVerified:false,exactPersistenceVerified:false};
function parse(e=extraction){return{candidateOnly:true,sourceGeometryCount:2,unmappedEntityCount:2,textCount:0,textTruncated:false,complete:false,operations:[],issues:[],text:[],provenance:[],extraction:e};}
function native(){const calls=[];return{calls,call:async method=>{calls.push(method);assert.equal(method,'revit.context.get');return{active:true,document:{identity:'doc',revision:1,path:'fixture.rvt',isModified:true},levels:[{id:1}]};}};}
test('candidate workflow preserves bounded verified native artifact pointers and unknown scope',async()=>{
 const f=native(),parsed=parse({...extraction,arbitraryText:'untrusted text must not be copied'});const snapshot=structuredClone(parsed);
 const result=await previewCandidateImport(args,f.call,undefined,{importInput:async()=>parsed});
 assert.equal(result.planCreated,false);assert.equal(result.candidateOnly,true);assert.equal(result.sourceExtraction.sourceSha256,extraction.sourceSha256);
 assert.equal(result.sourceExtraction.manifestPath,extraction.manifestPath);assert.equal(result.sourceExtraction.unsupportedGeometryCount,1);
 assert.equal(result.sourceExtraction.designScaleVerified,false);assert.ok(!Object.hasOwn(result.sourceExtraction,'arbitraryText'));assert.deepEqual(parsed,snapshot);assert.deepEqual(f.calls,['revit.context.get','revit.context.get']);
});
test('malformed or overstated native evidence never becomes a candidate result',async()=>{
 for(const changed of [{sourceSha256:'bad'},{manifestPath:'relative.json'},{designScaleVerified:true},{modelUploaded:true},{modifiedStateAfter:1},{unsupportedGeometryCount:5},{exporter:'unverified'},{manifestPath:'x'.repeat(32769)}]){
  const f=native();await assert.rejects(previewCandidateImport(args,f.call,undefined,{importInput:async()=>parse({...extraction,...changed})}),e=>e.code==='candidate_source_evidence_invalid');assert.ok(f.calls.every(c=>c==='revit.context.get'));
 }
});
test('non-native candidates keep prior result shape and exact operation digest',async()=>{
 const f=native(),withEvidence=await previewCandidateImport(args,f.call,undefined,{importInput:async()=>parse()});
 const plain=await previewCandidateImport(args,f.call,undefined,{importInput:async()=>parse(undefined)});
 // An omitted field is distinct from invented/native extraction claims.
 const p=await previewCandidateImport(args,f.call,undefined,{importInput:async()=>{const value=parse();delete value.extraction;return value;}});
 assert.equal(withEvidence.candidateDigestSha256,p.candidateDigestSha256);assert.ok(!Object.hasOwn(p,'sourceExtraction'));assert.equal(plain.planCreated,false);
});
