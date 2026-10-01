<#
  Ensures a Prometheus instance is running with this repository's scrape
  configuration and alert rules. Idempotent: if 9090 already answers, the
  config is refreshed and Prometheus is asked to reload it.
#>
param(
  [string]$PromHome = "C:\prometheus\prometheus-3.15.0.windows-amd64",
  [string]$RuntimeDir = "C:\prometheus\runtime",
  [string]$DataDir = "C:\prometheus\data",
  [string]$PromUrl = "http://localhost:9090"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

foreach ($d in @($RuntimeDir, $DataDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

Copy-Item "monitoring\prometheus.yml"  (Join-Path $RuntimeDir "prometheus.yml")  -Force
Copy-Item "monitoring\alert.rules.yml" (Join-Path $RuntimeDir "alert.rules.yml") -Force
Write-Host "[prometheus] configuration synced from the repository"

$running = $false
try {
  Invoke-WebRequest -Uri "$PromUrl/-/ready" -TimeoutSec 5 -UseBasicParsing | Out-Null
  $running = $true
} catch { }

if ($running) {
  try {
    Invoke-WebRequest -Uri "$PromUrl/-/reload" -Method Post -TimeoutSec 10 -UseBasicParsing | Out-Null
    Write-Host "[prometheus] already running - configuration reloaded"
  } catch {
    Write-Host "[prometheus] already running (reload endpoint not enabled)"
  }
  exit 0
}

$exe = Join-Path $PromHome "prometheus.exe"
if (-not (Test-Path $exe)) { throw "prometheus.exe not found at $exe" }

Start-Process -FilePath $exe -WindowStyle Hidden -ArgumentList @(
  "--config.file=$(Join-Path $RuntimeDir 'prometheus.yml')",
  "--storage.tsdb.path=$DataDir",
  "--web.listen-address=:9090",
  "--web.enable-lifecycle"
)

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest -Uri "$PromUrl/-/ready" -TimeoutSec 5 -UseBasicParsing | Out-Null
    Write-Host "[prometheus] started and ready on :9090"
    exit 0
  } catch { }
}
throw "Prometheus did not become ready within 60 seconds"
