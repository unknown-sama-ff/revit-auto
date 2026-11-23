import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStructuralElement,requireStructuralHostFeature} from '../structural-elements.mjs';
import {validateOperations,workflowOperations} from '../workflows.mjs';
import {previewRegisteredWriteWorkflow} from '../registered-planning.mjs';
import {getWorkflow} from '../workflow-registry.mjs';
const beam=()=>({operationType:'create_structural_beam',symbolId:21,levelId:311,start:{xMm:0,yMm:0,zMm:4000},end:{xMm:4000,yMm:0,zMm:4500},rotationDegrees:0});
const footing=()=>({operationType:'create_isolated_foundation',symbolId:31,levelId:311,point:{xMm:0,yMm:0,zMm:-500},rotationDegrees:90});
test('beam and isolated foundation preserve explicit absolute geometry and original input',()=>{
 for(const op of [beam(),footing()]){const before=structuredClone(op);assert.equal(validateStructuralElement(op),op);assert.equal(validateOperations([op])[0],op);assert.deepEqual(op,before);}
});
test('types and levels require existing safe native IDs rather than inferred or deferred IDs',()=>{
 for(const field of ['symbolId','levelId'])for(const value of [undefined,null,0,-1,1.5,'21','@new-type',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateStructuralElement({...beam(),[field]:value}),/native|existing|geometry/);
});
test('every XYZ coordinate is explicit finite bounded numeric data',()=>{
 for(const shape of [beam(),footing()])for(const key of shape.point?['point']:['start','end'])for(const axis of ['xMm','yMm','zMm'])for(const value of [undefined,null,'0',NaN,Infinity,1e8+1]){
  const op=structuredClone(shape);op[key][axis]=value;assert.throws(()=>validateStructuralElement(op));
 }
 for(const extra of [{xMm:0,yMm:0,zMm:0,w:1},{xMm:0,yMm:0}])assert.throws(()=>validateStructuralElement({...footing(),point:extra}));
});
test('sloping beams are retained but vertical or submillimeter horizontal spans are refused',()=>{
 validateStructuralElement(beam());
 for(const end of [{xMm:0,yMm:0,zMm:8000},{xMm:0.5,yMm:0,zMm:8000}])assert.throws(()=>validateStructuralElement({...beam(),end}),/horizontal span/);
});
test('rotation is bounded and placement defaults are not smuggled into controlled operations',()=>{
 for(const value of [null,'0',NaN,Infinity,361,-361])assert.throws(()=>validateStructuralElement({...beam(),rotationDegrees:value}));
 for(const op of [{...beam(),usage:'brace'},{...beam(),parameters:{a:1}},{...footing(),hostElementId:9},{...footing(),point:{xMm:0,yMm:0,zMm:0},offsetMm:20}])assert.throws(()=>validateStructuralElement(op),/unknown/);
});
test('structure workflow emits only declared beam/foundation operations and uses shared validator',()=>{
 const {operationType:omitBeam,...a}=beam(),{operationType:omitFoundation,...b}=footing();
 const operations=workflowOperations('structure.build',{beams:[a],isolatedFoundations:[b]});
 assert.deepEqual(operations.map(op=>op.operationType),['create_structural_beam','create_isolated_foundation']);
 assert.deepEqual(operations.map(op=>op.id),['beam1','foundation1']);
 assert.throws(()=>workflowOperations('structure.build',{beams:[a],operations:[{operationType:'delete_element',elementId:8}]}));
 assert.throws(()=>workflowOperations('structure.build',{beams:'invalid'}));
});
test('older loaded add-ins are refused without a native plan request',async()=>{
 const calls=[];await assert.rejects(requireStructuralHostFeature(async method=>{calls.push(method);return{moduleVersionId:'old',features:[]};}),e=>e.code==='structural_native_feature_unavailable');
 assert.deepEqual(calls,['revit.bridge.info']);
});
test('registered structure workflow refuses unavailable native feature and never dispatches create or commit',async()=>{
 const {operationType,...row}=beam(),calls=[];
 await assert.rejects(previewRegisteredWriteWorkflow({name:'structure.build',documentIdentity:'doc',expectedRevision:0,input:{beams:[row]}},getWorkflow('structure.build'),async method=>{
  calls.push(method);if(method==='revit.context.get')return{active:true,document:{identity:'doc',revision:0,path:'test.rvt',isFamilyDocument:false,isReadOnly:false,isModified:false}};
  if(method==='revit.bridge.info')return{features:[]};throw Error('A plan must not be sent.');
 }),e=>e.code==='structural_native_feature_unavailable');
 assert.deepEqual(calls,['revit.context.get','revit.bridge.info']);
});
