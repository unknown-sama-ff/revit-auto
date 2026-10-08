#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {callRevit} from './bridge.mjs';

export const REQUIRED_NATIVE_FEATURES=['build-fingerprint','native-change-receipts','stair-cleanup-evidence','ui-thread-audit-snapshot','electrical-circuit-audit','native-opening','explicit-stair-geometry'];
function failure(code,message){const error=new Error(message);error.code=code;throw error;}
export async function verifyNativeReadBatch({expectedBuild,project},bridgeCall,toolCall){
 if(typeof expectedBuild!=='string'||!expectedBuild.trim()||typeof project!=='string'||!path.isAbsolute(project))failure('invalid_acceptance_input','Specify the exact compiled informational version and the absolute path of the reviewed test project.');
 const plugin=await bridgeCall('revit.bridge.info');
 const missing=REQUIRED_NATIVE_FEATURES.filter(feature=>!plugin.features?.includes(feature));
 if(missing.length||plugin.informationalVersion!==expectedBuild)failure('native_candidate_not_loaded','Expected native build or required features are not loaded. Stop; do not restart apps, recreate plans or request any model write.');
 if(plugin.confirmationMode!=='chat'||plugin.requiresRevitConfirmation!==false)failure('native_confirmation_contract_invalid','Chat-only confirmation is not verified on the loaded candidate.');
 if(!Number.isSafeInteger(plugin.pid)||plugin.pid<=0||typeof plugin.moduleVersionId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(plugin.moduleVersionId))failure('native_build_identity_unknown','The loaded assembly lacks a verified module identity.');
 const before=await toolCall('revit_context_get',{});
 if(!before.active||typeof before.document?.identity!=='string'||!before.document.identity.trim()||!Number.isSafeInteger(before.document.revision)||before.document.revision<0||typeof before.document.isModified!=='boolean'||!before.counts||typeof before.counts!=='object'||Array.isArray(before.counts)||Object.values(before.counts).some(value=>!Number.isSafeInteger(value)||value<0))failure('native_context_unknown','The current project has no verified identity/revision.');
 if(!before.document.path||path.resolve(before.document.path).toLowerCase()!==path.resolve(project).toLowerCase())failure('native_project_mismatch','The active project is not the exact reviewed test project.');
 const pin={documentIdentity:before.document.identity,expectedRevision:before.document.revision};
 const audit=await toolCall('revit_workflow_run',{name:'audit',planningMode:'explicit',...pin,input:{}});
 if(audit.readOnly!==true||audit.planCreated!==false||audit.documentIdentity!==pin.documentIdentity||audit.documentRevision!==pin.expectedRevision||audit.auditConsistency?.uiThreadSnapshotVerified!==true)failure('native_audit_contract_invalid','The generic audit did not return the pinned UI-thread snapshot contract.');
 const direct=await toolCall('revit_electrical_audit',{...pin,maxCircuits:10,maxMembersPerCircuit:100,maxParametersPerCircuit:64});
 const unified=await toolCall('revit_workflow_run',{name:'electrical.audit',planningMode:'explicit',...pin,input:{maxCircuits:10,maxMembersPerCircuit:100,maxParametersPerCircuit:64}});
 if(direct.readOnly!==true||direct.planCreated!==false||direct.snapshotPolicy!=='ui-thread-json-v1'||direct.documentIdentity!==pin.documentIdentity||direct.documentRevision!==pin.expectedRevision||direct.engineeringComplianceVerified!==false)failure('native_electrical_contract_invalid','Electrical audit did not return the pinned read-only native evidence.');
 const normalize=value=>Array.isArray(value)?value.map(normalize).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])])):value;
 if(!isDeepStrictEqual(normalize(direct),normalize(unified)))failure('native_electrical_adapter_mismatch','Direct and unified electrical read evidence differ; do not certify the adapters.');
 const after=await toolCall('revit_context_get',{});
 if(!after.active||!isDeepStrictEqual(before.document,after.document)||!isDeepStrictEqual(before.counts,after.counts))failure('native_read_state_changed','Document state or counts changed during the read-only batch; discard the acceptance result.');
 const afterPlugin=await bridgeCall('revit.bridge.info');
 if(afterPlugin.informationalVersion!==plugin.informationalVersion||afterPlugin.moduleVersionId!==plugin.moduleVersionId||afterPlugin.pid!==plugin.pid)failure('native_host_changed','Native host identity changed during the acceptance batch.');
 return{status:'PASS_NATIVE_READ_ONLY_CONTRACT',checkedAtUtc:new Date().toISOString(),plugin,before,audit,electricalDirect:direct,electricalUnified:unified,after,
  verification:{nativeBuildMatched:true,modelWritesRequested:0,modelSavesRequested:0,planCreated:false,documentStateAndCountsUnchanged:true,genericAuditUiSnapshotVerified:true,electricalDirectUnifiedEquivalent:true,
   fieldCorrectnessIndependentlyVerified:false,fullElectricalParityVerified:false,nativeWriteSuccessVerified:false,transactionRollbackVerified:false,stairOpeningGeometryVerified:false,persistenceVerified:false,realAssistantUiDiscoveryVerified:false}};
}
async function main(){
 const [expectedBuild,project,record]=process.argv.slice(2);const root=path.resolve(import.meta.dirname,'..');
 if(!record||!path.isAbsolute(record))throw new Error('Provide EXPECTED_BUILD ABSOLUTE_TEST_PROJECT ABSOLUTE_NEW_RECORD inside the package acceptance directory.');
 const output=path.resolve(record),base=path.join(root,'acceptance');const relative=path.relative(base,output);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!relative||path.extname(output)!=='.json')throw new Error('Evidence must be a new JSON file inside package acceptance.');
 await fs.mkdir(path.dirname(output),{recursive:true});const parent=await fs.realpath(path.dirname(output)),realBase=await fs.realpath(base);const rel=path.relative(realBase,parent);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Evidence output escaped the acceptance directory.');
 const client=new Client({name:'native-candidate-readonly-acceptance',version:'0.4.0'});
 try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],stderr:'pipe'}));
  const toolCall=async(name,args)=>{const response=await client.callTool({name,arguments:args});const data=JSON.parse(response.content[0].text);if(response.isError)failure(data.code||'native_read_failed',data.message);return data;};
  const evidence=await verifyNativeReadBatch({expectedBuild,project},callRevit,toolCall);
  await fs.writeFile(output,JSON.stringify(evidence,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:evidence.status,informationalVersion:evidence.plugin.informationalVersion,moduleVersionId:evidence.plugin.moduleVersionId,electricalScope:evidence.electricalDirect.scope,electricalEvidenceComplete:evidence.electricalDirect.complete,modelWritesRequested:0,planCreated:false,fullBusinessAcceptance:false,evidenceFile:output},null,2));
 }finally{await client.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({status:'NOT_VERIFIED',code:error.code||'native_read_acceptance_failed',message:error.message}));process.exitCode=1;});
