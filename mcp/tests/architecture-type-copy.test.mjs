import test from 'node:test';
import assert from 'node:assert/strict';
import { architectureTypeCopySchema, architectureTypeCopyOperations, validateArchitectureTypeCopyPlan } from '../architecture-type-copy.mjs';
import { validateOperations, workflowOperations } from '../workflows.mjs';
import { previewRegisteredWriteWorkflow } from '../registered-planning.mjs';
import { getWorkflow } from '../workflow-registry.mjs';

const copy = (category='OST_StructuralColumns') => ({sourceTypeId:10,name:'Reviewed 500',category,dimensions:[
  {parameterId:101,name:'b',valueMm:500},{parameterId:102,name:'h',valueMm:500}
]});
const operation = (category='OST_StructuralColumns') => ({...copy(category),operationType:'duplicate_architecture_type',id:'type1'});
const column = () => ({operationType:'create_structural_column',symbolId:'@type1',baseLevelId:20,topLevelId:30,baseOffsetMm:0,topOffsetMm:0,point:{xMm:1000,yMm:2000}});
const placement = (category='OST_Doors',symbolId='@type1') => ({operationType:'create_family_instance',category,symbolId,hostElementId:50,levelId:20,point:{xMm:1000,yMm:0,zMm:0}});

test('architecture copy binds exactly two explicit native dimension parameters without trimming names',()=>{
  const row={...copy(),id:'copy-column',dependencies:['prior']};
  assert.deepEqual(architectureTypeCopySchema.parse(row),row);
  const builtin=copy('OST_Doors');builtin.dimensions[0].parameterId=-1001301;builtin.dimensions[1].parameterId=-1001302;
  assert.doesNotThrow(()=>architectureTypeCopySchema.parse(builtin));
  for(const field of ['sourceTypeId','name','category','dimensions']){const bad=copy();delete bad[field];assert.throws(()=>architectureTypeCopySchema.parse(bad));}
  for(const patch of [{sourceTypeId:'@source'},{sourceTypeId:0},{sourceTypeId:Number.MAX_SAFE_INTEGER+1},{name:' Reviewed'},{name:'Reviewed '},{category:'OST_LightingFixtures'},{parameters:{b:500}},{path:'source.rfa'},{widthMm:500}])
    assert.throws(()=>architectureTypeCopySchema.parse({...copy(),...patch}));
});

test('architecture copy refuses missing duplicated ambiguous or unbounded dimensions',()=>{
  for(const dimensions of [[],copy().dimensions.slice(0,1),[...copy().dimensions,{parameterId:103,name:'extra',valueMm:500}],
    [{...copy().dimensions[0]},{...copy().dimensions[1],parameterId:101}],
    [{...copy().dimensions[0]},{...copy().dimensions[1],name:'b'}]])assert.throws(()=>architectureTypeCopySchema.parse({...copy(),dimensions}));
  for(const patch of [{parameterId:0},{parameterId:0.5},{parameterId:Number.MAX_SAFE_INTEGER+1},{parameterId:'BIP:FAMILY_WIDTH_PARAM'},
    {name:''},{name:' b'},{name:'b '},{valueMm:0},{valueMm:-1},{valueMm:NaN},{valueMm:Infinity},{valueMm:100000001},{unit:'mm'},{parameter:'b'}]){
    const row=copy();Object.assign(row.dimensions[0],patch);assert.throws(()=>architectureTypeCopySchema.parse(row));
  }
  for(const patch of [{id:' '},{id:' type1'},{id:'type\n1'},{dependencies:['missing','missing']},{dependencies:'type1'},{dependencies:[' ']},{dependencies:['before\u0085after']},{id:'type1',dependencies:['type1']}])
    assert.throws(()=>architectureTypeCopySchema.parse({...copy(),...patch}));
});

test('architecture copy names reject controls and Revit type-name delimiters while dimension names stay exact',()=>{
  for(const delimiter of '\\/:{}[]|;<>?`~')assert.throws(()=>architectureTypeCopySchema.parse({...copy(),name:'Reviewed'+delimiter+'500'}));
  for(const control of ['\n','\t','\u0000','\u007f','\u0085','\u009f']){
    assert.throws(()=>architectureTypeCopySchema.parse({...copy(),name:'Reviewed'+control+'500'}));
    const row=copy();row.dimensions[0].name='b'+control+'width';assert.throws(()=>architectureTypeCopySchema.parse(row));
  }
  const parameter=copy();parameter.dimensions[0].name='Dimension [width]/b';assert.doesNotThrow(()=>architectureTypeCopySchema.parse(parameter));
  assert.throws(()=>architectureTypeCopyOperations({typeCopies:[{...copy(),dependencies:['type1']}]}),/itself/);
});

test('architecture builder emits dedicated copies before matching column door and window placements',()=>{
  const columnRow=column();delete columnRow.operationType;
  const ops=workflowOperations('architecture.build',{typeCopies:[copy()],columns:[columnRow]});
  assert.deepEqual(ops.map(row=>[row.operationType,row.id]),[['duplicate_architecture_type','type1'],['create_structural_column','column1']]);
  assert.deepEqual(ops[0].dimensions,copy().dimensions);assert.equal(ops[1].symbolId,'@type1');
  const rows=['OST_Doors','OST_Windows'].map((category,index)=>({...copy(category),sourceTypeId:10+index,id:index?'window-type':'door-type'}));
  const doors=placement('OST_Doors','@door-type'),windows=placement('OST_Windows','@window-type');delete doors.operationType;delete windows.operationType;
  const openings=workflowOperations('architecture.openings',{typeCopies:rows,doors:[doors],windows:[windows]});
  assert.deepEqual(openings.map(row=>row.operationType),['duplicate_architecture_type','duplicate_architecture_type','create_family_instance','create_family_instance']);
  assert.equal(openings[2].category,'OST_Doors');assert.equal(openings[3].category,'OST_Windows');
  const custom=architectureTypeCopyOperations({typeCopies:[{...copy(),id:'custom',dependencies:['earlier']}]});
  assert.equal(custom[0].id,'custom');assert.deepEqual(custom[0].dependencies,['earlier']);
});

test('architecture plans require existing copy sources unique source names and earlier references',()=>{
  assert.throws(()=>validateOperations([{...operation(),sourceTypeId:'@type1'}]));
  assert.throws(()=>validateOperations([column(),operation()]),/earlier/);
  assert.throws(()=>validateOperations([operation(),{...operation(),id:'type2'}]),/same source.*name/);
  assert.doesNotThrow(()=>validateOperations([operation(),{...operation(),name:'Reviewed 600',id:'type2'}]));
  assert.doesNotThrow(()=>validateOperations([operation(),{...operation(),sourceTypeId:11,id:'type2'}]));
  assert.throws(()=>validateOperations([{...operation(),dependencies:['missing']}]),/Unresolved dependency/);
  assert.throws(()=>validateOperations([{...operation(),parameters:{b:500}}]));
});

test('copy source and new type are protected from same-plan changes regardless of operation order',()=>{
  const mutations=[{operationType:'set_parameter',elementId:10,parameter:'b',value:{value:600,unit:'mm'}},
    {operationType:'delete_element',elementId:10},{operationType:'duplicate_type',sourceTypeId:10,name:'Other'}];
  for(const mutation of mutations)for(const operations of [[mutation,operation()],[operation(),mutation]])
    assert.throws(()=>validateOperations(operations),/protected/);
  for(const mutation of mutations){const target=mutation.operationType==='duplicate_type'?'sourceTypeId':'elementId';assert.throws(()=>validateOperations([operation(),{...mutation,[target]:'@type1'}]),/protected/);}
  const load={operationType:'load_family'};
  assert.throws(()=>validateArchitectureTypeCopyPlan([operation(),load]),/load_family/);
  const validLoad={operationType:'load_family',familyKey:'reviewed-family',sha256:'a'.repeat(64),catalogSha256:'b'.repeat(64),expectedFamilyName:'Reviewed',expectedCategoryId:-2000023,requiredTypes:['Standard'],conflictPolicy:'reject',overwriteTypeParameters:false};
  for(const operations of [[validLoad,operation()],[operation(),validLoad]])assert.throws(()=>validateOperations(operations),/load_family/);
  for(const placement of [{...column(),symbolId:10},{operationType:'create_family_instance',symbolId:10,levelId:20,point:{xMm:0,yMm:0,zMm:0}}])
    for(const operations of [[placement,operation()],[operation(),placement]])assert.throws(()=>validateOperations(operations),/activate.*source/);
  assert.doesNotThrow(()=>validateOperations([operation(),{operationType:'set_parameter',elementId:999,parameter:'Comments',value:'Reviewed'}]));
});

test('architecture placements cannot borrow a different category or generic duplicate reference',()=>{
  for(const source of [operation('OST_Doors'),{operationType:'duplicate_type',id:'type1',sourceTypeId:10,name:'Generic'},{operationType:'create_level',id:'type1',name:'L',elevationMm:0}])
    assert.throws(()=>validateOperations([source,column()]),/dedicated|matching/);
  for(const category of ['OST_Doors','OST_Windows',undefined]){
    const row=placement(category);if(category===undefined)delete row.category;
    assert.throws(()=>validateOperations([operation(),row]),/matching|door.*window/);
  }
  assert.throws(()=>validateOperations([operation('OST_Windows'),placement('OST_Doors')]),/matching/);
  assert.throws(()=>validateOperations([{operationType:'duplicate_type',id:'type1',sourceTypeId:10,name:'Generic'},placement()]),/dedicated/);
  const wrong=placement('OST_Windows',50);delete wrong.operationType;
  assert.throws(()=>workflowOperations('architecture.openings',{doors:[wrong]}),/category/);
});

test('copied architecture type references cannot stand in for instance host level or circuit IDs',()=>{
  for(const row of [{operationType:'create_tag',elementId:'@type1',viewId:40,xMm:0,yMm:0},
    {...placement('OST_Doors',40),hostElementId:'@type1'},
    {...placement('OST_Doors',40),levelId:'@type1'},
    {operationType:'create_circuit',elementIds:['@type1'],panelId:50}])
    assert.throws(()=>validateOperations([operation('OST_Doors'),row]),/only as the symbol|instance-element/);
});

test('lighting generic type copies and existing architecture placements remain supported',()=>{
  const lighting=workflowOperations('lighting.place',{typeCopies:[{sourceTypeId:10,name:'Existing lighting copy'}],lights:[{symbolId:'@type1',levelId:20,xMm:0,yMm:0,zMm:3000}]});
  assert.deepEqual(lighting.map(row=>row.operationType),['duplicate_type','create_family_instance']);
  const doors=placement('OST_Doors',40);delete doors.operationType;
  assert.doesNotThrow(()=>workflowOperations('architecture.openings',{doors:[doors]}));
  assert.doesNotThrow(()=>validateOperations([{...column(),symbolId:40}]));
});

test('registered architecture copy preview preserves pins and only creates one pending plan',async()=>{
  const calls=[],context={active:true,document:{identity:'architecture-doc',revision:0,path:'model.rvt',isModified:false,isFamilyDocument:false,isReadOnly:false}};
  const call=async(method,args)=>{calls.push({method,args});if(method==='revit.context.get')return structuredClone(context);if(method==='revit.plan.create')return {planId:'copy-preview',status:'pending',documentIdentity:'architecture-doc',documentRevision:0};throw new Error('Unexpected method '+method);};
  const row=column();delete row.operationType;
  const args={name:'architecture.build',planningMode:'explicit',documentIdentity:'architecture-doc',expectedRevision:0,input:{typeCopies:[copy()],columns:[row]}};
  const result=await previewRegisteredWriteWorkflow(args,getWorkflow(args.name),call);
  assert.equal(result.planCreated,true);assert.deepEqual(calls.map(row=>row.method),['revit.context.get','revit.plan.create','revit.context.get']);
  assert.equal(calls[1].args.expectedRevision,0);assert.equal(calls[1].args.operations[0].operationType,'duplicate_architecture_type');
  calls.length=0;await assert.rejects(previewRegisteredWriteWorkflow({...args,input:{typeCopies:[{...copy(),parameters:{b:500}}]}},getWorkflow(args.name),call));assert.deepEqual(calls,[]);
  const door=placement();delete door.operationType;
  const openingArgs={...args,name:'architecture.openings',input:{typeCopies:[copy('OST_Doors')],doors:[door]}};
  await previewRegisteredWriteWorkflow(openingArgs,getWorkflow(openingArgs.name),call);
  assert.deepEqual(calls[1].args.operations.map(operation=>operation.operationType),['duplicate_architecture_type','create_family_instance']);
  assert.equal(calls[1].args.operations[1].category,'OST_Doors');calls.length=0;
  await assert.rejects(previewRegisteredWriteWorkflow({...openingArgs,input:{typeCopies:[copy('OST_Windows')],doors:[door]}},getWorkflow(openingArgs.name),call),/matching/);assert.deepEqual(calls,[]);
  await previewRegisteredWriteWorkflow({...openingArgs,input:{typeCopies:[copy()]}},getWorkflow(openingArgs.name),call);
  assert.deepEqual(calls[1].args.operations.map(operation=>operation.operationType),['duplicate_architecture_type']);calls.length=0;
  const ask=await previewRegisteredWriteWorkflow({...args,planningMode:'ask',input:{}},getWorkflow(args.name),call);assert.equal(ask.planCreated,false);assert.deepEqual(calls,[]);
});
