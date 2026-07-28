@echo off
title Naviyra Hosting Panel
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 goto install_node

for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
set "NODE_MAJOR=%NODE_VER:v=%"
for /f "tokens=1 delims=." %%m in ("%NODE_MAJOR%") do set "NODE_MAJOR=%%m"
if not defined NODE_MAJOR goto install_node
if %NODE_MAJOR% LSS 20 goto install_node
goto run

:install_node
echo.
echo  [Naviyra] Node.js not found or too old. Installing Node.js LTS...
echo.
where winget >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: winget not available. Install Node.js 20+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if %errorlevel% neq 0 (
    echo  ERROR: Node.js install failed.
    pause
    exit /b 1
)
echo.
echo  Node.js installed. Restarting launcher...
echo.
:: Refresh PATH from Machine + User for this session
for /f "usebackq tokens=2*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul`) do set "MACHINE_PATH=%%B"
for /f "usebackq tokens=2*" %%A in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "USER_PATH=%%B"
set "PATH=%MACHINE_PATH%;%USER_PATH%"
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  Node was installed but is not on PATH yet.
    echo  Close this window and run this script again.
    pause
    exit /b 1
)

:run
node launcher\index.mjs start %*
if %errorlevel% neq 0 pause
