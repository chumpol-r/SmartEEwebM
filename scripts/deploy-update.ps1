# =============================================================================
# deploy-update.ps1
# -----------------------------------------------------------------------------
# Re-deploys SmartEE after a code change. Use for "ครั้งถัดไป" (subsequent
# deploys). Assumes install-worker-service.ps1 has been run once already.
#
# Steps performed:
#   1. git pull
#   2. server: npm install + restart worker service
#   3. client: npm install + npm run build + copy dist -> IIS site root
#   4. IIS app pool recycle (so any iisnode-hosted API picks up new code)
#
# Run as Administrator.
#
# Usage:
#   .\scripts\deploy-update.ps1
#   .\scripts\deploy-update.ps1 -SkipPull       # already pulled manually
#   .\scripts\deploy-update.ps1 -ClientOnly     # only rebuild frontend
#   .\scripts\deploy-update.ps1 -ServerOnly     # only restart backend
# =============================================================================

[CmdletBinding()]
param(
    [string]$RepoRoot     = (Split-Path -Parent $PSScriptRoot),
    [string]$ServiceName  = "SmartEEWorker",
    [string]$IisSiteRoot  = "C:\inetpub\wwwroot\smartee",   # IIS physical path
    [string]$IisAppPool   = "SmartEE",                       # IIS app pool name
    [switch]$SkipPull,
    [switch]$ClientOnly,
    [switch]$ServerOnly
)

$ErrorActionPreference = "Stop"

Write-Host "=== SmartEE Update Deployment ===" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot" -ForegroundColor Gray
Write-Host ""

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Must run as Administrator." -ForegroundColor Red
    exit 1
}

Set-Location $RepoRoot

# ---- 1. Pull latest code ----------------------------------------------------
if (-not $SkipPull) {
    Write-Host "[1/4] git pull..." -ForegroundColor Cyan
    git pull
    if ($LASTEXITCODE -ne 0) { Write-Host "git pull failed" -ForegroundColor Red; exit 1 }
}

# ---- 2. Backend -------------------------------------------------------------
if (-not $ClientOnly) {
    Write-Host "[2/4] Installing backend deps + restarting worker..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "server")
    npm install --omit=dev
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "npm install (server) failed" -ForegroundColor Red; exit 1 }
    Pop-Location

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        Write-Host "  Restarting service '$ServiceName'..." -ForegroundColor Gray
        Restart-Service -Name $ServiceName
        Start-Sleep -Seconds 3
        $status = (Get-Service -Name $ServiceName).Status
        Write-Host "  Service status: $status" -ForegroundColor (@{Running="Green"}[ "$status" ] ?? "Yellow")
    } else {
        Write-Host "  WARNING: Service '$ServiceName' is not installed." -ForegroundColor Yellow
        Write-Host "  Run scripts\install-worker-service.ps1 first." -ForegroundColor Yellow
    }
}

# ---- 3. Frontend ------------------------------------------------------------
if (-not $ServerOnly) {
    Write-Host "[3/4] Building frontend..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "client")
    npm install
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "npm install (client) failed" -ForegroundColor Red; exit 1 }
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "npm run build failed" -ForegroundColor Red; exit 1 }
    Pop-Location

    if (Test-Path $IisSiteRoot) {
        Write-Host "  Copying dist -> $IisSiteRoot ..." -ForegroundColor Gray
        # robocopy: /MIR mirrors, /XD node_modules .git, /XF .env to be safe
        robocopy (Join-Path $RepoRoot "client\dist") $IisSiteRoot /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
        # robocopy exit codes 0-7 are success; >=8 is failure
        if ($LASTEXITCODE -ge 8) { Write-Host "robocopy failed (code $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
    } else {
        Write-Host "  WARNING: IIS site root not found at $IisSiteRoot — skipping copy." -ForegroundColor Yellow
        Write-Host "  Pass -IisSiteRoot to override." -ForegroundColor Yellow
    }
}

# ---- 4. Recycle IIS app pool ------------------------------------------------
Write-Host "[4/4] Recycling IIS app pool '$IisAppPool'..." -ForegroundColor Cyan
Import-Module WebAdministration -ErrorAction SilentlyContinue
$pool = Get-Item "IIS:\AppPools\$IisAppPool" -ErrorAction SilentlyContinue
if ($pool) {
    Restart-WebAppPool -Name $IisAppPool
    Write-Host "  App pool recycled." -ForegroundColor Green
} else {
    Write-Host "  WARNING: App pool '$IisAppPool' not found — skipping recycle." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Deployment complete." -ForegroundColor Green
Write-Host "Verify with: curl http://localhost:8080/ ; Get-Content logs\worker-out.log -Tail 30" -ForegroundColor Gray
