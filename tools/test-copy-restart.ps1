#Requires -Version 7.5
[CmdletBinding()]
param(
  [ValidateSet('Prepare','Execute')][string]$Mode,
  [string]$OperationId,
  [string]$ExpectedRequestSha256,
  [switch]$OsHelper
)

$ErrorActionPreference='Stop'
$lifecycleRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lifecycleRuntime=Join-Path $lifecycleRoot 'runtime'

if(-not $OsHelper){
  if(-not $Mode){throw 'Choose Prepare or Execute; no lifecycle action is the default.'}
  if($Mode -eq 'Prepare'){
    if($OperationId -or $ExpectedRequestSha256){throw 'Prepare does not accept target paths or prior operation identifiers.'}
    & node (Join-Path $lifecycleRoot 'mcp/local-test-copy-supervisor.mjs') prepare
  }else{
    if($OperationId -cnotmatch '^[a-f0-9]{32}$' -or $ExpectedRequestSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'Execute requires the specifically approved operation ID and lowercase expected request SHA-256.'}
    & node (Join-Path $lifecycleRoot 'mcp/local-test-copy-supervisor.mjs') execute --operation-id $OperationId --expected-request-sha256 $ExpectedRequestSha256
  }
  exit $LASTEXITCODE
}
if($Mode -or $OperationId -or $ExpectedRequestSha256){throw 'OS helper cannot accept lifecycle action arguments.'}
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class LifecycleFileIdentity {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
    public System.Runtime.InteropServices.ComTypes.FILETIME Access; public System.Runtime.InteropServices.ComTypes.FILETIME Write;
    public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle handle,StringBuilder value,uint size,uint flags);
  static string FinalPath(SafeFileHandle handle) {
    var text=new StringBuilder(32768); var length=GetFinalPathNameByHandle(handle,text,(uint)text.Capacity,0);
    if(length==0||length>=text.Capacity) throw new IOException("Final local path is unavailable.");
    return text.ToString();
  }
  static bool Same(Info a,Info b) {return a.Volume==b.Volume&&a.IndexHigh==b.IndexHigh&&a.IndexLow==b.IndexLow&&a.SizeHigh==b.SizeHigh&&a.SizeLow==b.SizeLow&&a.Attributes==b.Attributes&&a.Write.dwHighDateTime==b.Write.dwHighDateTime&&a.Write.dwLowDateTime==b.Write.dwLowDateTime;}
  public static string[] Read(string path) {
    using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
      Info info; if(!GetFileInformationByHandle(stream.SafeFileHandle,out info)) throw new IOException("File identity is unavailable.");
      var text=new StringBuilder(32768); var length=GetFinalPathNameByHandle(stream.SafeFileHandle,text,(uint)text.Capacity,0);
      if(length==0||length>=text.Capacity) throw new IOException("Final local path is unavailable.");
      return new[]{info.Volume.ToString("x8")+":"+info.IndexHigh.ToString("x8")+info.IndexLow.ToString("x8"),text.ToString()};
    }
  }
  public static string[] Snapshot(string path) {
    using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
      Info before,after; if(!GetFileInformationByHandle(stream.SafeFileHandle,out before)) throw new IOException("Stable file identity is unavailable.");
      var final=FinalPath(stream.SafeFileHandle);string digest; using(var hash=SHA256.Create()) digest=Convert.ToHexString(hash.ComputeHash(stream)).ToLowerInvariant();
      if(!GetFileInformationByHandle(stream.SafeFileHandle,out after)||!Same(before,after)||!String.Equals(final,FinalPath(stream.SafeFileHandle),StringComparison.OrdinalIgnoreCase)) throw new IOException("File changed during shared-handle hashing.");
      using(var fresh=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
        Info current;if(!GetFileInformationByHandle(fresh.SafeFileHandle,out current)||!Same(before,current)||!String.Equals(final,FinalPath(fresh.SafeFileHandle),StringComparison.OrdinalIgnoreCase)) throw new IOException("The current path no longer names the same hashed file.");
      }
      return new[]{before.Volume.ToString("x8")+":"+before.IndexHigh.ToString("x8")+before.IndexLow.ToString("x8"),((long)before.SizeHigh*4294967296L+before.SizeLow).ToString(System.Globalization.CultureInfo.InvariantCulture),digest,final};
    }
  }
}
'@

$lifecycleHandles=@{}
$lifecycleCapturedProcess=$null
$lifecycleLaunched=$false
$lifecycleConfigPath=Join-Path $lifecycleRuntime 'bridge.json'
$lifecycleSource=Join-Path $lifecycleRuntime 'element-dependencies-loaded-1791644043265.json'
$lifecycleSourceHash='3d807d10a564c39f8508c2b8061176908f97c87ecc6c3ec2db1fd38cfabfc2c3'

function Assert-HelperFields($Value,[string[]]$Fields){
  if($null -eq $Value -or $Value -isnot [System.Collections.IDictionary]){throw 'Structured helper arguments are required.'}
  if($Value.Count -ne $Fields.Count -or @($Value.Keys|Where-Object {$_ -cnotin $Fields}).Count){throw 'Unknown or missing helper fields.'}
}
function Assert-LocalFile([string]$Candidate){
  if([string]::IsNullOrWhiteSpace($Candidate) -or -not [IO.Path]::IsPathFullyQualified($Candidate) -or $Candidate.StartsWith('\\')){throw 'Only existing local absolute files are allowed.'}
  $absolute=[IO.Path]::GetFullPath($Candidate)
  if(([IO.DriveInfo]::new([IO.Path]::GetPathRoot($absolute))).DriveType -ne [IO.DriveType]::Fixed){throw 'Network, removable or unknown drives are rejected.'}
  $cursor=$absolute
  while($cursor){
    if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse points and path aliases are rejected.'}
    $parent=[IO.Path]::GetDirectoryName($cursor);if($parent -eq $cursor){break};$cursor=$parent
  }
  if(-not(Test-Path -LiteralPath $absolute -PathType Leaf)){throw 'A file must already exist.'}
  $identity=[LifecycleFileIdentity]::Read($absolute)
  $final=$identity[1]
  if($final.StartsWith('\\?\')){$final=$final.Substring(4)}
  if($final -ine $absolute){throw 'The final file path differs from the fixed path.'}
  return @{path=$absolute;fileIdentity=$identity[0]}
}
function Get-BoundModelPath {
  Assert-LocalFile $lifecycleSource|Out-Null
  if((Get-FileHash -LiteralPath $lifecycleSource -Algorithm SHA256).Hash.ToLowerInvariant() -cne $lifecycleSourceHash){throw 'The fixed dependency-loaded evidence changed.'}
  $evidence=Get-Content -LiteralPath $lifecycleSource -Raw|ConvertFrom-Json -Depth 100
  if($evidence.status -cne 'ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED'){throw 'Fixed saved-scope evidence is incomplete.'}
  return [IO.Path]::GetFullPath($evidence.after.document.path)
}
function Get-Snapshot([string]$Candidate){
  $checked=Assert-LocalFile $Candidate
  $model=Get-BoundModelPath
  $backupName=[IO.Path]::GetFileName($checked.path)
  if($checked.path -ine $model -and -not ([IO.Path]::GetDirectoryName($checked.path) -ieq $lifecycleRuntime -and $backupName -cmatch '^lifecycle-[a-f0-9]{32}-backup\.rvt$')){throw 'File inspection is limited to the fixed model and operation backup.'}
  if(((Get-Item -LiteralPath $checked.path -Force).Attributes -band [IO.FileAttributes]::ReadOnly) -ne 0){throw 'Read-only test-copy files are rejected.'}
  $before=Get-Item -LiteralPath $checked.path -Force
  $snapshot=[LifecycleFileIdentity]::Snapshot($checked.path)
  $after=Assert-LocalFile $checked.path;$afterInfo=Get-Item -LiteralPath $checked.path -Force
  $snapshotPath=$snapshot[3];if($snapshotPath.StartsWith('\\?\')){$snapshotPath=$snapshotPath.Substring(4)}
  if($snapshotPath -ine $checked.path -or $checked.fileIdentity -cne $snapshot[0] -or $checked.fileIdentity -cne $after.fileIdentity -or $before.Length -ne [long]$snapshot[1] -or $before.Length -ne $afterInfo.Length -or $before.LastWriteTimeUtc -ne $afterInfo.LastWriteTimeUtc){throw 'File changed during its independent read.'}
  return @{path=$checked.path;bytes=$afterInfo.Length;sha256=$snapshot[2];fileIdentity=$checked.fileIdentity}
}
function Get-ConfigSnapshot([string]$Candidate){
  if([IO.Path]::GetFullPath($Candidate) -ine $lifecycleConfigPath){throw 'Config path override is rejected.'}
  $checked=Assert-LocalFile $Candidate;$bytes=[IO.File]::ReadAllBytes($checked.path)
  $config=[Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xfeff)|ConvertFrom-Json
  if($config.port -isnot [long] -and $config.port -isnot [int]){throw 'Bridge port must be integral.'}
  if($config.port -lt 1024 -or $config.port -gt 65535){throw 'Bridge port is outside the fixed allowed range.'}
  $acl=Get-Acl -LiteralPath $checked.path
  $sections=[Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group
  return @{path=$checked.path;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant();aclSddl=$acl.GetSecurityDescriptorSddlForm($sections);port=[int]$config.port}
}
function Get-CurrentIdentity {return @{userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId}}
function Get-ProcessIdentity([long]$TargetPid,[Diagnostics.Process]$RetainedProcess=$null){
  if($TargetPid -le 0 -or $TargetPid -gt [int]::MaxValue){throw 'Invalid process identity.'}
  $ownsProcess=$null -eq $RetainedProcess
  $proc=if($ownsProcess){[Diagnostics.Process]::GetProcessById([int]$TargetPid)}else{$RetainedProcess}
  try{
    $proc.Handle|Out-Null
    $proc.Refresh();if($proc.HasExited){throw 'Bound process has exited.'}
    $exe=$proc.MainModule.FileName;$checked=Assert-LocalFile $exe
    if([IO.Path]::GetFileName($exe) -ine 'Revit.exe'){throw 'Only the fixed Revit executable can be inspected.'}
    $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
    if($version.FileMajorPart -ne 27 -or $version.FileMinorPart -ne 3){throw 'Only Revit 2027.3 is supported.'}
    $cim=Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$TargetPid"
    $owner=Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid
    if($owner.ReturnValue -ne 0){throw 'Process owner SID is unavailable.'}
    $current=Get-CurrentIdentity
    if($owner.Sid -cne $current.userSid -or $proc.SessionId -ne $current.sessionId){throw 'Process is outside the current interactive user/session.'}
    return @{pid=$proc.Id;startTimeUtc=$proc.StartTime.ToUniversalTime().ToString('o');exePath=$checked.path;exeSha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant();version="$($version.FileMajorPart).$($version.FileMinorPart).$($version.FileBuildPart).$($version.FilePrivatePart)";userSid=$owner.Sid;sessionId=$proc.SessionId}
  }finally{if($ownsProcess){$proc.Dispose()}}
}
function Get-PortOwner([int]$Port){
  if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid bound port.'}
  $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object LocalPort -eq $Port)
  $owners=@($listeners.OwningProcess|Sort-Object -Unique)
  if($owners.Count -eq 0){return $null}
  if($owners.Count -ne 1){throw 'Bridge port has ambiguous process ownership.'}
  return [int]$owners[0]
}
function Read-HelperRecord([string]$Candidate,[string]$ExpectedHash){
  $checked=Assert-LocalFile $Candidate
  if([IO.Path]::GetDirectoryName($checked.path) -ine $lifecycleRuntime){throw 'Lifecycle permit escaped fixed runtime.'}
  $bytes=[IO.File]::ReadAllBytes($checked.path)
  if($bytes.Length -gt 8388608){throw 'Lifecycle permit exceeds its bounded budget.'}
  if($ExpectedHash -and [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() -cne $ExpectedHash){throw 'Lifecycle permit digest changed.'}
  return [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xfeff)|ConvertFrom-Json -AsHashtable -Depth 100 -DateKind String
}
function Assert-LaunchNotStopped([string]$BoundOperation,[string]$BoundHash){
  if($BoundOperation -cnotmatch '^[a-f0-9]{32}$' -or $BoundHash -cnotmatch '^[a-f0-9]{64}$'){throw 'Launch approval identity is invalid.'}
  $stopPath=Join-Path $lifecycleRuntime "lifecycle-$BoundOperation-supervisor-stop.json"
  if(Test-Path -LiteralPath $stopPath){
    $stop=Read-HelperRecord $stopPath
    Assert-HelperFields $stop @('schemaVersion','operationId','requestSha256','status','atUtc','reason')
    if($stop.schemaVersion -ne 1 -or $stop.operationId -cne $BoundOperation -or $stop.requestSha256 -cne $BoundHash){throw 'Permanent launch stop has conflicting approval identity.'}
    throw 'Permanent supervisor stop prevents empty Revit launch.'
  }
}
function Assert-LaunchPermit($Argument){
  Assert-HelperFields $Argument @('exePath','operationId','requestSha256')
  $op=$Argument.operationId;$hash=$Argument.requestSha256
  Assert-LaunchNotStopped $op $hash
  $request=Read-HelperRecord (Join-Path $lifecycleRuntime "lifecycle-$op-request.json") $hash
  if($request.schemaVersion -ne 1 -or $request.operationId -cne $op -or $request.process.exePath -cne $Argument.exePath -or $request.registration.modelPath -ine (Get-BoundModelPath)){throw 'Launch request differs from the fixed approved model or executable.'}
  $lease=Read-HelperRecord (Join-Path $lifecycleRuntime "lifecycle-$op-supervisor-lease.json")
  Assert-HelperFields $lease @('schemaVersion','operationId','requestSha256','atUtc')
  if($lease.schemaVersion -ne 1){throw 'Supervisor lease record version is unsupported.'}
  if($lease.operationId -cne $op -or $lease.requestSha256 -cne $hash){throw 'Launch requires the same active supervisor lease.'}
  $attempt=Read-HelperRecord (Join-Path $lifecycleRuntime "lifecycle-$op-launch-attempt.json")
  Assert-HelperFields $attempt @('schemaVersion','operationId','requestSha256','exitEvidenceSha256','atUtc')
  if($attempt.schemaVersion -ne 1 -or $attempt.operationId -cne $op -or $attempt.requestSha256 -cne $hash){throw 'Single launch marker differs from the approved request.'}
  $exit=Read-HelperRecord (Join-Path $lifecycleRuntime "lifecycle-$op-exit-observed.json") $attempt.exitEvidenceSha256
  Assert-HelperFields $exit @('schemaVersion','operationId','requestSha256','oldProcess','exitCode','portReleased','eventClosureFile','eventClosureSha256','savedFile','atUtc')
  if($exit.schemaVersion -ne 1 -or $exit.operationId -cne $op -or $exit.requestSha256 -cne $hash -or $exit.exitCode -ne 0 -or $exit.portReleased -ne $true){throw 'Normal old-process exit is unverified.'}
  foreach($key in @('pid','startTimeUtc','exePath','exeSha256','version','userSid','sessionId')){if($exit.oldProcess[$key] -cne $lifecycleCapturedProcess[$key] -or $request.process[$key] -cne $lifecycleCapturedProcess[$key]){throw 'Exit evidence differs from the retained old process.'}}
  $closurePath=[IO.Path]::GetFullPath($exit.eventClosureFile)
  if([IO.Path]::GetDirectoryName($closurePath) -ine $lifecycleRuntime -or [IO.Path]::GetFileName($closurePath) -cnotmatch "^lifecycle-$op-event-[0-9]{6}\.json$"){throw 'Exit closure escaped the fixed event chain.'}
  $closure=Read-HelperRecord $closurePath $exit.eventClosureSha256
  if($closure.operationId -cne $op -or $closure.requestSha256 -cne $hash -or $closure.kind -cne 'shutdown_closed' -or $closure.data.complete -ne $true -or $null -ne $closure.data.stopReason){throw 'Native event log did not close successfully.'}
  $file=Get-Snapshot $request.document.path
  foreach($key in @('path','bytes','sha256','fileIdentity')){if($file[$key] -cne $exit.savedFile[$key]){throw 'Saved model changed before launch.'}}
  $config=Get-ConfigSnapshot $request.bridgeConfig.path
  foreach($key in @('path','sha256','aclSddl','port')){if($config[$key] -cne $request.bridgeConfig[$key]){throw 'Bridge configuration changed before launch.'}}
  if($null -ne (Get-PortOwner $config.port)){throw 'Fixed bridge port is not free before launch.'}
  Assert-LaunchNotStopped $op $hash
}
function Invoke-Helper($Command){
  Assert-HelperFields $Command @('id','operation','args')
  $argument=$Command.args
  switch -CaseSensitive ($Command.operation){
    'identity' {Assert-HelperFields $argument @();return Get-CurrentIdentity}
    'file' {Assert-HelperFields $argument @('path');return Get-Snapshot $argument.path}
    'config' {Assert-HelperFields $argument @('path');return Get-ConfigSnapshot $argument.path}
    'inspect_process' {Assert-HelperFields $argument @('pid');return Get-ProcessIdentity $argument.pid}
    'capture' {
      Assert-HelperFields $argument @('process');$pin=$argument.process
      $proc=[Diagnostics.Process]::GetProcessById([int]$pin.pid)
      try{
        $proc.Handle|Out-Null
        $actual=Get-ProcessIdentity $pin.pid $proc
        foreach($key in @('pid','startTimeUtc','exePath','exeSha256','version','userSid','sessionId')){if($actual[$key] -cne $pin[$key]){throw 'Bound process changed at retained handle capture.'}}
        $id=[Guid]::NewGuid().ToString('N');$lifecycleHandles[$id]=$proc;$script:lifecycleCapturedProcess=$actual
        return @{id=$id;pid=$actual.pid}
      }catch{$proc.Dispose();throw}
    }
    'observe' {
      Assert-HelperFields $argument @('handle');$id=$argument.handle.id
      if(-not $lifecycleHandles.ContainsKey($id)){throw 'Unknown retained process handle.'}
      $proc=$lifecycleHandles[$id];$proc.Refresh()
      return @{exited=$proc.HasExited;exitCode=$(if($proc.HasExited){$proc.ExitCode}else{$null})}
    }
    'port_free' {Assert-HelperFields $argument @('port');return $null -eq (Get-PortOwner $argument.port)}
    'port_owner' {Assert-HelperFields $argument @('port');return Get-PortOwner $argument.port}
    'launch_empty' {
      Assert-LaunchPermit $argument
      if($lifecycleLaunched -or -not $lifecycleCapturedProcess -or $argument.exePath -cne $lifecycleCapturedProcess.exePath){throw 'Single launch must use the previously captured fixed executable.'}
      foreach($proc in $lifecycleHandles.Values){if(-not $proc.HasExited -or $proc.ExitCode -ne 0){throw 'A retained old process did not exit normally.'}}
      Assert-LocalFile $argument.exePath|Out-Null
      if((Get-FileHash -LiteralPath $argument.exePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $lifecycleCapturedProcess.exeSha256){throw 'Fixed executable bytes changed before launch.'}
      $current=Get-CurrentIdentity
      if($current.userSid -cne $lifecycleCapturedProcess.userSid -or $current.sessionId -ne $lifecycleCapturedProcess.sessionId){throw 'Launch user or session changed.'}
      $script:lifecycleLaunched=$true
      $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$argument.exePath;$start.WorkingDirectory=[IO.Path]::GetDirectoryName($argument.exePath);$start.UseShellExecute=$true;$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Normal
      Assert-LaunchNotStopped $argument.operationId $argument.requestSha256
      $proc=[Diagnostics.Process]::Start($start)
      if($null -eq $proc){throw 'Revit launch did not return a process handle.'}
      $proc.Refresh();$id=[Guid]::NewGuid().ToString('N');$lifecycleHandles[$id]=$proc
      return @{id=$id;pid=$proc.Id}
    }
    default {throw 'Unsupported OS helper operation.'}
  }
}

try{
  while($null -ne ($line=[Console]::ReadLine())){
    if($line.Length -gt 65536){throw 'OS helper input exceeds its bounded budget.'}
    $command=$null
    try{$command=$line|ConvertFrom-Json -AsHashtable -Depth 20 -DateKind String;$result=Invoke-Helper $command;[Console]::WriteLine((@{id=$command.id;ok=$true;result=$result}|ConvertTo-Json -Compress -Depth 20))}
    catch{
      $message=([string]$_.Exception.Message).Replace("`r",' ').Replace("`n",' ');if($message.Length -gt 512){$message=$message.Substring(0,512)}
      $detail=@{type=$_.Exception.GetType().FullName;line=[int]$_.InvocationInfo.ScriptLineNumber;message=$message}
      [Console]::Error.WriteLine(('{0}:{1}' -f $detail.type,$detail.line));[Console]::WriteLine((@{id=$command.id;ok=$false;code='os_inspection_failed';detail=$detail}|ConvertTo-Json -Compress -Depth 5))
    }
  }
}finally{foreach($proc in $lifecycleHandles.Values){$proc.Dispose()}}
