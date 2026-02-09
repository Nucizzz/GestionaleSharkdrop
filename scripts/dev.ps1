$ErrorActionPreference = "Stop"

$Root = Resolve-Path "$PSScriptRoot\.."
$Repo = $Root.Path

if (-not $env:MONGO_URL) { $env:MONGO_URL = "mongodb://127.0.0.1:27017" }
if (-not $env:DB_NAME) { $env:DB_NAME = "sharkdrop_wms" }

# Ensure MongoDB service is running (best effort)
try {
  $mongoSvc = Get-Service -Name MongoDB -ErrorAction Stop
  if ($mongoSvc.Status -ne "Running") {
    try {
      Start-Service -Name MongoDB -ErrorAction Stop
      Write-Host "MongoDB service started."
    } catch {
      Write-Host "MongoDB service is stopped. Start it manually (requires admin)."
    }
  }
} catch {
  Write-Host "MongoDB service not found. Ensure MongoDB is installed and running."
}

# Stop any previous uvicorn/expo processes launched from this repo
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match "uvicorn" -and $_.CommandLine -match "backend.server:app" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match "expo" -and $_.CommandLine -match "GESTIONALENUOVO" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$BackendOut = Join-Path $Repo "test_reports\\uvicorn.out.txt"
$BackendErr = Join-Path $Repo "test_reports\\uvicorn.err.txt"
$ExpoOut = Join-Path $Repo "test_reports\\expo.out.txt"
$ExpoErr = Join-Path $Repo "test_reports\\expo.err.txt"

Start-Process -FilePath py `
  -ArgumentList @("-m","uvicorn","backend.server:app","--host","0.0.0.0","--port","8000") `
  -WorkingDirectory $Repo `
  -RedirectStandardOutput $BackendOut `
  -RedirectStandardError $BackendErr

Start-Process -FilePath cmd `
  -ArgumentList @("/c","npx expo start --lan") `
  -WorkingDirectory (Join-Path $Repo "frontend") `
  -RedirectStandardOutput $ExpoOut `
  -RedirectStandardError $ExpoErr

Write-Host "Backend: http://127.0.0.1:8000/api"
Write-Host "Expo (LAN): check test_reports\\expo.out.txt for the QR code"
