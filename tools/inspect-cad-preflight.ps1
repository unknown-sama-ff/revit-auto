# Read-only CAD preflight extractor for AutoCAD Core Console. Windows PowerShell 5.1 / PowerShell 7 on Windows.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$ConsolePath,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [ValidateRange(1,120)][int]$TimeoutSeconds=120,
    [switch]$CheckOnly
)
$ErrorActionPreference='Stop'

function Get-PreflightSha256([string]$Path) {
    $stream=[IO.File]::OpenRead($Path); $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','') } finally { $sha.Dispose(); $stream.Dispose() }
}

function Resolve-PreflightLocalPath([string]$Value, [switch]$File) {
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

function Assert-PreflightData($Data) {
    if ($Data.schemaVersion -ne 1 -or $Data.status -cne 'cad-preflight-readonly' -or $Data.readOnlyRequested -ne $true -or $Data.saveRequested -ne $false -or $Data.dbmodBefore -ne 0 -or $Data.dbmodAfter -ne 0) {
        throw 'Invalid CAD preflight safety or modified-state evidence.'
    }
    if ($null -eq $Data.modelSpaceEntityCount -or $Data.modelSpaceEntityCount -lt 0 -or $null -eq $Data.paperSpaceEntityCount -or $Data.paperSpaceEntityCount -lt 0) {
        throw 'Invalid CAD preflight entity counts.'
    }
    if ($null -eq $Data.layers -or $null -eq $Data.geometrySummary) {
        throw 'Missing required CAD preflight layer or geometry summary.'
    }
}

function Stop-OwnedPreflightConsole($Process, $OwnedStart, [string]$Executable) {
    if ($null -eq $Process -or $null -eq $OwnedStart -or $Process.HasExited) { return }
    if ($Process.StartTime.ToUniversalTime() -ne $OwnedStart -or -not [string]::Equals($Process.MainModule.FileName,$Executable,[StringComparison]::OrdinalIgnoreCase)) { throw 'Console ownership changed; refuse cleanup.' }
    $Process.Kill()
    if (-not $Process.WaitForExit(5000)) { throw 'Owned console did not exit; inspect its recorded PID.' }
}

$run=$null; $manifest=$null; $proc=$null; $ownedStart=$null; $outStream=$null; $errStream=$null; $failure=$null
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This read-only CAD preflight extractor requires Windows and an installed licensed Autodesk Core Console.' }
    $source=Resolve-PreflightLocalPath $SourcePath -File; $console=Resolve-PreflightLocalPath $ConsolePath -File; $output=Resolve-PreflightLocalPath $OutputDirectory
    if ([IO.Path]::GetExtension($source) -ine '.dwg' -or [IO.Path]::GetFileName($console) -ine 'accoreconsole.exe') { throw 'Source must be .dwg; ConsolePath must explicitly select accoreconsole.exe.' }
    $len=(Get-Item -LiteralPath $source).Length
    if ($len -gt 20MB -or $len -lt 6) { throw 'DWG must be between 6 bytes and 20 MB.' }
    $header=[IO.File]::OpenRead($source)
    try { $six=New-Object byte[] 6; [void]$header.Read($six,0,6); $signature=[Text.Encoding]::ASCII.GetString($six) } finally { $header.Dispose() }
    if ($signature -notmatch '^AC[0-9]{4}$') { throw 'DWG version signature is unknown.' }
    if (-not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) { Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop }
    $signed=Get-AuthenticodeSignature -LiteralPath $console
    if ($signed.Status -ne 'Valid' -or $signed.SignerCertificate.Subject -notmatch 'Autodesk') { throw 'Console must have a valid Autodesk Authenticode signature.' }
    $lisp=Join-Path $PSScriptRoot 'cad-preflight-readonly.lsp'
    if (-not [IO.File]::Exists($lisp)) { throw 'Companion cad-preflight-readonly.lsp is missing.' }
    $sourceHash=(Get-PreflightSha256 $source)
    if ($CheckOnly) {
        [ordered]@{status='inputs-checked';sourceSha256=$sourceHash;dwgSignature=$signature;consoleSha256=(Get-PreflightSha256 $console);consoleSignatureValid=$true;timeoutSeconds=$TimeoutSeconds;outputDirectory=$output;processStarted=$false;licenseRuntimeVerified=$false} | ConvertTo-Json
        return
    }
    if (@(Get-CimInstance Win32_Process -Filter "Name='acad.exe' OR Name='accoreconsole.exe'").Count) { throw 'A CAD process is already running; reassess isolation before inspecting.' }
    [IO.Directory]::CreateDirectory($output) | Out-Null
    $run=Join-Path $output ('cad-preflight-'+[Guid]::NewGuid().ToString('N')); [IO.Directory]::CreateDirectory($run)|Out-Null
    $inputCopy=Join-Path $run 'source.dwg'; $preflight=Join-Path $run 'preflight.json'; $stdout=Join-Path $run 'stdout.log'; $stderr=Join-Path $run 'stderr.log'; $script=Join-Path $run 'preflight.scr'; $profile=Join-Path $run 'profile'
    $manifest=[ordered]@{schemaVersion=1;status='starting';source=$source;sourceSha256Before=$sourceHash;sourceCopy=$inputCopy;executable=$console;executableSha256=(Get-PreflightSha256 $console);lispSha256=(Get-PreflightSha256 $lisp);startedUtc=[DateTime]::UtcNow.ToString('o');timeoutSeconds=$TimeoutSeconds;ownedPid=$null;ownedStartTimeUtc=$null;consoleExitCode=$null;timedOut=$false;saveRequested=$false;modelWriteRequested=$false}
    $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8
    Copy-Item -LiteralPath $source -Destination $inputCopy
    if ((Get-PreflightSha256 $inputCopy) -ne $sourceHash) { throw 'Byte copy does not match source.' }
    [IO.File]::SetAttributes($inputCopy,[IO.FileAttributes]::ReadOnly)
    [IO.Directory]::CreateDirectory($profile)|Out-Null
    $inline=([IO.File]::ReadAllText($lisp)-split '\r?\n'|Where-Object{$_.Trim() -and -not $_.TrimStart().StartsWith(';')}) -join "`r`n"
    [IO.File]::WriteAllText($script,$inline+"`r`n_.QUIT`r`n",[Text.Encoding]::ASCII)
    $isolate='cad-pf-'+[Guid]::NewGuid().ToString('N')
    $info=New-Object Diagnostics.ProcessStartInfo; $info.FileName=$console
    $info.Arguments='/i "{0}" /s "{1}" /product ACAD /isolate {2} "{3}" /readonly' -f $inputCopy,$script,$isolate,$profile
    $manifest.arguments=$info.Arguments; $info.WorkingDirectory=$run; $info.UseShellExecute=$false; $info.CreateNoWindow=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $info.EnvironmentVariables['CAD_PREFLIGHT_INPUT_DIR']=$run+'\'; $info.EnvironmentVariables['CAD_PREFLIGHT_OUTPUT']=$preflight
    $proc=New-Object Diagnostics.Process; $proc.StartInfo=$info
    $outStream=[IO.File]::Create($stdout); $errStream=[IO.File]::Create($stderr)
    if (-not $proc.Start()) { throw 'Core Console did not start.' }
    $manifest.ownedPid=$proc.Id; $ownedStart=$proc.StartTime.ToUniversalTime(); $manifest.ownedStartTimeUtc=$ownedStart.ToString('o'); $manifest.status='running'
    $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8
    $outTask=$proc.StandardOutput.BaseStream.CopyToAsync($outStream); $errTask=$proc.StandardError.BaseStream.CopyToAsync($errStream)
    if (-not $proc.WaitForExit($TimeoutSeconds*1000)) { $manifest.timedOut=$true; Stop-OwnedPreflightConsole $proc $ownedStart $console }
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
    if ($log -notmatch '(?m)^\s*CAD_PREFLIGHT_SUCCESS modelSpace=' -or $log -match '(?m)^\s*CAD_PREFLIGHT_(FAILED|ERROR):' -or $log -match '(?im)(;\s*error|fatal error|licen[cs].*(fail|error)|drawing.*(corrupt|recover))') { throw 'CAD preflight log validation failed; inspect complete raw logs.' }
    if (-not [IO.File]::Exists($preflight) -or (Get-Item -LiteralPath $preflight).Length -gt 20MB) { throw 'Preflight JSON missing or exceeds the 20 MB budget.' }
    $data=Get-Content -LiteralPath $preflight -Raw|ConvertFrom-Json
    Assert-PreflightData $data
    $manifest.status='cad-preflight-complete-review-logs'; $manifest.preflightPath=$preflight; $manifest.dwgSignature=$signature
} catch {
    $failure=$_.Exception.Message
    if ($manifest) { $manifest.status='failed-unaccepted'; $manifest.failure=$failure }
} finally {
    if ($proc -and $ownedStart) { try { Stop-OwnedPreflightConsole $proc $ownedStart $console } catch { $failure=([string]$failure+' Cleanup: '+$_.Exception.Message); if($manifest){$manifest.cleanupFailure=$_.Exception.Message} } }
    if ($outStream) { $outStream.Dispose() }; if ($errStream) { $errStream.Dispose() }
    if ($manifest) {
        try {
            $manifest.sourceSha256After=(Get-PreflightSha256 $source)
            if ([IO.File]::Exists($inputCopy)) { $manifest.copySha256After=(Get-PreflightSha256 $inputCopy) }
            if ($manifest.sourceSha256After -ne $sourceHash -or $manifest.copySha256After -ne $sourceHash) { throw 'Source/copy hash changed or copy is unavailable.' }
        } catch { $failure=([string]$failure+' Integrity: '+$_.Exception.Message); $manifest.integrityFailure=$_.Exception.Message }
        if ($failure) { $manifest.status='failed-unaccepted'; $manifest.failure=$failure }
        $manifest.finishedUtc=[DateTime]::UtcNow.ToString('o'); $manifest.artifacts=@{}
        foreach ($name in @('preflight.json','stdout.log','stderr.log','preflight.scr','console.decoded.log')) {
            $artifact=Join-Path $run $name
            if ([IO.File]::Exists($artifact)) { try { $manifest.artifacts[$name]=@{sha256=(Get-PreflightSha256 $artifact);bytes=(Get-Item -LiteralPath $artifact).Length} } catch { $failure=([string]$failure+' Artifact hash: '+$_.Exception.Message); $manifest.status='failed-unaccepted' } }
        }
        try { $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8 } catch { $failure=([string]$failure+' Manifest write: '+$_.Exception.Message) }
        Write-Output (Join-Path $run 'manifest.json')
    }
    if ($proc) { $proc.Dispose() }
}
if ($failure) { Write-Error $failure -ErrorAction Continue; exit 1 }
