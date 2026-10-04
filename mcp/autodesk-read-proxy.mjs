import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema,CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function readonlyTools(tools,allowlist) {
  const names=new Set(allowlist);
  return tools.filter(t=>names.has(t.name) && t.annotations?.readOnlyHint===true && t.annotations?.destructiveHint!==true);
}
export async function startReadonlyProxy(configFile) {
  const settings=JSON.parse((await fs.readFile(configFile,'utf8')).replace(/^\uFEFF/,''));
  if(settings.profile!=='Read' || !Array.isArray(settings.allowedReadTools) || settings.allowedReadTools.length===0)
    throw new Error('Official MCP must be configured with profile Read and a non-empty reviewed allowedReadTools list. Obtain actual names from the official server/installer.');
  if(!path.isAbsolute(settings.command) || !Array.isArray(settings.args)) throw new Error('Use the absolute installed executable path and args supplied by Autodesk. No guessed or on-demand downloaded command is accepted.');
  const upstream=new Client({name:'revit-autodesk-read-guard',version:'0.3.7'});
  const transport=new StdioClientTransport({command:settings.command,args:settings.args,env:settings.env,stderr:'pipe'});
  transport.stderr?.on('data',chunk=>process.stderr.write(chunk));
  await upstream.connect(transport);
  const all=[];let cursor;
  do { const page=await upstream.listTools(cursor?{cursor}:undefined);all.push(...page.tools);cursor=page.nextCursor; }while(cursor);
  const visible=readonlyTools(all,settings.allowedReadTools);const permitted=new Set(visible.map(t=>t.name));
  if(!visible.length){await upstream.close();throw new Error('No reviewed tools have read-only metadata. Refusing to expose write or unclassified tools.');}
  const server=new Server({name:'revit-autodesk-read',version:'0.3.7'},{capabilities:{tools:{}},instructions:'This server forwards only reviewed, explicitly allowlisted read-only Autodesk tools. All model writes belong to revit-custom and require user chat approval of the previewed plan.'});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:visible}));
  server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
    if(!permitted.has(request.params.name))return{isError:true,content:[{type:'text',text:'Denied: this official MCP guard exposes only explicitly reviewed read-only tools.'}]};
    return upstream.callTool(request.params,undefined,{signal:extra.signal});
  });
  await server.connect(new StdioServerTransport());
  process.stdin.on('end',()=>upstream.close());
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await startReadonlyProxy(process.env.REVIT_AI_AUTODESK_CONFIG || path.resolve(import.meta.dirname,'..','runtime','autodesk-read.json'));}
  catch(error){process.stderr.write(`[revit-autodesk-read] ${error.message}\n`);process.exitCode=1;}
}


