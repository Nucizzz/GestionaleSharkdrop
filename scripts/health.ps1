$ErrorActionPreference = "Stop"

function Test-Http($url) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    return "$($r.StatusCode) $url"
  } catch {
    return "ERR $url - $($_.Exception.Message)"
  }
}

Write-Host (Test-Http "http://127.0.0.1:8000/api/health")
Write-Host (Test-Http "http://127.0.0.1:8000/api/shopify/sync-status")
Write-Host (Test-Http "http://127.0.0.1:8081")
