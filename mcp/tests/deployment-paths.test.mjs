import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {XMLParser} from 'fast-xml-parser';
const root=path.resolve(import.meta.dirname,'../..');
const project=new XMLParser({parseTagValue:false,ignoreAttributes:false}).parse(fs.readFileSync(path.join(root,'v27/RevitAutoV27.csproj'),'utf8')).Project;
const group=project.PropertyGroup;
const install=fs.readFileSync(path.join(root,'install-v27.ps1'),'utf8');
const build=fs.readFileSync(path.join(root,'build-v27.ps1'),'utf8');
const helper=fs.readFileSync(path.join(root,'v27/deployment.ps1'),'utf8');
const template=fs.readFileSync(path.join(root,'v27/RevitAutoV27.addin.example'),'utf8');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const ps=(script,cwd=os.tmpdir())=>spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',script],{cwd,encoding:'utf8',timeout:30000});
const windows={skip:process.platform!=='win32'};
const load=`$ErrorActionPreference='Stop'; . ${quote(path.join(root,'v27/deployment.ps1'))}; `;

test('default native build and installer derive the same DLL from project output',()=>{
 const expected=path.win32.normalize(path.win32.join('v27',group.OutputPath,'RevitAutoV27.dll'));
 assert.equal(group.AppendTargetFrameworkToOutputPath,'false');
 assert.match(build,/\$dll=Get-V27DefaultDll \$PSScriptRoot/);
 assert.match(install,/\$AssemblyPath=Get-V27DefaultDll \$root/);
 assert.match(helper,/\$project\.Project\.PropertyGroup\.OutputPath/);
 assert.ok(!expected.includes('v27\\v27'));
});
test('build checks compiler success and expected artifact before tests',()=>{
 const guard=build.indexOf('Build output is missing at the installation path');
 assert.ok(guard>build.indexOf('Revit 2027 plugin build failed.'));
 assert.ok(guard<build.indexOf('& dotnet run'));
 assert.match(build,/Test-Path -LiteralPath \$dll -PathType Leaf/);
 assert.match(build,/-p:CopyRetryCount=0/);
 assert.match(build,/FileShare\]::None/);
});
test('API references support explicit directory and environment without developer paths',()=>{
 assert.equal(group.RevitInstallDir[0]['#text'],'$(REVIT_2027_INSTALL_DIR)');
 assert.equal(group.RevitInstallDir[1]['#text'],'$(ProgramW6432)\\Autodesk\\Revit 2027');
 for(const reference of project.ItemGroup.Reference){
  assert.ok(reference.HintPath.startsWith('$(RevitInstallDir)\\'));
  assert.equal(reference.Private,'false');
 }
 assert.equal(project.Target['@_BeforeTargets'],'ResolveAssemblyReferences');
 assert.doesNotMatch(fs.readFileSync(path.join(root,'v27/RevitAutoV27.csproj'),'utf8'),/D:\\/);
 assert.ok(build.indexOf('Resolve-V27RevitDirectory')<build.indexOf('& dotnet @arguments'));
});
test('installer parses public template and checks dependencies before any installation writes',()=>{
 assert.match(install,/v27\\RevitAutoV27\.addin\.example/);
 const checkOnly=install.indexOf('if($CheckOnly)');
 assert.ok(checkOnly>install.indexOf('$dll=Assert-V27Dll'));
 assert.ok(checkOnly>install.indexOf("await import('@modelcontextprotocol/sdk/server/mcp.js')"));
 for(const mutation of ['New-Item','$addin.Save($manifest)','Set-Content','Copy-Item']){
  assert.ok(install.indexOf(mutation)>checkOnly,mutation);
 }
 assert.match(install,/if\(\$CheckOnly\)\{[^}]*return\s*\}/);
 assert.match(install,/\$target\+'\.backup-'/);
 assert.ok(!template.includes(root));
 const manifest=new XMLParser().parse(template).RevitAddIns.AddIn;
 assert.equal(manifest.Assembly,'RevitAutoV27.dll');
 assert.equal(manifest.FullClassName,'RevitAutoV27.App');
 assert.equal(manifest.AddInId,'6E95F8A9-7A3D-4B4A-9C4F-93F1D92F31C8');
 assert.match(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),/^\*\.addin\s*$/m);
});
test('PowerShell scripts parse without errors',windows,()=>{
 const files=['build-v27.ps1','install-v27.ps1','v27/deployment.ps1'];
 for(const file of files){
  const result=ps(`$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile(${quote(path.join(root,file))},[ref]$tokens,[ref]$errors);if($errors.Count){$errors | Out-String | Write-Error;exit 1}`);
  assert.equal(result.status,0,result.stderr||result.error?.message);
 }
});
test('path resolution remains package-relative from a different working directory',windows,()=>{
 const result=ps(load+`Get-V27DefaultDll ${quote(root)}; Resolve-V27PackagePath ${quote(root)} 'v27/bin/stage/RevitAutoV27.dll'`);
 assert.equal(result.status,0,result.stderr||result.error?.message);
 const lines=result.stdout.trim().split(/\r?\n/);
 assert.equal(lines[0],path.win32.join(root,'v27',group.OutputPath,'RevitAutoV27.dll'));
 assert.equal(lines[1],path.win32.join(root,'v27/bin/stage/RevitAutoV27.dll'));
});
test('output traversal or outside-package assembly paths fail closed',windows,()=>{
 for(const candidate of ['../outside/RevitAutoV27.dll',os.tmpdir()]){
  const result=ps(load+`Resolve-V27PackagePath ${quote(root)} ${quote(candidate)}`);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/inside this package/);
 }
});
test('missing Revit API directory is rejected before any compilation',windows,()=>{
 const missing=path.join(os.tmpdir(),'revit-api-not-present-'+process.pid);
 const result=ps(`& ${quote(path.join(root,'build-v27.ps1'))} -SkipTests -RevitInstallDir ${quote(missing)} -OutputDirectory 'v27/bin/unreachable-test'`);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Missing RevitAPI\.dll/);
 assert.ok(!fs.existsSync(path.join(root,'v27/bin/unreachable-test')));
});
test('non-Revit DLLs cannot be accepted as Revit API references',windows,()=>{
 // Ephemeral framework files exercise version rejection without shipping Autodesk binaries.
 const result=ps(load+`$dir=Join-Path $env:TEMP ('api-version-test-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $dir | Out-Null;try{foreach($name in @('RevitAPI.dll','RevitAPIUI.dll')){Copy-Item -LiteralPath ([object].Assembly.Location) -Destination (Join-Path $dir $name)};Resolve-V27RevitDirectory $dir}finally{foreach($name in @('RevitAPI.dll','RevitAPIUI.dll')){Remove-Item -LiteralPath (Join-Path $dir $name)};Remove-Item -LiteralPath $dir}`);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Unsupported RevitAPI\.dll version/);
});
test('missing installation assembly fails before runtime or manifest writes',windows,()=>{
 const result=ps(`& ${quote(path.join(root,'install-v27.ps1'))} -CheckOnly -AssemblyPath 'v27/bin/not-compiled/RevitAutoV27.dll'`);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Build-v27.ps1 must succeed/);
 assert.ok(!fs.existsSync(path.join(root,'v27/bin/not-compiled')));
});
