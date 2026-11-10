import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..');
const project=path.join(root,'v27/RevitAutoV27.csproj');
const helper=path.join(root,'v27/deployment.ps1');
const windows={skip:process.platform!=='win32'};
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const ps=script=>spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:60000});
let fixtureRoot;
let dotnetEnv;
const cases=[
  {name:'paired 27.3 API files',api:'27.3.0.28',ui:'27.3.0.28',ok:true},
  {name:'paired 27.3 patch API files',api:'27.3.2.42',ui:'27.3.2.42',ok:true},
  {name:'legacy 2025 files',api:'25.3.0.28',ui:'25.3.0.28',error:/Unsupported RevitAPI\.dll version/},
  {name:'earlier 27.2 files',api:'27.2.0.28',ui:'27.2.0.28',error:/Unsupported RevitAPI\.dll version/},
  {name:'future 27.4 files',api:'27.4.0.28',ui:'27.4.0.28',error:/Unsupported RevitAPI\.dll version/},
  {name:'mixed 27.3 and 27.4 files',api:'27.3.0.28',ui:'27.4.0.28',error:/Unsupported RevitAPIUI\.dll version/},
  {name:'different 27.3 file builds',api:'27.3.0.28',ui:'27.3.0.29',error:/must have matching file and assembly versions/},
  {name:'different 27.3 assembly builds',api:'27.3.0.28',ui:'27.3.0.28',uiAssembly:'27.3.1.0',error:/must have matching file and assembly versions/},
  {name:'legacy assembly stamped as 27.3',api:'27.3.0.28',ui:'27.3.0.28',apiAssembly:'25.3.0.0',error:/Unsupported RevitAPI\.dll assembly identity/},
  {name:'renamed API masquerading as APIUI',api:'27.3.0.28',ui:'27.3.0.28',renamed:true,error:/Unsupported RevitAPIUI\.dll assembly identity/},
  {name:'unknown file versions',unknown:true,error:/(Unsupported RevitAPI\.dll version|Cannot validate RevitAPI\.dll)/},
  {name:'missing APIUI file',api:'27.3.0.28',missingUi:true,error:/(Missing RevitAPIUI\.dll|Revit API DLLs are missing)/},
];

before(()=>{
  if(process.platform!=='win32')return;
  // Windows TEMP may contain an 8.3 alias. Use one physical path before
  // comparing it with PowerShell's expanded GetFullPath representation.
  fixtureRoot=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'revit-version-gate-')));
  const nugetHome=path.join(fixtureRoot,'nuget-home');
  fs.mkdirSync(path.join(nugetHome,'NuGet'),{recursive:true});
  fs.writeFileSync(path.join(nugetHome,'NuGet','NuGet.Config'),'<configuration><packageSources><clear /></packageSources></configuration>');
  dotnetEnv={...process.env,APPDATA:nugetHome};
  const fixtures=[];
  cases.forEach((entry,index)=>{
    entry.directory=path.join(fixtureRoot,String(index));
    fs.mkdirSync(entry.directory);
    for(const [name,version] of [['RevitAPI',entry.api],['RevitAPIUI',entry.ui]]){
      if(name==='RevitAPIUI'&&(entry.missingUi||entry.renamed))continue;
      const file=path.join(entry.directory,name+'.dll');
      if(entry.unknown){fs.writeFileSync(file,'Version information is unavailable.');continue;}
      const assemblyVersion=entry[name==='RevitAPI'?'apiAssembly':'uiAssembly']||version.split('.').slice(0,2).join('.')+'.0.0';
      fixtures.push({name,file,version,assemblyVersion});
    }
  });
  // Roslyn emits actual PE version resources; PowerShell Add-Type omits them and
  // would only test the unknown-version rejection branch.
  const generator=path.join(fixtureRoot,'generator');
  fs.mkdirSync(generator);
  fs.writeFileSync(path.join(generator,'Generator.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup><Reference Include="Microsoft.CodeAnalysis"><HintPath>$(MSBuildToolsPath)/Roslyn/bincore/Microsoft.CodeAnalysis.dll</HintPath></Reference><Reference Include="Microsoft.CodeAnalysis.CSharp"><HintPath>$(MSBuildToolsPath)/Roslyn/bincore/Microsoft.CodeAnalysis.CSharp.dll</HintPath></Reference></ItemGroup></Project>`);
  fs.writeFileSync(path.join(generator,'Program.cs'),`using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
var references=((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator).Select(file=>MetadataReference.CreateFromFile(file)).ToArray();
foreach(var fixture in JsonDocument.Parse(File.ReadAllText(args[0])).RootElement.EnumerateArray())
{
  var name=fixture.GetProperty("name").GetString()!;
  var file=fixture.GetProperty("file").GetString()!;
  var version=fixture.GetProperty("version").GetString()!;
  var assemblyVersion=fixture.GetProperty("assemblyVersion").GetString()!;
  var source="using System.Reflection; [assembly:AssemblyVersion(\\\""+assemblyVersion+"\\\")] [assembly:AssemblyFileVersion(\\\""+version+"\\\")] public class Fixture {}";
  var compilation=CSharpCompilation.Create(name,new[]{CSharpSyntaxTree.ParseText(source)},references,new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
  using var resources=compilation.CreateDefaultWin32Resources(true,false,null,null);
  using var output=File.Create(file);
  var result=compilation.Emit(output,win32Resources:resources);
  if(!result.Success)throw new Exception(string.Join(Environment.NewLine,result.Diagnostics));
}`);
  const request=path.join(fixtureRoot,'fixtures.json');
  fs.writeFileSync(request,JSON.stringify(fixtures));
  const result=spawnSync('dotnet',['run','--project',path.join(generator,'Generator.csproj'),'--no-launch-profile','--',request],{encoding:'utf8',timeout:60000,env:dotnetEnv});
  assert.equal(result.status,0,result.stdout+result.stderr||result.error?.message);
  for(const entry of cases)if(entry.renamed)fs.copyFileSync(path.join(entry.directory,'RevitAPI.dll'),path.join(entry.directory,'RevitAPIUI.dll'));
});
after(()=>{
  // Only this test's freshly generated fixtures are removed; no Autodesk files are copied.
  if(fixtureRoot)fs.rmSync(fixtureRoot,{recursive:true,force:true});
});

test('direct builds run the exact version gate before resolving native API references',()=>{
  const source=fs.readFileSync(project,'utf8');
  assert.match(source,/<Target Name="ValidateRevitApiDirectory" BeforeTargets="ResolveAssemblyReferences">/);
  assert.match(source,/<ValidateRevitApiVersion RevitInstallDir="\$\(RevitInstallDir\)"\s*\/>/);
  assert.match(source,/version\.FileMajorPart != 27 \|\| version\.FileMinorPart != 3/);
  assert.match(fs.readFileSync(helper,'utf8'),/\$version\.FileMajorPart -ne 27 -or \$version\.FileMinorPart -ne 3/);
});

for(const entry of cases){
  test('deployment gate: '+entry.name,windows,()=>{
    const result=ps(`$ErrorActionPreference='Stop'; . ${quote(helper)}; Resolve-V27RevitDirectory ${quote(entry.directory)}`);
    if(entry.ok){assert.equal(result.status,0,result.stderr||result.error?.message);assert.equal(path.win32.normalize(result.stdout.trim()).toLowerCase(),path.win32.normalize(entry.directory).toLowerCase());}
    else {assert.notEqual(result.status,0);assert.match(result.stderr,entry.error);}
  });
  test('direct MSBuild gate: '+entry.name,windows,()=>{
    // This target never compiles model code or writes the add-in output DLL.
    const result=spawnSync('dotnet',['msbuild',project,'-t:ValidateRevitApiDirectory','-p:RevitInstallDir='+entry.directory,'-v:minimal','-nologo'],{encoding:'utf8',timeout:60000,env:dotnetEnv});
    if(entry.ok)assert.equal(result.status,0,result.stdout+result.stderr||result.error?.message);
    else {assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,entry.error);}
  });
}
