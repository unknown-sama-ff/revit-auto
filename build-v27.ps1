param([switch]$SkipTests)
$ErrorActionPreference='Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
$env:DOTNET_CLI_HOME=Join-Path $PSScriptRoot '..\.dotnet-home'
$project=Join-Path $PSScriptRoot 'v27\RevitAutoV27.csproj'
& dotnet build $project -c Release
if($LASTEXITCODE -ne 0){throw 'Revit 2027 plugin build failed.'}
$dll=Join-Path $PSScriptRoot 'v27\bin\Release\net10.0-windows-v27-family-snapshot-0400\RevitAutoV27.dll'
if(-not(Test-Path -LiteralPath $dll -PathType Leaf)){throw 'Build output is missing at the installation path. Do not update the Revit manifest.'}

if(-not $SkipTests){
  & dotnet run --project (Join-Path $PSScriptRoot 'tests\CoreTests\CoreTests.csproj') -c Release
  if($LASTEXITCODE -ne 0){throw 'Core safety tests failed.'}
  & node --test (Join-Path $PSScriptRoot 'mcp\tests\*.test.mjs')
  if($LASTEXITCODE -ne 0){throw 'MCP/import/workflow tests failed.'}
}

