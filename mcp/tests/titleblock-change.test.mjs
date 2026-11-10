import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTitleBlockChangeInput,titleBlockChangeOperations,validateTitleBlockChange,validateTitleBlockChangePlan,inspectTitleBlockChangeScope} from '../titleblock-change.mjs';
import {parseElectricalSheetInput,electricalSheetOperations,inspectElectricalSheetScope} from '../electrical-sheet.mjs';
import {previewRegisteredWriteWorkflow} from '../registered-planning.mjs';
import {getWorkflow} from '../workflow-registry.mjs';

const row={titleBlockInstanceId:10,sheetId:20,targetTypeId:30};
const input={titleBlockChanges:[row]};
function fixture(patch={}){
  const items=[
    {summary:{id:10,className:'FamilyInstance',categoryId:-2000280,ownerViewId:20,typeId:40},titleBlock:{instanceId:10,sheetId:20,typeId:40,
      pinned:false,isReadOnly:false,familyPlacementType:'ViewBased',position:{xMm:0,yMm:0,zMm:0},rotationRadians:0,validTypeIds:[30,40],validTypesComplete:true,
      dependentElementIds:[50],dependenciesComplete:true,sheetTitleBlockInstanceIds:[10,11],sheetTitleBlocksComplete:true}},
    {summary:{id:20,className:'ViewSheet'}},
    {summary:{id:30,className:'FamilySymbol',categoryId:-2000280,placement:'ViewBased'},titleBlock:{typeId:30,categoryId:-2000280,familyPlacementType:'ViewBased',isActive:true}}
  ];
  for(const [index,update] of Object.entries(patch))Object.assign(items[index],update);
  const calls=[];
  const call=async(method,args)=>{calls.push({method,args});assert.equal(method,'revit.inspect');return {items:args.elementIds.map(id=>structuredClone(items.find(item=>item.summary.id===id)))};};
  return {items,call,calls};
}
test('one existing titleblock type change maps to an exact closed native operation',()=>{
  const expected=[{...row,operationType:'change_titleblock_type',id:'titleBlockChange1'}];
  assert.deepEqual(titleBlockChangeOperations(input),expected);
  assert.deepEqual(electricalSheetOperations(input),expected);
  assert.deepEqual(titleBlockChangeOperations(),[]);assert.deepEqual(titleBlockChangeOperations({titleBlockChanges:undefined}),[]);
  assert.deepEqual(parseElectricalSheetInput(input),input);
});
test('unknown fields, guessed ids, duplicates and mixed plans cannot change titleblocks',()=>{
  for(const update of [{titleBlockInstanceId:'@new'},{targetTypeId:0},{sheetId:10},{targetTypeId:Number.MAX_SAFE_INTEGER+1},{path:'hidden'},{parameters:{Comments:'hidden'}},{xMm:0}])
    assert.throws(()=>parseTitleBlockChangeInput({titleBlockChanges:[{...row,...update}]}));
  assert.throws(()=>parseTitleBlockChangeInput({titleBlockChanges:[row,row]}));
  const operation=titleBlockChangeOperations(input)[0];
  for(const update of [{id:null},{id:' '},{dependencies:null},{dependencies:[null]},{parameters:{Comments:'hidden'}},{operationType:'set_parameter'}])
    assert.throws(()=>validateTitleBlockChange({...operation,...update}));
  assert.doesNotThrow(()=>validateTitleBlockChangePlan([operation]));
  assert.throws(()=>validateTitleBlockChangePlan([operation,operation]),error=>error.code==='titleblock_change_requires_single_operation');
  assert.throws(()=>validateTitleBlockChangePlan([operation,{operationType:'delete_element',elementId:10}]),error=>error.code==='titleblock_change_requires_single_operation');
  for(const other of [{sheetChanges:[{sheetId:20,name:'Other'}]},{placementMoves:[{placementId:60,sheetId:20,viewId:70,xMm:0,yMm:0}]},{sheets:[{name:'New',number:'A1'}]}])
    assert.throws(()=>parseElectricalSheetInput({...input,...other}),error=>error.code==='titleblock_change_requires_single_operation');
});
test('native scope discloses owner type position no-op and replacement/dependency uncertainty',async()=>{
  const f=fixture(),review=await inspectElectricalSheetScope(input,f.call);
  assert.deepEqual(f.calls,[{method:'revit.inspect',args:{elementIds:[10,20,30]}}]);
  assert.equal(review.requiredNativeFeature,'controlled-titleblock-change');assert.equal(review.inspectedElementCount,3);
  const change=review.titleBlockChanges[0];
  assert.equal(change.oldTypeId,40);assert.equal(change.noOp,false);assert.deepEqual(change.dependentElementIds,[50]);
  assert.equal(change.nativeMayReplaceInstance,true);assert.equal(change.replacementElementIdKnown,false);
  assert.equal(change.nativeReadbackVerified,false);assert.equal(change.sideEffectsVerified,false);assert.equal(review.automaticSave,false);
  f.items[0].summary.typeId=30;f.items[0].titleBlock.typeId=30;
  const noOp=(await inspectTitleBlockChangeScope(input,f.call)).titleBlockChanges[0];
  assert.equal(noOp.noOp,true);assert.equal(noOp.nativeMayReplaceInstance,false);
});
test('native mismatched instance owner class category type or target are refused',async()=>{
  for(const mutate of [
    items=>{items[0].summary.className='Element';},items=>{items[0].summary.categoryId=-2000151;},
    items=>{items[0].summary.ownerViewId=99;},items=>{items[0].titleBlock.typeId=41;},
    items=>{items[1].summary.className='ViewPlan';},items=>{items[0].titleBlock.instanceId=99;},items=>{items[0].titleBlock.familyPlacementType='OneLevelBased';},
    items=>{items[2].summary.className='FamilyInstance';},items=>{items[2].summary.categoryId=-1;},
    items=>{items[2].summary.placement='OneLevelBased';},items=>{items[2].titleBlock.familyPlacementType='OneLevelBased';}
  ]){
    const f=fixture();mutate(f.items);await assert.rejects(inspectTitleBlockChangeScope(input,f.call));
  }
});
test('unknown pin writable activation location rotation dependency and valid-type evidence fails closed',async()=>{
  for(const mutate of [
    native=>{native.pinned=true;},native=>{delete native.pinned;},native=>{native.isReadOnly=true;},native=>{delete native.isReadOnly;},
    native=>{native.position.xMm=NaN;},native=>{delete native.position.zMm;},native=>{native.rotationRadians=Infinity;},
    native=>{native.dependenciesComplete=false;},native=>{native.dependentElementIds=[50,50];},native=>{native.validTypesComplete=false;},
    native=>{native.validTypeIds=[40];},native=>{native.validTypeIds=[30,0];},native=>{native.sheetTitleBlocksComplete=false;},
    native=>{native.sheetTitleBlockInstanceIds=[11];}
  ]){
    const f=fixture();mutate(f.items[0].titleBlock);await assert.rejects(inspectTitleBlockChangeScope(input,f.call));
  }
  const f=fixture();f.items[2].titleBlock.isActive=false;
  await assert.rejects(inspectTitleBlockChangeScope(input,f.call),error=>error.code==='titleblock_target_inactive');
});
test('missing duplicated unexpected or disappeared inspection items stop without retry',async()=>{
  const f=fixture();
  for(const report of [null,{items:[]},{items:f.items.slice(1)},{items:[f.items[0],f.items[0],f.items[2]]},{items:[f.items[0],f.items[1],{summary:{id:31}}]},{items:[f.items[0],f.items[1],{id:30,exists:false}]}]){
    let calls=0;await assert.rejects(inspectTitleBlockChangeScope(input,async()=>{calls++;return report;}),error=>error.code==='titleblock_scope_unknown');
    assert.equal(calls,1);
  }
});
test('empty or cancelled scope cannot contact native tools',async()=>{
  let calls=0;const call=async()=>{calls++;};
  assert.equal(await inspectTitleBlockChangeScope({},call),null);
  const controller=new AbortController();controller.abort();
  await assert.rejects(inspectTitleBlockChangeScope(input,call,controller.signal));assert.equal(calls,0);
});
for(const name of ['electrical.sheet','architecture.documentation']){
  test(name+' registered preview reads the exact titleblock scope and creates one pinned plan without committing',async()=>{
    const f=fixture(),calls=[],context={active:true,document:{identity:'doc-a',revision:0,path:'test.rvt',isModified:false,isFamilyDocument:false,isReadOnly:false}};
    const call=async(method,args)=>{
      calls.push({method,args});
      if(method==='revit.context.get')return structuredClone(context);
      if(method==='revit.inspect')return f.call(method,args);
      if(method==='revit.plan.create')return {planId:'plan-a',status:'pending',documentIdentity:args.documentIdentity,documentRevision:args.expectedRevision,operations:args.operations,requiresRevitConfirmation:false};
      throw new Error('Unexpected '+method);
    };
    const result=await previewRegisteredWriteWorkflow({name,documentIdentity:'doc-a',expectedRevision:0,input},getWorkflow(name),call);
    assert.equal(result.planCreated,true);assert.equal(result.documentRevision,0);
    assert.equal(result.domainReview.requiredNativeFeature,'controlled-titleblock-change');
    assert.deepEqual(result.plan.operations,titleBlockChangeOperations(input));
    assert.deepEqual(calls.map(item=>item.method),['revit.context.get','revit.inspect','revit.context.get','revit.plan.create','revit.context.get']);
    assert.equal(calls[3].args.source,'workflow:'+name+':explicit');
    assert.equal(calls[3].args.expectedRevision,0);assert.equal(calls[3].args.documentIdentity,'doc-a');
    assert.ok(!calls.some(item=>/confirm|commit|save/.test(item.method)));
  });
  test(name+' rejects invalid native titleblock evidence before native preview creation',async()=>{
    const f=fixture();f.items[0].titleBlock.pinned=true;
    const context={active:true,document:{identity:'doc-a',revision:0,path:'test.rvt',isModified:false}},calls=[];
    const call=async(method,args)=>{calls.push(method);if(method==='revit.context.get')return context;return f.call(method,args);};
    await assert.rejects(previewRegisteredWriteWorkflow({name,documentIdentity:'doc-a',expectedRevision:0,input},getWorkflow(name),call),error=>error.code==='titleblock_read_only');
    assert.deepEqual(calls,['revit.context.get','revit.inspect']);
  });
}
