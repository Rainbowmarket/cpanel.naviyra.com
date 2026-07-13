# Naviyra Panel - Windows one-time setup (optional — launcher does this on first start)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== Naviyra Panel Setup ===" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env" -ForegroundColor Green
}

npm install
Set-Location "$Root\agent"; npm install; Set-Location $Root

npx prisma generate
npx prisma db push
npm run db:seed

Write-Host "`nSetup complete. Start with: npm run app" -ForegroundColor Green
