# Shared deployment paths. Relative arguments are anchored to the repository, never the caller's cwd.
function Get-V27DefaultDll([string]$Root) {
  [xml]$project=Get-Content -LiteralPath (Join-Path $Root 'v27\RevitAutoV27.csproj') -Raw
  $output=[string]$project.Project.PropertyGroup.OutputPath
  if([string]::IsNullOrWhiteSpace($output)){throw 'The native project must declare a default OutputPath.'}
  return [IO.Path]::GetFullPath((Join-Path (Join-Path $Root 'v27') (Join-Path $output 'RevitAutoV27.dll')))
}
function Resolve-V27PackagePath([string]$Root,[string]$Path) {
  if(-not [IO.Path]::IsPathRooted($Path)){$Path=Join-Path $Root $Path}
  $resolved=[IO.Path]::GetFullPath($Path)
  $prefix=[IO.Path]::GetFullPath($Root).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  if(-not $resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){
    throw 'Plugin output must remain inside this package so runtime settings can be located.'
  }
  return $resolved
}
function Resolve-V27RevitDirectory([string]$Path) {
  if([string]::IsNullOrWhiteSpace($Path)){$Path=$env:REVIT_2027_INSTALL_DIR}
  if([string]::IsNullOrWhiteSpace($Path)){$Path=Join-Path $env:ProgramFiles 'Autodesk\Revit 2027'}
  $directory=[IO.Path]::GetFullPath($Path)
  foreach($name in @('RevitAPI.dll','RevitAPIUI.dll')){
    $file=Join-Path $directory $name
    if(-not(Test-Path -LiteralPath $file -PathType Leaf)){
      throw "Missing $name. Specify -RevitInstallDir or REVIT_2027_INSTALL_DIR pointing to Revit 2027.3 or later in the 2027 series."
    }
    $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($file)
    if($version.FileMajorPart -ne 27 -or $version.FileMinorPart -lt 3){
      throw "Unsupported $name version $($version.FileVersion). Only Revit 2027.3+ within the 2027 series is supported."
    }
  }
  # These characters cannot safely be transported as an MSBuild property value.
  if($directory.IndexOfAny([char[]]';,') -ge 0){throw 'Revit install directory cannot contain MSBuild property separators (; or ,).'}
  return $directory
}
function Assert-V27Dll([string]$Root,[string]$Path) {
  $dll=Resolve-V27PackagePath $Root $Path
  if(-not(Test-Path -LiteralPath $dll -PathType Leaf)){throw 'Build-v27.ps1 must succeed before installation.'}
  $identity=[Reflection.AssemblyName]::GetAssemblyName($dll)
  if($identity.Name -ne 'RevitAutoV27'){throw 'AssemblyPath must identify the compiled RevitAutoV27 assembly.'}
  $parent=[IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($dll))
  while($null -ne $parent){
    if(Test-Path -LiteralPath (Join-Path $parent.FullName 'mcp\package.json') -PathType Leaf){
      if(-not $parent.FullName.Equals([IO.Path]::GetFullPath($Root).TrimEnd('\','/'),[StringComparison]::OrdinalIgnoreCase)){
        throw 'The selected DLL belongs to a different nested package.'
      }
      return $dll
    }
    $parent=$parent.Parent
  }
  throw 'Cannot locate the package containing the selected DLL.'
}
function Get-V27Node {
  $node=(Get-Command node -ErrorAction Stop).Source
  $text=& $node --version
  if($LASTEXITCODE -ne 0 -or $text -notmatch '^v(\d+)\.(\d+)\.(\d+)') {throw 'Cannot determine the Node.js version.'}
  if([version]$text.TrimStart('v') -lt [version]'20.11.0'){throw 'Node.js 20.11 or later is required.'}
  return $node
}
