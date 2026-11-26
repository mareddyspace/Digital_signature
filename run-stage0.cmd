@echo off
rem Double-click to run the SignGuard stage 0 checks. Results: stage0-report.txt
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stage0-check.ps1"
echo.
echo Finished. You can close this window.
pause
