# Run the FRONTEND only.
#   Dev : Vite dev server on :5173 (HMR, proxies /api -> :3003)
#   Prod: build then serve client/dist on :4173 (static + SPA fallback)
# Usage:  .\run-frontend.ps1          (dev)
#         .\run-frontend.ps1 -Prod    (production)
param([switch]$Prod)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'client')

if ($Prod) {
    Write-Host "FRONTEND (prod) building..." -ForegroundColor Cyan
    npm run build
    $env:FRONTEND_PORT = '4173'
    Write-Host "FRONTEND (prod) serving on http://localhost:4173" -ForegroundColor Green
    npm run serve
} else {
    Write-Host "FRONTEND (dev) on http://localhost:5173" -ForegroundColor Green
    npm run dev
}
