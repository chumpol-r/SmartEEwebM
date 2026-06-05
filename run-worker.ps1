# Run the WORKER only (MQTT notifier + web push / LINE dispatchers).
# Standalone package in worker/ — health/status HTTP server included.
#   Dev : nodemon, :3005   (health: http://localhost:3005/health)
#   Prod: node,    :3004   (health: http://localhost:3004/health)
# Usage:  .\run-worker.ps1          (dev)
#         .\run-worker.ps1 -Prod    (production)
param([switch]$Prod)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'worker')

if ($Prod) {
    $env:NODE_ENV = 'production'
    $env:WORKER_PORT = '3004'
    Write-Host "WORKER (prod) on http://localhost:3004  (/health, /status)" -ForegroundColor Green
    npm start
} else {
    $env:WORKER_PORT = '3005'
    Write-Host "WORKER (dev) on http://localhost:3005  (/health, /status)" -ForegroundColor Green
    npm run dev
}
