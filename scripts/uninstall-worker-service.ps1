# =============================================================================
# uninstall-worker-service.ps1
# -----------------------------------------------------------------------------
# Stops and removes the SmartEE worker Windows Service.
# Does NOT touch source files, .env, or log files.
#
# Run as Administrator.
# =============================================================================

[CmdletBinding()]
param(
    [string]$ServiceName = "SmartEEWorker"
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Must run as Administrator." -ForegroundColor Red
    exit 1
}

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    foreach ($c in @("C:\ProgramData\chocolatey\bin\nssm.exe","C:\nssm\nssm.exe","C:\Tools\nssm\nssm.exe")) {
        if (Test-Path $c) { $nssm = $c; break }
    }
}
if (-not $nssm) { Write-Host "ERROR: nssm.exe not found." -ForegroundColor Red; exit 1 }

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service '$ServiceName' is not installed. Nothing to do." -ForegroundColor Yellow
    exit 0
}

Write-Host "Stopping service '$ServiceName'..." -ForegroundColor Cyan
& $nssm stop $ServiceName confirm | Out-Null
Start-Sleep -Seconds 2

Write-Host "Removing service '$ServiceName'..." -ForegroundColor Cyan
& $nssm remove $ServiceName confirm | Out-Null

Write-Host "Done." -ForegroundColor Green
