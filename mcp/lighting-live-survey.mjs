#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {callRevit} from './bridge.mjs';
import {stableContext,assertTestDocument,parameter} from './acceptance-helpers.mjs';
// Native read-only verification only. This script never creates or submits a model plan.
const argv=process.argv.slice(2);
const option=name=>{const index=argv.indexOf('--'+name);return index>=0?argv[index+1]:undefined;};
const root=path.resolve(import.meta.dirname,'..');
const client=new Client({name:'lighting-live-survey',version:'0.3.7'});
async function call(name,args={}){
 const result=await client.callTool({name,arguments:args});
 const data=JSON.parse(result.content[0].text);
 if(result.isError){const e=new Error(data.message);e.code=data.code;e.details=data.details;throw e;}
 return data;
}
try{
 const expected=option('project');const filename=option('state');
 if(!expected||!filename)throw new Error('Specify --project TEST_COPY.rvt --state NEW_RECORD.json.');
 const state=path.resolve(filename);const relative=path.relative(path.join(root,'acceptance'),state);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!state.endsWith('.json'))throw new Error('Use a new JSON evidence file inside acceptance.');
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(import.meta.dirname,'revit-custom.mjs')],stderr:'pipe'}));
 const tools=await client.listTools();const info=await callRevit('revit.bridge.info');
 const contexts=[];for(let i=0;i<5;i++)contexts.push(await call('revit_context_get'));
 const before=stableContext(contexts);
 assertTestDocument(before,expected,path.resolve(root,'../考生文件夹/照明模型+方昱.rvt'));
 const room=await call('revit_room_get',{roomId:2289999});
 if(!room.name.includes('办公室1')||room.number!=='103'||room.documentIdentity!==before.document.identity){const error=new Error('The reviewed office room does not match the test model.');error.details={id:room.id,name:room.name,number:room.number,documentIdentity:room.documentIdentity,expectedIdentity:before.document.identity};throw error;}
 const lightType=await call('revit_type_resolve',{family:'无装饰暗装照明设备',type:'300x1200',category:'OST_LightingFixtures'});
 const switchType=await call('revit_type_resolve',{family:'照明开关',type:'单极',category:'OST_LightingDevices'});
 if(lightType.status!=='resolved'||switchType.status!=='resolved')throw new Error('The legacy fixture/switch types were not resolved uniquely.');
 const referenceElements=await call('revit_inspect',{elementIds:[2290242,2290243,2290301,770796]});
 const panel=referenceElements.items.find(item=>item.summary.id===2290301);
 const view=referenceElements.items.find(item=>item.summary.id===770796);
 if((!panel||parameter(panel,-1001203)?.value!=='AL1-暗装')||view?.summary.className!=='ViewPlan')throw new Error('The reviewed panel/view no longer matches the test copy.');
 const switches=await call('revit_search',{category:'OST_LightingDevices',limit:100});
 const sheets=await call('revit_search',{category:'OST_Sheets',limit:100});
 const changes=await call('revit_changes_get',{documentIdentity:before.document.identity,sinceRevision:0});
 const image=await call('revit_view_export_image',{viewId:770796,pixelSize:1600});
 if(!image.modelRevisionUnchanged||image.savedModel!==false||!image.files?.length)throw new Error('Image export did not prove read-only behavior.');
 const after=await call('revit_context_get');stableContext([before,before,before,before,after]);
 if(after.document.isModified!==before.document.isModified)throw new Error('Read-only survey changed the modified-state flag.');
 const evidence={status:'PASS',checkedAtUtc:new Date().toISOString(),plugin:info,toolNames:tools.tools.map(t=>t.name),context:before,room,lightType,switchType,referenceElements,switches,sheets,changes,image,afterDocument:after.document,modelWritesRequested:0,modelSavesRequested:0};
 await fs.mkdir(path.dirname(state),{recursive:true});await fs.writeFile(state,JSON.stringify(evidence,null,2),{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',pluginVersion:info.version,toolCount:tools.tools.length,document:after.document,room:{id:room.id,name:room.name,number:room.number,areaM2:room.areaM2,layoutEligible:room.layoutEligible},resolvedTypes:{light:lightType.resolvedTypeId,switch:switchType.resolvedTypeId},imageFiles:image.files,stateFile:state,modelWritesRequested:0,modelSavesRequested:0},null,2));
}catch(error){console.error(JSON.stringify({status:'NOT_VERIFIED',code:error.code||'survey_failed',message:error.message,details:error.details},null,2));process.exitCode=1;}
finally{await client.close();}





