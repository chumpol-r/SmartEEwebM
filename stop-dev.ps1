# SmartEE Web - Stop Development Servers Script

Write-Host "🛑 Stopping SmartEE Web Development Environment..." -ForegroundColor Red
Write-Host ""

# Function to kill processes on a specific port
function Stop-ProcessOnPort {
    param([int]$Port, [string]$Name)
    
    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($connections) {
            $processes = $connections | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($proc in $processes) {
                $processInfo = Get-Process -Id $proc -ErrorAction SilentlyContinue
                if ($processInfo) {
                    Write-Host "🔪 Killing $Name (PID: $proc, Name: $($processInfo.Name))" -ForegroundColor Yellow
                    Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
                }
            }
            Write-Host "✅ Stopped $Name on port $Port" -ForegroundColor Green
        } else {
            Write-Host "ℹ️  No process found on port $Port ($Name)" -ForegroundColor Gray
        }
    } catch {
        Write-Host "⚠️  Error stopping $Name : $_" -ForegroundColor Yellow
    }
}

# Stop Backend (port 3002)
Write-Host "🔍 Checking Backend (port 3002)..." -ForegroundColor Cyan
Stop-ProcessOnPort -Port 3002 -Name "Backend"

Write-Host ""

# Stop Frontend (port 5173)
Write-Host "🔍 Checking Frontend (port 5173)..." -ForegroundColor Cyan
Stop-ProcessOnPort -Port 5173 -Name "Frontend Dev"

Write-Host ""

# Stop Frontend Preview (port 4173)
Write-Host "🔍 Checking Frontend Preview (port 4173)..." -ForegroundColor Cyan
Stop-ProcessOnPort -Port 4173 -Name "Frontend Preview"

Write-Host ""

# Stop Worker (dev 3005 / prod 3004)
Write-Host "🔍 Checking Worker (ports 3005, 3004)..." -ForegroundColor Cyan
Stop-ProcessOnPort -Port 3005 -Name "Worker (dev)"
Stop-ProcessOnPort -Port 3004 -Name "Worker (prod)"

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "✅ All development servers stopped!" -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
