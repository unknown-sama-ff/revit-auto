#!/usr/bin/env node
// Explicit local input and a new output file; never confirms plans or saves/reopens a model.
import fs from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {callRevit} from './bridge.mjs';
import {collisionInputSchema} from './collision-request.mjs';
import {normalizedItem,samePath} from './acceptance-helpers.mjs';

const [inputPath,outputPath]=process.argv.slice(2);
if(!inputPath||!outputPath)throw new Error('Usage: node collision-acceptance.mjs <reviewed-input.json> <new-local-evidence.json>');
const input=JSON.parse((await fs.readFile(inputPath,'utf8')).replace(/^\uFEFF/,''));
const {expectedProjectPath,...fields}=input;
if(typeof expectedProjectPath!=='string'||!expectedProjectPath.trim())throw new Error('Specify the previously reviewed test-copy path; no implicit active project acceptance.');
// Validate output before querying; evidence files are append-only.
const output=path.resolve(outputPath);
await fs.access(path.dirname(output));
try {await fs.access(output);throw new Error('Evidence file already exists; choose a new output file.');}
catch(error){if(error.code!=='ENOENT')throw error;}
const info=await callRevit('revit.bridge.info');
if(!info.features?.includes('collision-check'))throw new Error(`Loaded plugin ${info.version} lacks collision-check. Save manually and restart Revit; no model operation was requested.`);
const before=await callRevit('revit.context.get');
if(!before.active||!samePath(before.document.path,expectedProjectPath)||before.document.isFamilyDocument)throw new Error('Open the reviewed project test copy before acceptance.');
const request=collisionInputSchema.parse({...fields,documentIdentity:before.document.identity,expectedRevision:before.document.revision});
const ids=[...new Set([...request.targetElementIds,...(request.excludeElementIds||[])])];
async function inspectIds(){const items=[];for(let start=0;start<ids.length;start+=100){const page=await callRevit('revit.inspect',{elementIds:ids.slice(start,start+100)});items.push(...page.items);}return items;}
const baseline=await inspectIds();
if(baseline.some(item=>!item.summary))throw new Error('A reviewed model target/exclusion is missing; stop rather than predicting an ID.');
const report=await callRevit('revit.collision.check',request);
const afterItems=await inspectIds();
const after=await callRevit('revit.context.get');
const normalize=items=>items.map(item=>({...item,...normalizedItem(item)})).sort((a,b)=>a.summary.id-b.summary.id);
const pairKey=row=>`${row.targetElementId}:${row.candidateElementId}`;
if(!Array.isArray(report.collisions)||!Array.isArray(report.clearanceCandidates)||!Array.isArray(report.unknown)||!report.scope||!report.diagnostics)throw new Error('Incomplete report schema; no acceptance claim can be made.');
const exact=report.collisions,clearance=report.clearanceCandidates,unknown=report.unknown;
const reportedPairKeys=[...exact,...clearance,...unknown.filter(row=>row.targetElementId&&row.candidateElementId)].map(pairKey);
const excluded=new Set([...request.targetElementIds,...(request.excludeElementIds||[])]);
const checks={
  reportIdentityAndRevision:report.documentIdentity===before.document.identity&&report.documentRevision===before.document.revision,
  readOnlyIdentityRevision:after.document.identity===before.document.identity&&after.document.revision===before.document.revision,
  savedStateUnchanged:after.document.isModified===before.document.isModified,
  countsUnchanged:isDeepStrictEqual(after.counts,before.counts),
  viewAndSelectionUnchanged:isDeepStrictEqual(after.activeView,before.activeView)&&isDeepStrictEqual(after.selectedElementIds,before.selectedElementIds),
  targetsAndExclusionsUnchanged:isDeepStrictEqual(normalize(baseline),normalize(afterItems)),
  exactEvidence:exact.every(row=>row.evidence==='exact-solid-intersection'&&Number.isFinite(row.intersectionVolumeMm3)&&row.intersectionVolumeMm3>Math.max(1,(request.toleranceMm??0.1)**3)),
  conservativeEvidence:clearance.every(row=>row.evidence==='expanded-bounding-box-candidate'&&row.clearanceMm===(request.clearanceMm??0)&&row.clearanceMm>0),
  distinctEvidenceClasses:new Set(reportedPairKeys).size===reportedPairKeys.length,
  targetsAndExclusionsRespected:[...exact,...clearance].every(row=>request.targetElementIds.includes(row.targetElementId)&&Number.isSafeInteger(row.candidateElementId)&&row.candidateElementId>0&&!excluded.has(row.candidateElementId)),
  scopeMatchesRequest:isDeepStrictEqual(report.scope.targetElementIds,request.targetElementIds)&&isDeepStrictEqual(report.scope.excludeElementIds,request.excludeElementIds||[])&&report.scope.clearanceMm===(request.clearanceMm??0)&&report.scope.toleranceMm===(request.toleranceMm??0.1),
  diagnosticCountsMatch:report.diagnostics.exactIntersectionCount===exact.length&&report.diagnostics.clearanceCandidateCount===clearance.length&&report.diagnostics.unknownCount===unknown.length&&Number.isSafeInteger(report.diagnostics.candidateCount)&&Number.isSafeInteger(report.diagnostics.scannedCandidateCount)&&report.diagnostics.scannedCandidateCount>=0&&report.diagnostics.scannedCandidateCount<=report.diagnostics.candidateCount&&report.diagnostics.scannedCandidateCount<=(request.maxCandidates??500),
  completenessAndTruncationExplicit:typeof report.diagnostics.complete==='boolean'&&typeof report.diagnostics.truncated==='boolean'&&report.scope.truncated===report.diagnostics.truncated,
  noFalseCompleteness:!(report.diagnostics?.complete===true&&(report.diagnostics.truncated===true||unknown.length>0)),
  localScopeDisclosed:report.scope.targetGroupExcludedFromExternalCandidates===true&&report.scope.includesLinkedModels===false
};
const success=Object.values(checks).every(Boolean);
await fs.writeFile(output,JSON.stringify({capturedAtUtc:new Date().toISOString(),status:success?'PASS_READ_ONLY_COLLISION_CONTRACT':'COLLISION_CONTRACT_REQUIRES_REVIEW',checks,bridge:info,request,before,baseline,report,afterItems,after,engineeringClearanceCertified:false,note:'A query-contract pass is not a collision-free or maintenance-clearance pass. Read actual collision/unknown/truncated evidence.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({file:output,status:success?'PASS_READ_ONLY_COLLISION_CONTRACT':'COLLISION_CONTRACT_REQUIRES_REVIEW',checks,counts:{collisions:exact.length,clearanceCandidates:clearance.length,unknown:unknown.length},diagnostics:report.diagnostics,document:after.document},null,2));
if(!success)process.exitCode=1;
