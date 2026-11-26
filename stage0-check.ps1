<#
.SYNOPSIS
  Stage 0 baseline for SignGuard: stops the outdated backend, runs every check that needs Windows,
  then starts the current backend. Results are written to stage0-report.txt next to this script.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\stage0-check.ps1
#>
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$report = Join-Path $repo "stage0-report.txt"
$python = Join-Path $repo "backend\.venv\Scripts\python.exe"

function Section($title) { "`n===== $title =====" | Out-File $report -Append -Encoding utf8 }
function Log($text) { $text | Out-File $report -Append -Encoding utf8 }

"SignGuard stage 0 report - $(Get-Date -Format s)" | Out-File $report -Encoding utf8

# 1. Stop whatever holds port 8000 (the outdated backend), so the current code can start.
Section "Stop old backend on port 8000"
$owners = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($owners) {
    foreach ($procId in $owners) {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        Log "Stopping PID $procId ($($p.ProcessName))"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
} else {
    Log "Nothing was listening on port 8000"
}

# 2. Backend tests
Section "Backend tests (pytest)"
Push-Location (Join-Path $repo "backend")
& $python -m pytest tests -q -p no:cacheprovider 2>&1 | Out-File $report -Append -Encoding utf8
Log "pytest exit code: $LASTEXITCODE"
Pop-Location

# 3. Admin web production build (type-check + bundle)
Section "Admin web production build"
Push-Location (Join-Path $repo "admin-web")
npm run build 2>&1 | Out-File $report -Append -Encoding utf8
Log "build exit code: $LASTEXITCODE"
Pop-Location

# 4. Outlook add-in manifest: Microsoft's validation service
Section "Outlook add-in manifest validation"
Push-Location (Join-Path $repo "outlook-addin")
npm run validate 2>&1 | Out-File $report -Append -Encoding utf8
Log "validate exit code: $LASTEXITCODE"
Pop-Location

# 5. Start the current backend in its own window
Section "Start backend"
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$repo\backend'; & '$python' -m uvicorn app.main:app --port 8000"
)
Start-Sleep -Seconds 6
try {
    $health = Invoke-RestMethod -Uri "http://localhost:8000/api/health" -TimeoutSec 10
    Log "Health: $($health | ConvertTo-Json -Compress)"
    $brand = Invoke-WebRequest -Uri "http://localhost:8000/api/brand" -Headers @{ "X-Dev-User" = "meera.iyer@contoso.com" } -UseBasicParsing -TimeoutSec 10
    Log "New endpoints (/api/brand): HTTP $($brand.StatusCode)"
} catch {
    Log "Backend check failed: $($_.Exception.Message)"
}

Write-Host "Done. Results are in $report"
