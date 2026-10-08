import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..');
const windows={skip:process.platform!=='win32'};
const tempRoot=fs.realpathSync.native(os.tmpdir());
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const launcher=fs.readFileSync(path.join(root,'start-claude-2027.ps1'),'utf8');
function fixture(t,{help='--strict-mcp-config --mcp-config',exitCode=0,installed=false}={}){
 const dir=fs.mkdtempSync(path.join(tempRoot,'revit-claude-launch-'));
 const pkg=path.join(dir,'工具 发布 包');
 fs.mkdirSync(path.join(pkg,'v27'),{recursive:true});
 fs.mkdirSync(path.join(pkg,'mcp'));
 for(const file of ['start-claude-2027.ps1','v27/deployment.ps1','mcp/claude.mcp.json'])fs.copyFileSync(path.join(root,file),path.join(pkg,file));
 fs.writeFileSync(path.join(pkg,'mcp/revit-custom.mjs'),'// This fixture never starts an MCP server.\n');
 if(installed){fs.mkdirSync(path.join(pkg,'runtime'));fs.writeFileSync(path.join(pkg,'runtime/bridge.json'),'PRIVATE_TEST_MARKER');}
 const client=path.join(dir,'fake-claude.ps1');
 const receipt=path.join(dir,'client-receipt.json');
 const calls=path.join(dir,'client-calls.txt');
 fs.writeFileSync(client,`Add-Content -LiteralPath ${quote(calls)} -Value ($args -join '|')
if($args.Count -eq 1 -and $args[0] -eq '--help'){Write-Output ${quote(help)};$global:LASTEXITCODE=0;return}
$config=Get-Content -LiteralPath $args[2] -Raw | ConvertFrom-Json
[pscustomobject]@{arguments=@($args);cwd=$PWD.Path;configuration=$config}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath ${quote(receipt)}
$global:LASTEXITCODE=${exitCode}
`);
 t.after(()=>{
  const prefix=path.resolve(tempRoot)+path.sep+'revit-claude-launch-';
  assert.ok(path.resolve(dir).startsWith(prefix));
  assert.equal(fs.realpathSync.native(dir),dir);
  fs.rmSync(dir,{recursive:true,force:true});
 });
 return {dir,pkg,client,receipt,calls};
}
function run(f,{checkOnly=true,client=f.client,script,env}={}){
 const command=script??`$ErrorActionPreference='Stop'; & ${quote(path.join(f.pkg,'start-claude-2027.ps1'))} ${checkOnly?'-CheckOnly':''} -ClaudePath ${quote(client)}`;
 return spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',command],{cwd:os.tmpdir(),env:env??process.env,encoding:'utf8',timeout:30000});
}

test('Claude launcher uses a portable template and a single strict configuration without permission bypass',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'mcp/claude.mcp.json'),'utf8'));
 assert.deepEqual(config,{mcpServers:{'revit-custom':{command:'node',args:['mcp/revit-custom.mjs']}}});
 assert.match(launcher,/--strict-mcp-config/);
 assert.match(launcher,/\$config=Join-Path \$root 'runtime\\claude-2027\.mcp\.json'/);
 assert.doesNotMatch(launcher,/dangerously-skip-permissions|allow-dangerously-skip-permissions|--permission-mode|--allowedTools|--print|--resume|Start-Process/i);
 assert.doesNotMatch(launcher,/[A-Za-z]:\\/);
 assert.ok(launcher.indexOf('if($CheckOnly)')<launcher.indexOf('[IO.File]::WriteAllText'));
 assert.ok(launcher.indexOf('bridge.json')<launcher.indexOf('[IO.File]::WriteAllText'));
});

test('check-only resolves a relocated Unicode package from another cwd and writes no runtime',windows,t=>{
 const f=fixture(t);const result=run(f);
 assert.equal(result.status,0,result.stderr||result.error?.message);
 const data=JSON.parse(result.stdout);
 assert.equal(data.status,'PASS_CONFIGURATION_ONLY');
 assert.equal(data.workingDirectory,f.pkg);
 assert.equal(data.configurationWritten,false);
 assert.equal(data.chatStarted,false);
 assert.equal(data.permissionBypass,false);
 assert.equal(data.global2025ConfigurationChanged,false);
 assert.equal(data.modelWritesRequested,0);
 assert.equal(data.mcpConfiguration,path.join(f.pkg,'runtime/claude-2027.mcp.json'));
 assert.deepEqual(Object.keys(data.configuration.mcpServers),['revit-custom']);
 const server=data.configuration.mcpServers['revit-custom'];
 assert.equal(server.args[0],path.join(f.pkg,'mcp/revit-custom.mjs'));
 assert.ok(path.isAbsolute(server.command));
 assert.equal(fs.existsSync(path.join(f.pkg,'runtime')),false);
 assert.equal(fs.existsSync(f.receipt),false);
 assert.equal(fs.readFileSync(f.calls,'utf8').trim(),'--help');
});

test('mock launch receives one absolute config and preserves bridge bytes and caller cwd',windows,t=>{
 const f=fixture(t,{installed:true});
 const bridge=path.join(f.pkg,'runtime/bridge.json');const before=fs.readFileSync(bridge);
 const script=`$ErrorActionPreference='Stop';$before=$PWD.Path;& ${quote(path.join(f.pkg,'start-claude-2027.ps1'))} -ClaudePath ${quote(f.client)};if($PWD.Path -ne $before){throw 'Caller cwd changed'}`;
 const result=run(f,{script});assert.equal(result.status,0,result.stderr||result.error?.message);
 const receipt=JSON.parse(fs.readFileSync(f.receipt,'utf8').replace(/^\uFEFF/,''));
 assert.deepEqual(receipt.arguments,['--strict-mcp-config','--mcp-config',path.join(f.pkg,'runtime/claude-2027.mcp.json')]);
 assert.equal(receipt.cwd,f.pkg);
 assert.deepEqual(receipt.configuration.mcpServers['revit-custom'].args,[path.join(f.pkg,'mcp/revit-custom.mjs')]);
 assert.deepEqual(Object.keys(receipt.configuration.mcpServers),['revit-custom']);
 assert.deepEqual(fs.readFileSync(bridge),before);
 assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_TEST_MARKER/);
 assert.deepEqual(fs.readFileSync(f.calls,'utf8').trim().split(/\r?\n/).length,2);
});

test('npm-style .cmd launch preserves a Unicode config file path without inline JSON quoting',windows,t=>{
 const f=fixture(t,{installed:true});
 const found=spawnSync('pwsh',['-NoProfile','-Command','(Get-Process -Id $PID).Path'],{encoding:'utf8'});
 assert.equal(found.status,0,found.stderr);
 const wrapper=path.join(f.dir,'fake-claude.cmd');
 fs.writeFileSync(wrapper,`@echo off\r\n"${found.stdout.trim()}" -NoProfile -NonInteractive -File "${f.client}" %*\r\nexit /b %ERRORLEVEL%\r\n`);
 const result=run(f,{client:wrapper,checkOnly:false});assert.equal(result.status,0,result.stderr||result.error?.message);
 const receipt=JSON.parse(fs.readFileSync(f.receipt,'utf8').replace(/^\uFEFF/,''));
 assert.equal(receipt.arguments[2],path.join(f.pkg,'runtime/claude-2027.mcp.json'));
 assert.equal(receipt.configuration.mcpServers['revit-custom'].args[0],path.join(f.pkg,'mcp/revit-custom.mjs'));
});

test('launch with missing installation settings fails without creating credentials or a session',windows,t=>{
 const f=fixture(t);const result=run(f,{checkOnly:false});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Install the RevitAuto 2027 package first/);
 assert.equal(fs.existsSync(path.join(f.pkg,'runtime')),false);
 assert.equal(fs.existsSync(f.receipt),false);
});

test('client without verifiable isolation flags cannot launch or write config',windows,t=>{
 const f=fixture(t,{help:'--mcp-config',installed:true});const result=run(f,{checkOnly:false});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Cannot verify the required MCP isolation flags/);
 assert.equal(fs.existsSync(path.join(f.pkg,'runtime/claude-2027.mcp.json')),false);
 assert.equal(fs.existsSync(f.receipt),false);
});

test('missing or relative explicit client path fails without launching any client',windows,t=>{
 const f=fixture(t);
 for(const client of [path.join(f.dir,'not-installed.exe'),'fake-claude.ps1']){
  const result=run(f,{client});assert.notEqual(result.status,0);assert.match(result.stderr,/Claude Code is not found/);
 }
 assert.equal(fs.existsSync(f.calls),false);
});

for(const [name,edit] of [
 ['extra server',data=>data.mcpServers.other={command:'powershell',args:[]}],
 ['extra arguments',data=>data.mcpServers['revit-custom'].args.push('--debug')],
 ['arbitrary environment',data=>data.mcpServers['revit-custom'].env={UNTRUSTED:'1'}],
 ['wrong package script',data=>data.mcpServers['revit-custom'].args=['../other/revit-custom.mjs']],
 ['wrong executable',data=>data.mcpServers['revit-custom'].command='powershell'],
 ['top-level settings',data=>data.extra='not allowed'],
])test(`tampered template rejects ${name} before client invocation`,windows,t=>{
 const f=fixture(t);const file=path.join(f.pkg,'mcp/claude.mcp.json');const data=JSON.parse(fs.readFileSync(file,'utf8'));edit(data);fs.writeFileSync(file,JSON.stringify(data));
 const result=run(f);assert.notEqual(result.status,0);assert.equal(fs.existsSync(f.calls),false);assert.equal(fs.existsSync(path.join(f.pkg,'runtime')),false);
});

test('client launch failure restores cwd and does not retry a session',windows,t=>{
 const f=fixture(t,{installed:true,exitCode:7});
 const script=`$ErrorActionPreference='Stop';$before=$PWD.Path;try{& ${quote(path.join(f.pkg,'start-claude-2027.ps1'))} -ClaudePath ${quote(f.client)};throw 'Expected launch failure'}catch{if($_.Exception.Message -notmatch 'exited with code 7'){throw};if($PWD.Path -ne $before){throw 'Caller cwd changed'};Write-Output 'FAILURE_HANDLED_ONCE'}`;
 const result=run(f,{script});assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stdout,/FAILURE_HANDLED_ONCE/);
 assert.equal(fs.readFileSync(f.calls,'utf8').trim().split(/\r?\n/).length,2);
});

test('matching absolute legacy template paths remain compatible without inheriting caller cwd',windows,t=>{
 const f=fixture(t);const file=path.join(f.pkg,'mcp/claude.mcp.json');
 const config=JSON.parse(fs.readFileSync(file,'utf8'));config.mcpServers['revit-custom'].args=[path.join(f.pkg,'mcp/revit-custom.mjs')];fs.writeFileSync(file,JSON.stringify(config));
 const result=run(f);assert.equal(result.status,0,result.stderr||result.error?.message);
 const data=JSON.parse(result.stdout);assert.equal(data.configuration.mcpServers['revit-custom'].args[0],path.join(f.pkg,'mcp/revit-custom.mjs'));
 assert.equal(fs.existsSync(path.join(f.pkg,'runtime')),false);
});

test('missing MCP entry point is rejected before client invocation',windows,t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.pkg,'mcp/revit-custom.mjs'));
 const result=run(f);assert.notEqual(result.status,0);assert.match(result.stderr,/MCP entry point is missing/);
 assert.equal(fs.existsSync(f.calls),false);
});

test('PATH discovery prefers the explicitly found mock client rather than a global fallback',windows,t=>{
 const f=fixture(t);const found=spawnSync('pwsh',['-NoProfile','-Command','(Get-Process -Id $PID).Path'],{encoding:'utf8'});assert.equal(found.status,0,found.stderr);
 const wrapper=path.join(f.dir,'claude.cmd');fs.writeFileSync(wrapper,`@echo off\r\n"${found.stdout.trim()}" -NoProfile -NonInteractive -File "${f.client}" %*\r\nexit /b %ERRORLEVEL%\r\n`);
 const result=run(f,{script:`$ErrorActionPreference='Stop'; & ${quote(path.join(f.pkg,'start-claude-2027.ps1'))} -CheckOnly`,env:{...process.env,PATH:f.dir+path.delimiter+process.env.PATH}});
 assert.equal(result.status,0,result.stderr||result.error?.message);const data=JSON.parse(result.stdout);assert.equal(data.client,wrapper);
 assert.equal(fs.existsSync(f.receipt),false);
});
