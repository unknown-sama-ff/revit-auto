param([Parameter(Mandatory=$true)][string]$InputPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if($InputPath.StartsWith('\\') -or $OutputPath.StartsWith('\\')){throw 'Only local DWG and output files are accepted.'}
$inputFile=(Resolve-Path -LiteralPath $InputPath).Path
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\imports'))
$outputFile=[IO.Path]::GetFullPath($OutputPath)
if(-not $outputFile.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Output must remain in the package imports directory.'}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ActiveAcad { [DllImport("ole32.dll")] private static extern int CLSIDFromProgID([MarshalAs(UnmanagedType.LPWStr)] string p, out Guid c); [DllImport("oleaut32.dll", PreserveSig=false)] private static extern void GetActiveObject(ref Guid c, IntPtr r, [MarshalAs(UnmanagedType.Interface)] out object o); public static object Get(string p) { Guid c; Marshal.ThrowExceptionForHR(CLSIDFromProgID(p,out c)); object o; GetActiveObject(ref c,IntPtr.Zero,out o); return o; } }'
$acad=$null
foreach($prog in @('AutoCAD.Application','AutoCAD.Application.24.1')){try{$acad=[ActiveAcad]::Get($prog);break}catch{}}
if($null -eq $acad){throw 'Open the requested DWG in AutoCAD first. This adapter never starts AutoCAD or opens/saves drawings automatically.'}
$doc=$acad.ActiveDocument
if(-not [IO.Path]::GetFullPath($doc.FullName).Equals($inputFile,[StringComparison]::OrdinalIgnoreCase)){throw 'The requested DWG is not the active AutoCAD document.'}
function Number($value){if($null -eq $value){throw 'Native numeric value is unknown; null is not zero.'};$n=[double]$value;if([double]::IsNaN($n) -or [double]::IsInfinity($n)){throw 'Native AutoCAD value is not finite.'};return $n}
function Point($a){if($null -eq $a){throw 'Native AutoCAD point is unavailable.'};$v=@($a);if($v.Count -ne 3){throw 'Native AutoCAD XYZ must contain exactly three values.'};return @{x=(Number $v[0]);y=(Number $v[1]);z=(Number $v[2])}}
$initialName=[string]$doc.FullName
$initialModified=[int]$doc.GetVariable('DBMOD')
$initialCount=[int]$doc.ModelSpace.Count
$items=[Collections.Generic.List[object]]::new()
$watch=[Diagnostics.Stopwatch]::StartNew()
foreach($e in $doc.ModelSpace){
  if($watch.Elapsed.TotalSeconds -gt 45){throw 'DWG extraction exceeded its 45-second read-only budget.'}
  $o=@{objectName='unknown';layer=$null;handle=$null}
  try{
    $o.objectName=[string]$e.ObjectName;$o.layer=[string]$e.Layer;$o.handle=[string]$e.Handle
    switch -Regex ($o.objectName){
      '^AcDbLine$' {$o.start=Point $e.StartPoint;$o.end=Point $e.EndPoint;$o.coordinateSpace='native-world-xyz'}
      '^AcDbBlockReference$' {
        $o.name=[string]$e.Name;$o.insertion=Point $e.InsertionPoint;$o.rotation=Number $e.Rotation;$o.normal=Point $e.Normal
        $o.scaleFactors=@{x=(Number $e.XScaleFactor);y=(Number $e.YScaleFactor);z=(Number $e.ZScaleFactor)}
      }
      '^AcDbText$|^AcDbMText$' {$o.text=[string]$e.TextString;$o.insertion=Point $e.InsertionPoint}
      '^AcDbPolyline$|^AcDb2dPolyline$|^AcDb3dPolyline$' {
        $o.coordinates=@($e.Coordinates|ForEach-Object {Number $_});$o.closed=[bool]$e.Closed
        $o.coordinateStride=if($o.objectName -eq 'AcDbPolyline'){2}else{3}
        if($o.objectName -eq 'AcDb3dPolyline'){
          $o.coordinateSpace='native-world-xyz'
          if([int]$e.Type -ne 0){throw 'Curve-fit/spline 3D polylines cannot be treated as straight vertices.'}
        }else{
          $o.normal=Point $e.Normal;$o.elevation=Number $e.Elevation;$o.coordinateSpace='native-ocs'
          if($o.objectName -eq 'AcDb2dPolyline' -and [int]$e.Type -ne 0){throw 'Curve-fit/spline 2D polylines cannot be treated as straight vertices.'}
          $vertices=$o.coordinates.Count/$o.coordinateStride
          if($vertices -ne [int]$vertices -or $vertices -gt 10000){throw 'Invalid or excessive native polyline vertex count.'}
          $bulges=[Collections.Generic.List[double]]::new();for($i=0;$i -lt [int]$vertices;$i++){$bulges.Add((Number $e.GetBulge($i)))}
          $o.bulges=$bulges.ToArray()
        }
      }
    }
  }catch{
    $o.geometryUnknown=$true
    $errorText=$_.Exception.Message
    $o.readError=if($errorText.Length -gt 400){$errorText.Substring(0,400)}else{$errorText}
  }
  $items.Add($o)
  if($items.Count -gt 10000){throw 'DWG exceeds the 10,000 entity extraction limit.'}
}
$after=$acad.ActiveDocument
if(-not [string]::Equals([string]$after.FullName,$initialName,[StringComparison]::OrdinalIgnoreCase) -or [int]$after.GetVariable('DBMOD') -ne $initialModified -or [int]$after.ModelSpace.Count -ne $initialCount){throw 'Active DWG, modified state or entity count changed during extraction; discard this snapshot.'}
@{document=$doc.Name;entities=$items;extraction=@{activeDocumentMatched=$true;modifiedStateBefore=$initialModified;modifiedStateAfter=[int]$after.GetVariable('DBMOD');entityCountBefore=$initialCount;entityCountAfter=[int]$after.ModelSpace.Count;readOnly=$true;modelUploaded=$false;geometryCoverage='known-and-unknown-entities';exactPersistenceVerified=$false}} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputFile -Encoding UTF8
Write-Output "Read $($items.Count) entities without requesting AutoCAD changes."
