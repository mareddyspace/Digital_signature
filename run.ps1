$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPython = Join-Path $repo "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $backendPython)) {
    py -3.12 -m venv (Join-Path $repo "backend\.venv")
    & $backendPython -m pip install -r (Join-Path $repo "backend\requirements.txt") -r (Join-Path $repo "backend\requirements-dev.txt")
}

$adminModules = Join-Path $repo "admin-web\node_modules"
if (-not (Test-Path $adminModules)) {
    Push-Location (Join-Path $repo "admin-web")
    try {
        npm install
    } finally {
        Pop-Location
    }
}

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$repo\backend'; & '$backendPython' -m uvicorn app.main:app --port 8000"
)

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$repo\admin-web'; npm run dev"
)

Write-Host "SignGuard is starting."
Write-Host "Admin: http://localhost:5173"
Write-Host "API:   http://localhost:8000/api/health"
