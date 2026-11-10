import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {snapshot} from './acceptance-helpers.mjs';
import {assertSameInspectionScope} from './drawing-move-recovery.mjs';

assert.ok(process.argv.includes('--user-reported-saved'),'Run once after the human reports manually saving this test copy.');
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'runtime');
const file=path.resolve(root,process.argv[2]??'');
assert.equal(path.dirname(file),runtime);
const original=JSON.parse(await fs.readFile(file,'utf8'));
assert.equal(original.status,'MOVE_NATIVE_AND_COMPLETE_READ_SCOPES_VERIFIED_PNG_REVIEW_PENDING');
assert.equal(original.confirmationCalls,1);
const client=new Client({name:'saved-drawing-move-readback',version:'0.4.0'});
const allowed=new Set(['revit_context_get','revit_plan_get','revit_inspect','revit_search','revit_workflow_run']);
const result={planId:original.planId,checkedAt:new Date().toISOString(),sourceFile:file,status:'NOT_VERIFIED',
  confirmationCalls:0,automaticSave:false,automaticRetry:false,closeReopenPersistenceVerified:false,
  allModelSideEffectsVerified:false,fullLegacyParityVerified:false};
const output=path.join(runtime,'drawing-move-manual-save-'+Date.now()+'.json');
async function call(name,args={}){
  assert.ok(allowed.has(name));if(name==='revit_workflow_run')assert.equal(args.name,'verification.saved');
  const response=await client.callTool({name,arguments:args});
  const value=JSON.parse(response.content[0].text);
  if(response.isError){const error=new Error(value.message);Object.assign(error,{code:value.code,details:value.details});throw error;}
  return value;
}
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp','revit-custom.mjs')],stderr:'pipe'}));
  const before=result.before=await call('revit_context_get');
  assert.equal(before.active,true);assert.deepEqual(before.document,{...original.finalContext.document,isModified:false});
  for(const key of ['counts','activeView','selectedElementIds'])assert.deepEqual(before[key],original.finalContext[key]);
  result.savedVerification=await call('revit_workflow_run',{name:'verification.saved',documentIdentity:before.document.identity,
    expectedRevision:before.document.revision,input:{sinceRevision:original.before.document.revision}});
  assert.equal(result.savedVerification.saved,true);assert.equal(result.savedVerification.automaticSave,false);
  result.plan=await call('revit_plan_get',{planId:original.planId});assert.equal(result.plan.status,'committed');
  assert.deepEqual(result.plan.operations,original.plan.operations);assert.deepEqual(result.plan.receipt,original.receipt);
  result.snapshot=await snapshot(call,before);
  assert.deepEqual(result.snapshot.categoryIds,original.afterSnapshot.categoryIds);
  assert.deepEqual(result.snapshot.counts,original.afterSnapshot.counts);
  assertSameInspectionScope(result.snapshot,original.afterSnapshot,'saved electrical snapshot');
  const requested=original.afterFullScope.items.map(item=>item.summary.id),items=[];
  for(let offset=0;offset<requested.length;offset+=100){
    const report=await call('revit_inspect',{elementIds:requested.slice(offset,offset+100)});
    assert.ok(Array.isArray(report.items));items.push(...report.items);
  }
  result.fullScope={items};assertSameInspectionScope(result.fullScope,original.afterFullScope,'saved complete scope');
  result.after=await call('revit_context_get');
  for(const key of ['document','counts','activeView','selectedElementIds'])assert.deepEqual(result.after[key],before[key]);
  result.manualSaveCurrentSessionVerified=true;
  result.status='SAVED_CURRENT_SESSION_COMPLETE_MOVEMENT_READBACK_VERIFIED';
  console.log(JSON.stringify({status:result.status,evidenceFile:output,revision:before.document.revision,
    isModified:false,electricalCount:result.snapshot.items.length,fullScopeCount:items.length,
    confirmationCalls:0,automaticSave:false,closeReopenPersistenceVerified:false},null,2));
}catch(error){
  result.error={code:error.code,message:error.message,details:error.details};
  console.error(JSON.stringify({status:result.status,evidenceFile:output,error:result.error,automaticSave:false,automaticRetry:false},null,2));
  process.exitCode=1;
}finally{
  await fs.writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});await client.close();
}
