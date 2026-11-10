import test from 'node:test';
import assert from 'node:assert/strict';
import {parseElectricalSheetInput,electricalSheetOperations,inspectElectricalSheetScope} from '../electrical-sheet.mjs';

const ids={SHEET_NUMBER:-1007401,SHEET_NAME:-1007400,VIEW_NAME:-1005112,VIEW_SCALE_PULLDOWN_METRIC:-1005151};
const parameter=(name,value,extra={})=>({id:ids[name],storageType:name==='VIEW_SCALE_PULLDOWN_METRIC'?'Integer':'String',readOnly:false,valueSupported:true,hasValue:true,value,...extra});
const nativeSheet=(id,number='E'+id,name='Sheet '+id)=>({summary:{id,className:'ViewSheet',sheetNumber:number,name},parameters:[parameter('SHEET_NUMBER',number),parameter('SHEET_NAME',name)]});
const nativeView=(id,name='View '+id,scale=100)=>({summary:{id,className:'ViewPlan',isViewTemplate:false,name},parameters:[parameter('VIEW_NAME',name),parameter('VIEW_SCALE_PULLDOWN_METRIC',scale)]});
function fixture(items=[nativeSheet(10,'A101'),nativeView(20)],catalog=[{id:10,className:'ViewSheet',sheetNumber:'A101'}]){
  const calls=[];
  const call=async(method,args)=>{
    calls.push({method,args:structuredClone(args)});
    if(method==='revit.inspect')return {items:args.elementIds.map(id=>structuredClone(items.find(item=>item.summary.id===id)))};
    assert.equal(method,'revit.search');return {items:catalog.slice(args.offset,args.offset+args.limit),offset:args.offset,limit:args.limit,hasMore:args.offset+args.limit<catalog.length};
  };
  return {call,calls};
}

test('metadata rows produce only the four reviewed built-in parameter writes',()=>{
  const input={sheetChanges:[{sheetId:10,name:'Electrical plan',number:'E101'}],viewChanges:[{viewId:20,name:'Lighting plan',scale:100}]};
  assert.deepEqual(electricalSheetOperations(input),[
    {operationType:'set_parameter',id:'sheetNumber1',elementId:10,parameter:'BIP:SHEET_NUMBER',value:'E101'},
    {operationType:'set_parameter',id:'sheetName1',elementId:10,parameter:'BIP:SHEET_NAME',value:'Electrical plan'},
    {operationType:'set_parameter',id:'viewName1',elementId:20,parameter:'BIP:VIEW_NAME',value:'Lighting plan'},
    {operationType:'set_parameter',id:'viewScale1',elementId:20,parameter:'BIP:VIEW_SCALE_PULLDOWN_METRIC',value:100}
  ]);
});
test('existing sheet reuse and complete creation row order remain unchanged',()=>{
  const reuse={sheets:[{id:'sheetReuseTest',titleBlockId:90,number:'AI-E102-REUSE',name:'Reviewed reuse'}],viewports:[{id:'panelSchedulePlacement',sheetId:'@sheetReuseTest',viewId:40,xMm:20,yMm:300,zMm:0}]};
  assert.deepEqual(electricalSheetOperations(reuse),[
    {...reuse.sheets[0],operationType:'create_sheet'}, {...reuse.viewports[0],operationType:'place_viewport'}
  ]);
  const all={views:[{viewFamilyTypeId:1,levelId:2,name:'New',scale:100}],viewConfigurations:[{viewId:'@view1',referenceViewId:3,settings:['crop'],cropBounds:{min:{xMm:0,yMm:0},max:{xMm:100,yMm:100}}}],schedules:[{category:'OST_LightingFixtures',fields:['Mark'],name:'Lights'}],panelSchedules:[{panelId:4,name:'Panel'}],sheets:[{number:'E102',name:'Panel',parameters:{Comments:'Reviewed'}}],viewports:[{sheetId:'@sheet1',viewId:'@panelSchedule1',xMm:20,yMm:300,zMm:0}],tags:[{elementId:4,viewId:3,xMm:0,yMm:0}],dimensions:[{viewId:3,references:['a','b'],start:{xMm:0,yMm:0},end:{xMm:100,yMm:0}}]};
  assert.deepEqual(electricalSheetOperations(all).map(row=>row.operationType),['create_view_plan','configure_view','create_schedule','create_panel_schedule','create_sheet','place_viewport']);
  assert.deepEqual(electricalSheetOperations(all)[4].parameters,{Comments:'Reviewed'});
  assert.equal(parseElectricalSheetInput(all).tags.length,1);
});
test('metadata input rejects unsafe, unsupported and duplicate scopes before reads',()=>{
  for(const input of [
    {sheetChanges:[{sheetId:10}]},{viewChanges:[{viewId:20}]},
    {sheetChanges:[{sheetId:10,name:' '}]},{sheetChanges:[{sheetId:10,number:''}]},
    {viewChanges:[{viewId:20,scale:0}]},{viewChanges:[{viewId:20,scale:1.5}]},{viewChanges:[{viewId:20,scale:2147483648}]},
    {sheetChanges:[{sheetId:'@sheet1',number:'E101'}]},{viewChanges:[{viewId:Number.MAX_SAFE_INTEGER+1,name:'Invalid'}]},
    {sheetChanges:[{sheetId:10,name:'A'},{sheetId:10,number:'E101'}]},
    {viewChanges:[{viewId:20,name:'A'},{viewId:20,scale:100}]},
    {sheetChanges:[{sheetId:10,name:'A'}],viewChanges:[{viewId:10,name:'B'}]},
    {sheetChanges:[{sheetId:10,name:'A',parameter:'Comments'}]},
    {viewChanges:[{viewId:20,name:'A',parameters:{Comments:'Unsafe'}}]},
    ...['code','script','path','filePath','parameterChanges','operations'].map(key=>({[key]:key==='operations'?[]:'unsafe'})),
    ...['code','script','path','parameter'].map(key=>({sheets:[{number:'E101',name:'A',[key]:'unsafe'}]}))
  ])assert.throws(()=>parseElectricalSheetInput(input),JSON.stringify(input));
});
test('configure_view cannot silently accept names, scales or arbitrary native-ignored fields',()=>{
  const row={viewId:20,referenceViewId:21,settings:['crop'],cropBounds:{min:{xMm:0,yMm:0},max:{xMm:100,yMm:100}}};
  for(const patch of [{name:'Ignored'},{scale:100},{parameters:{Comments:'Ignored'}},{path:'ignored'}])assert.throws(()=>parseElectricalSheetInput({viewConfigurations:[{...row,...patch}]}));
});
test('metadata preflight exposes accurate native before/after, known-empty and no-op evidence',async()=>{
  const f=fixture();
  const review=await inspectElectricalSheetScope({sheetChanges:[{sheetId:10,name:'Sheet 10',number:'E101'}],viewChanges:[{viewId:20,name:'View 20',scale:200}]},f.call);
  assert.equal(review.selectedScopeVerified,true);assert.equal(review.inspectedElementCount,2);assert.equal(review.scope,'existing-sheet-and-plan-view-metadata-only');
  assert.deepEqual(review.sheetChanges[0].parameters.map(row=>[row.parameter,row.before,row.after,row.noOp]),[['BIP:SHEET_NUMBER','A101','E101',false],['BIP:SHEET_NAME','Sheet 10','Sheet 10',true]]);
  assert.deepEqual(review.viewChanges[0].parameters.map(row=>[row.parameter,row.before,row.after,row.noOp]),[['BIP:VIEW_NAME','View 20','View 20',true],['BIP:VIEW_SCALE_PULLDOWN_METRIC',100,200,false]]);
  assert.equal(review.sheetNumberCatalog.complete,true);assert.equal(review.automaticSave,false);assert.equal(review.fullLegacyParityVerified,false);
  assert.deepEqual(f.calls.map(row=>row.method),['revit.inspect','revit.search']);
  const empty=nativeView(20);empty.parameters[0]={...empty.parameters[0],hasValue:false,value:null};
  const known=await inspectElectricalSheetScope({viewChanges:[{viewId:20,name:'New'}]},fixture([empty]).call);
  assert.equal(known.viewChanges[0].parameters[0].before,null);assert.equal(known.viewChanges[0].parameters[0].beforeHasValue,false);assert.equal(known.viewChanges[0].parameters[0].noOp,false);
});

test('metadata and placement preflight deduplicates shared sheet/view ids into one inspect batch',async()=>{
  const metadata={sheetChanges:[{sheetId:10,name:'Sheet 10'}],viewChanges:[{viewId:30,name:'View 30'}]};
  const placement={placementMoves:[{placementId:11,sheetId:10,viewId:30,xMm:420,yMm:280,zMm:0}]};
  const items=[nativeSheet(10,'A101'),{summary:{id:11,className:'Viewport',ownerViewId:10},drawing:{sheetId:10,viewId:30,position:{xMm:400,yMm:200,zMm:0}}},{summary:{id:30,className:'ViewPlan',isViewTemplate:false},parameters:[parameter('VIEW_NAME','View 30'),parameter('VIEW_SCALE_PULLDOWN_METRIC',100)]}];
  const f=fixture(items),review=await inspectElectricalSheetScope({...metadata,...placement},f.call);
  assert.deepEqual(f.calls.filter(row=>row.method==='revit.inspect').map(row=>row.args.elementIds),[[10,30,11]]);
  assert.equal(review.inspectionDeduplicated,true);assert.equal(review.inspectionBatches,1);assert.equal(review.inspectedElementCount,3);
  assert.equal(review.inspectionSnapshotShared,true);assert.equal(review.placementMoves[0].after.xMm,420);
});

test('metadata and placement preflight batches the deduplicated union at 100 ids',async()=>{
  const placementMoves=Array.from({length:101},(_,index)=>({placementId:1000+index,sheetId:10,viewId:30,xMm:index,yMm:200,zMm:0}));
  const sheetChanges=[{sheetId:10,name:'Sheet 10'}],viewChanges=[{viewId:30,name:'View 30'}];
  const callArgs=[];
  const call=async(method,args)=>{assert.equal(method,'revit.inspect');callArgs.push(args.elementIds);return {items:args.elementIds.map(id=>id===10?nativeSheet(10):id===30?{summary:{id:30,className:'ViewPlan',isViewTemplate:false},parameters:[parameter('VIEW_NAME','View 30')]}:{summary:{id,className:'Viewport',ownerViewId:10},drawing:{sheetId:10,viewId:30,position:{xMm:0,yMm:200,zMm:0}}})};};
  const review=await inspectElectricalSheetScope({sheetChanges,viewChanges,placementMoves},call);
  assert.deepEqual(callArgs.map(ids=>ids.length),[100,3]);assert.equal(new Set(callArgs.flat()).size,103);assert.equal(review.inspectionBatches,2);assert.equal(review.inspectedElementCount,103);
});

test('placement-only sheet preflight preserves the movement result and error contracts',async()=>{
  const input={placementMoves:[{placementId:11,sheetId:10,viewId:30,xMm:420,yMm:280}]};
  const items=[nativeSheet(10),nativeView(30),{summary:{id:11,className:'Viewport',ownerViewId:10},drawing:{sheetId:10,viewId:30,position:{xMm:400,yMm:200,zMm:0}}}];
  const review=await inspectElectricalSheetScope(input,fixture(items).call);
  assert.equal(review.scope,'explicit-existing-drawing-placements');
  assert.equal(review.nativeMovementAccepted,false);assert.equal(review.allModelSideEffectsVerified,false);
  assert.equal(review.inspectionBatches,1);assert.equal(review.inspectionSnapshotShared,false);
  await assert.rejects(inspectElectricalSheetScope(input,async()=>({items:[]})),error=>error.code==='drawing_placement_scope_unknown');
});

test('shared preflight discards malformed or cancelled native batches without another read',async()=>{
  const input={sheetChanges:[{sheetId:10,name:'New'}],placementMoves:[{placementId:11,sheetId:10,viewId:30,xMm:420,yMm:280}]};
  const items=[nativeSheet(10),{summary:{id:11,className:'Viewport',ownerViewId:10},drawing:{sheetId:10,viewId:30,position:{xMm:400,yMm:200,zMm:0}}},nativeView(30)];
  for(const rows of [[],items.slice(1),[items[0],items[0],items[2]],[items[0],items[1],{id:30,exists:false}]]){
    let reads=0;
    await assert.rejects(inspectElectricalSheetScope(input,async()=>{reads++;return {items:rows};}),error=>error.code==='sheet_scope_unknown');
    assert.equal(reads,1);
  }
  const controller=new AbortController();let reads=0;
  await assert.rejects(inspectElectricalSheetScope(input,async()=>{reads++;controller.abort();return {items};},controller.signal),error=>error.name==='AbortError');
  assert.equal(reads,1);
});
test('built-in names or exact native IDs are resolved uniquely and contradictory evidence is rejected',async()=>{
  for(const named of ['VIEW_NAME','BIP:VIEW_NAME']){
    const item=nativeView(20);item.parameters=[{...parameter('VIEW_NAME','Original'),id:undefined,builtInParameter:named}];
    const review=await inspectElectricalSheetScope({viewChanges:[{viewId:20,name:'New'}]},fixture([item]).call);
    assert.equal(review.viewChanges[0].parameters[0].before,'Original');
  }
  for(const parameters of [
    [parameter('VIEW_NAME','Original'),parameter('VIEW_NAME','Other')],
    [{...parameter('VIEW_NAME','Original'),builtInParameter:'SHEET_NAME'}],
    [{...parameter('VIEW_NAME','Original'),id:ids.SHEET_NAME,builtInParameter:'VIEW_NAME'}]
  ])await assert.rejects(inspectElectricalSheetScope({viewChanges:[{viewId:20,name:'New'}]},fixture([{...nativeView(20),parameters}]).call),e=>e.code==='sheet_metadata_parameter_unknown');
});
test('unknown parameter state is never treated as empty or writable',async()=>{
  const input={viewChanges:[{viewId:20,name:'New'}]};
  for(const parameters of [
    [],[parameter('VIEW_NAME','Original',{storageType:'Integer'})],
    [parameter('VIEW_NAME','Original',{readOnly:true})],[parameter('VIEW_NAME','Original',{readOnly:undefined})],
    [parameter('VIEW_NAME','Original',{valueSupported:false})],[parameter('VIEW_NAME','Original',{valueSupported:undefined})],
    [parameter('VIEW_NAME','Original',{hasValue:undefined})],[parameter('VIEW_NAME',undefined)],
    [parameter('VIEW_NAME',null)],[{name:'View Name',storageType:'String',readOnly:false,valueSupported:true,hasValue:true,value:'Original'}]
  ])await assert.rejects(inspectElectricalSheetScope(input,fixture([{...nativeView(20),parameters}]).call),e=>e.code==='sheet_metadata_parameter_unknown');
  for(const value of [0,-1,1.5,2147483648,undefined,'100'])await assert.rejects(inspectElectricalSheetScope({viewChanges:[{viewId:20,scale:200}]},fixture([{...nativeView(20),parameters:[parameter('VIEW_SCALE_PULLDOWN_METRIC',value)]}]).call),e=>e.code==='sheet_metadata_parameter_unknown');
});
test('native targets must be exact sheets and verified non-template plan views',async()=>{
  for(const [input,item] of [
    [{sheetChanges:[{sheetId:10,name:'New'}]},{...nativeSheet(10),summary:{id:10,className:'ViewPlan'}}],
    [{viewChanges:[{viewId:20,name:'New'}]},{...nativeView(20),summary:{id:20,className:'ViewSheet',isViewTemplate:false}}],
    [{viewChanges:[{viewId:20,name:'New'}]},{...nativeView(20),summary:{id:20,className:'ViewPlan',isViewTemplate:true}}],
    [{viewChanges:[{viewId:20,name:'New'}]},{...nativeView(20),summary:{id:20,className:'ViewPlan'}}]
  ])await assert.rejects(inspectElectricalSheetScope(input,fixture([item]).call),e=>e.code==='sheet_metadata_target_mismatch');
});
test('metadata inspection rejects missing, duplicate, unexpected and disappeared results without retry',async()=>{
  const input={sheetChanges:[{sheetId:10,name:'New'}],viewChanges:[{viewId:20,name:'New'}]};
  for(const result of [null,{items:[]},{items:[nativeSheet(10)]},{items:[nativeSheet(10),nativeSheet(10)]},{items:[nativeSheet(10),nativeView(21)]},{items:[nativeSheet(10),{id:20,exists:false}]}]){
    let calls=0;await assert.rejects(inspectElectricalSheetScope(input,async()=>{calls++;return result;}),e=>e.code==='sheet_scope_unknown');assert.equal(calls,1);
  }
});
test('metadata native reads are bounded to 100 IDs and cancellation is honored',async()=>{
  const rows=Array.from({length:101},(_,index)=>({viewId:index+1,name:'Reviewed '+index}));
  const f=fixture(rows.map(row=>nativeView(row.viewId)));
  const review=await inspectElectricalSheetScope({viewChanges:rows},f.call);
  assert.equal(review.inspectedElementCount,101);assert.deepEqual(f.calls.map(call=>call.args.elementIds.length),[100,1]);
  const controller=new AbortController();controller.abort();let reads=0;
  await assert.rejects(inspectElectricalSheetScope({viewChanges:[rows[0]]},async()=>{reads++;},controller.signal));assert.equal(reads,0);
});
test('sheet number preflight traverses pages and accepts an exact target no-op',async()=>{
  const catalog=Array.from({length:501},(_,index)=>({id:index+1,className:'ViewSheet',sheetNumber:'A'+(index+1)}));
  const f=fixture([nativeSheet(1,'A1')],catalog);
  const review=await inspectElectricalSheetScope({sheetChanges:[{sheetId:1,number:'A1'}]},f.call);
  assert.equal(review.sheetNumberCatalog.count,501);assert.equal(review.sheetChanges[0].parameters[0].noOp,true);
  assert.deepEqual(f.calls.filter(call=>call.method==='revit.search').map(call=>call.args),[{category:'OST_Sheets',limit:500,offset:0},{category:'OST_Sheets',limit:500,offset:500}]);
});
test('sheet numbering rejects occupied numbers, swaps, reused released numbers and new-sheet collisions',async()=>{
  const native=[nativeSheet(10,'A101'),nativeSheet(11,'A102')],catalog=native.map(item=>({...item.summary,id:item.summary.id}));
  for(const input of [
    {sheetChanges:[{sheetId:10,number:'A102'}]},
    {sheetChanges:[{sheetId:10,number:'A102'},{sheetId:11,number:'A101'}]},
    {sheetChanges:[{sheetId:10,number:'E101'},{sheetId:11,number:'E101'}]},
    {sheetChanges:[{sheetId:10,number:'E101'}],sheets:[{number:'E101',name:'New'}]},
    {sheetChanges:[{sheetId:10,number:'E101'}],sheets:[{number:'A101',name:'New'}]},
    {sheetChanges:[{sheetId:10,number:'E101'}],sheets:[{number:'E102',name:'New'},{number:'E102',name:'Other'}]}
  ])await assert.rejects(inspectElectricalSheetScope(input,fixture(native,catalog).call),e=>e.code==='sheet_number_conflict');
});
test('unknown, duplicate, truncated and inconsistent sheet catalogs fail closed',async()=>{
  const input={sheetChanges:[{sheetId:10,number:'E101'}]},valid={id:10,className:'ViewSheet',sheetNumber:'A101'};
  for(const page of [
    null,{items:[],hasMore:true},{items:[valid]}, {items:[valid],hasMore:false,truncated:true},
    {items:[{...valid,sheetNumber:null}],hasMore:false},{items:[{...valid,className:'ViewPlan'}],hasMore:false},
    {items:[valid,valid],hasMore:false},{items:[valid,{...valid,id:11}],hasMore:false},
    {items:[{...valid,sheetNumber:'Different'}],hasMore:false},{items:[],hasMore:false},
    {items:[valid],offset:99,limit:500,hasMore:false},{items:[valid],offset:0,limit:501,hasMore:false},
    {items:Array.from({length:501},(_,index)=>({...valid,id:index+1,sheetNumber:'X'+index})),hasMore:false}
  ]){
    let searches=0;
    await assert.rejects(inspectElectricalSheetScope(input,async(method,args)=>{
      if(method==='revit.inspect')return {items:[nativeSheet(10,'A101')]};
      searches++;return page;
    }),e=>e.code==='sheet_number_catalog_unknown');
    assert.equal(searches,1);
  }
});
test('sheet catalog pagination rejects repeated pages and the 10000-item overflow',async()=>{
  const input={sheetChanges:[{sheetId:10,number:'E101'}]};
  let duplicateSearches=0;
  await assert.rejects(inspectElectricalSheetScope(input,async(method)=>{
    if(method==='revit.inspect')return {items:[nativeSheet(10,'A101')]};
    duplicateSearches++;return {items:[{id:10,className:'ViewSheet',sheetNumber:'A101'}],hasMore:true};
  }),e=>e.code==='sheet_number_catalog_unknown');assert.equal(duplicateSearches,2);
  let searches=0;
  await assert.rejects(inspectElectricalSheetScope(input,async(method,args)=>{
    if(method==='revit.inspect')return {items:[nativeSheet(10,'A101')]};
    searches++;return {items:Array.from({length:500},(_,index)=>({id:args.offset+index+1,className:'ViewSheet',sheetNumber:'A'+(args.offset+index+1)})),offset:args.offset,limit:500,hasMore:true};
  }),e=>e.code==='sheet_number_catalog_truncated');assert.equal(searches,20);
});
test('new sheets reject occupied numbers without requiring a metadata change',async()=>{
  const f=fixture([], [{id:10,className:'ViewSheet',sheetNumber:'E101'}]);
  await assert.rejects(inspectElectricalSheetScope({sheets:[{number:'E101',name:'Plan'}]},f.call),e=>e.code==='sheet_number_conflict');
  assert.deepEqual(f.calls.map(c=>c.method),['revit.search']);
});

test('two new sheets cannot claim the same number before any native read',async()=>{
  const f=fixture();
  await assert.rejects(inspectElectricalSheetScope({sheets:[{number:'E201',name:'A'},{number:'E201',name:'B'}]},f.call),e=>e.code==='sheet_number_conflict');
  assert.deepEqual(f.calls,[]);
});

test('creation-only number checks return a bounded catalog scope without inventing metadata inspection',async()=>{
  const f=fixture([],[{id:10,className:'ViewSheet',sheetNumber:'A101'}]);
  const review=await inspectElectricalSheetScope({sheets:[{number:' E201 ',name:' First '},{number:'E202',name:'Second'}]},f.call);
  assert.equal(review.scope,'new-sheet-number-catalog-only');assert.equal(review.numberScopeVerified,true);
  assert.equal(review.inspectedElementCount,0);assert.equal(review.inspectionBatches,0);
  assert.deepEqual(review.newSheetNumbers,[' E201 ','E202']);
  assert.equal(review.sheetNumberCatalog.count,1);assert.equal(review.nativeCreationAccepted,false);
  assert.deepEqual(f.calls.map(c=>c.method),['revit.search']);
  const empty=await inspectElectricalSheetScope({sheets:[{number:'E101',name:'First sheet'}]},fixture([],[]).call);
  assert.equal(empty.sheetNumberCatalog.complete,true);assert.equal(empty.sheetNumberCatalog.count,0);
});

test('new sheet catalog follows all pages even with no existing metadata edits',async()=>{
  const catalog=Array.from({length:501},(_,i)=>({id:i+1,className:'ViewSheet',sheetNumber:'A'+i}));
  const f=fixture([],catalog);
  await assert.rejects(inspectElectricalSheetScope({sheets:[{number:'A500',name:'Collision on second page'}]},f.call),e=>e.code==='sheet_number_conflict');
  assert.deepEqual(f.calls.map(c=>c.args.offset),[0,500]);
});

test('name-only metadata and new-sheet numbering share the catalog conflict check',async()=>{
  const f=fixture([nativeSheet(10,'A101')],[{id:10,className:'ViewSheet',sheetNumber:'A101'}]);
  await assert.rejects(inspectElectricalSheetScope({sheetChanges:[{sheetId:10,name:'Rename only'}],sheets:[{number:'A101',name:'New'}]},f.call),e=>e.code==='sheet_number_conflict');
  assert.deepEqual(f.calls.map(c=>c.method),['revit.inspect','revit.search']);
});

test('new-sheet numbering is still checked when an existing viewport is moved',async()=>{
  const moves={placementMoves:[{placementId:11,sheetId:10,viewId:30,xMm:420,yMm:280}],sheets:[{number:'E201',name:'New'}]};
  const f=fixture([nativeSheet(10),nativeView(30),{summary:{id:11,className:'Viewport',ownerViewId:10},drawing:{sheetId:10,viewId:30,position:{xMm:400,yMm:200,zMm:0}}}]);
  const review=await inspectElectricalSheetScope(moves,f.call);
  assert.equal(review.scope,'new-sheet-number-catalog-and-existing-drawing-placements');
  assert.equal(review.inspectedElementCount,3);assert.deepEqual(review.newSheetNumbers,['E201']);
  assert.equal(review.placementMoves[0].after.xMm,420);
  assert.deepEqual(f.calls.map(c=>c.method),['revit.inspect','revit.search']);
});

test('creation-only catalog failures and cancellation stop after one read',async()=>{
  const input={sheets:[{number:'E201',name:'New'}]};
  for(const page of [null,{items:[],hasMore:true},{items:[]},{items:[],hasMore:false,truncated:true}]){
    let reads=0;await assert.rejects(inspectElectricalSheetScope(input,async()=>{reads++;return page;}),e=>e.code==='sheet_number_catalog_unknown');
    assert.equal(reads,1);
  }
  const controller=new AbortController();let reads=0;
  await assert.rejects(inspectElectricalSheetScope(input,async()=>{reads++;controller.abort();return {items:[],hasMore:false};},controller.signal),e=>e.name==='AbortError');
  assert.equal(reads,1);
});

test('sheet placement, tags and new-view levels never accept conflicting or ignored selectors',()=>{
  const paperPoint={xMm:10,yMm:20,zMm:0};
  for(const input of [
    {viewports:[{sheetId:1,viewId:2,point:paperPoint}]},
    {viewports:[{sheetId:1,viewId:2,xMm:100,yMm:200,zMm:9,point:paperPoint}]},
    {viewports:[{sheetId:1,viewId:2,xMm:100,yMm:200,zMm:0,point:paperPoint}]},
    {tags:[{elementId:1,viewId:2,point:paperPoint}]},
    {tags:[{elementId:1,viewId:2,xMm:100,yMm:200,point:paperPoint}]},
    {views:[{viewFamilyTypeId:1,levelId:2,level:'Conflicting level'}]},
    {views:[{viewFamilyTypeId:1}]}
  ])assert.throws(()=>parseElectricalSheetInput(input));
  assert.doesNotThrow(()=>parseElectricalSheetInput({views:[{viewFamilyTypeId:1,level:'Reviewed level'}],viewports:[{sheetId:1,viewId:2,...paperPoint}],tags:[{elementId:1,viewId:2,...paperPoint}]}));
});
test('existing creation strings and reference names are preserved verbatim',()=>{
  const input={sheets:[{id:'sheet 1',number:' E101 ',name:' Reviewed sheet '}],viewports:[{sheetId:'@sheet 1',viewId:2,xMm:10,yMm:20,zMm:0}]};
  const operations=electricalSheetOperations(input);
  assert.equal(operations[0].id,input.sheets[0].id);assert.equal(operations[0].number,input.sheets[0].number);assert.equal(operations[0].name,input.sheets[0].name);assert.equal(operations[1].sheetId,input.viewports[0].sheetId);
});

test('scale metadata uses the writable metric dropdown and refuses the readonly scale display parameter',async()=>{
  const display={id:-1005150,builtInParameter:'VIEW_SCALE',storageType:'Integer',readOnly:true,valueSupported:true,hasValue:true,value:100};
  const native={...nativeView(20),parameters:[display,parameter('VIEW_SCALE_PULLDOWN_METRIC',100)]};
  const review=await inspectElectricalSheetScope({viewChanges:[{viewId:20,scale:50}]},fixture([native]).call);
  assert.equal(review.viewChanges[0].parameters[0].parameter,'BIP:VIEW_SCALE_PULLDOWN_METRIC');
  assert.equal(review.viewChanges[0].parameters[0].parameterId,-1005151);
  assert.equal(electricalSheetOperations({viewChanges:[{viewId:20,scale:50}]} )[0].parameter,'BIP:VIEW_SCALE_PULLDOWN_METRIC');
  await assert.rejects(inspectElectricalSheetScope({viewChanges:[{viewId:20,scale:50}]},fixture([{...nativeView(20),parameters:[display]}]).call),e=>e.code==='sheet_metadata_parameter_unknown');
  await assert.rejects(inspectElectricalSheetScope({viewChanges:[{viewId:20,scale:50}]},fixture([{...nativeView(20),parameters:[parameter('VIEW_SCALE_PULLDOWN_METRIC',100,{readOnly:true})]}]).call),e=>e.code==='sheet_metadata_parameter_unknown');
});
