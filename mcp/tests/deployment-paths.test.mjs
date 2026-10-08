import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {XMLParser} from 'fast-xml-parser';
const root=path.resolve(import.meta.dirname,'../..');
const project=new XMLParser({parseTagValue:false}).parse(fs.readFileSync(path.join(root,'v27/RevitAutoV27.csproj'),'utf8')).Project;
const group=project.PropertyGroup;
const install=fs.readFileSync(path.join(root,'install-v27.ps1'),'utf8');
const build=fs.readFileSync(path.join(root,'build-v27.ps1'),'utf8');
const dllFromScript=source=>source.match(/\$dll=Join-Path \$(?:root|PSScriptRoot) '([^']+)'/)?.[1];
test('default native build output and installer resolve to exactly the same DLL',()=>{
 const expected=path.win32.normalize(path.win32.join('v27',group.OutputPath,'RevitAutoV27.dll'));
 assert.equal(group.AppendTargetFrameworkToOutputPath,'false');
 assert.equal(path.win32.normalize(dllFromScript(install)),expected);
 assert.equal(path.win32.normalize(dllFromScript(build)),expected);
 assert.ok(!expected.includes('v27\\v27'));
});
test('build verifies the expected installation artifact after checking compiler exit status',()=>{
 const guard=build.indexOf('Build output is missing at the installation path');
 assert.ok(guard>build.indexOf('Revit 2027 plugin build failed.'));
 assert.ok(guard<build.indexOf('if(-not $SkipTests)'));
 assert.match(build,/Test-Path -LiteralPath \$dll -PathType Leaf/);
});
test('installer verifies DLL presence before publishing the Revit manifest',()=>{
 const guard=install.indexOf('Build-v27.ps1 must succeed before installation.');
 assert.ok(guard>=0);assert.ok(guard<install.indexOf('$addin.Save($manifest)'));
});
