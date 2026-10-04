#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const client=new Client({name:'revit-ai-acceptance',version:'0.3.4'});
let planId;
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(import.meta.dirname,'revit-custom.mjs')],stderr:'pipe'}));
  async function call(name,args={}){const result=await client.callTool({name,arguments:args});const data=JSON.parse(result.content[0].text);if(result.isError)throw new Error(data.message);return data;}
  const before=await call('revit_context_get');if(!before.active)throw new Error('Open a Revit project first.');
  const suffix=Date.now();
  const preview=await call('revit_plan_create',{summary:'只读验收预览',documentIdentity:before.document.identity,operations:[{operationType:'create_level',name:'AI_PREVIEW_TEST_'+suffix,elevationMm:123456}]});
  planId=preview.planId;
  const after=await call('revit_context_get');
  if(JSON.stringify(before.counts)!==JSON.stringify(after.counts)||before.document.revision!==after.document.revision)throw new Error('Unexpected model changes during preview.');
  await call('revit_plan_cancel',{planId});planId=undefined;
  console.log('PASS: current document read, preview caused no changes, and cancellation succeeded.');
  if(process.argv.includes('--lighting')) {
    const file=process.argv[process.argv.indexOf('--lighting')+1];if(!file)throw new Error('Provide a reviewed lighting workflow JSON file.');
    const input=JSON.parse((await fs.readFile(path.resolve(file),'utf8')).replace(/^\uFEFF/,''));
    const lighting=await call('revit_workflow_run',{name:'lighting.full',documentIdentity:after.document.identity,summary:'照明工作流验收（仅预览）',input});
    planId=lighting.planId;console.log(JSON.stringify(lighting,null,2));
    if(process.argv.includes('--confirm')) {
      console.log('Executing the reviewed plan after user approval in chat. No second Revit confirmation dialog will appear. Do not use --confirm without that approval.');
      await call('revit_plan_confirm',{planId});planId=undefined;
    } else {await call('revit_plan_cancel',{planId});planId=undefined;console.log('Preview cancelled. No model writes requested.');}
  }
} finally {if(planId){try{await client.callTool({name:'revit_plan_cancel',arguments:{planId}});}catch{}}await client.close();}

