@echo off
rem Double-click to start the SignGuard admin web app at http://localhost:5173
rem (needs the backend running on port 8000; run-stage0.cmd or run.ps1 starts it).
cd /d "%~dp0admin-web"
title SignGuard admin web (http://localhost:5173)
npm run dev
pause
