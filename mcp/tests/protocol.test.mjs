import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
const serverPath=path.resolve(import.meta.dirname,'..','revit-custom.mjs');
function launch(){const child=spawn(process.execPath,[serverPath],{stdio:['pipe','pipe','pipe'],env:{...process.env,REVIT_AI_CONFIG:path.resolve(import.meta.dirname,'..','..','runtime','missing.json')}}); return child;}
test('MCP advertises safe tool instructions and protocol', async()=>{
  // Protocol smoke is isolated from Revit: initialize and tools/list do not access the model until a tool is called.
  const child=spawn(process.execPath,[serverPath],{stdio:['pipe','pipe','pipe']}); let buffer=''; const responses=new Map(); child.stdout.on('data',chunk=>{buffer+=chunk; let i; while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line) {const r=JSON.parse(line);responses.set(r.id,r);}}});
  const send=(id,method,params={})=>new Promise((resolve,reject)=>{child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n'); const end=Date.now()+3000; const poll=()=>responses.has(id)?resolve(responses.get(id)):Date.now()>end?reject(new Error('timeout')):setTimeout(poll,10);poll();});
  try { const init=await send(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1.0'}}); assert.equal(init.result.serverInfo.name,'revit-custom'); assert.match(init.result.instructions,/preview/); const tools=await send(2,'tools/list'); assert.ok(tools.result.tools.some(t=>t.name==='revit_plan_confirm')); } finally { child.kill(); }
});

