param([switch]$CheckOnly,[string]$ClaudePath)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
. (Join-Path $root 'v27\deployment.ps1')
$template=Join-Path $root 'mcp\claude.mcp.json'
$expectedServer=[IO.Path]::GetFullPath((Join-Path $root 'mcp\revit-custom.mjs'))
$data=Get-Content -LiteralPath $template -Raw | ConvertFrom-Json
$names=@($data.mcpServers.PSObject.Properties.Name)
if(@($data.PSObject.Properties.Name).Count -ne 1 -or $names.Count -ne 1 -or $names[0] -ne 'revit-custom'){
  throw 'The dedicated 2027 MCP template must contain only revit-custom. Global 2025 settings are not changed.'
}
$server=$data.mcpServers.'revit-custom'
$fields=@($server.PSObject.Properties.Name)
if($fields.Count -ne 2 -or 'command' -notin $fields -or 'args' -notin $fields -or $server.command -ne 'node' -or @($server.args).Count -ne 1 -or $server.args[0] -isnot [string]){
  throw 'The 2027 template must specify only node and the verified package MCP script; arbitrary environment or extra arguments are not allowed.'
}
$serverPath=$server.args[0]
if(-not [IO.Path]::IsPathRooted($serverPath)){$serverPath=Join-Path $root $serverPath}
if([IO.Path]::GetFullPath($serverPath) -ne $expectedServer){throw 'The 2027 entry must use this package''s verified revit-custom Node server.'}
if(-not (Test-Path -LiteralPath $expectedServer -PathType Leaf)){throw 'The custom Revit MCP entry point is missing.'}
$node=Get-V27Node
if([string]::IsNullOrWhiteSpace($ClaudePath)){
  $claude=Get-Command claude -ErrorAction SilentlyContinue
  if($claude -and $claude.Source){$ClaudePath=$claude.Source}
  else{
    foreach($candidate in @((Join-Path $env:APPDATA 'npm\claude.cmd'),(Join-Path $env:USERPROFILE '.local\bin\claude.exe'))){
      if(Test-Path -LiteralPath $candidate -PathType Leaf){$ClaudePath=$candidate;break}
    }
  }
}
if([string]::IsNullOrWhiteSpace($ClaudePath) -or -not [IO.Path]::IsPathRooted($ClaudePath) -or -not (Test-Path -LiteralPath $ClaudePath -PathType Leaf)){
  throw 'Claude Code is not found. Supply -ClaudePath with its absolute executable path or run from the terminal where it is installed. No client is installed automatically.'
}
$ClaudePath=[IO.Path]::GetFullPath($ClaudePath)
$help=(& $ClaudePath --help | Out-String)
if($LASTEXITCODE -ne 0 -or $help -notmatch '--strict-mcp-config' -or $help -notmatch '--mcp-config'){
  throw 'Cannot verify the required MCP isolation flags from this Claude Code client. No session was started.'
}
# Generate absolute paths from this package, not the caller's working directory.
# A file avoids JSON quoting differences between the native and npm .cmd clients.
$config=Join-Path $root 'runtime\claude-2027.mcp.json'
$generated=[ordered]@{mcpServers=[ordered]@{'revit-custom'=[ordered]@{command=$node;args=@($expectedServer)}}}
$arguments=@('--strict-mcp-config','--mcp-config',$config)
if($CheckOnly){
  [pscustomobject]@{status='PASS_CONFIGURATION_ONLY';client=$ClaudePath;node=$node;workingDirectory=$root;mcpConfiguration=$config;configurationWritten=$false;configuration=$generated;serverNames=$names;launchArguments=$arguments;global2025ConfigurationChanged=$false;permissionBypass=$false;chatStarted=$false;modelWritesRequested=0}|ConvertTo-Json -Depth 8
  return
}
if(-not(Test-Path -LiteralPath (Join-Path $root 'runtime\bridge.json') -PathType Leaf)){
  throw 'Install the RevitAuto 2027 package first. No runtime credentials are created by this launcher.'
}
# Only the local managed launch file changes; bridge credentials and global client configs are untouched.
[IO.File]::WriteAllText($config,($generated|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
# Preserve ordinary client permissions and the caller's cwd, including client failures.
$previous=Get-Location
try{
  Set-Location -LiteralPath $root
  & $ClaudePath @arguments
  if($LASTEXITCODE -ne 0){throw "Claude Code exited with code $LASTEXITCODE. The launcher does not retry or reopen a session."}
}finally{Set-Location -LiteralPath $previous}
