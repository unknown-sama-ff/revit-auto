import test from 'node:test';
import assert from 'node:assert/strict';
import {parameterImportInputSchema,previewParameterImport} from '../parameter-import.mjs';
const base={documentIdentity:'doc-a',expectedRevision:2,input:{rows:[{operationType:'create_level',name:'AI-1F',elevationMm:'0'}],mapping:{},defaults:{}}};

test('parameter import pins identity/revision and creates preview only',async()=>{
 const calls=[];const result=await previewParameterImport(base,async(method,args)=>{calls.push([method,args]);if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:2,isFamilyDocument:false}};if(method==='revit.plan.create')return {planId:'p1',documentIdentity:'doc-a',documentRevision:2,operations:args.operations};throw new Error('unexpected '+method);});
 assert.equal(result.planCreated,true);assert.equal(result.plan.planId,'p1');assert.deepEqual(calls.map(([method])=>method),['revit.context.get','revit.plan.create']);assert.ok(!calls.some(([method])=>method==='revit.plan.confirm'));
});

test('parameter import returns table issues without creating a plan',async()=>{
 const calls=[];const result=await previewParameterImport({documentIdentity:'doc-a',input:{rows:[{family:'灯具'}],mapping:{family:'family'}}},async(method)=>{calls.push(method);if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:0,isFamilyDocument:false}};throw new Error('unexpected '+method);});
 assert.equal(result.planCreated,false);assert.ok(result.issues.length>0);assert.deepEqual(calls,['revit.context.get']);
});

test('parameter import rejects identity/revision changes and candidate inputs',async()=>{
 await assert.rejects(()=>previewParameterImport({...base,documentIdentity:'other'},async method=>{if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:2,isFamilyDocument:false}};throw new Error('must stop');}),/Active document differs/);
 await assert.rejects(()=>previewParameterImport({...base,expectedRevision:1},async method=>{if(method==='revit.context.get')return {active:true,document:{identity:'doc-a',revision:2,isFamilyDocument:false}};throw new Error('must stop');}),/Project revision differs/);
 assert.throws(()=>parameterImportInputSchema.parse({rows:[{entities:[]}],format:'image'}),/Invalid/);
});

test('parameter import schema is strict and requires table source',()=>{assert.throws(()=>parameterImportInputSchema.parse({mapping:{x:'y'}}));assert.throws(()=>parameterImportInputSchema.parse({rows:[],filePath:'x.csv'}));assert.throws(()=>parameterImportInputSchema.parse({rows:[{}],save:true}));});

