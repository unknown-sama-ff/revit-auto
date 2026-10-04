#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {callRevit} from './bridge.mjs';
import {assertTestDocument} from './acceptance-helpers.mjs';
// These are two real SDK clients, not proof that the human's Claude/Codex UI sessions are configured.
// No plan creation/confirmation, audit changes, model saves or native UI actions are requested.
const file=process.argv[2],project=process.argv[3];
const root=path.resolve(import.meta.dirname,'..');
const clients=[];
async function call(client,name,arguments_={}){
 const response=await client.callTool({name,arguments:arguments_});const data=JSON.parse(response.content[0].text);
 if(response.isError){const error=new Error(data.message);error.code=data.code;throw error;}return data;
}
try{
 if(!file||!project)throw new Error('Specify NEW_RECORD.json inside acceptance and the exact TEST_COPY.rvt path.');
 const state=path.resolve(file),relative=path.relative(path.join(root,'acceptance'),state);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!state.endsWith('.json'))throw new Error('Use a new JSON evidence file inside acceptance.');
 for(const name of ['Claude-compatible-SDK','Codex-compatible-SDK']){
  const client=new Client({name,version:'0.3.7'});clients.push(client);
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(import.meta.dirname,'revit-custom.mjs')],stderr:'pipe'}));
 }
 const plugin=await callRevit('revit.bridge.info');
 const listings=await Promise.all(clients.map(client=>client.listTools()));
 if(!isDeepStrictEqual(listings[0].tools.map(tool=>tool.name),listings[1].tools.map(tool=>tool.name)))throw new Error('The two clients do not expose the same MCP contract.');
 const before=await call(clients[0],'revit_context_get');assertTestDocument(before,project,path.resolve(root,'../考生文件夹/照明模型+方昱.rvt'));
 const rounds=[];
 for(let index=0;index<5;index++){
  const values=await Promise.all(clients.map(client=>call(client,'revit_context_get')));
  for(const context of values)if(!isDeepStrictEqual(context.document,before.document)||!isDeepStrictEqual(context.counts,before.counts))throw new Error('Native document state drifted under parallel read requests.');
  rounds.push({round:index+1,clients:values.map(context=>({document:context.document,counts:context.counts}))});
 }
 const resolved=await Promise.all(clients.map(client=>call(client,'revit_type_resolve',{family:'无装饰暗装照明设备',type:'300x1200',category:'OST_LightingFixtures'})));
 if(!isDeepStrictEqual(resolved[0],resolved[1])||resolved[0].status!=='resolved')throw new Error('Type resolution differs between the native read sessions.');
 const missing=await call(clients[0],'revit_type_resolve',{family:'__AI_ACCEPTANCE_MISSING_FAMILY__',type:'__AI_ACCEPTANCE_MISSING_TYPE__',category:'OST_LightingFixtures'});
 if(missing.status!=='missing'||missing.resolvedTypeId!==undefined&&missing.resolvedTypeId!==null||missing.candidates?.length!==0)throw new Error('Missing types were not explicitly reported; never guess a fallback.');
 const after=await call(clients[1],'revit_context_get');
 if(!isDeepStrictEqual(after.document,before.document)||!isDeepStrictEqual(after.counts,before.counts))throw new Error('Read-only session test changed model state.');
 const evidence={status:'PASS_READ_ONLY',checkedAtUtc:new Date().toISOString(),plugin,toolNames:listings[0].tools.map(tool=>tool.name),rounds,resolvedType:resolved[0],missingType:missing,document:after.document,modelWritesRequested:0,modelSavesRequested:0,scope:'Two SDK stdio clients query the actual Revit host concurrently. Does not prove real assistant UI setup, concurrent writes, duplicate commit safety or transaction rollback.'};
 await fs.mkdir(path.dirname(state),{recursive:true});await fs.writeFile(state,JSON.stringify(evidence,null,2),{flag:'wx'});
 console.log(JSON.stringify({status:evidence.status,pluginVersion:plugin.version,toolCount:listings[0].tools.length,parallelRounds:rounds.length,document:after.document,resolvedTypeId:resolved[0].resolvedTypeId,missingTypeStatus:missing.status,evidenceFile:state,modelWritesRequested:0,modelSavesRequested:0,scope:evidence.scope},null,2));
}catch(error){console.error(JSON.stringify({status:'NOT_VERIFIED',code:error.code||'parallel_read_failed',message:error.message},null,2));process.exitCode=1;}
finally{await Promise.all(clients.map(client=>client.close()));}
