#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {callRevit} from './bridge.mjs';
import {stableContext,assertTestDocument} from './acceptance-helpers.mjs';
import {verifyLightingPlan} from './lighting-verification.mjs';
// No confirm/commit tool is called here. An assistant submits the exact pending plan only after human chat approval.
const argv=process.argv.slice(2),command=argv[0];
const option=name=>{const index=argv.indexOf('--'+name);return index>=0?argv[index+1]:undefined;};
const root=path.resolve(import.meta.dirname,'..');
const original=path.resolve(root,'../考生文件夹/照明模型+方昱.rvt');
const client=new Client({name:'lighting-scene-acceptance',version:'0.3.9'});
async function call(name,args={}){const response=await client.callTool({name,arguments:args});const data=JSON.parse(response.content[0].text);if(response.isError){const error=new Error(data.message);error.code=data.code;error.details=data.details;throw error;}return data;}
async function context(){const reads=[];for(let i=0;i<5;i++)reads.push(await call('revit_context_get'));return stableContext(reads);}
let pendingPlanId;
try{
 const filename=option('state');if(!filename)throw new Error('Specify --state NEW_RECORD.json for prepare, or the existing record for verify.');
 const state=path.resolve(filename),relative=path.relative(path.join(root,'acceptance'),state);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!state.endsWith('.json'))throw new Error('Acceptance evidence must be JSON inside the package acceptance directory.');
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(import.meta.dirname,'revit-custom.mjs')],stderr:'pipe'}));
 const plugin=await callRevit('revit.bridge.info');
 if(!plugin.features?.includes('lighting-evidence'))throw new Error('Load the staged v0.3.9 plugin before lighting acceptance. No model plan was requested.');
 if(command==='prepare'){
  const expected=option('project'),inputFile=option('input');if(!expected||!inputFile)throw new Error('prepare --project TEST_COPY.rvt --input ASSISTANT_REVIEWED_INPUT.json --state NEW_RECORD.json');
  const before=await context();assertTestDocument(before,expected,original);
  const input=JSON.parse((await fs.readFile(inputFile,'utf8')).replace(/^\uFEFF/,''));
  if(Object.hasOwn(input,'documentIdentity')&&input.documentIdentity!==before.document.identity)throw new Error('Reviewed input belongs to a different document session.');
  const proposal=await call('revit_room_lighting_preview',{...input,documentIdentity:before.document.identity});pendingPlanId=proposal.plan.planId;
  const after=await context();stableContext([before,before,before,before,after]);
  if(before.document.isModified!==after.document.isModified)throw new Error('Preview changed the modified-state flag. Stop.');
  const record={formatVersion:1,expectedProject:path.resolve(expected),documentIdentity:before.document.identity,baselineDocument:before.document,baselineCounts:before.counts,input,proposal,preview:proposal.plan};
  await fs.mkdir(path.dirname(state),{recursive:true});await fs.writeFile(state,JSON.stringify(record,null,2),{flag:'wx'});pendingPlanId=undefined;
  console.log(JSON.stringify({status:'PREVIEW_ONLY',planId:proposal.plan.planId,document:before.document,operations:proposal.plan.operations,expected:proposal.expected,warnings:[...proposal.plan.warnings,...proposal.warnings,...proposal.notes],expiresAtUtc:proposal.plan.expiresAtUtc,stateFile:state,modelWritesRequested:0,next:'Show the exact preview in chat. After human approval submit the SAME plan id through the MCP, then run verify with this record. No automatic save.'},null,2));
 }else if(command==='verify'){
  const record=JSON.parse((await fs.readFile(state,'utf8')).replace(/^\uFEFF/,''));
  if(record.formatVersion!==1||!record.preview?.planId)throw new Error('Invalid lighting acceptance record.');
  const current=await context();assertTestDocument(current,record.expectedProject,original);
  if(current.document.identity!==record.documentIdentity)throw new Error('The Revit document session changed; the existing receipt cannot prove this new session.');
  const plan=await call('revit_plan_get',{planId:record.preview.planId});
  if(!isDeepStrictEqual(plan.operations,record.preview.operations))throw new Error('Current plan differs from the reviewed immutable preview.');
  if(plan.status!=='committed')throw new Error('Plan status is '+plan.status+'. It has not successfully executed; this verifier will not submit it.');
  const ids=new Set(plan.receipt.createdElementIds);
  for(const op of plan.operations)for(const value of [op.panelId,op.firstElementId,op.secondElementId,op.referenceViewId,op.viewId,op.viewportId])if(Number.isSafeInteger(value)&&value>0)ids.add(value);
  const all=[...ids],items=[];for(let index=0;index<all.length;index+=100)items.push(...(await call('revit_inspect',{elementIds:all.slice(index,index+100)})).items);
  const after=await context();stableContext([current,current,current,current,after]);
  const verified=verifyLightingPlan(plan,after,items,record.baselineCounts);
  const imageFiles=[];for(const op of plan.operations.filter(op=>op.operationType==='create_view_plan'||op.operationType==='create_sheet')){
   const image=await call('revit_view_export_image',{viewId:plan.receipt.references[op.id],pixelSize:1600});
   if(image.savedModel!==false||image.modelRevisionUnchanged!==true)throw new Error('Image export did not preserve read-only evidence.');imageFiles.push(...image.files);
  }
  const final=await context();stableContext([after,after,after,after,final]);
  await fs.writeFile(state+'.verified.json',JSON.stringify({...verified,checkedAtUtc:new Date().toISOString(),plugin,document:final.document,receipt:plan.receipt,inspected:items,imageFiles,modelWritesRequested:0,modelSavesRequested:0},null,2),{flag:'wx'});
  console.log(JSON.stringify({...verified,imageFiles,evidenceFile:state+'.verified.json'},null,2));
 }else throw new Error('Use prepare or verify. This acceptance runner never submits model writes.');
}catch(error){console.error(JSON.stringify({status:'NOT_VERIFIED',code:error.code||'lighting_acceptance_failed',message:error.message,details:error.details},null,2));process.exitCode=1;}
finally{if(pendingPlanId){try{await call('revit_plan_cancel',{planId:pendingPlanId});}catch{}}await client.close();}
