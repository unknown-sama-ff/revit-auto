import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.resolve(import.meta.dirname,'../..');
test('backend commit contains no secondary model confirmation dialog',async()=>{
  const source=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');
  assert.doesNotMatch(source,/TaskDialog|dialog\.Show\(/);
});
test('transaction warnings are captured and returned to chat instead of asking in Revit',async()=>{
  const source=await fs.readFile(path.join(root,'v27/RevitCommandRouter.cs'),'utf8');
  assert.match(source,/accessor\.DeleteWarning\(failure\)/);
  assert.match(source,/ProceedWithRollBack/);
  assert.match(source,/warnings = failureCapture\.Messages/);
});
test('MCP confirmation instructions require one chat approval and no new confirmation input',async t=>{
  const client=new Client({name:'chat-confirmation-contract',version:'1.0'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/revit-custom.mjs')],stderr:'pipe'}));
  const list=await client.listTools();
  for(const name of ['revit_plan_confirm','revit_import_commit']){
    const tool=list.tools.find(t=>t.name===name);
    assert.deepEqual(tool.inputSchema.required,['planId']);
    assert.deepEqual(Object.keys(tool.inputSchema.properties),['planId']);
    assert.match(tool.description,/chat approval/i);
    assert.match(tool.description,/without.*Revit.*dialog/i);
  }
  const safety=await client.readResource({uri:'revit-custom://safety'});
  assert.match(safety.contents[0].text,/chat approval/i);
  assert.doesNotMatch(safety.contents[0].text,/defaults No/);
});
