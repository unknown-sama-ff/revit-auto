import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('official read guard completes a real SDK relay but denies write calls (mock upstream, not Autodesk installation)',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'revit-official-relay-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const config=path.join(dir,'official.json');await fs.writeFile(config,JSON.stringify({profile:'Read',command:process.execPath,args:[path.resolve(import.meta.dirname,'official-fixture.mjs')],allowedReadTools:['query_model','delete_model']}));
 const c=new Client({name:'official-read-guard-test',version:'1.0'});t.after(()=>c.close());
 await c.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../autodesk-read-proxy.mjs')],env:{REVIT_AI_AUTODESK_CONFIG:config},stderr:'pipe'}));
 const tools=await c.listTools();assert.deepEqual(tools.tools.map(tool=>tool.name),['query_model']);
 const read=await c.callTool({name:'query_model',arguments:{}});assert.equal(JSON.parse(read.content[0].text).readOnly,true);
 const denied=await c.callTool({name:'delete_model',arguments:{}});assert.equal(denied.isError,true);assert.match(denied.content[0].text,/Denied/);
});
