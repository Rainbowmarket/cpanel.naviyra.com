# Naviyra Panel - start panel + agent without Docker

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
    Write-Host ".env not found. Run .\scripts\setup.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "=== Starting Naviyra Panel ===" -ForegroundColor Cyan
Write-Host "Panel:  http://localhost:3000" -ForegroundColor White
Write-Host "Agent:  http://localhost:4000 (dry-run on Windows)" -ForegroundColor White
Write-Host "Press Ctrl+C to stop the panel. Close the agent window separately." -ForegroundColor Yellow
Write-Host ""

# Start agent in a new PowerShell window
$agentCmd = "Set-Location '$Root\agent'; `$env:AGENT_DRY_RUN='true'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmd

# Start panel in this window (foreground)
npm run dev
