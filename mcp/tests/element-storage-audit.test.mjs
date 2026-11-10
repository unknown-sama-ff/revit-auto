import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readElementStorageSchemas} from '../element-storage-audit.mjs';

const request={documentIdentity:'reviewed-session',expectedRevision:7,elementIds:[86962,293247]};
const context={active:true,document:{identity:request.documentIdentity,revision:request.expectedRevision,
  path:'test-copy.rvt',isModified:false,isReadOnly:false}};
const summary=id=>({id,uniqueId:'native-'+id,name:id===86962?'系统数据':'自动连接跟踪器图元',
  className:'Element',category:null,categoryId:null,typeId:-1,ownerViewId:-1,levelId:-1});
const resolved={guid:'7a43b62d-60c4-4dd3-82a9-cc0ca376bb01',metadataStatus:'resolved',
  schemaName:'ReviewedConnectivityState',vendorId:'ACME',applicationGuid:null,
  readAccessLevel:'Public',writeAccessLevel:'Vendor',
  fields:[{name:'SourceElementId',valueType:'System.Int64',containerType:'Simple',specTypeId:null}]};
const notLoaded={guid:'128f7c06-0c77-4b23-884c-3f90c12553a2',metadataStatus:'not_loaded',
  schemaName:null,vendorId:null,applicationGuid:null,readAccessLevel:null,writeAccessLevel:null,fields:[]};
const nativeResponse=(items=[
  {elementId:86962,exists:true,summary:summary(86962),schemaEvidence:{supported:true,complete:true,count:1,truncated:false,schemas:[structuredClone(resolved)]}},
  {elementId:293247,exists:true,summary:summary(293247),schemaEvidence:{supported:true,complete:true,count:1,truncated:false,schemas:[structuredClone(notLoaded)]}}
])=>({documentIdentity:request.documentIdentity,documentRevision:request.expectedRevision,items,
  schemaScope:'attached-extensible-storage-schema-definitions-only',entityValuesReturned:false,
  modelWritesRequested:false,automaticSave:false,allModelSideEffectsVerified:false});

async function fixture(t,{response=nativeResponse(),contexts=[context,context],features=['element-storage-schema-audit']}={}){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'element-storage-audit-'));
  const token='test-element-storage-token-'.repeat(2),calls=[];
  const server=net.createServer(socket=>{
    let buffer='';
    socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8');const newline=buffer.indexOf('\n');if(newline<0)return;
      const call=JSON.parse(buffer.slice(0,newline));calls.push(call);
      assert.equal(call.token,token);assert.ok(call.deadlineUnixMs>Date.now());
      const fail=(code,message)=>socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:false,error:{code,message}})+'\n');
      const send=value=>socket.end(JSON.stringify({protocol:'revit-auto-2027-v2',ok:true,result:value})+'\n');
      if(call.method==='revit.bridge.info')return send({protocol:'revit-auto-2027-v2',version:'test',features});
      if(call.method==='revit.context.get'){
        const contextIndex=calls.filter(item=>item.method==='revit.context.get').length-1;
        return send(contexts[Math.min(contextIndex,contexts.length-1)]);
      }
      if(call.method==='revit.element.storage_schemas')return send(response);
      return fail('unexpected_method','Unexpected native method '+call.method);
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const config=path.join(folder,'bridge.json');
  await fs.writeFile(config,JSON.stringify({port:server.address().port,token}));
  const client=new Client({name:'element-storage-audit-test',version:'1.0.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,
    args:[path.resolve(import.meta.dirname,'../revit-custom.mjs')],
    env:{...process.env,REVIT_AI_CONFIG:config},stderr:'pipe'}));
  t.after(async()=>{await client.close();await new Promise(resolve=>server.close(resolve));await fs.rm(folder,{recursive:true,force:true});});
  return {client,calls};
}

function parseResult(result){return JSON.parse(result.content?.[0]?.text??'{}');}

test('MCP publishes a pinned, read-only schema metadata tool',async t=>{
  const {client}=await fixture(t);const listed=await client.listTools();
  const tool=listed.tools.find(item=>item.name==='revit_element_storage_schemas');
  assert.ok(tool,'the current RevitAuto MCP server does not expose native schema metadata');
  assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);
  assert.equal(tool.inputSchema.additionalProperties,false);
  assert.deepEqual(tool.inputSchema.required,['documentIdentity','expectedRevision','elementIds']);
});

test('query returns schema definitions only and preserves an unloaded schema as unresolved',async t=>{
  const {client,calls}=await fixture(t);
  const response=await client.callTool({name:'revit_element_storage_schemas',arguments:request});
  assert.notEqual(response.isError,true,JSON.stringify(response.content));
  const result=parseResult(response);
  assert.equal(result.schemaScope,'attached-extensible-storage-schema-definitions-only');
  assert.equal(result.entityValuesReturned,false);assert.equal(result.modelWritesRequested,false);
  assert.equal(result.automaticSave,false);assert.equal(result.allModelSideEffectsVerified,false);
  assert.equal(result.items[0].schemaEvidence.schemas[0].schemaName,'ReviewedConnectivityState');
  assert.deepEqual(result.items[0].schemaEvidence.schemas[0].fields,[
    {name:'SourceElementId',valueType:'System.Int64',containerType:'Simple',specTypeId:null}
  ]);
  assert.equal(result.items[1].schemaEvidence.schemas[0].metadataStatus,'not_loaded');
  assert.equal(result.items[1].schemaEvidence.schemas[0].schemaName,null);
  assert.deepEqual(calls.filter(call=>call.method==='revit.element.storage_schemas').map(call=>call.params),[request]);
  assert.deepEqual(calls.filter(call=>call.method!=='revit.bridge.info').map(call=>call.method),[
    'revit.context.get','revit.element.storage_schemas','revit.context.get'
  ]);
});

test('query rejects extra request fields and more than twenty IDs before native reads',async t=>{
  const {client,calls}=await fixture(t);
  for(const args of [
    {...request,includeValues:true},
    {...request,elementIds:Array.from({length:21},(_,index)=>index+1)}
  ]){
    const result=await client.callTool({name:'revit_element_storage_schemas',arguments:args});
    assert.equal(result.isError,true);
  }
  assert.deepEqual(calls.filter(call=>call.method==='revit.element.storage_schemas'),[]);
  assert.deepEqual(calls.filter(call=>call.method==='revit.context.get'),[]);
});

test('query refuses entity values or malformed schema metadata in native responses',async t=>{
  const contaminated=nativeResponse();
  contaminated.items[0].schemaEvidence.schemas[0].values={SourceElementId:2296043};
  const {client,calls}=await fixture(t,{response:contaminated});
  const response=await client.callTool({name:'revit_element_storage_schemas',arguments:request});
  assert.equal(response.isError,true);
  assert.equal(parseResult(response).code,'element_storage_schema_response_invalid');
  assert.deepEqual(calls.filter(call=>call.method!=='revit.bridge.info').map(call=>call.method),[
    'revit.context.get','revit.element.storage_schemas'
  ]);
});

test('query discards the result when document revision changes during the read',async t=>{
  const changed={active:true,document:{...context.document,revision:8}};
  let contextIndex=0;const calls=[];
  const call=async(method,args)=>{
    calls.push({method,args});
    if(method==='revit.context.get')return structuredClone(contextIndex++===0?context:changed);
    assert.equal(method,'revit.element.storage_schemas');
    return nativeResponse();
  };
  await assert.rejects(readElementStorageSchemas(request,call),error=>error.code==='document_revision_changed');
  assert.deepEqual(calls.map(entry=>entry.method),[
    'revit.context.get','revit.element.storage_schemas','revit.context.get'
  ]);
});
