param([switch]$CheckOnly)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$config=Join-Path $root 'mcp\claude.mcp.json'
$expectedServer=Join-Path $root 'mcp\revit-custom.mjs'
$data=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
$names=@($data.mcpServers.PSObject.Properties.Name)
if($names.Count -ne 1 -or $names[0] -ne 'revit-custom'){throw 'The dedicated 2027 MCP configuration must contain only revit-custom. Global 2025 settings are not changed.'}
$server=$data.mcpServers.'revit-custom'
if($server.command -ne 'node' -or @($server.args).Count -ne 1 -or [IO.Path]::GetFullPath($server.args[0]) -ne [IO.Path]::GetFullPath($expectedServer)){throw 'The 2027 entry must use this package''s verified revit-custom Node server.'}
if(-not (Test-Path -LiteralPath $expectedServer -PathType Leaf)){throw 'The custom Revit MCP entry point is missing.'}
$node=Get-Command node -ErrorAction Stop
$claude=Get-Command claude -ErrorAction SilentlyContinue
$claudePath=if($claude){$claude.Source}else{Join-Path $env:APPDATA 'npm\claude.cmd'}
if(-not (Test-Path -LiteralPath $claudePath -PathType Leaf)){throw 'Claude Code is not found. Run this launcher from the terminal where Claude Code is installed; it does not install a new client.'}
$help=(& $claudePath --help | Out-String)
if($LASTEXITCODE -ne 0 -or $help -notmatch '--strict-mcp-config' -or $help -notmatch '--mcp-config'){throw 'The installed Claude Code does not confirm support for strict MCP selection. No session was started.'}
$arguments=@('--strict-mcp-config','--mcp-config',$config)
if($CheckOnly){
  [pscustomobject]@{status='PASS_CONFIGURATION_ONLY';client=$claudePath;node=$node.Source;workingDirectory=$root;mcpConfiguration=$config;serverNames=$names;launchArguments=$arguments;global2025ConfigurationChanged=$false;permissionBypass=$false;chatStarted=$false;modelWritesRequested=0}|ConvertTo-Json -Depth 5
  return
}
# Keep all ordinary client permissions. Never skip chat approval or enable arbitrary model-writing code.
$previous=Get-Location
try{Set-Location -LiteralPath $root; & $claudePath @arguments}
finally{Set-Location -LiteralPath $previous}
