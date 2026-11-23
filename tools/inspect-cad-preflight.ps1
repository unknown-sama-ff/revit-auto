# Read-only CAD preflight extractor for AutoCAD Core Console. Windows PowerShell 5.1 / PowerShell 7 on Windows.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$ConsolePath,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [ValidateRange(1,300)][int]$TimeoutSeconds=180,
    [ValidateRange(5,300)][int]$StallTimeoutSeconds=30,
    [switch]$SkipGeometryJsonl,
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

function Assert-PreflightScriptSyntax([string]$LispText) {
    $rawLines=$LispText -split '\r?\n'
    $activeLines=@()
    foreach ($line in $rawLines) {
        $trimmed=$line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith(';')) { continue }
        if ($line.Length -gt 500) {
            throw 'CAD preflight LISP line exceeds 500 characters; wrap lines to prevent Core Console .scr truncation and interactive prompt hang.'
        }
        $activeLines+=$line
    }
    if ($activeLines.Count -eq 0) { throw 'CAD preflight LISP contains no executable statements.' }
    $depth=0; $inString=$false; $escape=$false
    $joined=$activeLines -join "`n"
    foreach ($ch in $joined.ToCharArray()) {
        if ($inString) {
            if ($escape) { $escape=$false }
            elseif ($ch -eq [char]'\') { $escape=$true }
            elseif ($ch -eq [char]'"') { $inString=$false }
        } elseif ($ch -eq [char]'"') {
            $inString=$true
        } elseif ($ch -eq [char]'(') {
            $depth++
        } elseif ($ch -eq [char]')') {
            $depth--
            if ($depth -lt 0) { throw 'CAD preflight LISP has an unbalanced closing parenthesis; refuse to launch Core Console.' }
        }
    }
    if ($inString -or $depth -ne 0) {
        throw 'CAD preflight LISP has unbalanced parentheses or string literals; refuse to launch Core Console.'
    }
    return ($activeLines -join "`r`n")
}

function Test-PreflightInteractiveHangText([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    $tail=if ($Text.Length -gt 4096) { $Text.Substring($Text.Length - 4096) } else { $Text }
    if ($tail -match '(?m)^\s*\(+_>\s*$') { return 'interactive_prompt_hang' }
    if ($tail -match '(?i)(Press ENTER to continue|Enter name of drawing|Specify\s+(?:font|shape)|Select shape file|Press ESC to cancel)') { return 'interactive_prompt_hang' }
    if ($tail -match '(?i)(Drawing file is not valid|Press ENTER to recover|drawing\s+.*needs\s+recovery)') { return 'drawing_recovery_prompt' }
    if ($tail -match '(?i)(fatal\s+error|licen[cs][a-z]*\s+.*(?:fail|error))') { return 'cad_fatal_or_license_error' }
    return $null
}

function Read-PreflightLogTail([string]$Path, [int]$MaxBytes=4096) {
    if (-not [IO.File]::Exists($Path)) { return '' }
    $fs=$null
    try {
        $fs=[IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
        $len=$fs.Length
        if ($len -le 0) { return '' }
        $readLen=[int][Math]::Min($len,$MaxBytes)
        $start=$len - $readLen
        if ($start -gt 0 -and ($start % 2) -ne 0) { $start--; $readLen++ }
        [void]$fs.Seek($start,[IO.SeekOrigin]::Begin)
        $buf=New-Object byte[] $readLen
        $actual=$fs.Read($buf,0,$readLen)
        if ($actual -le 0) { return '' }
        $zeroOdd=0; $pairs=[int]($actual / 2)
        for ($i=1; $i -lt $actual; $i+=2) { if ($buf[$i] -eq 0) { $zeroOdd++ } }
        $enc=if ($pairs -gt 4 -and ($zeroOdd / [double]$pairs) -gt 0.4) { [Text.Encoding]::Unicode } else { [Text.Encoding]::UTF8 }
        return $enc.GetString($buf,0,$actual)
    } catch { return '' } finally { if ($fs) { $fs.Dispose() } }
}

function Test-OwnedPreflightOrphanCandidate([string]$CommandLine, [bool]$ParentAlive, [double]$AgeSeconds, [int]$MaxOrphanAgeSeconds=360) {
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $isOwnedMarker=($CommandLine -match '/isolate\s+cad-pf-[0-9a-f]{32}') -and ($CommandLine -match 'preflight\.scr') -and ($CommandLine -match '/readonly')
    if (-not $isOwnedMarker) { return $false }
    return ((-not $ParentAlive) -or ($AgeSeconds -gt $MaxOrphanAgeSeconds))
}

function Clear-OwnedOrphanPreflightConsoles([int]$MaxOrphanAgeSeconds=360) {
    $cleaned=@(); $remainingActive=0
    $candidates=@(Get-CimInstance Win32_Process -Filter "Name='accoreconsole.exe'" -ErrorAction SilentlyContinue)
    foreach ($item in $candidates) {
        $procId=[int]$item.ProcessId
        $ppid=[int]$item.ParentProcessId
        $cmdLine=[string]$item.CommandLine
        $parentAlive=$false
        if ($ppid -gt 0) {
            try { $parentProc=[Diagnostics.Process]::GetProcessById($ppid); $parentAlive=(-not $parentProc.HasExited); $parentProc.Dispose() } catch { $parentAlive=$false }
        }
        $procObj=$null
        try {
            $procObj=[Diagnostics.Process]::GetProcessById($procId)
            $ageSec=([DateTime]::UtcNow - $procObj.StartTime.ToUniversalTime()).TotalSeconds
            if (Test-OwnedPreflightOrphanCandidate -CommandLine $cmdLine -ParentAlive $parentAlive -AgeSeconds $ageSec -MaxOrphanAgeSeconds $MaxOrphanAgeSeconds) {
                $exeName=[IO.Path]::GetFileName($procObj.MainModule.FileName)
                if ([string]::Equals($exeName,'accoreconsole.exe',[StringComparison]::OrdinalIgnoreCase)) {
                    $procObj.Kill()
                    $exited=$procObj.WaitForExit(5000)
                    $cleaned+=[ordered]@{pid=$procId;parentPid=$ppid;parentAlive=$parentAlive;ageSeconds=[Math]::Round($ageSec,1);terminated=$exited}
                    continue
                }
            }
            $remainingActive++
        } catch {
            # Process exited concurrently between CIM snapshot and lookup; no action needed.
        } finally {
            if ($procObj) { $procObj.Dispose() }
        }
    }
    return [ordered]@{cleanedCount=$cleaned.Count;cleaned=$cleaned;remainingActiveCount=$remainingActive}
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

function Get-OptionalFileLength([string]$Path) {
    if (-not [IO.File]::Exists($Path)) { return [int64]0 }
    try { return ([IO.FileInfo]::new($Path)).Length } catch { return [int64]0 }
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
    $inline=Assert-PreflightScriptSyntax ([IO.File]::ReadAllText($lisp))
    $sourceHash=(Get-PreflightSha256 $source)
    if ($CheckOnly) {
        [ordered]@{status='inputs-checked';sourceSha256=$sourceHash;dwgSignature=$signature;consoleSha256=(Get-PreflightSha256 $console);consoleSignatureValid=$true;timeoutSeconds=$TimeoutSeconds;stallTimeoutSeconds=$StallTimeoutSeconds;skipGeometryJsonl=[bool]$SkipGeometryJsonl;outputDirectory=$output;processStarted=$false;licenseRuntimeVerified=$false} | ConvertTo-Json
        return
    }
    $orphanCleanup=Clear-OwnedOrphanPreflightConsoles
    $waitAttempts=0
    while (@(Get-CimInstance Win32_Process -Filter "Name='accoreconsole.exe'").Count -gt 0) {
        if ($waitAttempts -ge 30) { throw 'An accoreconsole.exe process is already running and did not finish within 15 seconds; reassess isolation before inspecting.' }
        Start-Sleep -Milliseconds 500
        $waitAttempts++
    }
    [IO.Directory]::CreateDirectory($output) | Out-Null
    $run=Join-Path $output ('cad-preflight-'+[Guid]::NewGuid().ToString('N')); [IO.Directory]::CreateDirectory($run)|Out-Null
    $inputCopy=Join-Path $run 'source.dwg'; $preflight=Join-Path $run 'preflight.json'; $geometry=Join-Path $run 'geometry.jsonl'; $stdout=Join-Path $run 'stdout.log'; $stderr=Join-Path $run 'stderr.log'; $script=Join-Path $run 'preflight.scr'; $profile=Join-Path $run 'profile'
    $manifest=[ordered]@{schemaVersion=1;status='starting';source=$source;sourceSha256Before=$sourceHash;sourceCopy=$inputCopy;executable=$console;executableSha256=(Get-PreflightSha256 $console);lispSha256=(Get-PreflightSha256 $lisp);startedUtc=[DateTime]::UtcNow.ToString('o');supervisorPid=$PID;timeoutSeconds=$TimeoutSeconds;stallTimeoutSeconds=$StallTimeoutSeconds;skipGeometryJsonl=[bool]$SkipGeometryJsonl;orphanCleanup=$orphanCleanup;ownedPid=$null;ownedStartTimeUtc=$null;consoleExitCode=$null;timedOut=$false;stallDetected=$false;stallReason=$null;saveRequested=$false;modelWriteRequested=$false}
    $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8
    Copy-Item -LiteralPath $source -Destination $inputCopy
    if ((Get-PreflightSha256 $inputCopy) -ne $sourceHash) { throw 'Byte copy does not match source.' }
    [IO.File]::SetAttributes($inputCopy,[IO.FileAttributes]::ReadOnly)
    [IO.Directory]::CreateDirectory($profile)|Out-Null
    [IO.File]::WriteAllText($script,$inline+"`r`n_.QUIT`r`n",[Text.Encoding]::ASCII)
    $isolate='cad-pf-'+[Guid]::NewGuid().ToString('N')
    $info=New-Object Diagnostics.ProcessStartInfo; $info.FileName=$console
    $info.Arguments='/i "{0}" /s "{1}" /product ACAD /isolate {2} "{3}" /readonly' -f $inputCopy,$script,$isolate,$profile
    $manifest.arguments=$info.Arguments; $info.WorkingDirectory=$run; $info.UseShellExecute=$false; $info.CreateNoWindow=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $info.EnvironmentVariables['CAD_PREFLIGHT_INPUT_DIR']=$run+'\'; $info.EnvironmentVariables['CAD_PREFLIGHT_OUTPUT']=$preflight; $info.EnvironmentVariables['CAD_PREFLIGHT_BUDGET_MS']=[string]($TimeoutSeconds*1000)
    if ($SkipGeometryJsonl) { [void]$info.EnvironmentVariables.Remove('CAD_PREFLIGHT_GEOMETRY_OUTPUT') }
    else { $info.EnvironmentVariables['CAD_PREFLIGHT_GEOMETRY_OUTPUT']=$geometry }
    $proc=New-Object Diagnostics.Process; $proc.StartInfo=$info
    $outStream=[IO.FileStream]::new($stdout,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)
    $errStream=[IO.FileStream]::new($stderr,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)
    if (-not $proc.Start()) { throw 'Core Console did not start.' }
    $manifest.ownedPid=$proc.Id; $ownedStart=$proc.StartTime.ToUniversalTime(); $manifest.ownedStartTimeUtc=$ownedStart.ToString('o'); $manifest.status='running'
    $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8
    $outTask=$proc.StandardOutput.BaseStream.CopyToAsync($outStream); $errTask=$proc.StandardError.BaseStream.CopyToAsync($errStream)

    $startedAt=[DateTime]::UtcNow; $lastProgressUtc=$startedAt; $lastCpuMs=0.0; $lastOutBytes=[int64]0; $lastErrBytes=[int64]0; $lastGeomBytes=[int64]0; $lastJsonBytes=[int64]0
    while (-not $proc.WaitForExit(1000)) {
        $now=[DateTime]::UtcNow
        $elapsed=($now - $startedAt).TotalSeconds
        $cpuMs=$lastCpuMs
        try { $proc.Refresh(); $cpuMs=$proc.TotalProcessorTime.TotalMilliseconds } catch {}
        $outBytes=Get-OptionalFileLength $stdout; $errBytes=Get-OptionalFileLength $stderr
        $geomBytes=if ($SkipGeometryJsonl) { [int64]0 } else { Get-OptionalFileLength $geometry }
        $jsonBytes=Get-OptionalFileLength $preflight
        $progressed=($cpuMs -gt ($lastCpuMs + 10.0)) -or ($outBytes -gt $lastOutBytes) -or ($errBytes -gt $lastErrBytes) -or ($geomBytes -gt $lastGeomBytes) -or ($jsonBytes -gt $lastJsonBytes)
        if ($progressed) {
            $lastProgressUtc=$now; $lastCpuMs=$cpuMs; $lastOutBytes=$outBytes; $lastErrBytes=$errBytes; $lastGeomBytes=$geomBytes; $lastJsonBytes=$jsonBytes
        }
        $idleSec=($now - $lastProgressUtc).TotalSeconds
        if ($idleSec -ge 5) {
            $tailText=(Read-PreflightLogTail $stdout) + "`n" + (Read-PreflightLogTail $stderr)
            $hangReason=Test-PreflightInteractiveHangText $tailText
            if ($hangReason) {
                $manifest.stallDetected=$true; $manifest.stallReason=$hangReason
                $manifest.elapsedSeconds=[Math]::Round($elapsed,2); $manifest.lastProgressSecondsAgo=[Math]::Round($idleSec,2)
                Stop-OwnedPreflightConsole $proc $ownedStart $console
                break
            }
        }
        if ($idleSec -ge $StallTimeoutSeconds) {
            $manifest.stallDetected=$true; $manifest.stallReason='no_progress_timeout'
            $manifest.elapsedSeconds=[Math]::Round($elapsed,2); $manifest.lastProgressSecondsAgo=[Math]::Round($idleSec,2)
            Stop-OwnedPreflightConsole $proc $ownedStart $console
            break
        }
        if ($elapsed -ge $TimeoutSeconds) {
            $manifest.timedOut=$true; $manifest.stallDetected=$true; $manifest.stallReason='total_timeout'
            $manifest.elapsedSeconds=[Math]::Round($elapsed,2); $manifest.lastProgressSecondsAgo=[Math]::Round($idleSec,2)
            Stop-OwnedPreflightConsole $proc $ownedStart $console
            break
        }
    }
    if ($null -eq $manifest.elapsedSeconds) { $manifest.elapsedSeconds=[Math]::Round(([DateTime]::UtcNow - $startedAt).TotalSeconds,2) }
    $manifest.consoleExitCode=$proc.ExitCode
    if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($outTask,$errTask),5000)) { throw 'Log pipes did not close within the bounded drain interval.' }
    $outStream.Dispose(); $errStream.Dispose()
    if ($manifest.stallDetected) { throw ('Core Console stalled and was terminated by watchdog: '+$manifest.stallReason) }
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
    if (-not $SkipGeometryJsonl) {
        if (-not [IO.File]::Exists($geometry) -or (Get-Item -LiteralPath $geometry).Length -gt 50MB) { throw 'Preflight geometry JSONL missing or exceeds the 50 MB budget.' }
    }
    $data=Get-Content -LiteralPath $preflight -Raw|ConvertFrom-Json
    Assert-PreflightData $data
    $manifest.status='cad-preflight-complete-review-logs'; $manifest.preflightPath=$preflight; $manifest.geometryPath=if ($SkipGeometryJsonl) { $null } else { $geometry }; $manifest.dwgSignature=$signature
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
        foreach ($name in @('preflight.json','geometry.jsonl','stdout.log','stderr.log','preflight.scr','console.decoded.log')) {
            $artifact=Join-Path $run $name
            if ([IO.File]::Exists($artifact)) { try { $manifest.artifacts[$name]=@{sha256=(Get-PreflightSha256 $artifact);bytes=(Get-Item -LiteralPath $artifact).Length} } catch { $failure=([string]$failure+' Artifact hash: '+$_.Exception.Message); $manifest.status='failed-unaccepted' } }
        }
        try { $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding UTF8 } catch { $failure=([string]$failure+' Manifest write: '+$_.Exception.Message) }
        Write-Output (Join-Path $run 'manifest.json')
    }
    if ($proc) { $proc.Dispose() }
}
if ($failure) { Write-Error $failure -ErrorAction Continue; exit 1 }
