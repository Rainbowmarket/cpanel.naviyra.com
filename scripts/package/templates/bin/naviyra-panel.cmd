@echo off
setlocal
set "BASE=%~dp0.."
set "APP=%BASE%\app"
set "NAVIYRA_ROOT=%APP%"

if exist "%BASE%\node\node.exe" (
  set "PATH=%BASE%\node;%PATH%"
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install Node 20+ or use the installer with embedded Node.
  exit /b 1
)

cd /d "%APP%"
node "%APP%\launcher\index.mjs" %*
