[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'install-codex-revit-custom.ps1'
$fixture = Join-Path (Split-Path -Parent $PSScriptRoot) ('.tmp-codex-config-test-' + [guid]::NewGuid().ToString('N') + '.toml')
$backup = $null

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Label) {
  if ($Actual -ne $Expected) {
    throw "${Label}: expected [$Expected], actual [$Actual]"
  }
}

@(
  'model = "fixture"',
  '',
  '[mcp_servers.node_repl]',
  'command = "node"',
  'args = []',
  'startup_timeout_sec = 120'
) -join "`n" | Set-Content -LiteralPath $fixture -Encoding utf8

try {
  $check1 = (& $installer -Mode CheckOnly -ConfigPath $fixture | ConvertFrom-Json)
  Assert-Equal $check1.status 'PASS_NOT_CONFIGURED' 'initial status'

  $install = (& $installer -Mode Install -ConfigPath $fixture | ConvertFrom-Json)
  Assert-Equal $install.status 'INSTALLED' 'install status'
  $backup = $install.backupPath

  $check2 = (& $installer -Mode CheckOnly -ConfigPath $fixture | ConvertFrom-Json)
  Assert-Equal $check2.status 'PASS_CONFIGURED' 'configured status'

  $repeat = (& $installer -Mode Install -ConfigPath $fixture | ConvertFrom-Json)
  Assert-Equal $repeat.status 'ALREADY_CONFIGURED' 'idempotent status'

  $restore = (& $installer -Mode Restore -ConfigPath $fixture -BackupPath $backup | ConvertFrom-Json)
  Assert-Equal $restore.status 'RESTORED' 'restore status'

  $check3 = (& $installer -Mode CheckOnly -ConfigPath $fixture | ConvertFrom-Json)
  Assert-Equal $check3.status 'PASS_NOT_CONFIGURED' 'restored status'

  [pscustomobject]@{
    status = 'PASS'
    initial = $check1.status
    installed = $install.status
    repeat = $repeat.status
    restored = $restore.status
    final = $check3.status
  } | ConvertTo-Json -Depth 3
}
finally {
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Force }
  if ($backup -and (Test-Path -LiteralPath $backup)) { Remove-Item -LiteralPath $backup -Force }
}
