param([Parameter(Mandatory=$true)][string]$InputPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
$inputFile=(Resolve-Path -LiteralPath $InputPath).Path
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\imports'))
$outputFile=[IO.Path]::GetFullPath($OutputPath)
if(-not $outputFile.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Output must remain in the package imports directory.'}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ActiveAcad { [DllImport("ole32.dll")] static extern int CLSIDFromProgID([MarshalAs(UnmanagedType.LPWStr)] string p, out Guid c); [DllImport("oleaut32.dll")] static extern int GetActiveObject(ref Guid c, IntPtr r, [MarshalAs(UnmanagedType.Interface)] out object o); public static object Get(string p) { Guid c; Marshal.ThrowExceptionForHR(CLSIDFromProgID(p,out c)); object o; Marshal.ThrowExceptionForHR(GetActiveObject(ref c,IntPtr.Zero,out o)); return o; } }'
$acad=$null
foreach($prog in @('AutoCAD.Application','AutoCAD.Application.24.1')){try{$acad=[ActiveAcad]::Get($prog);break}catch{}}
if($null -eq $acad){throw 'Open the requested DWG in AutoCAD first. This adapter never starts AutoCAD or opens/saves drawings automatically.'}
$doc=$acad.ActiveDocument
if(-not [IO.Path]::GetFullPath($doc.FullName).Equals($inputFile,[StringComparison]::OrdinalIgnoreCase)){throw 'The requested DWG is not the active AutoCAD document.'}
function Point($a){if($null -eq $a){return $null};$v=@($a);return @{x=[double]$v[0];y=[double]$v[1];z=if($v.Count -gt 2){[double]$v[2]}else{0}}}
$items=[Collections.Generic.List[object]]::new()
foreach($e in $doc.ModelSpace){
  $o=@{objectName=[string]$e.ObjectName;layer=[string]$e.Layer;handle=[string]$e.Handle}
  switch -Regex ($e.ObjectName){
    '^AcDbLine$' {$o.start=Point $e.StartPoint;$o.end=Point $e.EndPoint}
    'BlockReference$' {$o.name=$e.Name;$o.insertion=Point $e.InsertionPoint;$o.rotation=[double]$e.Rotation}
    'Text$|MText$' {$o.text=$e.TextString;$o.insertion=Point $e.InsertionPoint}
    'Polyline$' {$o.coordinates=@($e.Coordinates);$o.closed=[bool]$e.Closed}
  }
  $items.Add($o)
  if($items.Count -gt 10000){throw 'DWG exceeds the 10,000 entity extraction limit.'}
}
@{document=$doc.Name;fullName=$doc.FullName;entities=$items} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputFile -Encoding UTF8
Write-Output "Read $($items.Count) entities without changing AutoCAD."
