import fs from 'node:fs/promises';import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const candidate=String.raw`C:\Program Files\Autodesk\Revit 2027 MCP Server Read-Tools Technical Preview\Autodesk.RevitMcpServer.Stdio.exe`;
const command=process.env.REVIT_OFFICIAL_READ_EXECUTABLE||candidate;
const args=['--ManageConfigurationWithAutodeskRevitPluginInstaller=true'];
const docs='https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_RevitMcp_setting_up_revit_mcp_server_html';
try{await fs.access(command);}catch{console.log(JSON.stringify({status:'NOT_INSTALLED',expectedReadExecutable:command,officialArgs:args,officialDocumentation:docs,officialDownloadArticle:'https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/How-to-download-the-Revit-MCP-server.html',downloadPath:'Autodesk Account > Products and Services > Revit > View Details > Extensions',documentedSupport:'Revit 2027.2 Technical Preview; local 2027.3 compatibility is unverified',next:'Obtain the official Read-Tools add-on through your Autodesk account/approved installer; never register a nonexistent binary or substitute custom MCP as official.'},null,2));process.exitCode=2;}
if(!process.exitCode){
 const client=new Client({name:'official-read-discovery',version:'0.3.7'});
 try{
  await client.connect(new StdioClientTransport({command,args,stderr:'pipe'}));
  const all=[];let cursor;let pages=0;
  do{const page=await client.listTools(cursor?{cursor}:undefined);all.push(...page.tools);cursor=page.nextCursor;if(++pages>50)throw new Error('Unexpected official tool pagination.');}while(cursor);
  console.log(JSON.stringify({status:'DISCOVERY_ONLY',command,args,toolCount:all.length,tools:all.map(t=>({name:t.name,description:t.description,annotations:t.annotations})),next:'Review the tool list and configure only Read tools before any assistant registration. No model tool has been called.'},null,2));
 }finally{await client.close();}
}

