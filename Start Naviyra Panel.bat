@echo off
title Naviyra Hosting Panel
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Node.js is not installed.
    echo  Download from https://nodejs.org
    echo.
    pause
    exit /b 1
)

node launcher\index.mjs start %*
if %errorlevel% neq 0 pause
