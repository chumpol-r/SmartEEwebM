# Run the BACKEND API only.
#   Dev : nodemon, listens on :3002 + :3003 (EXTRA_PORTS, vite proxy target)
#   Prod: node, NODE_ENV=production, :3002
# Usage:  .\run-backend.ps1          (dev)
#         .\run-backend.ps1 -Prod    (production)
param([switch]$Prod)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'server')

if ($Prod) {
    $env:NODE_ENV = 'production'
    $env:PORT = '3002'
    $env:ENABLE_MQTT_WORKER = 'false'  # worker runs as its own process
    Write-Host "BACKEND (prod) on http://localhost:3002" -ForegroundColor Green
    npm start
} else {
    Write-Host "BACKEND (dev) on http://localhost:3002 (+3003)" -ForegroundColor Green
    npm run dev
}
