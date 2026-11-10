#!/usr/bin/env node
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {callRevit} from './bridge.mjs';
import {parseRuntimeDiagnosticArgs,probeRuntimeDiagnostic} from './runtime-diagnostics.mjs';

export async function runHealth(args=process.argv.slice(2)){
  const {options,evidence}=parseRuntimeDiagnosticArgs(args);
  const client=new Client({name:'revit-ai-health',version:'0.4.0'});
  try{
    const bridgeEnv={};
    for(const key of ['REVIT_AI_CONFIG','REVIT_AI_TIMEOUT_MS','REVIT_AI_READONLY_BRIDGE_INFO_CACHE_MS'])
      if(process.env[key]!==undefined)bridgeEnv[key]=process.env[key];
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(import.meta.dirname,'revit-custom.mjs')],stderr:'pipe',env:bridgeEnv}));
    const tools=await client.listTools();
    const toolCall=async(name,args,signal)=>{
      const r=await client.callTool({name,arguments:args},undefined,{signal});
      const value=JSON.parse(r.content.find(c=>c.type==='text').text);
      if(r.isError)throw Object.assign(new Error(value.message),value);return value;
    };
    const data=await probeRuntimeDiagnostic({...options,nativeCall:callRevit,toolCall,
      serverInfo:client.getServerVersion(),toolCount:tools.tools.length});
    if(evidence){
      const directory=path.resolve(import.meta.dirname,'../acceptance/diagnostics','runtime-'+randomUUID());
      await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'observations.json');
      const bytes=Buffer.from(JSON.stringify(data.evidence,null,2)+'\n');await fs.writeFile(file,bytes,{flag:'wx'});
      data.report.evidence={path:file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
    }
    return data.report;
  }finally{await client.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await runHealth();console.log(JSON.stringify(report,null,2));process.exitCode=report.issues.length?1:0;}
  catch(e){console.log(JSON.stringify({status:'diagnostic-failed',code:e.code??'runtime_diagnostic_error',message:e.message,
    ...(e.details?{details:e.details}:{}),
    modelWritesRequested:0,automaticRetryAllowed:false},null,2));process.exitCode=2;}
}


