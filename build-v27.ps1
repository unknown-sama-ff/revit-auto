param(
  [switch]$SkipTests,
  [string]$RevitInstallDir,
  [string]$OutputDirectory
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'v27\deployment.ps1')
$revit=Resolve-V27RevitDirectory $RevitInstallDir
$dll=Get-V27DefaultDll $PSScriptRoot
if(-not [string]::IsNullOrWhiteSpace($OutputDirectory)){
  $output=Resolve-V27PackagePath $PSScriptRoot $OutputDirectory
  if($output.IndexOfAny([char[]]';,') -ge 0){throw 'OutputDirectory cannot contain MSBuild property separators (; or ,).'}
  $dll=Join-Path $output 'RevitAutoV27.dll'
}
# Fail before compilation instead of retrying copies over a live Revit assembly.
if(Test-Path -LiteralPath $dll -PathType Leaf){
  try{$handle=[IO.File]::Open($dll,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$handle.Dispose()}
  catch{throw 'Output DLL is in use or not writable. Select a different -OutputDirectory; do not close Revit automatically.'}
}
if(-not $SkipTests){$null=Get-V27Node}
$env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
$env:DOTNET_CLI_HOME=Join-Path $PSScriptRoot '..\.dotnet-home'
$project=Join-Path $PSScriptRoot 'v27\RevitAutoV27.csproj'
$arguments=@('build',$project,'-c','Release',"-p:RevitInstallDir=$revit",'-p:CopyRetryCount=0')
if(-not [string]::IsNullOrWhiteSpace($OutputDirectory)){$arguments+="-p:OutputPath=$output"}
& dotnet @arguments
if($LASTEXITCODE -ne 0){throw 'Revit 2027 plugin build failed.'}
if(-not(Test-Path -LiteralPath $dll -PathType Leaf)){throw 'Build output is missing at the installation path. Do not update the Revit manifest.'}
if(-not $SkipTests){
  & dotnet run --project (Join-Path $PSScriptRoot 'tests\CoreTests\CoreTests.csproj') -c Release
  if($LASTEXITCODE -ne 0){throw 'Core safety tests failed.'}
  & node --test (Join-Path $PSScriptRoot 'mcp\tests\*.test.mjs')
  if($LASTEXITCODE -ne 0){throw 'MCP/import/workflow tests failed.'}
}
Write-Output "Build verified: $dll"
Write-Output 'No installation or Revit restart was performed.'
