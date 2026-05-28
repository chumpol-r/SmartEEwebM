# =============================================================================
# install-worker-service.ps1
# -----------------------------------------------------------------------------
# Installs the SmartEE MQTT notifier worker as a Windows Service via NSSM.
#
# This worker subscribes to MQTT, compares values with dbo.NotifyConfig,
# and inserts dbo.NotifyLog rows. It MUST be running for notifications to fire.
#
# Run as Administrator (NSSM needs SCM privileges).
#
# Usage:
#   .\scripts\install-worker-service.ps1
#   .\scripts\install-worker-service.ps1 -Force          # re-install if exists
#   .\scripts\install-worker-service.ps1 -ServiceName "SmartEEWorkerStg"
# =============================================================================

[CmdletBinding()]
param(
    [string]$ServiceName = "SmartEEWorker",
    [string]$RepoRoot    = (Split-Path -Parent $PSScriptRoot),
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# ---- 0. Sanity checks --------------------------------------------------------
Write-Host "=== SmartEE Worker Service Installer ===" -ForegroundColor Cyan
Write-Host ""

# Require admin
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Must run as Administrator (right-click PowerShell -> Run as Administrator)" -ForegroundColor Red
    exit 1
}

# Locate node.exe
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Host "ERROR: node.exe not found in PATH. Install Node.js 18+ first." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js : $node" -ForegroundColor Gray

# Locate nssm.exe (try PATH, then common install paths, then choco)
$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    $candidates = @(
        "C:\ProgramData\chocolatey\bin\nssm.exe",
        "C:\nssm\nssm.exe",
        "C:\Tools\nssm\nssm.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { $nssm = $c; break } }
}
if (-not $nssm) {
    Write-Host "ERROR: nssm.exe not found." -ForegroundColor Red
    Write-Host "  Install with one of:" -ForegroundColor Yellow
    Write-Host "    choco install nssm -y" -ForegroundColor Yellow
    Write-Host "    OR download from https://nssm.cc/download and put nssm.exe in PATH" -ForegroundColor Yellow
    exit 1
}
Write-Host "NSSM    : $nssm" -ForegroundColor Gray

# Resolve repo paths
$workerScript = Join-Path $RepoRoot "server\worker.js"
$workerDir    = Join-Path $RepoRoot "server"
$envFile      = Join-Path $workerDir ".env"
$logDir       = Join-Path $RepoRoot "logs"

if (-not (Test-Path $workerScript)) {
    Write-Host "ERROR: worker.js not found at $workerScript" -ForegroundColor Red
    Write-Host "  Pass -RepoRoot if running from a different directory." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $envFile)) {
    Write-Host "WARNING: $envFile missing — worker will start but fail to connect to DB/MQTT." -ForegroundColor Yellow
}

# Ensure logs dir exists
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
    Write-Host "Created log directory: $logDir" -ForegroundColor Gray
}

Write-Host "Repo    : $RepoRoot" -ForegroundColor Gray
Write-Host "Worker  : $workerScript" -ForegroundColor Gray
Write-Host "Service : $ServiceName" -ForegroundColor Gray
Write-Host ""

# ---- 1. Handle existing service ---------------------------------------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    if (-not $Force) {
        Write-Host "Service '$ServiceName' already exists. Re-run with -Force to reinstall." -ForegroundColor Yellow
        exit 0
    }
    Write-Host "Stopping and removing existing service..." -ForegroundColor Yellow
    & $nssm stop   $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 2
    & $nssm remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

# ---- 2. Install service -----------------------------------------------------
Write-Host "Installing service..." -ForegroundColor Cyan
& $nssm install $ServiceName $node $workerScript

# Working directory — relative paths in worker.js resolve against this
& $nssm set $ServiceName AppDirectory $workerDir

# Display name + description (shows in services.msc)
& $nssm set $ServiceName DisplayName "SmartEE MQTT Notifier Worker"
& $nssm set $ServiceName Description "Subscribes to MQTT and inserts NotifyLog rows when readings breach NotifyConfig thresholds. Required for in-app alerts and Web Push notifications."

# Start automatically on boot, restart on crash (with backoff)
& $nssm set $ServiceName Start          SERVICE_AUTO_START
& $nssm set $ServiceName AppExit Default Restart
& $nssm set $ServiceName AppRestartDelay 5000          # wait 5s before restart
& $nssm set $ServiceName AppThrottle     10000         # consider "crashed" if exits <10s

# Log rotation — separate stdout/stderr, rotate at 10MB
& $nssm set $ServiceName AppStdout       (Join-Path $logDir "worker-out.log")
& $nssm set $ServiceName AppStderr       (Join-Path $logDir "worker-err.log")
& $nssm set $ServiceName AppRotateFiles  1
& $nssm set $ServiceName AppRotateOnline 1
& $nssm set $ServiceName AppRotateBytes  10485760      # 10 MB

# Graceful shutdown — give 10s for the worker's SIGTERM handler to finish
& $nssm set $ServiceName AppStopMethodSkip      0
& $nssm set $ServiceName AppStopMethodConsole   10000
& $nssm set $ServiceName AppStopMethodWindow    5000
& $nssm set $ServiceName AppStopMethodThreads   5000

Write-Host "Service installed." -ForegroundColor Green

# ---- 3. Start service -------------------------------------------------------
Write-Host "Starting service..." -ForegroundColor Cyan
& $nssm start $ServiceName
Start-Sleep -Seconds 3

$status = (Get-Service -Name $ServiceName).Status
if ($status -eq "Running") {
    Write-Host ""
    Write-Host "SUCCESS — service '$ServiceName' is running." -ForegroundColor Green
    Write-Host ""
    Write-Host "Logs:" -ForegroundColor Cyan
    Write-Host "  Get-Content '$logDir\worker-out.log' -Tail 50 -Wait" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Manage:" -ForegroundColor Cyan
    Write-Host "  nssm restart $ServiceName" -ForegroundColor Gray
    Write-Host "  nssm stop    $ServiceName" -ForegroundColor Gray
    Write-Host "  nssm status  $ServiceName" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "Service installed but status = $status. Check the error log:" -ForegroundColor Yellow
    Write-Host "  Get-Content '$logDir\worker-err.log' -Tail 50" -ForegroundColor Gray
    exit 1
}
