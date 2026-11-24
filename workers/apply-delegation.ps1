<#
.SYNOPSIS
  Applies a SignGuard decision in Exchange Online: grant or remove Send on Behalf,
  or remove a Full Access / Send As grant flagged on the Mailbox permissions page.

.DESCRIPTION
  CHANGES MAILBOX PERMISSIONS. Run it only for decisions approved in SignGuard.
  Today SignGuard records approvals and you run this script; a later phase runs it automatically
  from a worker using app-only sign-in (Exchange.ManageAsApp + certificate).

.EXAMPLE
  ./apply-delegation.ps1 -Action GrantSendOnBehalf -Mailbox arjun.rao@contoso.com -Delegate priya.sharma@contoso.com
.EXAMPLE
  ./apply-delegation.ps1 -Action RemoveSendAs -Mailbox arjun.rao@contoso.com -Delegate sara.khan@contoso.com
#>
param(
  [Parameter(Mandatory)][ValidateSet("GrantSendOnBehalf", "RemoveSendOnBehalf", "RemoveSendAs", "RemoveFullAccess")]
  [string]$Action,
  [Parameter(Mandatory)][string]$Mailbox,
  [Parameter(Mandatory)][string]$Delegate,
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

switch ($Action) {
  "GrantSendOnBehalf"  { Set-Mailbox -Identity $Mailbox -GrantSendOnBehalfTo @{ Add = $Delegate } }
  "RemoveSendOnBehalf" { Set-Mailbox -Identity $Mailbox -GrantSendOnBehalfTo @{ Remove = $Delegate } }
  "RemoveSendAs"       { Remove-RecipientPermission -Identity $Mailbox -Trustee $Delegate -AccessRights SendAs -Confirm:$false }
  "RemoveFullAccess"   { Remove-MailboxPermission -Identity $Mailbox -User $Delegate -AccessRights FullAccess -InheritanceType All -Confirm:$false }
}

Write-Host "$Action done: $Delegate on $Mailbox"
Disconnect-ExchangeOnline -Confirm:$false
