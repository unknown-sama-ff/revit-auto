import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {drawingCandidates} from '../../mcp/drawing-candidates.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const cli=path.join(root,'tools/export-dwg-native.ps1');
const lispPath=path.join(root,'tools/native-dwg-readonly.lsp');
const ps=process.env.NATIVE_DWG_TEST_POWERSHELL||'pwsh';
const psAvailable=spawnSync(ps,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8',timeout:10000}).status===0;
const quote=value=>`'${value.replaceAll("'","''")}'`;

function fixture(){
 const evidence={modelSpace:true,owner330Handle:'A',ownerType:'BLOCK_RECORD',ownerName:'*Model_Space',group67Present:true,group67Raw:0,group67Effective:0,layout410:'Model'};
 return {schemaVersion:2,scope:'selected-ModelSpace-main-graphical-entities',wholeDrawingDecodeAccepted:false,entireDatabaseInventoryComplete:false,designScaleVerified:false,readOnlyRequested:true,saveRequested:false,modelSpaceEntityCount:2,selectionCount:2,selectionCountAfter:2,selectionHandlesStable:true,dbmodBefore:0,dbmodAfter:0,ownerRecordType:'BLOCK_RECORD',ownerRecordName:'*Model_Space',ownerRecordHandle:'A',lineGeometryCount:1,unsupportedGeometryCount:1,insunits:0,insbase:[0,0,0],countsByType:{LINE:1,CIRCLE:1},entities:[{...evidence,handle:'B',type:'LINE',layer:'Walls',coordinateSpace:'native-world-xyz',start:[1,2,3],end:[5,6,3]},{...evidence,handle:'C',type:'CIRCLE',layer:'Other',geometryUnknown:true}]};
}
async function psFunctions(t,body,data=fixture()){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-dwg-unit-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'fixture.json');await fs.writeFile(input,JSON.stringify(data));
 const code=`$ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(cli)},[ref]$tokens,[ref]$errors);if($errors.Count){throw ($errors|Out-String)};$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)|ForEach-Object{Invoke-Expression $_.Extent.Text};$data=Get-Content -LiteralPath ${quote(input)} -Raw|ConvertFrom-Json;${body}`;
 return spawnSync(ps,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:20000});
}

test('scripts use read-only boundaries without private source assumptions',async()=>{
 const bytes=await fs.readFile(cli),source=bytes.toString('utf8'),lisp=await fs.readFile(lispPath,'utf8');
 assert.deepEqual([...bytes.subarray(0,3)],[239,187,191],'PowerShell 5.1 UTF-8 BOM');
 for(const content of [source,lisp])assert.doesNotMatch(content,/2579|480ea5|泵房|D:\\CAD|\b410\s*-ne\s*410/i);
 assert.match(source,/ValidateRange\(1,120\)/);assert.match(source,/\[switch\]\$CheckOnly/);
 assert.match(source,/\/readonly/);assert.match(source,/\/isolate/);assert.match(source,/CreateNoWindow=\$true/);
 assert.match(source,/SHA256\]::Create/);assert.match(source,/FileAttributes\]::ReadOnly/);
 assert.match(source,/StartTime\.ToUniversalTime\(\) -ne \$OwnedStart/);assert.match(source,/MainModule\.FileName/);
 assert.doesNotMatch(source,/Stop-Process|taskkill|Start-Process|New-Object\s+-ComObject|Documents\.Open|\.Save(?:As)?\(/i);
 assert.doesNotMatch(lisp,/\((?:setvar|entmod|entdel|entmake|vl-load-com|vlax-get-acad-object|command)\b/i);
 assert.match(lisp,/\(ssname ss 0\)/);assert.match(lisp,/BLOCK_RECORD/);assert.match(lisp,/\*Model_Space/);
 assert.match(lisp,/\(nr-dxf 410 d\) "Model"/);assert.match(lisp,/\(assoc 67 d\)/);assert.match(lisp,/\(nr-owner d\)/);
 assert.match(lisp,/entireDatabaseInventoryComplete\\\":false/);assert.match(lisp,/geometryUnknown\\\":true/);
});

test('LISP strings and expression structure are balanced',async()=>{
 const rawLines=(await fs.readFile(lispPath,'utf8')).split(/\r?\n/);
 for(let i=0;i<rawLines.length;i++)assert.ok(rawLines[i].length<=240,`Line ${i+1} exceeds 240 chars`);
 const text=rawLines.filter(line=>!line.trimStart().startsWith(';')).join('\n');
 let depth=0,string=false,escape=false;
 for(const ch of text){if(string){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')string=false;}else if(ch==='"')string=true;else if(ch==='(')depth++;else if(ch===')'){depth--;assert.ok(depth>=0);}}
 assert.equal(string,false);assert.equal(depth,0);
});

test('general inventory validates and normalizes to existing drawing candidates contract',{skip:!psAvailable},async t=>{
 const result=await psFunctions(t,"Convert-NativeImport $data 'drawing.dwg' 'fixturehash'|ConvertTo-Json -Depth 14");
 assert.equal(result.status,0,result.stderr);const normalized=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
 assert.equal(normalized.entities.length,2);assert.equal(normalized.entities[0].objectName,'AcDbLine');
 assert.deepEqual(normalized.entities[0].start,{x:1,y:2,z:3});assert.equal(normalized.entities[1].geometryUnknown,true);
 const calibration={scaleMmPerUnit:1,origin:{x:0,y:0},offsetMm:{x:0,y:0,z:0},rotationDegrees:0,levelId:1};
 const mapped=drawingCandidates(normalized,calibration,{Walls:{operationType:'create_wall',wallTypeId:2,heightMm:3000}});
 assert.equal(mapped.operations.length,1);assert.equal(mapped.issues.length,0);assert.equal(mapped.unmappedEntityCount,1);
 const rejected=drawingCandidates(normalized,calibration,{Other:{operationType:'create_wall',wallTypeId:2,heightMm:3000}});
 assert.equal(rejected.operations.length,0);assert.match(rejected.issues[0].message,/Unknown source geometry/);
});

test('owner, scope, duplicates, counts and unavailable XYZ fail closed',{skip:!psAvailable},async t=>{
 const changes=[
  d=>d.entities[0].ownerName='*Paper_Space',d=>d.entities[0].owner330Handle='BAD',
  d=>d.entities[0].layout410='Layout1',d=>d.entities[0].group67Raw=1,
  d=>d.entities[1].handle='B',d=>d.selectionCountAfter=3,d=>d.dbmodAfter=1,
  d=>d.entities[0].start=[null,2,3],d=>d.entities[0].end=['5',6,3],
  d=>d.entities[1].geometryUnknown=false,d=>d.countsByType.CIRCLE=2,
  d=>d.wholeDrawingDecodeAccepted=true,d=>d.entities=[]
 ];
 // Run a single PowerShell process for deterministic, bounded fixture validation.
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-dwg-bad-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'cases.json');await fs.writeFile(file,JSON.stringify(changes.map(change=>{const d=fixture();change(d);return d;})));
 const result=await psFunctions(t,`$cases=Get-Content -LiteralPath ${quote(file)} -Raw|ConvertFrom-Json;$failed=0;foreach($case in $cases){try{Assert-NativeInventory $case}catch{$failed++}};if($failed -ne $cases.Count){throw 'A bad fixture was accepted'};Write-Output $failed`);
 assert.equal(result.status,0,result.stderr);assert.equal(Number(result.stdout.trim()),changes.length);
});

test('absent group67 default0 is preserved, string/infinite values are rejected',{skip:!psAvailable},async t=>{
 const data=fixture();data.entities[0].group67Present=false;data.entities[0].group67Raw=null;
 const good=await psFunctions(t,"Assert-NativeInventory $data; 'ok'",data);assert.equal(good.status,0,good.stderr);
 const bad=await psFunctions(t,'$data.entities[0].start[0]=[double]::PositiveInfinity;Assert-NativeInventory $data');assert.notEqual(bad.status,0);
});

test('CheckOnly checks mock signed inputs without creating output or a process',{skip:!psAvailable||process.platform!=='win32'},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-dwg-check-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'input.dwg'),console=path.join(dir,'accoreconsole.exe'),output=path.join(dir,'must-not-exist');
 await fs.writeFile(input,'AC1021fixture');await fs.writeFile(console,'mock-not-executable');
 const command=`function Get-AuthenticodeSignature {param($LiteralPath) [pscustomobject]@{Status='Valid';SignerCertificate=[pscustomobject]@{Subject='CN=Autodesk mock'}}}; & ${quote(cli)} -SourcePath ${quote(input)} -ConsolePath ${quote(console)} -OutputDirectory ${quote(output)} -CheckOnly`;
 const result=spawnSync(ps,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr);const checked=JSON.parse(result.stdout.replace(/^\uFEFF/,''));assert.equal(checked.processStarted,false);assert.equal(checked.licenseRuntimeVerified,false);
 await assert.rejects(fs.access(output));
 const invalid=spawnSync(ps,['-NoProfile','-NonInteractive','-File',cli,'-SourcePath',input,'-ConsolePath',console,'-OutputDirectory',output,'-TimeoutSeconds','121','-CheckOnly'],{encoding:'utf8',timeout:20000});assert.notEqual(invalid.status,0);await assert.rejects(fs.access(output));
});

test('PowerShell 5.1 grammar parser accepts the CLI without running it',{skip:process.platform!=='win32'},()=>{
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile(${quote(cli)},[ref]$tokens,[ref]$errors);if($errors.Count){$errors|Out-String|Write-Error;exit 1}`],{encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr||result.error?.message);
});

test('ownership cleanup refuses changed PID identity and stops only a matching mock',{skip:!psAvailable},async t=>{
 const result=await psFunctions(t,`$start=[DateTime]::UtcNow;$fake=[pscustomobject]@{HasExited=$false;StartTime=$start;MainModule=[pscustomobject]@{FileName='C:\\mock\\accoreconsole.exe'};Killed=$false};$fake|Add-Member ScriptMethod Kill {$this.Killed=$true};$fake|Add-Member ScriptMethod WaitForExit {param($ms) $true};$rejected=$false;try{Stop-OwnedNativeConsole $fake ($start.AddSeconds(-1)) 'C:\\mock\\accoreconsole.exe'}catch{$rejected=$true};if(-not $rejected -or $fake.Killed){throw 'Reused process identity was not protected'};$rejected=$false;try{Stop-OwnedNativeConsole $fake $start 'C:\\other\\accoreconsole.exe'}catch{$rejected=$true};if(-not $rejected -or $fake.Killed){throw 'Executable mismatch was not protected'};Stop-OwnedNativeConsole $fake $start 'C:\\mock\\accoreconsole.exe';if(-not $fake.Killed){throw 'Matching owned mock was not stopped'};'ok'`);
 assert.equal(result.status,0,result.stderr);
});

test('copy IO failure retains failed manifest and never reaches process start',{skip:!psAvailable||process.platform!=='win32'},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-dwg-io-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'input.dwg'),console=path.join(dir,'accoreconsole.exe'),output=path.join(dir,'output');
 await fs.writeFile(input,'AC1021fixture');await fs.writeFile(console,'mock-not-executable');
 const command=`function Get-AuthenticodeSignature {param($LiteralPath) [pscustomobject]@{Status='Valid';SignerCertificate=[pscustomobject]@{Subject='CN=Autodesk mock'}}};function Get-CimInstance {param($Filter)};function Copy-Item {param($LiteralPath,$Destination) throw 'simulated byte-copy IO failure'};& ${quote(cli)} -SourcePath ${quote(input)} -ConsolePath ${quote(console)} -OutputDirectory ${quote(output)}`;
 const result=spawnSync(ps,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:20000});assert.notEqual(result.status,0);
 const runs=await fs.readdir(output);assert.equal(runs.length,1);const manifest=JSON.parse((await fs.readFile(path.join(output,runs[0],'manifest.json'),'utf8')).replace(/^\uFEFF/,''));
 assert.equal(manifest.status,'failed-unaccepted');assert.match(manifest.failure,/simulated byte-copy IO failure/);assert.equal(manifest.ownedPid,null);assert.equal(manifest.consoleExitCode,null);assert.equal(manifest.sourceSha256Before,manifest.sourceSha256After);
});
