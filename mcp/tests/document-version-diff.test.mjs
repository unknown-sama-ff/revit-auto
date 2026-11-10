import test from 'node:test';
import assert from 'node:assert/strict';
import {documentVersionDiffRequestSchema,documentVersionDiffResponseSchema,readDocumentVersionDiff} from '../document-version-diff.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';import net from 'node:net';import os from 'node:os';import path from 'node:path';

const request={documentIdentity:'reviewed-session',expectedRevision:0,baseVersionGuid:'954250cd-d791-45e4-8053-602edef74272'};
const context={active:true,document:{identity:request.documentIdentity,revision:0,path:'floor-test.rvt',isModified:false,isReadOnly:false}};
const report={documentIdentity:request.documentIdentity,documentRevision:0,baseVersionGuid:request.baseVersionGuid,currentVersionGuid:'2ccd315e-663c-47d1-98a6-6e9668f6a96e',currentSaveCount:52,modelKind:'non_workshared',createdIds:[1,2296041,2296042,2296043],modifiedIds:[86962,293247],deletedIds:[],deletedIdsAvailable:false,complete:true,truncated:false,modelWritesRequested:false,automaticSave:false,allModelSideEffectsVerified:false,scopeNote:'IDs only; not property-level causality.'};
const clone=value=>structuredClone(value);
const fixture=({before=context,after=context,response=report,features=['document-version-diff']}={})=>{let contexts=0;const calls=[];return {calls,call:async(method,params)=>{calls.push({method,params});if(method==='revit.context.get')return clone(contexts++===0?before:after);assert.equal(method,'revit.document.version_diff');return clone(response);}};};

test('request strictly requires reviewed document pin and a valid base version GUID',()=>{
  assert.equal(documentVersionDiffRequestSchema.safeParse(request).success,true);
  for(const value of [{...request,baseVersionGuid:'bad'},{...request,baseVersionGuid:undefined},{...request,expectedRevision:undefined},{...request,extra:true}])assert.equal(documentVersionDiffRequestSchema.safeParse(value).success,false);
});

test('response distinguishes complete non-workshared differences from unavailable deletion history',()=>{
  assert.equal(documentVersionDiffResponseSchema.safeParse(report).success,true);
  for(const change of [r=>{r.createdIds=[2296043,1]},r=>{r.modifiedIds=[86962,86962]},r=>{r.deletedIdsAvailable=true},r=>{r.truncated=true},r=>{r.modelWritesRequested=true},r=>{r.baseVersionGuid='00000000-0000-0000-0000-000000000000'}]){const value=clone(report);change(value);assert.equal(documentVersionDiffResponseSchema.safeParse(value).success,false);}
});

test('read pins before and after native call and returns exact version diff',async()=>{
  const f=fixture();const value=await readDocumentVersionDiff(request,f.call);
  assert.deepEqual(value,report);assert.deepEqual(f.calls.map(x=>x.method),['revit.context.get','revit.document.version_diff','revit.context.get']);
  assert.deepEqual(f.calls[1].params,request);
});

test('read discards evidence if context drifts and does not retry',async()=>{
  const after=clone(context);after.document.revision=1;const f=fixture({after});
  await assert.rejects(readDocumentVersionDiff(request,f.call),error=>error.code==='document_revision_changed');
  assert.equal(f.calls.filter(x=>x.method==='revit.document.version_diff').length,1);
});

test('read rejects conflicting document pins before native diff call',async()=>{
  const before=clone(context);before.document.identity='another-project';const f=fixture({before});
  await assert.rejects(readDocumentVersionDiff(request,f.call),error=>error.code==='document_changed');
  assert.deepEqual(f.calls.map(x=>x.method),['revit.context.get']);
});

test('read rejects a native response scoped to another base version GUID',async()=>{
  const response=clone(report);response.baseVersionGuid='00000000-0000-4000-8000-000000000001';const f=fixture({response});
  await assert.rejects(readDocumentVersionDiff(request,f.call),error=>error.code==='document_version_diff_scope_mismatch');
  assert.equal(f.calls.filter(x=>x.method==='revit.document.version_diff').length,1);
});

test('read rejects malformed incomplete native responses without returning partial IDs',async()=>{
  const response=clone(report);response.complete=false;const f=fixture({response});
  await assert.rejects(readDocumentVersionDiff(request,f.call),error=>error.code==='document_version_diff_response_invalid');
});

test('read rejects document save-state or path drift after native diff call',async()=>{
  const after=clone(context);after.document.path='renamed.rvt';const f=fixture({after});
  await assert.rejects(readDocumentVersionDiff(request,f.call),error=>error.code==='document_version_diff_state_changed');
  assert.equal(f.calls.filter(x=>x.method==='revit.document.version_diff').length,1);
});

test('MCP tool advertises strict read-only pinned scope',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'document-version-diff-mcp-'));const calls=[];const server=net.createServer(socket=>{let buffer='';socket.on('data',chunk=>{buffer+=chunk;const i=buffer.indexOf('\n');if(i<0)return;const req=JSON.parse(buffer.slice(0,i));calls.push(req);if(req.method==='revit.bridge.info')socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result:{protocol:'revit-auto-2027-v2',features:['document-version-diff']}})+'\n');else socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result:req.method==='revit.context.get'?context:report})+'\n');});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const config=path.join(folder,'bridge.json');await fs.writeFile(config,JSON.stringify({port:server.address().port,token:'version-diff-token'}));const client=new Client({name:'version-diff-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],env:{...process.env,REVIT_AI_CONFIG:config},stderr:'pipe'}));t.after(async()=>{await client.close();await new Promise(resolve=>server.close(resolve));await fs.rm(folder,{recursive:true,force:true});});
  const listed=await client.listTools();const tool=listed.tools.find(item=>item.name==='revit_document_version_diff');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.deepEqual(tool.inputSchema.required,['documentIdentity','expectedRevision','baseVersionGuid']);
});
