<#
.SYNOPSIS
  Apply a SignGuard Microsoft 365 deployment to Outlook on the web (and the mobile apps that
  use the Outlook on the web signature).

.DESCRIPTION
  The Outlook add-in already applies the right signature to every email in Outlook on the web,
  new Outlook and classic Outlook. This script covers clients that don't run the add-in by
  storing each person's static signature in their mailbox settings.

  1. In SignGuard, Integrations > Microsoft 365 > Deploy. Download the export (JSON).
  2. Run this script as an Exchange administrator.

  Note: when roaming signatures are on in your tenant, Set-MailboxMessageConfiguration can't
  change signatures for Outlook on the web; rely on the add-in instead.

.EXAMPLE
  .\deploy-outlook-signatures.ps1 -ExportFile .\signguard-deployment-12.json -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExportFile,
    # Also turn the signature on for new messages and replies.
    [switch]$AutoAdd
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command Set-MailboxMessageConfiguration -ErrorAction SilentlyContinue)) {
    Import-Module ExchangeOnlineManagement
    Connect-ExchangeOnline -ShowBanner:$false
}

$items = Get-Content -Raw -Path $ExportFile | ConvertFrom-Json
$ok = 0
$failed = 0

foreach ($item in $items) {
    if (-not $item.email -or -not $item.html) { continue }
    if ($PSCmdlet.ShouldProcess($item.email, "Set Outlook on the web signature")) {
        try {
            $params = @{ Identity = $item.email; SignatureHtml = $item.html }
            if ($AutoAdd) {
                $params.AutoAddSignature = $true
                $params.AutoAddSignatureOnReply = $true
            }
            Set-MailboxMessageConfiguration @params
            $ok++
            Write-Host "Updated $($item.email)"
        } catch {
            $failed++
            Write-Warning "Failed for $($item.email): $($_.Exception.Message)"
        }
    }
}

Write-Host "Done: $ok updated, $failed failed."
