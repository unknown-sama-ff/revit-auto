import test from 'node:test';import assert from 'node:assert/strict';import {drawingCandidates} from '../imports.mjs';
const calibration={scaleMmPerUnit:100,origin:{x:0,y:0},offsetMm:{x:0,y:0,z:0},rotationDegrees:0,levelId:1};
const data={entities:[{objectName:'AcDbLine',layer:'wall',start:{x:0,y:0,z:0},end:{x:10,y:0,z:0}}]};
test('candidate geometry does not forward destructive or arbitrary layer operations',()=>assert.throws(()=>drawingCandidates(data,calibration,{wall:{operationType:'delete_element',elementId:99}}),/candidate|controlled|unsupported/i));

import {validateCalibration} from '../drawing-candidates.mjs';
test('calibration requires explicit rotation and never coerces string numbers or unknown source planes',()=>{
 for(const c of [{...calibration,rotationDegrees:undefined},{...calibration,scaleMmPerUnit:'100'},{...calibration,levelId:0},{...calibration,sourceYAxis:'automatic'},{...calibration,offsetMm:{x:0,y:0}},{...calibration,code:'unsafe'}])assert.throws(()=>validateCalibration(c));
});
test('candidate transformation preserves known source Z, explicit pixel orientation and provenance',()=>{
 const c={...calibration,sourcePlaneZ:0,sourceYAxis:'down',rotationDegrees:90,offsetMm:{x:1000,y:2000,z:3000}};
 const result=drawingCandidates({entities:[{objectName:'AcDbLine',layer:'wall',handle:'real-entity',start:{x:1,y:2,z:0},end:{x:3,y:2,z:0}}]},c,{wall:{operationType:'create_wall',wallTypeId:2,heightMm:3000}});
 assert.ok(Math.abs(result.operations[0].start.xMm-1200)<1e-6);assert.ok(Math.abs(result.operations[0].start.yMm-2100)<1e-6);assert.equal(result.operations[0].start.zMm,3000);assert.equal(result.provenance[0].handle,'real-entity');
});
test('unknown/scaled/mirrored blocks and unsupported curved profiles return issues not invented family geometry',()=>{
 const c={...calibration,sourcePlaneZ:0};const mapped={block:{operationType:'create_family_instance',symbolId:99}};
 for(const entity of [{objectName:'AcDbBlockReference',layer:'block',insertion:{x:1,y:2,z:0},rotation:0},{objectName:'AcDbBlockReference',layer:'block',normal:{x:0,y:0,z:1},insertion:{x:1,y:2,z:0},rotation:0,scaleFactors:{x:-1,y:1,z:1}},{objectName:'AcDbBlockReference',layer:'block',normal:{x:0,y:0,z:1},insertion:{x:1,y:2,z:0}}]){const result=drawingCandidates({entities:[entity]},c,mapped);assert.equal(result.operations.length,0);assert.equal(result.issues.length,1);}
});
test('floor candidate profile uses explicit coordinate plane and rejects self-intersecting polygon',()=>{
 const c={...calibration,sourcePlaneZ:0};const mapped={floor:{operationType:'create_floor',floorTypeId:3}};
 const square={objectName:'AcDbPolyline',layer:'floor',closed:true,coordinates:[0,0,10,0,10,10,0,10],normal:{x:0,y:0,z:1},bulges:[0,0,0,0]};
 const accepted=drawingCandidates({entities:[square]},c,mapped);assert.equal(accepted.operations.length,1);assert.equal(accepted.operations[0].boundary.length,4);
 const invalid=drawingCandidates({entities:[{...square,coordinates:[0,0,10,10,10,0,0,10]}]},c,mapped);assert.equal(invalid.operations.length,0);assert.equal(invalid.issues.length,1);
});

import {spawnSync} from 'node:child_process';import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
test('2D polyline height comes from explicit native elevation, not ignored coordinate Z',()=>{
 const entity={objectName:'AcDb2dPolyline',layer:'floor',closed:true,coordinateStride:3,coordinates:[0,0,999,10,0,999,10,10,999,0,10,999],normal:{x:0,y:0,z:1},elevation:2,bulges:[0,0,0,0]};
 const result=drawingCandidates({entities:[entity]},{...calibration,sourcePlaneZ:0},{floor:{operationType:'create_floor',floorTypeId:3}});assert.equal(result.operations.length,1);assert.ok(result.operations[0].boundary.every(p=>p.zMm===200));
});
test('block candidate requires explicit native unit scale and preserves rotation evidence',()=>{
 const entity={objectName:'AcDbBlockReference',layer:'block',normal:{x:0,y:0,z:1},insertion:{x:2,y:3,z:0},rotation:Math.PI/2,scaleFactors:{x:1,y:1,z:1}};
 const result=drawingCandidates({entities:[entity]},{...calibration,rotationDegrees:30},{block:{operationType:'create_family_instance',symbolId:4}});assert.equal(result.operations.length,1);assert.ok(Math.abs(result.operations[0].rotationDegrees-120)<1e-6);
 const missing=structuredClone(entity);delete missing.scaleFactors;const unknown=drawingCandidates({entities:[missing]},calibration,{block:{operationType:'create_family_instance',symbolId:4}});assert.equal(unknown.operations.length,0);assert.match(unknown.issues[0].message,/scale.*unknown/i);
});
test('AutoCAD extraction source is read-only and checks active file/modified state without hiding unknown geometry (source contract)',async()=>{
 const source=await fs.readFile(path.join(root,'mcp/export-dwg.ps1'),'utf8');assert.match(source,/GetBulge/);assert.match(source,/\$e\.Elevation/);assert.match(source,/\$e\.Normal/);assert.match(source,/\$e\.XScaleFactor/);assert.match(source,/geometryUnknown=\$true/);assert.match(source,/GetVariable\('DBMOD'\)/);assert.match(source,/45-second/);assert.doesNotMatch(source,/\.Save\(|\.SaveAs\(|\.Documents\.Open|\.Documents\.Add|Start-Process|\.SetVariable\(/);
});
test('fixed AutoCAD extraction script parses without starting AutoCAD',{skip:process.platform!=='win32'},()=>{
 const file=path.join(root,'mcp/export-dwg.ps1').replaceAll("'","''");const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',`$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$tokens,[ref]$errors);if($errors.Count){$errors|Out-String|Write-Error;exit 1}`],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr||result.error?.message);
});

test('explicit downward source Y axis transforms block rotation without guessing mirrored scale',()=>{
 const entity={objectName:'AcDbBlockReference',layer:'block',normal:{x:0,y:0,z:1},insertion:{x:2,y:3,z:0},rotation:Math.PI/2,scaleFactors:{x:1,y:1,z:1}};
 const result=drawingCandidates({entities:[entity]},{...calibration,sourceYAxis:'down',rotationDegrees:30},{block:{operationType:'create_family_instance',symbolId:4}});assert.equal(result.operations.length,1);assert.ok(Math.abs(result.operations[0].rotationDegrees-(-60))<1e-6);
});

test('mapping fields must belong to the selected candidate operation instead of being silently ignored',()=>{
 assert.throws(()=>drawingCandidates(data,calibration,{wall:{operationType:'create_wall',wallTypeId:2,heightMm:3000,systemTypeId:4}}),/unsupported/);
 const grid=drawingCandidates(data,calibration,{wall:{operationType:'create_grid',name:'AX-1'}});assert.equal(grid.operations[0].name,'AX-1');
});
