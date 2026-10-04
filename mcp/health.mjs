#!/usr/bin/env node
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
const client=new Client({name:'revit-ai-health',version:'0.3.9'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(import.meta.dirname,'revit-custom.mjs')],stderr:'pipe'}));
  const tools=await client.listTools();console.log('MCP discovery: '+tools.tools.length+' tools.');
  const result=await client.callTool({name:'revit_context_get',arguments:{}});
  if(result.isError){console.error(result.content[0].text);process.exitCode=1;}
  else {const c=JSON.parse(result.content[0].text);console.log(JSON.stringify({active:c.active,revitVersion:c.revitVersion,revitBuild:c.revitBuild,document:c.document,counts:c.counts},null,2));}
} finally {await client.close();}


