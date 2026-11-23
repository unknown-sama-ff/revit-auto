# Optional standalone exporter. Windows PowerShell 5.1 / PowerShell 7 on Windows.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$ConsolePath,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [ValidateRange(1,120)][int]$TimeoutSeconds=120,
    [switch]$CheckOnly
)
$ErrorActionPreference='Stop'

function Get-NativeSha256([string]$Path) {
    $stream=[IO.File]::OpenRead($Path); $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','') } finally { $sha.Dispose(); $stream.Dispose() }
}

function Resolve-NativeLocalPath([string]$Value, [switch]$File) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '[\x00-\x1f"]' -or $Value -match '^(\\\\|//|[a-z]+://)' -or $Value -notmatch '^[a-zA-Z]:[\\/]') { throw 'Use an absolute local Windows path without control characters.' }
    $full=[IO.Path]::GetFullPath($Value)
    $ancestor=$full
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item=Get-Item -LiteralPath $ancestor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not accepted for source, console or output paths.' }
        }
        $parent=[IO.Path]::GetDirectoryName($ancestor)
        if ($parent -eq $ancestor) { break }; $ancestor=$parent
    }
    if ($File -and -not [IO.File]::Exists($full)) { throw ('Required local file does not exist: '+$full) }
    if (-not $File -and [IO.File]::Exists($full)) { throw 'OutputDirectory must be a directory.' }
    return $full
}

function Assert-NativeInventory($Data) {
    if ($Data.schemaVersion -ne 2 -or $Data.scope -cne 'selected-ModelSpace-main-graphical-entities' -or $Data.wholeDrawingDecodeAccepted -ne $false -or $Data.entireDatabaseInventoryComplete -ne $false -or $Data.designScaleVerified -ne $false -or $Data.readOnlyRequested -ne $true -or $Data.saveRequested -ne $false) { throw 'Invalid native scope/safety evidence.' }
    $entities=@($Data.entities); $count=$entities.Count
    if ($count -lt 1 -or $count -gt 10000 -or $Data.modelSpaceEntityCount -ne $count -or $Data.selectionCount -ne $count -or $Data.selectionCountAfter -ne $count -or $Data.selectionHandlesStable -ne $true -or $Data.dbmodBefore -ne 0 -or $Data.dbmodAfter -ne 0) { throw 'Native count, stability or modified-state evidence failed.' }
    if ($Data.ownerRecordType -cne 'BLOCK_RECORD' -or $Data.ownerRecordName -cne '*Model_Space' -or $Data.ownerRecordHandle -notmatch '^[0-9A-Fa-f]+$') { throw 'Native owner record is unavailable or invalid.' }
    $handles=@{}; $types=@{}; $lines=0
    foreach ($entity in $entities) {
        if ($entity.handle -isnot [string] -or $entity.handle -notmatch '^[0-9A-Fa-f]+$' -or $handles.ContainsKey($entity.handle) -or $entity.type -isnot [string] -or -not $entity.type -or $entity.layer -isnot [string]) { throw 'Invalid or duplicate entity metadata.' }
        $handles[$entity.handle]=$true
        if ($entity.modelSpace -ne $true -or $entity.ownerType -cne 'BLOCK_RECORD' -or $entity.ownerName -cne '*Model_Space' -or $entity.owner330Handle -cne $Data.ownerRecordHandle -or $entity.layout410 -cne 'Model' -or $entity.group67Effective -ne 0 -or $entity.group67Present -isnot [bool] -or ($entity.group67Present -and $entity.group67Raw -ne 0) -or (-not $entity.group67Present -and $null -ne $entity.group67Raw)) { throw 'Per-entity owner/67/410 evidence failed.' }
        if (-not $types.ContainsKey($entity.type)) { $types[$entity.type]=0 }; $types[$entity.type]++
        if ($entity.type -ceq 'LINE') {
            $lines++
            if ($entity.coordinateSpace -cne 'native-world-xyz') { throw 'LINE coordinate space is unknown.' }
            foreach ($point in @($entity.start,$entity.end)) {
                if (@($point).Count -ne 3) { throw 'LINE must have exactly three native XYZ coordinates.' }
                foreach ($number in $point) {
                    if ($null -eq $number -or $number -is [string] -or $number -is [bool] -or $number -isnot [ValueType] -or [double]::IsNaN([double]$number) -or [double]::IsInfinity([double]$number)) { throw 'LINE contains an unavailable or nonfinite coordinate.' }
                }
            }
        } elseif ($entity.geometryUnknown -ne $true -or $null -ne $entity.start -or $null -ne $entity.end) { throw 'Unsupported geometry must stay explicitly unknown.' }
    }
    $ledger=@($Data.countsByType.PSObject.Properties)
    if ($ledger.Count -ne $types.Count) { throw 'Type ledger has missing or extra types.' }
    foreach ($entry in $ledger) { if (-not $types.ContainsKey($entry.Name) -or $types[$entry.Name] -ne $entry.Value) { throw 'Type count ledger mismatch.' } }
    if ($Data.lineGeometryCount -ne $lines -or $Data.unsupportedGeometryCount -ne ($count-$lines)) { throw 'Supported/unknown geometry ledger mismatch.' }
}

function Convert-NativeImport($Data, [string]$Name, [string]$Hash) {
    Assert-NativeInventory $Data
    $rows=@(foreach ($entity in $Data.entities) {
        $row=[ordered]@{objectName='UnknownNativeGeometry';nativeType=$entity.type;handle=$entity.handle;layer=$entity.layer;modelSpace=$true;owner330Handle=$entity.owner330Handle;ownerType=$entity.ownerType;ownerName=$entity.ownerName;group67Present=$entity.group67Present;group67Raw=$entity.group67Raw;group67Effective=0;layout410=$entity.layout410}
        if ($entity.type -ceq 'LINE') {
            $row.objectName='AcDbLine'; $row.coordinateSpace='native-world-xyz'
            $row.start=@{x=$entity.start[0];y=$entity.start[1];z=$entity.start[2]}; $row.end=@{x=$entity.end[0];y=$entity.end[1];z=$entity.end[2]}
        } else { $row.geometryUnknown=$true; $row.readError='This exporter inventories this native type but does not extract its geometry.' }
        [pscustomobject]$row
    })
    return [ordered]@{document=$Name;entities=$rows;extraction=[ordered]@{sourceSha256=$Hash;readOnly=$true;modelUploaded=$false;activeDocumentMatched=$false;sourceCopyMatched=$true;modifiedStateBefore=$Data.dbmodBefore;modifiedStateAfter=$Data.dbmodAfter;entityCountBefore=$Data.selectionCount;entityCountAfter=$Data.selectionCountAfter;geometryCoverage='known-and-unknown-entities';scope=$Data.scope;lineGeometryCount=$Data.lineGeometryCount;unsupportedGeometryCount=$Data.unsupportedGeometryCount;countsByType=$Data.countsByType;wholeDrawingDecodeAccepted=$false;exactPersistenceVerified=$false;designScaleVerified=$false;observedInsunits=$Data.insunits;observedInsbase=$Data.insbase}}
}

function Stop-OwnedNativeConsole($Process, $OwnedStart, [string]$Executable) {
    if ($null -eq $Process -or $null -eq $OwnedStart -or $Process.HasExited) { return }
    if ($Process.StartTime.ToUniversalTime() -ne $OwnedStart -or -not [string]::Equals($Process.MainModule.FileName,$Executable,[StringComparison]::OrdinalIgnoreCase)) { throw 'Console ownership changed; refuse cleanup.' }
    $Process.Kill()
    if (-not $Process.WaitForExit(5000)) { throw 'Owned console did not exit; inspect its recorded PID.' }
}

$run=$null; $manifest=$null; $proc=$null; $ownedStart=$null; $outStream=$null; $errStream=$null; $failure=$null
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This optional exporter requires Windows and an installed licensed Autodesk Core Console.' }
    $source=Resolve-NativeLocalPath $SourcePath -File; $console=Resolve-NativeLocalPath $ConsolePath -File; $output=Resolve-NativeLocalPath $OutputDirectory
    if ([IO.Path]::GetExtension($source) -ine '.dwg' -or [IO.Path]::GetFileName($console) -ine 'accoreconsole.exe') { throw 'Source must be .dwg; ConsolePath must explicitly select accoreconsole.exe.' }
    if ((Get-Item -LiteralPath $source).Length -gt 20MB -or (Get-Item -LiteralPath $source).Length -lt 6) { throw 'DWG must be between 6 bytes and 20 MB.' }
    $header=[IO.File]::OpenRead($source)
    try { $six=New-Object byte[] 6; [void]$header.Read($six,0,6); $signature=[Text.Encoding]::ASCII.GetString($six) } finally { $header.Dispose() }
    if ($signature -notmatch '^AC[0-9]{4}$') { throw 'DWG version signature is unknown.' }
    if (-not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) { Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop }
    $signed=Get-AuthenticodeSignature -LiteralPath $console
    if ($signed.Status -ne 'Valid' -or $signed.SignerCertificate.Subject -notmatch 'Autodesk') { throw 'Console must have a valid Autodesk Authenticode signature.' }
    $lisp=Join-Path $PSScriptRoot 'native-dwg-readonly.lsp'
    if (-not [IO.File]::Exists($lisp)) { throw 'Companion native-dwg-readonly.lsp is missing.' }
    $sourceHash=(Get-NativeSha256 $source)
    if ($CheckOnly) { [ordered]@{status='inputs-checked';sourceSha256=$sourceHash;dwgSignature=$signature;consoleSha256=(Get-NativeSha256 $console);consoleSignatureValid=$true;timeoutSeconds=$TimeoutSeconds;outputDirectory=$output;processStarted=$false;licenseRuntimeVerified=$false} | ConvertTo-Json; return }
    if (@(Get-CimInstance Win32_Process -Filter "Name='acad.exe' OR Name='accoreconsole.exe'").Count) { throw 'A CAD process is already running; reassess isolation before exporting.' }
    [IO.Directory]::CreateDirectory($output) | Out-Null
    $run=Join-Path $output ('native-dwg-'+[Guid]::NewGuid().ToString('N')); [IO.Directory]::CreateDirectory($run)|Out-Null
    $inputCopy=Join-Path $run 'source.dwg'; $native=Join-Path $run 'native.json'; $export=Join-Path $run 'export.json'; $stdout=Join-Path $run 'stdout.log'; $stderr=Join-Path $run 'stderr.log'; $script=Join-Path $run 'extract.scr'; $profile=Join-Path $run 'profile'
    $manifest=[ordered]@{schemaVersion=1;status='starting';source=$source;sourceSha256Before=$sourceHash;sourceCopy=$inputCopy;executable=$console;executableSha256=(Get-NativeSha256 $console);lispSha256=(Get-NativeSha256 $lisp);startedUtc=[DateTime]::UtcNow.ToString('o');timeoutSeconds=$TimeoutSeconds;ownedPid=$null;ownedStartTimeUtc=$null;consoleExitCode=$null;timedOut=$false;saveRequested=$false;modelWriteRequested=$false}
    $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8
    Copy-Item -LiteralPath $source -Destination $inputCopy
    if ((Get-NativeSha256 $inputCopy) -ne $sourceHash) { throw 'Byte copy does not match source.' }
    [IO.File]::SetAttributes($inputCopy,[IO.FileAttributes]::ReadOnly)
    [IO.Directory]::CreateDirectory($profile)|Out-Null
    $inline=([IO.File]::ReadAllText($lisp)-split '\r?\n'|Where-Object{$_.Trim() -and -not $_.TrimStart().StartsWith(';')}) -join "`r`n"
    [IO.File]::WriteAllText($script,$inline+"`r`n_.QUIT`r`n",[Text.Encoding]::ASCII)
    $isolate='dwg-ro-'+[Guid]::NewGuid().ToString('N')
    $info=New-Object Diagnostics.ProcessStartInfo; $info.FileName=$console
    $info.Arguments='/i "{0}" /s "{1}" /product ACAD /isolate {2} "{3}" /readonly' -f $inputCopy,$script,$isolate,$profile
    $manifest.arguments=$info.Arguments; $info.WorkingDirectory=$run; $info.UseShellExecute=$false; $info.CreateNoWindow=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $info.EnvironmentVariables['NATIVE_RO_INPUT_DIR']=$run+'\'; $info.EnvironmentVariables['NATIVE_RO_OUTPUT']=$native
    $proc=New-Object Diagnostics.Process; $proc.StartInfo=$info
    $outStream=[IO.File]::Create($stdout); $errStream=[IO.File]::Create($stderr)
    if (-not $proc.Start()) { throw 'Core Console did not start.' }
    $manifest.ownedPid=$proc.Id; $ownedStart=$proc.StartTime.ToUniversalTime(); $manifest.ownedStartTimeUtc=$ownedStart.ToString('o'); $manifest.status='running'
    $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8
    $outTask=$proc.StandardOutput.BaseStream.CopyToAsync($outStream); $errTask=$proc.StandardError.BaseStream.CopyToAsync($errStream)
    if (-not $proc.WaitForExit($TimeoutSeconds*1000)) { $manifest.timedOut=$true; Stop-OwnedNativeConsole $proc $ownedStart $console }
    $manifest.consoleExitCode=$proc.ExitCode
    if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($outTask,$errTask),5000)) { throw 'Log pipes did not close within the bounded drain interval.' }
    $outStream.Dispose(); $errStream.Dispose()
    if ($manifest.timedOut -or $proc.ExitCode -ne 0) { throw 'Core Console timed out or returned a nonzero exit code.' }
    $log=''
    foreach($file in @($stdout,$stderr)) {
        $bytes=[IO.File]::ReadAllBytes($file)
        $encoding=if($bytes.Length -gt 1 -and $bytes[1] -eq 0){[Text.Encoding]::Unicode}else{[Text.Encoding]::UTF8}
        $log+=$encoding.GetString($bytes)+"`n"
    }
    [IO.File]::WriteAllText((Join-Path $run 'console.decoded.log'),$log,[Text.UTF8Encoding]::new($false))
    if ($log -notmatch '(?m)^\s*NATIVE_RO_SUCCESS modelSpace=' -or $log -match '(?m)^\s*NATIVE_RO_(FAILED|ERROR):' -or $log -match '(?im)(;\s*error|fatal error|licen[cs].*(fail|error)|drawing.*(corrupt|recover))') { throw 'Native completion/log validation failed; inspect complete raw logs.' }
    if (-not [IO.File]::Exists($native) -or (Get-Item -LiteralPath $native).Length -gt 20MB) { throw 'Native JSON missing or exceeds the 20 MB import budget.' }
    $data=Get-Content -LiteralPath $native -Raw|ConvertFrom-Json
    $converted=Convert-NativeImport $data ([IO.Path]::GetFileName($source)) $sourceHash
    $converted|ConvertTo-Json -Depth 14|Set-Content -LiteralPath $export -Encoding UTF8
    if ((Get-Item -LiteralPath $export).Length -gt 20MB) { throw 'Normalized export exceeds the 20 MB import budget.' }
    $manifest.status='scoped-export-complete-review-logs'; $manifest.exportPath=$export
} catch {
    $failure=$_.Exception.Message
    if ($manifest) { $manifest.status='failed-unaccepted'; $manifest.failure=$failure }
} finally {
    if ($proc -and $ownedStart) { try { Stop-OwnedNativeConsole $proc $ownedStart $console } catch { $failure=([string]$failure+' Cleanup: '+$_.Exception.Message); if($manifest){$manifest.cleanupFailure=$_.Exception.Message} } }
    if ($outStream) { $outStream.Dispose() }; if ($errStream) { $errStream.Dispose() }
    if ($manifest) {
        try {
            $manifest.sourceSha256After=(Get-NativeSha256 $source)
            if ([IO.File]::Exists($inputCopy)) { $manifest.copySha256After=(Get-NativeSha256 $inputCopy) }
            if ($manifest.sourceSha256After -ne $sourceHash -or $manifest.copySha256After -ne $sourceHash) { throw 'Source/copy hash changed or copy is unavailable.' }
        } catch { $failure=([string]$failure+' Integrity: '+$_.Exception.Message); $manifest.integrityFailure=$_.Exception.Message }
        if ($failure) { $manifest.status='failed-unaccepted'; $manifest.failure=$failure }
        $manifest.finishedUtc=[DateTime]::UtcNow.ToString('o'); $manifest.artifacts=@{}
        foreach ($name in @('native.json','export.json','stdout.log','stderr.log','extract.scr','console.decoded.log')) {
            $artifact=Join-Path $run $name
            if ([IO.File]::Exists($artifact)) { try { $manifest.artifacts[$name]=@{sha256=(Get-NativeSha256 $artifact);bytes=(Get-Item -LiteralPath $artifact).Length} } catch { $failure=([string]$failure+' Artifact hash: '+$_.Exception.Message); $manifest.status='failed-unaccepted' } }
        }
        try { $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8 } catch { $failure=([string]$failure+' Manifest write: '+$_.Exception.Message) }
        Write-Output (Join-Path $run 'manifest.json')
    }
    if ($proc) { $proc.Dispose() }
}
if ($failure) { Write-Error $failure -ErrorAction Continue; exit 1 }
