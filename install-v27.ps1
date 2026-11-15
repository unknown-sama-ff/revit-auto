param(
  [switch]$RegisterCodex,
  [switch]$RegisterClaudeDesktop,
  [switch]$DisableLegacyClaudeRevit,
  [switch]$CheckOnly,
  [string]$AssemblyPath,
  [ValidateSet('Ask','ExactPlanChat','AgentReview')][string]$ModelApprovalMode='Ask',
  [string[]]$AuthorizedDocumentPath=@(),
  [string]$AuthorizationStatement
)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
. (Join-Path $root 'v27\deployment.ps1')
if([string]::IsNullOrWhiteSpace($AssemblyPath)){$AssemblyPath=Get-V27DefaultDll $root}
$dll=Assert-V27Dll $root $AssemblyPath
$template=Join-Path $root 'v27\RevitAutoV27.addin.example'
[xml]$addin=Get-Content -LiteralPath $template -Raw
if($addin.RevitAddIns.AddIn.FullClassName -ne 'RevitAutoV27.App' -or $addin.RevitAddIns.AddIn.AddInId -ne '6E95F8A9-7A3D-4B4A-9C4F-93F1D92F31C8'){
  throw 'Invalid Revit add-in template.'
}
$addin.RevitAddIns.AddIn.Assembly=$dll
$node=Get-V27Node
$script=Join-Path $root 'mcp\revit-custom.mjs'
if(-not(Test-Path -LiteralPath $script -PathType Leaf)){throw 'MCP entry point is missing.'}
# Dependency resolution uses the package directory, independent of caller cwd.
Push-Location (Join-Path $root 'mcp')
try{
  & $node --input-type=module -e "await import('@modelcontextprotocol/sdk/server/mcp.js'); await import('fast-xml-parser'); await import('fflate'); await import('zod');"
  if($LASTEXITCODE -ne 0){throw 'MCP dependencies are missing or invalid. Run npm ci in the mcp directory.'}
}finally{Pop-Location}
if($RegisterCodex){$codex=(Get-Command codex -ErrorAction Stop).Source}
if($CheckOnly){
  Write-Output "Installation checks passed. Selected DLL: $dll"
  Write-Output 'No runtime credentials, Revit manifest or assistant configuration were changed.'
  return
}
$authorizationFile=Join-Path $root 'runtime\execution-authorization.json'
$selectedApprovalMode=$ModelApprovalMode
$installationStatement=$AuthorizationStatement
if($selectedApprovalMode -eq 'Ask'){
  if(Test-Path -LiteralPath $authorizationFile){
    Write-Output 'Existing model authorization retained. No new authorization or per-plan approval setting was created.'
    $selectedApprovalMode='RetainExisting'
  }elseif([Environment]::UserInteractive -and -not [Console]::IsInputRedirected){
    Write-Host 'Model execution approval: 1 = approve each exact plan; 2 = authorize agent review once for specified local test models.'
    Write-Host 'Both modes retain preview review, fresh document checks and single execution. Neither enables automatic saving or restarting.'
    $choice=Read-Host 'Choose 1 or 2 (Enter = 1)'
    if($choice -eq '2'){
      $selectedApprovalMode='AgentReview'
      if($AuthorizedDocumentPath.Count -eq 0){
        $modelScope=Read-Host 'Enter exact existing local .rvt test model paths, separated by |'
        $AuthorizedDocumentPath=@($modelScope.Split('|') | ForEach-Object {$_.Trim()} | Where-Object {$_})
      }
      if([string]::IsNullOrWhiteSpace($installationStatement)){
        $installationStatement='User selected one-time agent review during installation for these exact test models: '+($AuthorizedDocumentPath -join ' | ')+'. No automatic saving or restarting.'
      }
    }elseif([string]::IsNullOrWhiteSpace($choice) -or $choice -eq '1'){$selectedApprovalMode='ExactPlanChat'}
    else{throw 'Unknown approval choice; no installation or model authorization was changed.'}
  }else{
    $selectedApprovalMode='ExactPlanChat'
    Write-Output 'Non-interactive install defaults to exact-plan chat approval. To use an existing user grant, select -ModelApprovalMode AgentReview with exact -AuthorizedDocumentPath and -AuthorizationStatement.'
  }
}
if($selectedApprovalMode -eq 'AgentReview'){
  if($AuthorizedDocumentPath.Count -eq 0 -or [string]::IsNullOrWhiteSpace($installationStatement)){
    throw 'AgentReview requires exact existing local test model path(s) and the user authorization statement. The explicit statement is the initial grant; no additional per-plan approval is requested.'
  }
  if(Test-Path -LiteralPath $authorizationFile){throw 'A model authorization already exists. Reuse it or explicitly revoke/rotate it; the installer will not overwrite it.'}
  if(Test-Path -LiteralPath ($authorizationFile+'.revoked')){throw 'Prior authorization was revoked; explicit review/rotation is required before creating another grant.'}
}elseif($selectedApprovalMode -eq 'ExactPlanChat' -and (Test-Path -LiteralPath $authorizationFile)){
  throw 'An existing authorization is present. Revoke or rotate it explicitly before selecting exact-plan mode; the installer will not silently change it.'
}
$runtime=Join-Path $root 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
# Runtime credentials may be read only by the current Windows account and SYSTEM.
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]::new($runtime),[Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true,$false)
$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$propagate=[Security.AccessControl.PropagationFlags]::None
foreach($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl',$inherit,$propagate,'Allow'))}
# Persist DACL only: no SACL/audit privileges are needed or requested.
[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($runtime),$acl)
if($selectedApprovalMode -eq 'AgentReview'){
  $authorizationArgs=@((Join-Path $root 'mcp\execution-authorization-setup.mjs'),'--project-root',$root,'--user-authorized','--granted-by','user-installation','--user-statement',$installationStatement)
  foreach($modelPath in $AuthorizedDocumentPath){$authorizationArgs+=@('--document',$modelPath)}
  & $node @authorizationArgs
  if($LASTEXITCODE -ne 0){throw 'Model authorization setup failed; no Revit model command was requested.'}
  Write-Output 'One-time scoped agent-review authorization created. Preview and agent review remain required; a second human approval for each plan is not required within that scope.'
}
$config=Join-Path $runtime 'bridge.json'
if(-not(Test-Path -LiteralPath $config)){
  $bytes=New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token=([Convert]::ToBase64String($bytes)).TrimEnd('=').Replace('+','-').Replace('/','_')
  @{port=8091;token=$token;planLifetimeMinutes=120} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
}
$settings=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
if($settings.token.Length -lt 40){throw 'Invalid bridge token; repair runtime/bridge.json.'}
if(-not $settings.PSObject.Properties['planLifetimeMinutes']){
  $settings|Add-Member -NotePropertyName planLifetimeMinutes -NotePropertyValue 120
  $settings|ConvertTo-Json|Set-Content -LiteralPath $config -Encoding UTF8
}
if($settings.planLifetimeMinutes -isnot [long] -and $settings.planLifetimeMinutes -isnot [int]){throw 'planLifetimeMinutes must be an integer.'}
if($settings.planLifetimeMinutes -lt 15 -or $settings.planLifetimeMinutes -gt 480){throw 'planLifetimeMinutes must be between 15 and 480.'}
$manifest=Join-Path $root 'v27\RevitAutoV27.addin'
$addin.Save($manifest)
$targetDir=Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2027'
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$target=Join-Path $targetDir 'RevitAutoV27.addin'
if(Test-Path -LiteralPath $target -PathType Leaf){
  Copy-Item -LiteralPath $target -Destination ($target+'.backup-'+[Guid]::NewGuid().ToString('N'))
}
Copy-Item -LiteralPath $manifest -Destination $target -Force
if($RegisterCodex){
  $codex=(Get-Command codex -ErrorAction Stop).Source
  $codexConfig=if($env:CODEX_HOME){Join-Path $env:CODEX_HOME 'config.toml'}else{Join-Path $env:USERPROFILE '.codex\config.toml'}
  if(Test-Path -LiteralPath $codexConfig){Copy-Item -LiteralPath $codexConfig -Destination ($codexConfig+'.backup-'+(Get-Date -Format 'yyyyMMddHHmmss'))}
  $existing=$null
  try{$existing=& $codex mcp get revit-custom --json 2>$null}catch{}
  $matches=$false
  if($LASTEXITCODE -eq 0){$entry=$existing|ConvertFrom-Json;$matches=($entry.transport.command -eq $node -and $entry.transport.args[0] -eq $script)}
  if(-not $matches){
    & $codex mcp add revit-custom -- $node $script
    if($LASTEXITCODE -ne 0){throw 'Codex MCP registration failed.'}
  }
  if(Test-Path -LiteralPath $codexConfig){
    $toml=Get-Content -LiteralPath $codexConfig -Raw
    $pattern='(?ms)(\[mcp_servers\.revit-custom\]\r?\n)(.*?)(?=^\[|\z)'
    $toml=[regex]::Replace($toml,$pattern,{param($m) $body=[regex]::Replace($m.Groups[2].Value,'(?m)^\s*(startup_timeout_sec|tool_timeout_sec)\s*=.*\r?\n?','');$m.Groups[1].Value+$body.TrimEnd()+"`r`nstartup_timeout_sec = 15`r`ntool_timeout_sec = 180`r`n`r`n"})
    Set-Content -LiteralPath $codexConfig -Value $toml -Encoding UTF8
  }
}
if($RegisterClaudeDesktop){
  $claudeDir=Join-Path $env:APPDATA 'Claude'
  New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
  $file=Join-Path $claudeDir 'claude_desktop_config.json'
  $data=if(Test-Path -LiteralPath $file){Get-Content -LiteralPath $file -Raw|ConvertFrom-Json}else{[pscustomobject]@{}}
  if(-not $data.PSObject.Properties['mcpServers']){$data|Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{})}
  if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination ($file+'.backup-'+(Get-Date -Format 'yyyyMMddHHmmss'))}
  if($DisableLegacyClaudeRevit -and $data.mcpServers.PSObject.Properties['revit-mcp']){$data.mcpServers.PSObject.Properties.Remove('revit-mcp')}
  $data.mcpServers|Add-Member -NotePropertyName 'revit-custom' -NotePropertyValue ([pscustomobject]@{command=$node;args=@($script)}) -Force
  $data|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $file -Encoding UTF8
}
Write-Output 'RevitAutoV27 manifest and private bridge settings installed. Existing 2025 files are unchanged.'
Write-Output 'Load the add-in on the next manual Revit start. Reload the MCP connection when its Node code or tools change; restarting the agent application is only needed if its tool list remains cached.'
