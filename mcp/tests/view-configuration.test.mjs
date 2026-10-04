import test from 'node:test';import assert from 'node:assert/strict';
import {referenceViewOperation,verifyViewConfiguration} from '../view-configuration.mjs';
import {validateOperations} from '../workflows.mjs';
function settings(){return {viewId:1,viewType:'FloorPlan',discipline:'Plumbing',viewRange:{top:{levelId:311,offsetMm:4000},cut:{levelId:311,offsetMm:1200},bottom:{levelId:311,offsetMm:0},depth:{levelId:311,offsetMm:-1000}},crop:{active:true,visible:false,min:{xMm:-1500,yMm:-1500,zMm:-1000},max:{xMm:31550,yMm:15750,zMm:5000},origin:{xMm:0,yMm:0,zMm:0},basisX:{x:1,y:0,z:0},basisY:{x:0,y:1,z:0},basisZ:{x:0,y:0,z:1}},lightingCategories:[1,2,3,4].map(id=>({category:'cat'+id,categoryId:id,hiddenSupported:true,hidden:false,graphics:{projectionWeight:-1,projectionColor:null}})),displayStyle:'HLR',detailLevel:'Fine',partsVisibility:'ShowBoth'};}
test('reference operation modifies only the explicitly requested view and viewport',()=>{const op=referenceViewOperation({viewId:2,referenceViewId:1,viewportId:3,paperPoint:{xMm:420,yMm:280,zMm:0}});assert.equal(op.operationType,'configure_view');assert.equal(op.discipline,'Electrical');assert.equal(op.settings.length,7);assert.ok(!Object.hasOwn(op,'elementIds'));});
test('view settings input rejects empty/unknown/duplicate implicit changes',()=>{for(const settings of [[],['unknown'],['crop','crop']])assert.throws(()=>validateOperations([{operationType:'configure_view',viewId:2,referenceViewId:1,settings}]),/settings/);});
test('recenter requires paired viewport/paper point, zero paper Z and finite XY',()=>{assert.throws(()=>referenceViewOperation({viewId:2,referenceViewId:1,viewportId:3}),/together/);assert.throws(()=>referenceViewOperation({viewId:2,referenceViewId:1,viewportId:3,paperPoint:{xMm:420,yMm:280,zMm:3000}}),/zero Z/);assert.throws(()=>referenceViewOperation({viewId:2,referenceViewId:1,viewportId:3,paperPoint:{xMm:NaN,yMm:280,zMm:0}}),/finite/);});
test('native settings match the reference while discipline is explicitly Electrical',()=>{const source=settings(),target={...structuredClone(source),viewId:2,discipline:'Electrical'};const op=referenceViewOperation({viewId:2,referenceViewId:1,viewportId:3,paperPoint:{xMm:420,yMm:280,zMm:0}});assert.equal(verifyViewConfiguration(op,source,target,{viewId:2,position:{xMm:420,yMm:280,zMm:23}}).status,'PASS_NATIVE_SETTINGS');});
test('wrong range, crop and hidden fixture categories cannot pass',()=>{for(const field of ['range','crop','category']){const source=settings(),target={...structuredClone(source),viewId:2,discipline:'Electrical'},op=referenceViewOperation({viewId:2,referenceViewId:1});if(field==='range')target.viewRange.top.offsetMm=2300;else if(field==='crop')target.crop.active=false;else target.lightingCategories[0].hidden=true;assert.throws(()=>verifyViewConfiguration(op,source,target),/differs|differ/);}});
test('settings checks are not falsely labeled as pixel/visual acceptance',()=>{const source=settings(),target={...structuredClone(source),viewId:2,discipline:'Electrical'},op=referenceViewOperation({viewId:2,referenceViewId:1});assert.equal(verifyViewConfiguration(op,source,target).visualStatus,'REQUIRES_IMAGE_REVIEW');});

import fs from 'node:fs/promises';
test('view acceptance never confirms a model plan and native service only mutates target view/viewport',async()=>{
 const runner=await fs.readFile(new URL('../view-acceptance.mjs',import.meta.url),'utf8');const native=await fs.readFile(new URL('../../v27/ViewConfigurationService.cs',import.meta.url),'utf8');
 assert.doesNotMatch(runner,/call\(['"](?:revit_plan_confirm|revit_import_commit)['"]/);assert.match(native,/target\.SetViewRange/);assert.match(native,/target\.SetCategoryHidden/);assert.match(native,/viewport\.SetBoxCenter/);assert.doesNotMatch(native,/source\.(?:Set|CropBox\s*=|Discipline\s*=)|doc\.(?:Delete|Save)\(/);
});

test('actual plan crop evidence compares XY while native view-range heights remain exact',async t=>{
 const folder=new URL('../../acceptance/',import.meta.url);let capture,record;
 try{capture=JSON.parse(await fs.readFile(new URL('view-correction-v037-20261003-pid57124.json.native-inspection.json',folder),'utf8'));record=JSON.parse((await fs.readFile(new URL('view-correction-v037-20261003-pid57124.json',folder),'utf8')).replace(/^\uFEFF/,''));}
 catch(error){if(error.code==='ENOENT'){t.skip('Local native capture is unavailable.');return;}throw error;}
 assert.equal(capture.reference.settings.crop.min.zMm,-30480);assert.equal(capture.target.settings.crop.min.zMm,-304800);assert.equal(capture.target.settings.crop.min.xMm,capture.reference.settings.crop.min.xMm);
 assert.equal(verifyViewConfiguration(record.operations[0],capture.reference.settings,capture.target.settings,capture.placement.drawing).status,'PASS_NATIVE_SETTINGS');
});

test('ignoring plan crop Z does not hide wrong XY bounds or true view-range heights',()=>{
 for(const error of ['cropXY','rangeZ']){const source=settings(),target={...structuredClone(source),viewId:2,discipline:'Electrical'},op=referenceViewOperation({viewId:2,referenceViewId:1});target.crop.min.zMm=-304800;
 if(error==='cropXY')target.crop.min.xMm-=100;else target.viewRange.top.offsetMm=2300;
 assert.throws(()=>verifyViewConfiguration(op,source,target),/differs/);}
});
test('unknown/nonplan crop spaces do not get an implicit Z exception',()=>{const source={...settings(),viewType:'Section'},target={...structuredClone(source),viewId:2,discipline:'Electrical'},op=referenceViewOperation({viewId:2,referenceViewId:1});target.crop.min.zMm=-304800;assert.throws(()=>verifyViewConfiguration(op,source,target),/crop min/);});
