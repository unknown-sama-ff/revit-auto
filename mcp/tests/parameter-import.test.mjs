import test from 'node:test';
import assert from 'node:assert/strict';
import {parameterImportInputSchema,parameterImportRequestInputSchema,previewParameterImport} from '../parameter-import.mjs';

const context={active:true,document:{identity:'doc-a',revision:2,path:'C:\\models\\test.rvt',isModified:false,isFamilyDocument:false,isReadOnly:false}};
const base={documentIdentity:'doc-a',expectedRevision:2,input:{rows:[{operationType:'create_level',name:'AI-1F',elevationMm:'0'}],mapping:{},defaults:{}}};
const invalidTable={rows:[{family:'灯具'}],mapping:{family:'family'}};
function fixture({contexts=[context],plan,cancelError,createError}={}){
  const calls=[];let index=0;
  const call=async(method,args)=>{
    calls.push({method,args});
    if(method==='revit.context.get')return contexts[Math.min(index++,contexts.length-1)];
    if(method==='revit.plan.create'){
      if(createError)throw createError;
      return plan===undefined?{planId:'p1',status:'pending',documentIdentity:'doc-a',documentRevision:2,operations:args.operations}:plan;
    }
    if(method==='revit.plan.cancel'){
      if(cancelError)throw cancelError;
      return {planId:args.planId,status:'cancelled'};
    }
    throw new Error('unexpected '+method);
  };
  return {calls,call};
}
const methods=f=>f.calls.map(c=>c.method);
const noWrites=f=>assert.ok(!methods(f).some(method=>/confirm|commit|save/.test(method)));
const changedDocument=changes=>({...context,document:{...context.document,...changes}});

test('parameter import creates one pinned pending preview and verifies final saved state',async()=>{
  const f=fixture();const result=await previewParameterImport(base,f.call);
  assert.equal(result.planCreated,true);assert.equal(result.plan.planId,'p1');assert.equal(result.planningMode,'explicit');assert.equal(result.candidateOnly,false);
  assert.equal(result.documentIdentity,'doc-a');assert.equal(result.documentRevision,2);
  assert.deepEqual(methods(f),['revit.context.get','revit.plan.create','revit.context.get']);
  const request=f.calls.find(c=>c.method==='revit.plan.create').args;
  assert.equal(request.documentIdentity,'doc-a');assert.equal(request.expectedRevision,2);assert.equal(request.source,'workflow:imports.parameter_table:explicit');
  noWrites(f);
});

test('ask accepts missing source and does not query a host or read the given file',async()=>{
  for(const input of [{},{filePath:'C:\\missing-table-that-must-not-be-read.csv'}]){
    const f=fixture();const result=await previewParameterImport({documentIdentity:'doc-a',planningMode:'ask',input},f.call);
    assert.equal(result.status,'needs_clarification');assert.equal(result.planningMode,'ask');assert.equal(result.planCreated,false);assert.equal(result.requiresClarification,true);
    assert.ok(result.questions.length);assert.equal(result.candidateOnly,false);assert.deepEqual(result.assumptions,[]);assert.deepEqual(methods(f),[]);
  }
});

test('ask still validates request structure without host access',async()=>{
  const f=fixture();
  for(const request of [
    {documentIdentity:' ',planningMode:'ask'},
    {documentIdentity:'doc-a',expectedRevision:-1,planningMode:'ask'},
    {documentIdentity:'doc-a',planningMode:'ask',input:{rows:[]}},
    {documentIdentity:'doc-a',planningMode:'ask',input:{scriptPath:'x.csx'}}
  ])await assert.rejects(()=>previewParameterImport(request,f.call));
  assert.deepEqual(methods(f),[]);
});

test('assisted requires nonempty disclosed assumptions before any reads',async()=>{
  const f=fixture();
  await assert.rejects(()=>previewParameterImport({...base,planningMode:'assisted'},f.call),error=>error.code==='assumptions_required');
  await assert.rejects(()=>previewParameterImport({...base,planningMode:'assisted',assumptions:[' ']},f.call));
  assert.deepEqual(methods(f),[]);
});

test('assisted returns candidate metadata and preserves explicit mapped row data',async()=>{
  const f=fixture();const result=await previewParameterImport({...base,planningMode:'assisted',assumptions:['User permits this candidate level name.']},f.call);
  assert.equal(result.planningMode,'assisted');assert.equal(result.candidateOnly,true);assert.equal(result.planCreated,true);
  assert.deepEqual(result.assumptions,['User permits this candidate level name.']);assert.ok(result.warnings.length);assert.deepEqual(result.missingInputs,[]);assert.deepEqual(result.alternatives,[]);
  const request=f.calls.find(c=>c.method==='revit.plan.create').args;
  assert.equal(request.source,'workflow:imports.parameter_table:assisted');assert.match(request.summary,/User permits this candidate level name\./);
  assert.deepEqual(request.operations,[{operationType:'create_level',name:'AI-1F',elevationMm:0}]);
  noWrites(f);
});

test('assisted does not infer missing row data or create a plan with table errors',async()=>{
  const f=fixture();const result=await previewParameterImport({...base,planningMode:'assisted',assumptions:['Use only reviewed table cells.'],input:invalidTable},f.call);
  assert.equal(result.candidateOnly,true);assert.equal(result.planningMode,'assisted');assert.equal(result.planCreated,false);assert.ok(result.issues.length);assert.ok(result.warnings.length);
  assert.deepEqual(methods(f),['revit.context.get','revit.context.get']);
});

test('table issues are returned only after the source context remains unchanged',async()=>{
  const f=fixture();const result=await previewParameterImport({...base,input:invalidTable},f.call);
  assert.equal(result.planCreated,false);assert.equal(result.status,'validation_issues');assert.ok(result.issues.length);
  assert.deepEqual(methods(f),['revit.context.get','revit.context.get']);noWrites(f);
});

for(const [label,change,code] of [
  ['identity',{identity:'doc-b'},'document_changed'],
  ['revision',{revision:3},'document_revision_changed'],
  ['path',{path:'C:\\models\\other.rvt'},'planning_state_changed'],
  ['saved state',{isModified:true},'planning_state_changed']
]){
  test('parameter preview rejects final '+label+' drift and cancels the known plan once',async()=>{
    const f=fixture({contexts:[context,changedDocument(change)]});
    await assert.rejects(()=>previewParameterImport(base,f.call),error=>{
      assert.equal(error.code,code);assert.equal(error.details.planId,'p1');assert.deepEqual(error.details.previewCleanup,{attempted:true,status:'cancelled'});return true;
    });
    assert.deepEqual(methods(f),['revit.context.get','revit.plan.create','revit.context.get','revit.plan.cancel']);noWrites(f);
  });
  test('table issues reject '+label+' drift without creating or cancelling a plan',async()=>{
    const f=fixture({contexts:[context,changedDocument(change)]});
    await assert.rejects(()=>previewParameterImport({...base,input:invalidTable},f.call),error=>error.code===code);
    assert.deepEqual(methods(f),['revit.context.get','revit.context.get']);noWrites(f);
  });
}

for(const [label,plan,code,hasId] of [
  ['null response',null,'invalid_preview_response',false],
  ['missing plan ID',{status:'pending',documentIdentity:'doc-a',documentRevision:2},'invalid_preview_response',false],
  ['empty plan ID',{planId:' ',status:'pending',documentIdentity:'doc-a',documentRevision:2},'invalid_preview_response',false],
  ['nonpending status',{planId:'p1',status:'failed',documentIdentity:'doc-a',documentRevision:2},'invalid_preview_response',true],
  ['wrong preview identity',{planId:'p1',status:'pending',documentIdentity:'doc-b',documentRevision:2},'plan_scope_mismatch',true],
  ['wrong preview revision',{planId:'p1',status:'pending',documentIdentity:'doc-a',documentRevision:3},'document_revision_changed',true]
])test('invalid parameter preview '+label+' is rejected without retry',async()=>{
  const f=fixture({plan});
  await assert.rejects(()=>previewParameterImport(base,f.call),error=>error.code===code);
  assert.deepEqual(methods(f),['revit.context.get','revit.plan.create',...(hasId?['revit.plan.cancel']:[])]);noWrites(f);
});

test('failed cleanup preserves the original context error and reports uncertainty',async()=>{
  const f=fixture({contexts:[context,changedDocument({revision:3})],cancelError:Object.assign(new Error('cancel connection lost'),{code:'transport_error'})});
  await assert.rejects(()=>previewParameterImport(base,f.call),error=>{
    assert.equal(error.code,'document_revision_changed');assert.equal(error.details.previewCleanup.status,'unknown');assert.equal(error.details.previewCleanup.code,'transport_error');return true;
  });
  assert.equal(methods(f).filter(method=>method==='revit.plan.cancel').length,1);assert.equal(methods(f).filter(method=>method==='revit.plan.create').length,1);noWrites(f);
});

test('create observation timeout is propagated once and never recreates a preview',async()=>{
  const timeout=Object.assign(new Error('preview response timed out'),{code:'timeout'});const f=fixture({createError:timeout});
  await assert.rejects(()=>previewParameterImport(base,f.call),error=>error===timeout);
  assert.deepEqual(methods(f),['revit.context.get','revit.plan.create']);noWrites(f);
});

test('initial identity/revision mismatch, read-only document and incomplete context stop before preview',async()=>{
  for(const [request,native,code] of [
    [{...base,documentIdentity:'other'},context,'document_changed'],
    [{...base,expectedRevision:1},context,'document_revision_changed'],
    [base,changedDocument({isReadOnly:true}),'document_read_only'],
    [base,{active:false},'no_active_document'],
    [base,changedDocument({isFamilyDocument:true}),'no_active_document'],
    [base,changedDocument({isModified:undefined}),'planning_context_invalid'],
    [base,changedDocument({revision:undefined}),'planning_context_invalid']
  ]){
    const f=fixture({contexts:[native]});await assert.rejects(()=>previewParameterImport(request,f.call),error=>error.code===code);
    assert.deepEqual(methods(f),['revit.context.get']);
  }
});

test('parameter input stays strict and explicit source requirements remain separate from ask shape',()=>{
  assert.deepEqual(parameterImportRequestInputSchema.parse({}),{});
  assert.throws(()=>parameterImportInputSchema.parse({mapping:{x:'y'}}));
  assert.throws(()=>parameterImportInputSchema.parse({rows:[],filePath:'x.csv'}));
  assert.throws(()=>parameterImportInputSchema.parse({rows:[{}],save:true}));
  assert.throws(()=>parameterImportInputSchema.parse({rows:[{entities:[]}],format:'image'}));
});

test('unknown mode and explicit missing source are rejected without native calls',async()=>{
  const f=fixture();
  await assert.rejects(()=>previewParameterImport({...base,planningMode:'guess'},f.call));
  await assert.rejects(()=>previewParameterImport({documentIdentity:'doc-a',input:{}},f.call));
  assert.deepEqual(methods(f),[]);
});
