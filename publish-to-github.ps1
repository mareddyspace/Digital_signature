# Tests, builds, commits and pushes SignGuard to GitHub. Stops at the first failure; nothing is pushed then.
$ErrorActionPreference = "Continue"  # each step checks $LASTEXITCODE itself
$Repo = "https://github.com/mareddyspace/Digital_signature.git"
Set-Location $PSScriptRoot

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }

Step "Git identity"
if (-not (git config user.name))  { git config user.name  (Read-Host "Your name for commits") }
if (-not (git config user.email)) { git config user.email (Read-Host "Your email for commits (the one on GitHub)") }
Write-Host ("Committing as " + (git config user.name) + " <" + (git config user.email) + ">")

Step "Backend tests"
Push-Location backend
& .\.venv\Scripts\python.exe -m pip install -q -r requirements-dev.txt
& .\.venv\Scripts\python.exe -m pytest -q
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Fail "backend tests failed" }

Step "Admin web build"
Push-Location admin-web
npm run build
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Fail "admin web build failed" }

Step "Check no secrets are included"
git add -A
$bad = git diff --cached --name-only | Where-Object { $_ -match '(^|/)\.env$|\.db$|\.pem$|\.pfx$|\.key$' }
if ($bad) { git reset -q; Fail ("these files must not be uploaded: " + ($bad -join ", ")) }
git status --short

Step "Commit"
if (git diff --cached --name-only) {
  $msg = @"
SignGuard platform: designer, rules, campaigns, disclaimers, brand kit, integrity, read-only demo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KWxkaL3GzbUS37YKKsQQfg
"@
  git commit -q -m $msg
  if ($LASTEXITCODE -ne 0) { Fail "commit failed" }
} else { Write-Host "Nothing new to commit." }

Step "Push to $Repo"
if (git remote) { git remote set-url origin $Repo } else { git remote add origin $Repo }
git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) { Fail "push failed (sign in to GitHub when the window opens, then run this again)" }

Write-Host ""
Write-Host "Done: https://github.com/mareddyspace/Digital_signature" -ForegroundColor Green
