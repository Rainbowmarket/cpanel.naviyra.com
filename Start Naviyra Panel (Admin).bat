@echo off
title Naviyra Hosting Panel (Administrator)
cd /d "%~dp0"

:: Request Administrator if not already elevated
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator permission...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed. Get it from https://nodejs.org
    pause
    exit /b 1
)

set AGENT_DRY_RUN=false
node launcher\index.mjs start %*
if %errorlevel% neq 0 pause
