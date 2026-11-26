@echo off
cd /d "%~dp0"
title Publish SignGuard to GitHub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-to-github.ps1"
pause
