import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperations, workflowOperations } from '../workflows.mjs';
import { previewRegisteredWriteWorkflow } from '../registered-planning.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const column = () => ({ operationType:'create_structural_column', symbolId:10, baseLevelId:20, topLevelId:30, baseOffsetMm:100, topOffsetMm:-200, point:{xMm:3000,yMm:4000} });
const grid = () => ({ operationType:'create_grid', name:'AX-1', start:{xMm:0,yMm:0,zMm:0}, end:{xMm:3000,yMm:0,zMm:0} });

test('architecture build creates reviewed columns and named grids in order', () => {
  const {operationType:ignoredColumn,...row}=column(), {operationType:ignoredGrid,...axis}=grid();
  const ops=workflowOperations('architecture.build',{grids:[axis],columns:[{...row,rotationDegrees:90}]});
  assert.deepEqual(ops.map(op=>[op.operationType,op.id]),[['create_grid','grid1'],['create_structural_column','column1']]);
  assert.deepEqual(ops[1].point,{xMm:3000,yMm:4000});
  assert.equal(ops[1].baseOffsetMm,100); assert.equal(ops[1].topOffsetMm,-200);
});

test('structural columns require each type level and offset rather than guessing', () => {
  for(const field of ['symbolId','baseLevelId','topLevelId','baseOffsetMm','topOffsetMm','point']) {
    const op=column(); delete op[field];
    assert.throws(()=>validateOperations([op]),/explicit/);
  }
  assert.throws(()=>validateOperations([{...column(),baseLevelId:30}]),/different/);
});

test('structural columns reject non-type references deferred levels and ignored parameter maps', () => {
  assert.throws(()=>validateOperations([{operationType:'create_level',id:'L',name:'L',elevationMm:0},{...column(),symbolId:'@L'}]),/dedicated architecture copy/);
  for(const field of ['baseLevelId','topLevelId'])
    assert.throws(()=>validateOperations([{operationType:'create_level',id:'L',name:'L',elevationMm:0},{...column(),[field]:'@L'}]),/existing positive native ID/);
  for(const [field,value] of [['family','Concrete'],['type','500'],['heightMm',4000],['parameters',{b:500}],['levelId',20],['point',{xMm:0,yMm:0,zMm:0}]])
    assert.throws(()=>validateOperations([{...column(),[field]:value}]),/explicit|only explicit/);
  assert.throws(()=>validateOperations([{...column(),rotationDegrees:361}]),/rotationDegrees/);
  assert.throws(()=>validateOperations([{...column(),topOffsetMm:NaN}]),/finite/);
});

test('grid creation requires explicit names and horizontal nondegenerate lines', () => {
  for(const name of [undefined,'',' AX-1','AX-1 ',null])
    assert.throws(()=>validateOperations([{...grid(),name}]),/Grid name/);
  assert.throws(()=>validateOperations([{...grid(),end:{xMm:3000,yMm:0,zMm:1}}]),/horizontal/);
  assert.throws(()=>validateOperations([{...grid(),end:{xMm:0.5,yMm:0,zMm:0}}]),/1 mm/);
  assert.throws(()=>validateOperations([{...grid(),start:{xMm:0,yMm:0,zMm:null}}]),/finite/);
  assert.throws(()=>validateOperations([{...grid(),parameters:{Comments:'hidden'}}]),/only an explicit/);
  assert.throws(()=>validateOperations([{...grid(),curve:{kind:'arc'}}]),/only an explicit/);
  assert.doesNotThrow(()=>validateOperations([{...grid(),start:{xMm:0,yMm:0},end:{xMm:3000,yMm:0}}]));
  assert.throws(()=>validateOperations([grid(),grid()]),/unique within/);
});

test('registered architecture preview admits columns and only requests one native preview', async () => {
  const calls=[],context={active:true,document:{identity:'architecture-doc',revision:0,path:'model.rvt',isModified:false,isFamilyDocument:false,isReadOnly:false}};
  const call=async(method,args)=>{
    calls.push({method,args});
    if(method==='revit.context.get')return structuredClone(context);
    if(method==='revit.plan.create')return {planId:'column-preview',status:'pending',documentIdentity:'architecture-doc',documentRevision:0,requiresConfirmation:true};
    throw new Error('Unexpected native method '+method);
  };
  const {operationType,...row}=column();
  const args={name:'architecture.build',planningMode:'explicit',documentIdentity:'architecture-doc',expectedRevision:0,input:{columns:[row]}};
  const result=await previewRegisteredWriteWorkflow(args,getWorkflow(args.name),call);
  assert.equal(result.planCreated,true);
  assert.deepEqual(calls.map(item=>item.method),['revit.context.get','revit.plan.create','revit.context.get']);
  assert.deepEqual(calls[1].args.operations,[{...row,operationType:'create_structural_column',id:'column1'}]);
  assert.equal(calls[1].args.expectedRevision,0);assert.equal(calls[1].args.documentIdentity,'architecture-doc');
  calls.length=0;
  const incomplete={...row};delete incomplete.topOffsetMm;
  await assert.rejects(previewRegisteredWriteWorkflow({...args,input:{columns:[incomplete]}},getWorkflow(args.name),call),/explicit/);
  assert.deepEqual(calls,[]);
});

const room = () => ({operationType:'create_room',levelId:311,xMm:1000,yMm:1000,zMm:0,name:'办公室',number:'101'});

test('room creation requires explicit nonblank unpadded name and number strings', () => {
  const valid=room(), original=structuredClone(valid);
  assert.doesNotThrow(() => validateOperations([valid]));
  assert.deepEqual(valid,original);
  for (const field of ['name','number']) {
    for (const value of ['\u0085','\u0085办公室','办公室\u0085']) {
      const op=room();
      op[field]=value;
      assert.throws(() => validateOperations([op]));
    }
    const bomPrefixed=room();
    bomPrefixed[field]='\uFEFF'+bomPrefixed[field];
    assert.doesNotThrow(() => validateOperations([bomPrefixed]));
    const bomSuffixed=room();
    bomSuffixed[field]+='\uFEFF';
    assert.doesNotThrow(() => validateOperations([bomSuffixed]));
    for (const value of [undefined,null,42,'','   ',' 101','101 ']) {
      const op=room();
      if (value===undefined) delete op[field];
      else op[field]=value;
      assert.throws(() => validateOperations([op]));
    }
  }
});
