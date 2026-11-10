[CmdletBinding()]
param(
  [ValidateSet('Prepare','Confirm')][string]$Mode,
  [string]$AssemblyPath,
  [string]$RequestPath,
  [string]$BaselinePath,
  [string]$ExpectedRequestSha256,
  [switch]$ChatApproved,
  [switch]$AgentReviewed,
  [string]$StandingAuthorizationPath
)

$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'deployment.ps1')

function Get-SwitchHash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash}
function Get-SwitchBytesHash([byte[]]$Bytes){return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes))}
function Get-SwitchModuleVersionId([string]$Path){
  $stream=[IO.File]::OpenRead($Path);$reader=$null;$pe=$null
  try{
    $pe=[Reflection.PortableExecutable.PEReader]::new($stream);$reader=[Reflection.Metadata.PEReaderExtensions]::GetMetadataReader($pe)
    return $reader.GetGuid($reader.GetModuleDefinition().Mvid).ToString()
  }finally{if($null -ne $pe){$pe.Dispose()};$stream.Dispose()}
}
function Assert-SwitchPath([string]$Path){
  $resolved=[IO.Path]::GetFullPath($Path);$cursor=$resolved
  while($cursor){
    if(Test-Path -LiteralPath $cursor){
      if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Registration paths cannot contain reparse points.'}
    }
    $parent=[IO.Path]::GetDirectoryName($cursor)
    if($parent -eq $cursor){break};$cursor=$parent
  }
  return $resolved
}
function Write-SwitchNew([string]$Path,[byte[]]$Bytes){
  $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($Bytes);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Convert-SwitchJsonBytes($Value){return [Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 20))}
function Get-SwitchProtectedSnapshot($Context){
  $bridge=Assert-SwitchPath $Context.bridge
  if(-not(Test-Path -LiteralPath $bridge -PathType Leaf)){throw 'Existing bridge settings are required; registration never creates them.'}
  $files=@()
  foreach($path in $Context.clients){
    $checked=Assert-SwitchPath $path;$present=Test-Path -LiteralPath $checked -PathType Leaf
    $files+=[ordered]@{path=$checked;present=$present;sha256=$(if($present){Get-SwitchHash $checked}else{$null})}
  }
  $legacy=Assert-SwitchPath $Context.legacy2025;$legacyPresent=Test-Path -LiteralPath $legacy -PathType Container;$manifests=@()
  if($legacyPresent){
    foreach($item in (Get-ChildItem -LiteralPath $legacy -Filter '*.addin' -File | Sort-Object FullName)){
      $checked=Assert-SwitchPath $item.FullName;$manifests+=[ordered]@{path=$checked;sha256=Get-SwitchHash $checked}
    }
  }
  return [ordered]@{bridgePath=$bridge;bridgeSha256=Get-SwitchHash $bridge;bridgeAclSddl=(Get-Acl -LiteralPath $bridge).Sddl;
    runtimeAclSddl=(Get-Acl -LiteralPath $Context.runtime).Sddl;legacy2025Directory=$legacy;legacy2025DirectoryPresent=$legacyPresent;
    legacy2025Manifests=$manifests;clientConfigs=$files}
}
function Assert-SwitchProtected($Context,$Expected){
  $actual=Get-SwitchProtectedSnapshot $Context
  if(($actual|ConvertTo-Json -Depth 20 -Compress) -cne ($Expected|ConvertTo-Json -Depth 20 -Compress)){throw 'Bridge contents/ACL, 2025 manifests or client configuration changed.'}
}
function Read-SwitchXml([byte[]]$Bytes){
  $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null
  $memory=[IO.MemoryStream]::new($Bytes);$reader=[Xml.XmlReader]::Create($memory,$settings)
  $xml=[Xml.XmlDocument]::new();$xml.PreserveWhitespace=$true;$xml.XmlResolver=$null
  try{$xml.Load($reader)}finally{$reader.Dispose();$memory.Dispose()}
  $root=$xml.DocumentElement
  if($root.LocalName -cne 'RevitAddIns' -or $root.NamespaceURI){throw 'Unexpected Revit registration XML root.'}
  $children=@($root.ChildNodes|Where-Object NodeType -eq ([Xml.XmlNodeType]::Element))
  if($children.Count -ne 1 -or $children[0].LocalName -cne 'AddIn' -or $children[0].GetAttribute('Type') -cne 'Application'){throw 'Manifest must contain one Application AddIn only.'}
  $addin=$children[0]
  foreach($field in @('Name','Assembly','AddInId','FullClassName','VendorId','VendorDescription')){
    $matches=@($addin.SelectNodes($field))
    if($matches.Count -ne 1 -or $matches[0].Attributes.Count -ne 0 -or $matches[0].ChildNodes.Count -ne 1 -or $matches[0].FirstChild.NodeType -ne [Xml.XmlNodeType]::Text){throw "Manifest requires one plain-text $field field."}
  }
  if($addin.SelectSingleNode('AddInId').InnerText -cne '6E95F8A9-7A3D-4B4A-9C4F-93F1D92F31C8' -or $addin.SelectSingleNode('FullClassName').InnerText -cne 'RevitAutoV27.App'){throw 'Manifest identifies an unexpected add-in.'}
  return $xml
}
function Convert-SwitchXmlBytes($Xml,[bool]$Bom){
  $memory=[IO.MemoryStream]::new();$settings=[Xml.XmlWriterSettings]::new()
  $settings.Encoding=[Text.UTF8Encoding]::new($Bom);$settings.Indent=$false;$settings.NewLineHandling=[Xml.NewLineHandling]::None
  $writer=[Xml.XmlWriter]::Create($memory,$settings)
  try{$Xml.Save($writer);$writer.Flush();return ,$memory.ToArray()}finally{$writer.Dispose();$memory.Dispose()}
}
function Assert-SwitchManifestDifference([byte[]]$Original,[byte[]]$Proposed,[string]$Assembly){
  $old=Read-SwitchXml $Original;$new=Read-SwitchXml $Proposed
  $oldAssembly=$old.SelectSingleNode('/RevitAddIns/AddIn/Assembly');$newAssembly=$new.SelectSingleNode('/RevitAddIns/AddIn/Assembly')
  if($newAssembly.InnerText -cne $Assembly){throw 'Proposed Assembly differs from the selected DLL.'}
  $newAssembly.InnerText=$oldAssembly.InnerText
  if($old.OuterXml -cne $new.OuterXml){throw 'Manifest changed outside its Assembly field, including whitespace or attributes.'}
  return $oldAssembly.InnerText
}
function Assert-SwitchContext($Context){
  $runtime=Assert-SwitchPath $Context.runtime;$target=Assert-SwitchPath $Context.target
  if(-not(Test-Path -LiteralPath $runtime -PathType Container) -or -not(Test-Path -LiteralPath $target -PathType Leaf)){throw 'Existing private runtime and installed manifest are required.'}
}
function Assert-SwitchBaseline($Context,[string]$Path){
  if([string]::IsNullOrWhiteSpace($Path)){return $null}
  $resolved=Assert-SwitchPath $Path
  if([IO.Path]::GetDirectoryName($resolved) -ine [IO.Path]::GetFullPath($Context.runtime)){throw 'Baseline must be a direct child of the private runtime directory.'}
  if([IO.Path]::GetExtension($resolved) -ine '.json'){throw 'Baseline must be a JSON evidence file.'}
  try{$json=Get-Content -LiteralPath $resolved -Raw|ConvertFrom-Json}catch{throw 'Baseline must be valid JSON evidence.'}
  if($null -eq $json){throw 'Baseline JSON evidence is empty.'}
  $state=if($null -ne $json.after.document){$json.after.document}elseif($null -ne $json.before.document){$json.before.document}else{$null}
  return [ordered]@{path=$resolved;sha256=Get-SwitchHash $resolved;status=$json.status;documentState=$state}
}
function New-SwitchRequest($Context,[string]$Dll,[string]$Baseline){
  Assert-SwitchContext $Context;$assembly=Assert-SwitchPath (Assert-V27Dll $Context.root $Dll)
  $original=[IO.File]::ReadAllBytes($Context.target);$xml=Read-SwitchXml $original
  $node=$xml.SelectSingleNode('/RevitAddIns/AddIn/Assembly');$previous=$node.InnerText
  if($previous -ceq $assembly){throw 'The selected DLL is already registered.'}
  $node.InnerText=$assembly
  $hasBom=$original.Length -ge 3 -and $original[0] -eq 239 -and $original[1] -eq 187 -and $original[2] -eq 191
  $proposedBytes=Convert-SwitchXmlBytes $xml $hasBom;Assert-SwitchManifestDifference $original $proposedBytes $assembly|Out-Null
  $id=[Guid]::NewGuid().ToString('N');$proposed=Join-Path $Context.runtime "registration-switch-proposed-$id.addin"
  $request=Join-Path $Context.runtime "registration-switch-request-$id.json";$snapshot=Get-SwitchProtectedSnapshot $Context;$baselineEvidence=Assert-SwitchBaseline $Context $Baseline
  Write-SwitchNew $proposed $proposedBytes
  $moduleVersionId=Get-SwitchModuleVersionId $assembly
  $data=[ordered]@{status='PREPARED';state='PREPARED';requestId=$id;preparedAt=[DateTimeOffset]::Now.ToString('o');targetManifest=$Context.target;
    originalManifestSha256=Get-SwitchHash $Context.target;originalAssembly=$previous;proposedManifest=$proposed;proposedManifestSha256=Get-SwitchHash $proposed;
    assemblyPath=$assembly;assemblySha256=Get-SwitchHash $assembly;moduleVersionId=$moduleVersionId;expectedModuleVersionId=$moduleVersionId;baseline=$baselineEvidence;protectedSnapshot=$snapshot;automaticRetryAllowed=$false;automaticSave=$false;restartPerformed=$false}
  Write-SwitchNew $request (Convert-SwitchJsonBytes $data);Assert-SwitchProtected $Context $snapshot
  return $request
}
function Get-SwitchApproval($Context,[bool]$Approved,[bool]$AgentReviewed,[string]$AuthorizationPath){
  if($Approved){
    if($AgentReviewed -or -not [string]::IsNullOrWhiteSpace($AuthorizationPath)){throw 'Choose one approval source; agent review cannot be recorded as human chat approval.'}
    return [ordered]@{mode='human-chat';humanChatApproval=$true;agentReviewed=$false;standingAuthorization=$null}
  }
  if(-not $AgentReviewed){throw 'Explicit -ChatApproved or -AgentReviewed with a standing user authorization is required.'}
  if([string]::IsNullOrWhiteSpace($AuthorizationPath)){throw 'AgentReviewed requires -StandingAuthorizationPath.'}
  $file=Assert-SwitchPath $AuthorizationPath
  if([IO.Path]::GetDirectoryName($file) -ine [IO.Path]::GetFullPath($Context.runtime) -or [IO.Path]::GetExtension($file) -ine '.json'){
    throw 'Standing authorization must be a JSON direct child of the private runtime directory.'
  }
  if(Test-Path -LiteralPath "$file.revoked"){throw 'Standing authorization has been revoked.'}
  $bytes=[IO.File]::ReadAllBytes($file)
  try{$grant=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)|ConvertFrom-Json}catch{throw 'Standing authorization is not valid UTF-8 JSON.'}
  if(($grant.schemaVersion -isnot [int] -and $grant.schemaVersion -isnot [long]) -or $grant.schemaVersion -ne 1 -or
     $grant.kind -cne 'standing-development-authorization' -or $grant.enabled -isnot [bool] -or -not $grant.enabled -or
     $grant.grantedBy -cne 'user-chat' -or $grant.grantId -cnotmatch '^[a-f0-9]{32}$' -or
     $grant.userStatement -isnot [string] -or $grant.sourceSessionId -isnot [string] -or
     [string]::IsNullOrWhiteSpace($grant.userStatement) -or [string]::IsNullOrWhiteSpace($grant.sourceSessionId)){
    throw 'Standing authorization lacks an enabled explicit user-chat grant.'
  }
  $permissions=@($grant.permissions)
  if($grant.permissions -isnot [Array] -or $permissions.Count -ne 1 -or $permissions[0] -cne 'plugin_registration' -or
     [string]::IsNullOrWhiteSpace($grant.projectRoot) -or [string]::IsNullOrWhiteSpace($grant.targetManifest) -or
     [IO.Path]::GetFullPath($grant.projectRoot) -ine [IO.Path]::GetFullPath($Context.root) -or
     [IO.Path]::GetFullPath($grant.targetManifest) -ine [IO.Path]::GetFullPath($Context.target)){
    throw 'Standing authorization scope differs from this project and registration target.'
  }
  return [ordered]@{mode='agent-reviewed-standing-authorization';humanChatApproval=$false;agentReviewed=$true;
    standingAuthorization=[ordered]@{path=$file;sha256=Get-SwitchBytesHash $bytes;grantId=$grant.grantId;sourceSessionId=$grant.sourceSessionId}}
}
function Assert-SwitchApproval($Context,$Approval){
  if($Approval.mode -ceq 'human-chat'){return}
  $current=Get-SwitchApproval $Context $false $true $Approval.standingAuthorization.path
  if($current.standingAuthorization.sha256 -cne $Approval.standingAuthorization.sha256){throw 'Standing authorization changed during registration review.'}
}
function Invoke-SwitchRequest($Context,[string]$Request,[bool]$Approved,[string]$ReviewedRequestSha256,[bool]$AgentReviewed=$false,[string]$AuthorizationPath){
  $approval=Get-SwitchApproval $Context $Approved $AgentReviewed $AuthorizationPath
  if($ReviewedRequestSha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'Confirm requires the independently reviewed -ExpectedRequestSha256.'}
  Assert-SwitchContext $Context;$file=Assert-SwitchPath $Request
  if([IO.Path]::GetDirectoryName($file) -ine [IO.Path]::GetFullPath($Context.runtime)){throw 'Request must be a direct child of the private runtime directory.'}
  $requestBytes=[IO.File]::ReadAllBytes($file)
  if((Get-SwitchBytesHash $requestBytes) -ine $ReviewedRequestSha256){throw 'Prepared request hash differs from the independently reviewed request.'}
  $data=[Text.UTF8Encoding]::new($false,$true).GetString($requestBytes)|ConvertFrom-Json
  if($data.status -cne 'PREPARED' -or $data.state -cne 'PREPARED' -or $data.requestId -cnotmatch '^[a-f0-9]{32}$' -or $data.automaticRetryAllowed -ne $false){throw 'Malformed prepared registration request.'}
  if([IO.Path]::GetFileName($file) -cne "registration-switch-request-$($data.requestId).json"){throw 'Request filename differs from its bound request ID.'}
  if($data.targetManifest -ine $Context.target){throw 'Prepared target differs from the current-user 2027 manifest.'}
  $expectedProposed=Join-Path $Context.runtime "registration-switch-proposed-$($data.requestId).addin"
  if($data.proposedManifest -ine $expectedProposed){throw 'Unexpected proposed manifest path.'}
  $proposed=Assert-SwitchPath $data.proposedManifest;$assembly=Assert-SwitchPath (Assert-V27Dll $Context.root $data.assemblyPath)
  if((Get-SwitchHash $assembly) -cne $data.assemblySha256 -or (Get-SwitchModuleVersionId $assembly) -cne $data.moduleVersionId -or $data.moduleVersionId -cne $data.expectedModuleVersionId -or (Get-SwitchHash $proposed) -cne $data.proposedManifestSha256 -or (Get-SwitchHash $Context.target) -cne $data.originalManifestSha256){throw 'Original/proposed manifest or selected DLL identity/hash changed.'}
  if($null -ne $data.baseline){$baseline=Assert-SwitchBaseline $Context $data.baseline.path;if($baseline.sha256 -cne $data.baseline.sha256){throw 'Prepared baseline evidence changed.'}}
  $original=[IO.File]::ReadAllBytes($Context.target);$replacement=[IO.File]::ReadAllBytes($proposed)
  if((Get-SwitchBytesHash $original) -cne $data.originalManifestSha256 -or (Get-SwitchBytesHash $replacement) -cne $data.proposedManifestSha256){throw 'Captured manifest bytes differ from the independently reviewed request.'}
  $previous=Assert-SwitchManifestDifference $original $replacement $assembly
  if($previous -cne $data.originalAssembly){throw 'Original Assembly differs from the prepared request.'}
  Assert-SwitchProtected $Context $data.protectedSnapshot
  Assert-SwitchApproval $Context $approval
  $attempt=Join-Path $Context.runtime "registration-switch-attempt-$($data.requestId).json";$receipt=Join-Path $Context.runtime "registration-switch-receipt-$($data.requestId).json"
  $backup="$($Context.target).backup-registration-switch-$($data.requestId)"
  foreach($path in @($attempt,$receipt,$backup)){if(Test-Path -LiteralPath $path){throw 'Existing registration attempt/receipt/backup must be reviewed; do not retry.'};Assert-SwitchPath $path|Out-Null}
  $attemptData=[ordered]@{status='ATTEMPT_STARTED';requestId=$data.requestId;request=$file;attemptedAt=[DateTimeOffset]::Now.ToString('o');humanChatApproval=$approval.humanChatApproval;approval=$approval;
    reviewedRequestSha256=$ReviewedRequestSha256.ToUpperInvariant();
    targetManifest=$Context.target;backup=$backup;selectedAssembly=$assembly;selectedAssemblySha256=$data.assemblySha256;automaticRetryAllowed=$false;automaticSave=$false}
  Write-SwitchNew $attempt (Convert-SwitchJsonBytes $attemptData)
  try{
    Write-SwitchNew $backup $original
    if((Get-SwitchHash $backup) -cne $data.originalManifestSha256){throw 'Manifest backup hash differs from the original.'}
    Assert-SwitchContext $Context;Assert-SwitchProtected $Context $data.protectedSnapshot
    Assert-SwitchApproval $Context $approval
    if((Get-SwitchHash $Context.target) -cne $data.originalManifestSha256 -or (Get-SwitchHash $assembly) -cne $data.assemblySha256 -or (Get-SwitchModuleVersionId $assembly) -cne $data.moduleVersionId -or (Get-SwitchHash $proposed) -cne $data.proposedManifestSha256){throw 'Registration inputs changed immediately before write.'}
    if((Get-SwitchBytesHash $original) -cne $data.originalManifestSha256 -or (Get-SwitchBytesHash $replacement) -cne $data.proposedManifestSha256){throw 'Captured manifest bytes changed immediately before write.'}
    if($null -ne $data.baseline){$baseline=Assert-SwitchBaseline $Context $data.baseline.path;if($baseline.sha256 -cne $data.baseline.sha256){throw 'Prepared baseline evidence changed immediately before write.'}}
    Assert-SwitchApproval $Context $approval
    $targetStream=[IO.File]::Open($Context.target,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try{
      $current=[byte[]]::new($targetStream.Length);$targetStream.ReadExactly($current)
      if([Convert]::ToBase64String($current) -cne [Convert]::ToBase64String($original)){throw 'Manifest changed before obtaining the exclusive write handle.'}
      $targetStream.Position=0;$targetStream.Write($replacement);$targetStream.SetLength($replacement.Length);$targetStream.Flush($true)
    }finally{$targetStream.Dispose()}
    if((Get-SwitchHash $Context.target) -cne $data.proposedManifestSha256){throw 'Installed manifest readback hash differs.'}
    Assert-SwitchManifestDifference $original ([IO.File]::ReadAllBytes($Context.target)) $assembly|Out-Null
    Assert-SwitchProtected $Context $data.protectedSnapshot
    if($null -ne $data.baseline){$baseline=Assert-SwitchBaseline $Context $data.baseline.path;if($baseline.sha256 -cne $data.baseline.sha256){throw 'Prepared baseline evidence changed after registration.'}}
    $outcome=[ordered]@{status='REGISTERED_MANUAL_RESTART_PENDING';requestId=$data.requestId;completedAt=[DateTimeOffset]::Now.ToString('o');approval=$approval;
      reviewedRequestSha256=$ReviewedRequestSha256.ToUpperInvariant();
      targetManifest=$Context.target;backup=$backup;backupVerified=$true;installedManifestSha256=Get-SwitchHash $Context.target;selectedAssembly=$assembly;
      selectedAssemblySha256=$data.assemblySha256;moduleVersionId=$data.moduleVersionId;baselineUnchanged=($null -eq $data.baseline -or $baseline.sha256 -eq $data.baseline.sha256);protectedSnapshotUnchanged=$true;modelWritesRequested=$false;automaticSave=$false;restartPerformed=$false;automaticRetryAllowed=$false}
    Write-SwitchNew $receipt (Convert-SwitchJsonBytes $outcome);return $receipt
  }catch{
    $outcome=[ordered]@{status='FAILED_AFTER_ATTEMPT_DO_NOT_RETRY';requestId=$data.requestId;failedAt=[DateTimeOffset]::Now.ToString('o');approval=$approval;
      reviewedRequestSha256=$ReviewedRequestSha256.ToUpperInvariant();
      error=$_.Exception.Message;targetManifest=$Context.target;backup=$backup;automaticRetryAllowed=$false;automaticSave=$false;restartPerformed=$false}
    if(-not(Test-Path -LiteralPath $receipt)){Write-SwitchNew $receipt (Convert-SwitchJsonBytes $outcome)}
    throw
  }
}
function Get-CurrentSwitchContext{
  $root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $codex=if($env:CODEX_HOME){Join-Path $env:CODEX_HOME 'config.toml'}else{Join-Path $env:USERPROFILE '.codex\config.toml'}
  return @{root=$root;runtime=Join-Path $root 'runtime';bridge=Join-Path $root 'runtime\bridge.json';
    target=Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2027\RevitAutoV27.addin';legacy2025=Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2025';
    clients=@($codex,(Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'))}
}

if($MyInvocation.InvocationName -ne '.'){
  $context=Get-CurrentSwitchContext
  if($Mode -eq 'Prepare'){
    if([string]::IsNullOrWhiteSpace($AssemblyPath)){throw 'Prepare requires the exact -AssemblyPath selected for registration.'}
    $prepared=New-SwitchRequest $context $AssemblyPath $BaselinePath
    [ordered]@{status='PREPARED';requestPath=$prepared;requestSha256=Get-SwitchHash $prepared}|ConvertTo-Json
  }elseif($Mode -eq 'Confirm'){
    if([string]::IsNullOrWhiteSpace($RequestPath)){throw 'Confirm requires -RequestPath.'}
    Invoke-SwitchRequest $context $RequestPath $ChatApproved $ExpectedRequestSha256 $AgentReviewed $StandingAuthorizationPath
  }else{throw 'Specify -Mode Prepare or -Mode Confirm.'}
}
