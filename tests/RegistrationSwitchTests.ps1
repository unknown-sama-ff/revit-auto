$ErrorActionPreference='Stop'
$packageRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $packageRoot 'v27\registration-switch.ps1')
$selectedDll=Join-Path $packageRoot 'v27\bin\Release\net10.0-windows-recovery-parity-20261010\RevitAutoV27.dll'
if(-not(Test-Path -LiteralPath $selectedDll -PathType Leaf)){throw 'Build the dedicated recovery-parity DLL before these fixture tests.'}
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('registration-switch-tests-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot|Out-Null
$passed=0
function Assert-Test([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Expect-Throw([scriptblock]$Action,[string]$Pattern){
  try{& $Action}catch{if($_.Exception.Message -match $Pattern){return};throw};throw "Expected failure: $Pattern"
}
function Test([string]$Name,[scriptblock]$Action){& $Action;$script:passed++;Write-Output "PASS $Name"}
function Assert-NoSubmission($Context,[string]$Before){
  Assert-Test ((Get-SwitchHash $Context.target) -eq $Before) 'Rejected request changed the manifest.'
  foreach($prefix in @('registration-switch-attempt-','registration-switch-receipt-')){
    Assert-Test (@(Get-ChildItem -LiteralPath $Context.runtime -Filter "$prefix*").Count -eq 0) 'Rejected request wrote attempt/receipt evidence.'
  }
  Assert-Test (@(Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($Context.target)) -Filter 'RevitAutoV27.addin.backup-registration-switch-*').Count -eq 0) 'Rejected request wrote a registration backup.'
}
function New-Fixture{
  $dir=Join-Path $fixtureRoot ([Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $dir|Out-Null
  $runtime=Join-Path $dir 'runtime';$legacy=Join-Path $dir '2025';$registration=Join-Path $dir '2027'
  foreach($folder in @($runtime,$legacy,$registration)){New-Item -ItemType Directory -Path $folder|Out-Null}
  $bridge=Join-Path $runtime 'bridge.json';[IO.File]::WriteAllText($bridge,'{"port":8091,"fixtureCredential":"never printed"}')
  $target=Join-Path $registration 'RevitAutoV27.addin'
  $template=[IO.File]::ReadAllText((Join-Path $packageRoot 'v27\RevitAutoV27.addin.example')).Replace('<Assembly>RevitAutoV27.dll</Assembly>','<Assembly>D:\old\RevitAutoV27.dll</Assembly>')
  [IO.File]::WriteAllText($target,$template,[Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $legacy 'old.addin'),'legacy2025')
  $client=Join-Path $dir 'client.toml';[IO.File]::WriteAllText($client,'client fixture settings')
  $baseline=Join-Path $runtime 'saved-baseline.json';[IO.File]::WriteAllText($baseline,'{"saved":true,"items":[1,2,3]}')
  return @{root=$packageRoot;runtime=$runtime;bridge=$bridge;target=$target;legacy2025=$legacy;clients=@($client,(Join-Path $dir 'absent-client.json'));baseline=$baseline;directory=$dir}
}
function New-StandingAuthorization($Context){
  $file=Join-Path $Context.runtime 'standing-authorization.json'
  $grant=[ordered]@{schemaVersion=1;kind='standing-development-authorization';grantId=[Guid]::NewGuid().ToString('N');enabled=$true;
    grantedBy='user-chat';userStatement='Fixture user delegates plugin registration review.';sourceSessionId=[Guid]::NewGuid().ToString();
    projectRoot=$Context.root;targetManifest=$Context.target;permissions=@('plugin_registration')}
  Write-SwitchNew $file (Convert-SwitchJsonBytes $grant);return $file
}
try{
  Test 'Standing user grant permits one agent-reviewed exact switch without claiming per-request human approval'{
    $context=New-Fixture;$request=New-SwitchRequest $context $selectedDll $context.baseline;$hash=Get-SwitchHash $request
    $grant=New-StandingAuthorization $context;$grantHash=Get-SwitchHash $grant
    $receipt=Invoke-SwitchRequest $context $request $false $hash $true $grant;$result=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
    Assert-Test ($result.status -ceq 'REGISTERED_MANUAL_RESTART_PENDING') 'Delegated registration did not complete.'
    Assert-Test ($result.approval.mode -ceq 'agent-reviewed-standing-authorization') 'Approval provenance missing.'
    Assert-Test ($result.approval.humanChatApproval -eq $false -and $result.approval.agentReviewed -eq $true) 'Agent review was mislabeled human approval.'
    Assert-Test ($result.approval.standingAuthorization.sha256 -ceq $grantHash) 'Standing grant hash was not pinned.'
    $attempt=Get-Content -LiteralPath (Join-Path $context.runtime "registration-switch-attempt-$($result.requestId).json") -Raw|ConvertFrom-Json
    Assert-Test ($attempt.humanChatApproval -eq $false) 'Attempt falsely claims per-request human approval.'
    Assert-Test ($result.automaticSave -eq $false -and $result.restartPerformed -eq $false) 'Registration performed a lifecycle action.'
    Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $true $grant} 'hash changed|do not retry'
  }
  Test 'Agent flag alone and a grant without agent review cannot submit'{
    $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline;$hash=Get-SwitchHash $request
    $grant=New-StandingAuthorization $context
    Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $true} 'StandingAuthorizationPath'
    Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $false $grant} 'ChatApproved'
    Expect-Throw {Invoke-SwitchRequest $context $request $true $hash $true $grant} 'one approval source'
    Assert-NoSubmission $context $before
  }
  Test 'Disabled non-user wrong-project wrong-target and wrong-action grants reject before submission'{
    foreach($kind in @('disabled','stringEnabled','actor','project','target','action','scalarPermission','missingStatement','missingSession','badGrantId')){
      $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline;$hash=Get-SwitchHash $request
      $file=New-StandingAuthorization $context;$grant=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json
      if($kind -eq 'disabled'){$grant.enabled=$false};if($kind -eq 'actor'){$grant.grantedBy='agent'}
      if($kind -eq 'stringEnabled'){$grant.enabled='true'};if($kind -eq 'scalarPermission'){$grant.permissions='plugin_registration'}
      if($kind -eq 'project'){$grant.projectRoot=$context.directory};if($kind -eq 'target'){$grant.targetManifest=Join-Path $context.directory 'wrong.addin'}
      if($kind -eq 'action'){$grant.permissions=@('model_write')};if($kind -eq 'missingStatement'){$grant.userStatement=''}
      if($kind -eq 'missingSession'){$grant.sourceSessionId=''};if($kind -eq 'badGrantId'){$grant.grantId='not-a-grant'}
      [IO.File]::WriteAllBytes($file,(Convert-SwitchJsonBytes $grant))
      Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $true $file} 'Standing authorization'
      Assert-NoSubmission $context $before
    }
  }
  Test 'Revoked and outside-runtime standing grants reject before submission'{
    $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline;$hash=Get-SwitchHash $request
    $file=New-StandingAuthorization $context;[IO.File]::WriteAllText("$file.revoked",'revoked')
    Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $true $file} 'revoked'
    $outside=Join-Path $context.directory 'outside.json';Copy-Item -LiteralPath $file -Destination $outside
    Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $true $outside} 'direct child'
    Assert-NoSubmission $context $before
  }
  Test 'Standing authorization cannot replace the independent exact request digest'{
    $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline;$grant=New-StandingAuthorization $context
    foreach($hash in @('abc',('0'*64))){Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $true $grant} 'ExpectedRequestSha256|independently reviewed request'}
    Assert-NoSubmission $context $before
  }
  Test 'Revocation during preflight is caught before creating an attempt'{
    $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline;$hash=Get-SwitchHash $request
    $script:fixtureGrant=New-StandingAuthorization $context
    $script:fixtureProtectionImplementation=(Get-Item Function:\Assert-SwitchProtected).ScriptBlock
    function script:Assert-SwitchProtected($Context,$Expected){& $script:fixtureProtectionImplementation $Context $Expected;[IO.File]::WriteAllText("$script:fixtureGrant.revoked",'revoked during review')}
    try{Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $true $script:fixtureGrant} 'revoked'}
    finally{Set-Item Function:\Assert-SwitchProtected $script:fixtureProtectionImplementation}
    Assert-NoSubmission $context $before
  }
  Test 'Grant bytes changed during preflight are caught before creating an attempt'{
    $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline;$hash=Get-SwitchHash $request
    $script:fixtureGrant=New-StandingAuthorization $context
    $script:fixtureProtectionImplementation=(Get-Item Function:\Assert-SwitchProtected).ScriptBlock
    function script:Assert-SwitchProtected($Context,$Expected){& $script:fixtureProtectionImplementation $Context $Expected;[IO.File]::AppendAllText($script:fixtureGrant,' ')}
    try{Expect-Throw {Invoke-SwitchRequest $context $request $false $hash $true $script:fixtureGrant} 'authorization changed'}
    finally{Set-Item Function:\Assert-SwitchProtected $script:fixtureProtectionImplementation}
    Assert-NoSubmission $context $before
  }
  Test 'Prepare writes private review materials only and binds hashes MVID and baseline'{
    $context=New-Fixture;$before=Get-SwitchHash $context.target;$protected=Get-SwitchProtectedSnapshot $context
    $request=New-SwitchRequest $context $selectedDll $context.baseline;$data=Get-Content -LiteralPath $request -Raw|ConvertFrom-Json
    Assert-Test ((Get-SwitchHash $context.target) -eq $before) 'Prepare changed the manifest.'
    Assert-SwitchProtected $context $protected
    Assert-Test ($data.moduleVersionId -eq (Get-SwitchModuleVersionId $selectedDll)) 'MVID was not pinned.'
    Assert-Test ($data.baseline.sha256 -eq (Get-SwitchHash $context.baseline)) 'Baseline was not pinned.'
    Assert-SwitchManifestDifference ([IO.File]::ReadAllBytes($context.target)) ([IO.File]::ReadAllBytes($data.proposedManifest)) ([IO.Path]::GetFullPath($selectedDll))|Out-Null
    Assert-Test (@(Get-ChildItem -LiteralPath $context.runtime -Filter 'registration-switch-attempt-*').Count -eq 0) 'Prepare created an attempt.'
  }
  Test 'Confirm requires approval and then performs one exact switch with verified backup'{
    $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline
    $reviewedHash=Get-SwitchHash $request
    Expect-Throw {Invoke-SwitchRequest $context $request $false $reviewedHash} 'ChatApproved'
    Assert-Test ((Get-SwitchHash $context.target) -eq $before) 'Approval rejection changed the manifest.'
    $receipt=Invoke-SwitchRequest $context $request $true $reviewedHash;$result=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
    Assert-Test ($result.status -eq 'REGISTERED_MANUAL_RESTART_PENDING') 'Registration fixture did not complete.'
    Assert-Test ((Get-SwitchHash $result.backup) -eq $before) 'Backup is not the original byte sequence.'
    Assert-Test ($result.protectedSnapshotUnchanged -eq $true) 'Protected snapshot is not verified.'
    Assert-Test ($result.reviewedRequestSha256 -eq $reviewedHash) 'Receipt omitted the independently reviewed digest.'
    $attempt=Get-Content -LiteralPath (Join-Path $context.runtime "registration-switch-attempt-$($result.requestId).json") -Raw|ConvertFrom-Json
    Assert-Test ($attempt.reviewedRequestSha256 -eq $reviewedHash) 'Attempt omitted the independently reviewed digest.'
    $installed=Get-SwitchHash $context.target;Expect-Throw {Invoke-SwitchRequest $context $request $true $reviewedHash} 'hash changed|do not retry'
    Assert-Test ((Get-SwitchHash $context.target) -eq $installed) 'Repeated confirm changed the manifest.'
    Assert-Test (@(Get-ChildItem -LiteralPath $context.runtime -Filter 'registration-switch-attempt-*').Count -eq 1) 'Repeated confirm created another attempt.'
  }
  Test 'Missing malformed or unrelated external request digest rejects before any submission'{
    foreach($digest in @($null,'','abc',('G'*64),('0'*64))){
      $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline
      Expect-Throw {Invoke-SwitchRequest $context $request $true $digest} 'ExpectedRequestSha256|independently reviewed request'
      Assert-NoSubmission $context $before
    }
  }
  Test 'Original reviewed digest rejects rewritten protected snapshots removed baseline and paired DLL metadata'{
    foreach($kind in @('bridge','client','baselineRemoved','dllMetadata')){
      $context=New-Fixture;$before=Get-SwitchHash $context.target;$request=New-SwitchRequest $context $selectedDll $context.baseline
      $reviewedHash=Get-SwitchHash $request;$data=Get-Content -LiteralPath $request -Raw|ConvertFrom-Json
      if($kind -eq 'bridge'){[IO.File]::AppendAllText($context.bridge,' ');$data.protectedSnapshot=Get-SwitchProtectedSnapshot $context}
      if($kind -eq 'client'){[IO.File]::AppendAllText($context.clients[0],' altered');$data.protectedSnapshot=Get-SwitchProtectedSnapshot $context}
      if($kind -eq 'baselineRemoved'){$data.baseline=$null}
      if($kind -eq 'dllMetadata'){
        # Simulate a replacement identity/proposal coherently inside JSON; never alter the compiled DLL.
        $data.assemblyPath=$data.assemblyPath.ToUpperInvariant();$data.assemblySha256='F'*64
        $data.moduleVersionId=[Guid]::NewGuid().ToString();$data.expectedModuleVersionId=$data.moduleVersionId
        $xml=Read-SwitchXml ([IO.File]::ReadAllBytes($data.proposedManifest));$xml.SelectSingleNode('/RevitAddIns/AddIn/Assembly').InnerText=$data.assemblyPath
        [IO.File]::WriteAllBytes($data.proposedManifest,(Convert-SwitchXmlBytes $xml $false));$data.proposedManifestSha256=Get-SwitchHash $data.proposedManifest
      }
      [IO.File]::WriteAllBytes($request,(Convert-SwitchJsonBytes $data))
      Assert-Test ((Get-SwitchHash $request) -ne $reviewedHash) 'Tamper fixture failed to change the approved bytes.'
      Expect-Throw {Invoke-SwitchRequest $context $request $true $reviewedHash} 'hash differs from the independently reviewed request'
      Assert-NoSubmission $context $before
    }
  }
  Test 'Manifest bytes changed after path hashing reject before attempts and backups'{
    foreach($kind in @('original','proposed')){
      $context=New-Fixture;$request=New-SwitchRequest $context $selectedDll $context.baseline;$data=Get-Content -LiteralPath $request -Raw|ConvertFrom-Json
      $reviewedHash=Get-SwitchHash $request
      $script:fixtureHashImplementation=(Get-Item Function:\Get-SwitchHash).ScriptBlock
      $script:fixtureTarget=$context.target;$script:fixtureTamperPath=if($kind -eq 'original'){$context.target}else{$data.proposedManifest}
      $script:fixtureTampered=$false;$script:fixtureAfterTamperTargetHash=$null
      function script:Get-SwitchHash([string]$Path){
        $hash=& $script:fixtureHashImplementation $Path
        if($Path -ieq $script:fixtureTarget -and -not $script:fixtureTampered){
          [IO.File]::AppendAllText($script:fixtureTamperPath,' ')
          $script:fixtureTampered=$true;$script:fixtureAfterTamperTargetHash=& $script:fixtureHashImplementation $script:fixtureTarget
        }
        return $hash
      }
      try{
        Expect-Throw {Invoke-SwitchRequest $context $request $true $reviewedHash} 'Captured manifest bytes differ'
      }finally{
        Set-Item Function:\Get-SwitchHash $script:fixtureHashImplementation
      }
      Assert-Test $script:fixtureTampered 'Race fixture did not mutate the path after hash acquisition.'
      Assert-NoSubmission $context $script:fixtureAfterTamperTargetHash
    }
  }
  Test 'Unknown XML changes mixed add-ins DTDs and duplicate Assembly fail before attempts'{
    foreach($kind in @('vendor','duplicate','mixed','dtd')){
      $context=New-Fixture;$request=New-SwitchRequest $context $selectedDll $context.baseline;$data=Get-Content -LiteralPath $request -Raw|ConvertFrom-Json
      $text=[IO.File]::ReadAllText($data.proposedManifest)
      if($kind -eq 'vendor'){$text=$text.Replace('<VendorId>CDXA</VendorId>','<VendorId>OTHER</VendorId>')}
      if($kind -eq 'duplicate'){$text=$text.Replace('</AddIn>','<Assembly>other.dll</Assembly></AddIn>')}
      if($kind -eq 'mixed'){$text=$text.Replace('</RevitAddIns>','<AddIn Type="Application" /></RevitAddIns>')}
      if($kind -eq 'dtd'){$text=$text.Replace('<RevitAddIns>','<!DOCTYPE RevitAddIns [<!ENTITY x "hidden">]><RevitAddIns>')}
      [IO.File]::WriteAllText($data.proposedManifest,$text);$data.proposedManifestSha256=Get-SwitchHash $data.proposedManifest
      [IO.File]::WriteAllBytes($request,(Convert-SwitchJsonBytes $data))
      # Synthetic reviewed bytes exercise the deeper XML guards after the external digest gate.
      $reviewedHash=Get-SwitchHash $request
      Expect-Throw {Invoke-SwitchRequest $context $request $true $reviewedHash} 'outside|one|DTD|Document Type'
      Assert-Test (@(Get-ChildItem -LiteralPath $context.runtime -Filter 'registration-switch-attempt-*').Count -eq 0) 'Invalid XML created an attempt.'
    }
  }
  Test 'Changed manifest DLL hash baseline settings ACL and clients are rejected before submission'{
    foreach($kind in @('target','dll','baseline','bridge','client','newClient','legacy','acl')){
      $context=New-Fixture;$request=New-SwitchRequest $context $selectedDll $context.baseline;$data=Get-Content -LiteralPath $request -Raw|ConvertFrom-Json
      if($kind -eq 'target'){[IO.File]::AppendAllText($context.target,' ')}
      if($kind -eq 'dll'){$data.assemblySha256='0'*64;[IO.File]::WriteAllBytes($request,(Convert-SwitchJsonBytes $data))}
      if($kind -eq 'baseline'){[IO.File]::WriteAllText($context.baseline,'{"saved":false}')}
      if($kind -eq 'bridge'){[IO.File]::AppendAllText($context.bridge,' ')}
      if($kind -eq 'client'){[IO.File]::AppendAllText($context.clients[0],' changed')}
      if($kind -eq 'newClient'){[IO.File]::WriteAllText($context.clients[1],'now exists')}
      if($kind -eq 'legacy'){[IO.File]::WriteAllText((Join-Path $context.legacy2025 'new.addin'),'changed')}
      if($kind -eq 'acl'){$data.protectedSnapshot.runtimeAclSddl='tampered';[IO.File]::WriteAllBytes($request,(Convert-SwitchJsonBytes $data))}
      # The DLL/ACL cases intentionally approve synthetic bytes to verify their later guards.
      $reviewedHash=Get-SwitchHash $request
      Expect-Throw {Invoke-SwitchRequest $context $request $true $reviewedHash} 'changed|identity/hash'
      Assert-Test (@(Get-ChildItem -LiteralPath $context.runtime -Filter 'registration-switch-attempt-*').Count -eq 0) 'Changed input created an attempt.'
    }
  }
  Test 'Existing attempt marker prevents submission even with an unchanged target'{
    $context=New-Fixture;$request=New-SwitchRequest $context $selectedDll $context.baseline;$data=Get-Content -LiteralPath $request -Raw|ConvertFrom-Json
    $before=Get-SwitchHash $context.target;Write-SwitchNew (Join-Path $context.runtime "registration-switch-attempt-$($data.requestId).json") ([Text.Encoding]::UTF8.GetBytes('{}'))
    $reviewedHash=Get-SwitchHash $request
    Expect-Throw {Invoke-SwitchRequest $context $request $true $reviewedHash} 'do not retry'
    Assert-Test ((Get-SwitchHash $context.target) -eq $before) 'Attempt marker did not stop the write.'
  }
  Test 'Unexpected request target proposed path and baseline traversal are rejected'{
    foreach($kind in @('target','proposed','baseline')){
      $context=New-Fixture;$request=New-SwitchRequest $context $selectedDll $context.baseline;$data=Get-Content -LiteralPath $request -Raw|ConvertFrom-Json
      if($kind -eq 'target'){$data.targetManifest=Join-Path $context.directory 'wrong.addin'}
      if($kind -eq 'proposed'){$data.proposedManifest=$context.target}
      if($kind -eq 'baseline'){$data.baseline.path=Join-Path $context.directory 'outside.json'}
      [IO.File]::WriteAllBytes($request,(Convert-SwitchJsonBytes $data))
      # Synthetic reviewed bytes exercise path binding independently of digest rejection.
      $reviewedHash=Get-SwitchHash $request
      Expect-Throw {Invoke-SwitchRequest $context $request $true $reviewedHash} 'target differs|Unexpected proposed|direct child'
    }
  }
  Test 'CreateNew cannot overwrite evidence and reparse ancestors are rejected'{
    $context=New-Fixture;$file=Join-Path $context.runtime 'create-new.json';Write-SwitchNew $file ([Text.Encoding]::UTF8.GetBytes('original'))
    Expect-Throw {Write-SwitchNew $file ([Text.Encoding]::UTF8.GetBytes('replacement'))} 'already exists'
    Assert-Test ([IO.File]::ReadAllText($file) -eq 'original') 'CreateNew overwrote evidence.'
    $link=Join-Path $context.directory 'linked-runtime';New-Item -ItemType Junction -Path $link -Target $context.runtime|Out-Null
    try{Expect-Throw {Assert-SwitchPath (Join-Path $link 'bridge.json')} 'reparse'}finally{Remove-Item -LiteralPath $link -Force}
  }
  Write-Output "Registration fixture tests passed: $passed"
}finally{
  $resolved=[IO.Path]::GetFullPath($fixtureRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'registration-switch-tests-*'){throw 'Unsafe fixture cleanup target.'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
