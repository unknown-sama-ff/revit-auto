#!/usr/bin/env node
import fs from 'node:fs/promises';import path from 'node:path';import {isDeepStrictEqual} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {stableContext,assertTestDocument,snapshot} from './acceptance-helpers.mjs';
import {referenceViewOperation,verifyViewConfiguration} from './view-configuration.mjs';
const argv=process.argv.slice(2),command=argv[0],option=name=>{const i=argv.indexOf('--'+name);return i>=0?argv[i+1]:undefined;};
const root=path.resolve(import.meta.dirname,'..'),client=new Client({name:'view-configuration-acceptance',version:'0.3.9'});
let pending;
async function call(name,args={}){const r=await client.callTool({name,arguments:args});const d=JSON.parse(r.content[0].text);if(r.isError){const e=new Error(d.message);e.code=d.code;e.details=d.details;throw e;}return d;}
async function context(){const values=[];for(let i=0;i<5;i++)values.push(await call('revit_context_get'));return stableContext(values);}
try{
 const filename=option('state');if(!filename)throw new Error('Specify an acceptance JSON record with --state.');
 const state=path.resolve(filename),relative=path.relative(path.join(root,'acceptance'),state);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!state.endsWith('.json'))throw new Error('Evidence must stay inside acceptance.');
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(import.meta.dirname,'revit-custom.mjs')],stderr:'pipe'}));
 if(command==='prepare'){
  const expected=option('project');const viewId=Number(option('target')),referenceViewId=Number(option('reference')),viewportId=Number(option('viewport')),paperX=Number(option('paper-x')??420),paperY=Number(option('paper-y')??280);
  if(!expected||![viewId,referenceViewId,viewportId].every(id=>Number.isSafeInteger(id)&&id>0))throw new Error('prepare --project TEST_COPY --target ID --reference ID --viewport ID --state NEW_RECORD.json');
  const before=await context();assertTestDocument(before,expected,path.resolve(root,'../考生文件夹/照明模型+方昱.rvt'));
  const source=await call('revit_view_get',{viewId:referenceViewId}),target=await call('revit_view_get',{viewId});
  const placement=(await call('revit_inspect',{elementIds:[viewportId]})).items[0];
  if(placement?.drawing?.viewId!==viewId)throw new Error('The viewport does not display the reviewed target view.');
  const operations=[referenceViewOperation({viewId,referenceViewId,viewportId,paperPoint:{xMm:paperX,yMm:paperY,zMm:0},discipline:'Electrical'})];
  const baseline=await snapshot(call,before);const latest=await context();stableContext([before,before,before,before,latest]);
  const plan=await call('revit_plan_create',{documentIdentity:before.document.identity,expectedRevision:before.document.revision,summary:'仅优化新照明视图范围、裁剪、照明类别/电气规程并保持图纸视口420/280；不改模型元素、不保存',source:'view-configuration-acceptance',operations});pending=plan.planId;
  const after=await context();stableContext([before,before,before,before,after]);
  if(!isDeepStrictEqual(baseline,await snapshot(call,after)))throw new Error('View preview changed the electrical model baseline.');
  await fs.writeFile(state,JSON.stringify({formatVersion:1,expectedProject:path.resolve(expected),documentIdentity:before.document.identity,baselineDocument:before.document,baseline,source,target,placement,operations,preview:plan},null,2),{flag:'wx'});pending=undefined;
  console.log(JSON.stringify({status:'PREVIEW_ONLY',planId:plan.planId,document:before.document,reference:source.settings,target:target.settings,operations,expiresAtUtc:plan.expiresAtUtc,paperPoint:{xMm:paperX,yMm:paperY},stateFile:state,modelWritesRequested:0,next:'Show this exact settings-only preview for chat approval; this runner never submits a write.'},null,2));
 }else if(command==='verify'){
  const record=JSON.parse((await fs.readFile(state,'utf8')).replace(/^\uFEFF/,''));
  if(record.formatVersion!==1)throw new Error('Invalid view acceptance record.');
  const current=await context();assertTestDocument(current,record.expectedProject,path.resolve(root,'../考生文件夹/照明模型+方昱.rvt'));
  if(current.document.identity!==record.documentIdentity)throw new Error('Document session changed.');
  const plan=await call('revit_plan_get',{planId:record.preview.planId});
  if(plan.status!=='committed'||!isDeepStrictEqual(plan.operations,record.operations))throw new Error('The exact view configuration has not committed. No automatic submission.');
  const op=record.operations[0];
  if(plan.receipt.completedOperationCount!==1||plan.receipt.createdElementIds.length!==0||plan.receipt.saved!==false||!isDeepStrictEqual([...plan.receipt.changedElementIds].sort(),[op.viewId,op.viewportId].sort()))throw new Error('Receipt does not prove a settings-only view/viewport change.');
  const source=await call('revit_view_get',{viewId:op.referenceViewId}),target=await call('revit_view_get',{viewId:op.viewId}),placement=(await call('revit_inspect',{elementIds:[op.viewportId]})).items[0];
  if(!isDeepStrictEqual(source.settings,record.source.settings))throw new Error('The reference view was changed.');
  const verified=verifyViewConfiguration(op,source.settings,target.settings,placement.drawing);
  const electrical=await snapshot(call,current);if(!isDeepStrictEqual(record.baseline,electrical))throw new Error('View settings unexpectedly altered model elements/electrical relationships.');
  const images=[];for(const viewId of [op.viewId,placement.drawing.sheetId]){const image=await call('revit_view_export_image',{viewId,pixelSize:1600});if(!image.modelRevisionUnchanged||image.savedModel!==false)throw new Error('Export changed model state.');images.push(...image.files);}
  const after=await context();stableContext([current,current,current,current,after]);
  await fs.writeFile(state+'.verified.json',JSON.stringify({...verified,checkedAtUtc:new Date().toISOString(),document:after.document,source,target,placement,receipt:plan.receipt,electricalModelUnchanged:true,images,modelSavesRequested:0},null,2),{flag:'wx'});
  console.log(JSON.stringify({...verified,electricalModelUnchanged:true,images,evidenceFile:state+'.verified.json',modelSavesRequested:0},null,2));
 }else throw new Error('Use prepare or verify. No model confirmation/commit call exists in this script.');
}catch(error){console.error(JSON.stringify({status:'NOT_VERIFIED',code:error.code||'view_acceptance_failed',message:error.message,details:error.details},null,2));process.exitCode=1;}
finally{if(pending){try{await call('revit_plan_cancel',{planId:pending});}catch{}}await client.close();}
