#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {callRevit} from './bridge.mjs';
import {stableContext,assertTestDocument,CASE_TARGETS,caseOperations,snapshot,assertWrite,assertRollback} from './acceptance-helpers.mjs';

// No commit/confirm call is allowed here. Submission of an existing plan belongs to the assistant after chat approval.
const args=process.argv.slice(2);const command=args[0];
const option=name=>{const index=args.indexOf('--'+name);return index>=0?args[index+1]:undefined;};
const original=path.resolve(import.meta.dirname,'../../考生文件夹/照明模型+方昱.rvt');
const workspace=path.resolve(import.meta.dirname,'..');
const stateFile=option('state')?path.resolve(option('state')):null;
const client=new Client({name:'identity-write-rollback-acceptance',version:'0.3.9'});
async function call(name,arguments_={}){
  const result=await client.callTool({name,arguments:arguments_});
  const data=JSON.parse(result.content[0].text);if(result.isError){const error=new Error(data.message);error.code=data.code;error.details=data.details;throw error;}return data;
}
async function contextSeries(){const contexts=[];for(let i=0;i<5;i++)contexts.push(await call('revit_context_get'));return stableContext(contexts);}
async function requireFixedPlugin(){const info=await callRevit('revit.bridge.info');if(info.documentIdentityPolicy!=='native-session-equality')throw new Error('The running Revit DLL does not contain the identity fix. Save/restart Revit before this acceptance.');if(command!=='probe'&&info.connectorInspectionPolicy!=='capability-aware-v2')throw new Error('Restart Revit to load the connector-inspection fix v0.3.9 before preparing or verifying electrical baselines. No write was requested.');return info;}
function requireStateFile(){if(!stateFile)throw new Error('Specify --state with a new acceptance record path.');const relative=path.relative(workspace,stateFile);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Acceptance records must remain in this package directory.');}
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(import.meta.dirname,'revit-custom.mjs')],stderr:'pipe'}));
  const info=await requireFixedPlugin();
  if(command==='probe'){
    const context=await contextSeries();console.log(JSON.stringify({status:'PASS',plugin:info,document:context.document,counts:context.counts,reads:5},null,2));
  }else if(command==='prepare'){
    requireStateFile();const testCase=args[1];const expected=option('project');if(!expected||!CASE_TARGETS[testCase])throw new Error('Usage: prepare write|rollback --project TEST_COPY.rvt --state NEW_RECORD.json');
    const context=await contextSeries();assertTestDocument(context,expected,original);
    const baseline=await snapshot(call,context);
    const target=baseline.items.find(item=>item.summary.id===CASE_TARGETS[testCase].id);if(!target)throw new Error('The reviewed target element is not present in this copy.');
    const operations=caseOperations(testCase,target);
    const latest=await call('revit_context_get');stableContext([context,context,context,context,latest]);
    let planId;
    try{
      const preview=await call('revit_plan_create',{documentIdentity:context.document.identity,source:'acceptance:'+testCase,summary:testCase==='write'?'副本验收：写入 OFF1-01 注释':'副本验收：OFF1-02 修改→删除→访问失败→整组回滚',operations});planId=preview.planId;
      const after=await call('revit_context_get');stableContext([context,context,context,context,after]);
      if(!isDeepStrictEqual(baseline,await snapshot(call,after)))throw new Error('Preview changed the model baseline. Stop.');
      await fs.mkdir(path.dirname(stateFile),{recursive:true});
      await fs.writeFile(stateFile,JSON.stringify({formatVersion:1,testCase,expectedProject:path.resolve(expected),documentIdentity:context.document.identity,baselineDocument:context.document,baseline,operations,preview},null,2),{flag:'wx'});
      console.log(JSON.stringify({status:'PREVIEW_ONLY',testCase,planId,document:context.document,operations,warnings:preview.warnings,expiresAtUtc:preview.expiresAtUtc,stateFile,next:'Show this exact preview to the user. After chat approval, call revit_plan_confirm with this planId once, then run verify. No Revit popup.'},null,2));
      planId=undefined;
    }finally{if(planId){try{await call('revit_plan_cancel',{planId});}catch{}}}
  }else if(command==='verify'){
    requireStateFile();const record=JSON.parse((await fs.readFile(stateFile,'utf8')).replace(/^\uFEFF/,''));
    if(record.formatVersion!==1||!CASE_TARGETS[record.testCase])throw new Error('Invalid acceptance record.');
    const context=await contextSeries();assertTestDocument(context,record.expectedProject,original);
    if(context.document.identity!==record.documentIdentity)throw new Error('Revit document session changed. Existing plan results cannot be assumed.');
    const plan=await call('revit_plan_get',{planId:record.preview.planId});
    if(!isDeepStrictEqual(plan.operations,record.operations))throw new Error('Acceptance record does not match the immutable plan.');
    if(plan.status!=='committed'&&plan.status!=='failed')throw new Error('Plan is '+plan.status+'; actual execution has not been verified. No automatic confirmation was performed.');
    const after=await snapshot(call,context);const latest=await call('revit_context_get');stableContext([context,context,context,context,latest]);
    if(record.testCase==='write')assertWrite(record.baseline,after,plan.receipt);else assertRollback(record.baseline,after,plan.receipt);
    await fs.writeFile(stateFile+'.verified.json',JSON.stringify({status:'PASS',testCase:record.testCase,planId:plan.planId,receipt:plan.receipt,document:context.document,countsUnchanged:true,electricalBaselineVerified:true,saved:false},null,2),{flag:'wx'});
    console.log(JSON.stringify({status:'PASS',testCase:record.testCase,planId:plan.planId,receipt:plan.receipt,modelAutoSaved:false},null,2));
  }else throw new Error('Use probe, prepare write|rollback, or verify. This script never submits model writes.');
}catch(error){console.error(JSON.stringify({status:'NOT_VERIFIED',code:error.code||'acceptance_failed',message:error.message,details:error.details},null,2));process.exitCode=1;}
finally{await client.close();}


