<#
.SYNOPSIS
  Exports every Full Access, Send As and Send on Behalf grant in Exchange Online to JSON
  for SignGuard's Mailbox permissions page (Import from Exchange).

.DESCRIPTION
  Read-only. Needs the ExchangeOnlineManagement module and either:
   - an admin signing in interactively (just run it), or
   - app-only sign-in: an Entra app with the Exchange.ManageAsApp permission, a certificate,
     and an Exchange role that can read mailbox permissions (pass -AppId, -CertificateThumbprint, -Organization).

.EXAMPLE
  ./export-mailbox-permissions.ps1 -OutFile permissions.json
.EXAMPLE
  ./export-mailbox-permissions.ps1 -AppId <app id> -CertificateThumbprint <thumbprint> -Organization contoso.onmicrosoft.com
#>
param(
  [string]$OutFile = "mailbox-permissions.json",
  [string]$AppId,
  [string]$CertificateThumbprint,
  [string]$Organization
)

$ErrorActionPreference = "Stop"
Import-Module ExchangeOnlineManagement

if ($AppId) {
  Connect-ExchangeOnline -AppId $AppId -CertificateThumbprint $CertificateThumbprint -Organization $Organization -ShowBanner:$false
} else {
  Connect-ExchangeOnline -ShowBanner:$false
}

function Get-Smtp([string]$identity) {
  if (-not $identity) { return $null }
  try { return (Get-EXORecipient -Identity $identity -ErrorAction Stop).PrimarySmtpAddress.ToString().ToLower() }
  catch { return $null }  # deleted users, system accounts
}

$rows = New-Object System.Collections.Generic.List[object]
$mailboxes = Get-EXOMailbox -ResultSize Unlimited -Properties GrantSendOnBehalfTo

foreach ($mb in $mailboxes) {
  $mailbox = $mb.PrimarySmtpAddress.ToString().ToLower()

  Get-EXOMailboxPermission -Identity $mailbox |
    Where-Object { -not $_.IsInherited -and $_.AccessRights -contains "FullAccess" -and $_.User -notlike "NT AUTHORITY*" -and $_.User -notlike "S-1-5-*" } |
    ForEach-Object {
      $trustee = Get-Smtp $_.User
      if ($trustee) { $rows.Add([ordered]@{ mailbox = $mailbox; trustee = $trustee; type = "full_access" }) }
    }

  Get-EXORecipientPermission -Identity $mailbox |
    Where-Object { $_.AccessRights -contains "SendAs" -and $_.Trustee -notlike "NT AUTHORITY*" -and $_.Trustee -notlike "S-1-5-*" } |
    ForEach-Object {
      $trustee = Get-Smtp $_.Trustee
      if ($trustee) { $rows.Add([ordered]@{ mailbox = $mailbox; trustee = $trustee; type = "send_as" }) }
    }

  foreach ($delegate in @($mb.GrantSendOnBehalfTo)) {
    $trustee = Get-Smtp $delegate
    if ($trustee) { $rows.Add([ordered]@{ mailbox = $mailbox; trustee = $trustee; type = "send_on_behalf" }) }
  }
}

# Grant dates and last-used times aren't available from these cmdlets; SignGuard records when it
# first saw each grant. Last use can be added later from the mailbox audit log.
ConvertTo-Json -InputObject @($rows) -Depth 3 | Set-Content -Path $OutFile -Encoding utf8
Write-Host "Wrote $($rows.Count) grants to $OutFile. Import it on SignGuard's Mailbox permissions page."
Disconnect-ExchangeOnline -Confirm:$false
