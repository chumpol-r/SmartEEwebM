# SmartEE Web - Development Startup Script
# This script starts both Backend and Frontend servers

Write-Host "🚀 Starting SmartEE Web Development Environment..." -ForegroundColor Green
Write-Host ""

# Check if we're in the correct directory
$currentDir = Get-Location
if (-not (Test-Path ".\server") -or -not (Test-Path ".\client")) {
    Write-Host "❌ Error: Please run this script from the SmartEEweb root directory" -ForegroundColor Red
    Write-Host "Current directory: $currentDir" -ForegroundColor Yellow
    exit 1
}

# Function to check if port is in use
function Test-Port {
    param([int]$Port)
    $connection = Test-NetConnection -ComputerName localhost -Port $Port -WarningAction SilentlyContinue
    return $connection.TcpTestSucceeded
}

# Check if ports are already in use
Write-Host "🔍 Checking ports..." -ForegroundColor Cyan

if (Test-Port 3002) {
    Write-Host "⚠️  Port 3002 is already in use (Backend)" -ForegroundColor Yellow
    $response = Read-Host "Do you want to kill the process and continue? (y/n)"
    if ($response -eq 'y') {
        $processes = Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($proc in $processes) {
            Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
        }
        Write-Host "✅ Killed process on port 3002" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } else {
        Write-Host "❌ Cancelled" -ForegroundColor Red
        exit 1
    }
}

if (Test-Port 5173) {
    Write-Host "⚠️  Port 5173 is already in use (Frontend)" -ForegroundColor Yellow
    $response = Read-Host "Do you want to kill the process and continue? (y/n)"
    if ($response -eq 'y') {
        $processes = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($proc in $processes) {
            Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
        }
        Write-Host "✅ Killed process on port 5173" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } else {
        Write-Host "❌ Cancelled" -ForegroundColor Red
        exit 1
    }
}

if (Test-Port 3005) {
    Write-Host "⚠️  Port 3005 is already in use (Worker)" -ForegroundColor Yellow
    $response = Read-Host "Do you want to kill the process and continue? (y/n)"
    if ($response -eq 'y') {
        $processes = Get-NetTCPConnection -LocalPort 3005 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($proc in $processes) {
            Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
        }
        Write-Host "✅ Killed process on port 3005" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } else {
        Write-Host "❌ Cancelled" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "🔧 Starting Backend Server..." -ForegroundColor Cyan

# Start Backend in new window
$backendPath = Join-Path $currentDir "server"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendPath'; Write-Host '🔧 Backend Server' -ForegroundColor Green; npm start"

Write-Host "✅ Backend starting on http://localhost:3002" -ForegroundColor Green
Write-Host ""
Write-Host "⏳ Waiting 5 seconds for backend to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check if backend is running
Write-Host "🔍 Checking backend health..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3002/api/health" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Backend is running!" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Backend health check failed, but continuing..." -ForegroundColor Yellow
    Write-Host "   Backend may still be starting up" -ForegroundColor Gray
}

Write-Host ""
Write-Host "📨 Starting Worker (MQTT / notifications)..." -ForegroundColor Cyan

# Start Worker in new window (own process, own folder, own port — independent of API)
$workerPath = Join-Path $currentDir "worker"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$workerPath'; Write-Host '📨 Worker' -ForegroundColor Magenta; npm run dev"

Write-Host "✅ Worker starting on http://localhost:3005 (/health, /status)" -ForegroundColor Green

Write-Host ""
Write-Host "🎨 Starting Frontend Server..." -ForegroundColor Cyan

# Start Frontend in new window
$frontendPath = Join-Path $currentDir "client"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendPath'; Write-Host '🎨 Frontend Server' -ForegroundColor Blue; npm run dev"

Write-Host "✅ Frontend starting on http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "🎉 SmartEE Web is starting!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 URLs:" -ForegroundColor Cyan
Write-Host "   Frontend: http://localhost:5173" -ForegroundColor White
Write-Host "   Backend:  http://localhost:3002" -ForegroundColor White
Write-Host "   Worker:   http://localhost:3005/health" -ForegroundColor White
Write-Host "   Health:   http://localhost:3002/api/health" -ForegroundColor White
Write-Host ""
Write-Host "💡 Tips:" -ForegroundColor Cyan
Write-Host "   - Both servers are running in separate windows" -ForegroundColor Gray
Write-Host "   - Close those windows to stop the servers" -ForegroundColor Gray
Write-Host "   - Or press Ctrl+C in each window" -ForegroundColor Gray
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "Press any key to exit this window (servers will keep running)..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
