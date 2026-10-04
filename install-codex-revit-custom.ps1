[CmdletBinding()]
param(
  [ValidateSet('CheckOnly','Install','Restore')]
  [string]$Mode = 'CheckOnly',
  [string]$ConfigPath = '',
  [string]$BackupPath = ''
)

$ErrorActionPreference = 'Stop'

function Get-FullPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path)
}

function Get-DefaultConfigPath {
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
  return (Join-Path $codexHome 'config.toml')
}

function Get-Text([string]$Path) {
  return [IO.File]::ReadAllText($Path)
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Get-SectionText([string]$Text, [string]$SectionName) {
  $lines = $Text -split "`r?`n"
  $header = '^\s*\[' + [regex]::Escape($SectionName) + '\]\s*$'
  $start = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $header) {
      if ($start -ge 0) { throw "配置中存在重复的 [$SectionName] 节。" }
      $start = $i
    }
  }
  if ($start -lt 0) { return $null }
  $end = $lines.Count
  for ($i = $start + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*\[[^]]+\]\s*$') {
      $end = $i
      break
    }
  }
  return (($lines[$start..($end - 1)]) -join "`n")
}

function Get-NodePath {
  $node = @(Get-Command node -CommandType Application -ErrorAction Stop | Where-Object { $_.Path } | Select-Object -First 1)[0]
  return (Get-FullPath $node.Path)
}

function Get-TomlEscaped([string]$Path) {
  return ($Path -replace '\\', '\\')
}

function Get-ExpectedSection([string]$NodePath, [string]$ServerPath) {
  $escapedNode = Get-TomlEscaped $NodePath
  $escapedServer = Get-TomlEscaped $ServerPath
  return @(
    '[mcp_servers.revit-custom]',
    ('command = "' + $escapedNode + '"'),
    ('args = ["' + $escapedServer + '"]'),
    'startup_timeout_sec = 120'
  )
}

function Get-EntryState([string]$Text, [string]$NodePath, [string]$ServerPath) {
  $section = Get-SectionText $Text 'mcp_servers.revit-custom'
  if ($null -eq $section) { return 'MISSING' }
  $expected = Get-ExpectedSection $NodePath $ServerPath
  foreach ($line in $expected[1..($expected.Count - 1)]) {
    if ($section -notmatch ('(?m)^\s*' + [regex]::Escape($line) + '\s*$')) {
      return 'CONFLICT'
    }
  }
  return 'CONFIGURED'
}

function Assert-StaticPrerequisites([string]$Config, [string]$Server, [string]$Node) {
  if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
    throw "Codex 配置不存在：$Config"
  }
  if (-not (Test-Path -LiteralPath $Server -PathType Leaf)) {
    throw "revit-custom MCP 入口不存在：$Server"
  }
  if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) {
    throw "Node 运行时不存在：$Node"
  }
}

function Assert-NoForbiddenEntries([string]$Text) {
  $forbidden = @(
    'revit-autodesk-read',
    'Autodesk.RevitMcpServer',
    'send_code_to_revit',
    'mcp-server-for-revit'
  )
  foreach ($token in $forbidden) {
    if ($Text.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      throw "检测到禁止的 MCP/代码执行入口：$token。为避免双写入通道，脚本未继续。"
    }
  }
}

try {
  $root = Get-FullPath $PSScriptRoot
  $serverPath = Get-FullPath (Join-Path $root 'mcp\revit-custom.mjs')
  $nodePath = Get-NodePath
  $configPath = if ($ConfigPath) { Get-FullPath $ConfigPath } else { Get-FullPath (Get-DefaultConfigPath) }
  $configDir = Split-Path -Parent $configPath

  if ($Mode -eq 'Restore') {
    if (-not $BackupPath) { throw 'Restore 模式必须提供 -BackupPath。' }
    $backupPath = Get-FullPath $BackupPath
    if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { throw "备份不存在：$backupPath" }
    $prefix = $configDir.TrimEnd('\') + '\'
    if (-not $backupPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw '为避免误覆盖，备份必须位于 Codex 配置目录内。'
    }
    Copy-Item -LiteralPath $backupPath -Destination $configPath -Force
    [pscustomobject]@{
      status = 'RESTORED'
      configPath = $configPath
      backupPath = $backupPath
      serverPath = $serverPath
      nodePath = $nodePath
    } | ConvertTo-Json -Depth 4
    exit 0
  }

  Assert-StaticPrerequisites $configPath $serverPath $nodePath
  $raw = Get-Text $configPath
  Assert-NoForbiddenEntries $raw
  $state = Get-EntryState $raw $nodePath $serverPath

  if ($Mode -eq 'CheckOnly') {
    [pscustomobject]@{
      status = if ($state -eq 'CONFIGURED') { 'PASS_CONFIGURED' } else { 'PASS_NOT_CONFIGURED' }
      entryState = $state
      configPath = $configPath
      serverPath = $serverPath
      nodePath = $nodePath
      officialMcpRegistered = $false
      arbitraryCodeToolRegistered = $false
      modelWritesRequested = 0
    } | ConvertTo-Json -Depth 4
    exit 0
  }

  if ($state -eq 'CONFLICT') {
    throw '已存在 revit-custom 配置，但 command/args/timeout 与项目的受控配置不一致；未自动覆盖。'
  }

  if ($state -eq 'CONFIGURED') {
    [pscustomobject]@{
      status = 'ALREADY_CONFIGURED'
      entryState = $state
      configPath = $configPath
      serverPath = $serverPath
      nodePath = $nodePath
      backupPath = $null
      officialMcpRegistered = $false
      arbitraryCodeToolRegistered = $false
      modelWritesRequested = 0
    } | ConvertTo-Json -Depth 4
    exit 0
  }

  $newline = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
  $escapedNode = Get-TomlEscaped $nodePath
  $escapedServer = Get-TomlEscaped $serverPath
  $block = @(
    '',
    '# BEGIN RevitAuto 2027 revit-custom MCP (managed)',
    '[mcp_servers.revit-custom]',
    ('command = "' + $escapedNode + '"'),
    ('args = ["' + $escapedServer + '"]'),
    'startup_timeout_sec = 120',
    '# END RevitAuto 2027 revit-custom MCP (managed)',
    ''
  ) -join $newline
  $newText = $raw.TrimEnd("`r", "`n") + $block
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupPath = "$configPath.bak-$stamp"
  Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
  Write-Utf8NoBom $configPath $newText

  [pscustomobject]@{
    status = 'INSTALLED'
    entryState = 'CONFIGURED'
    configPath = $configPath
    serverPath = $serverPath
    nodePath = $nodePath
    backupPath = $backupPath
    officialMcpRegistered = $false
    arbitraryCodeToolRegistered = $false
    modelWritesRequested = 0
  } | ConvertTo-Json -Depth 4
} catch {
  [pscustomobject]@{
    status = 'ERROR'
    message = $_.Exception.Message
    modelWritesRequested = 0
  } | ConvertTo-Json -Depth 4
  exit 1
}
