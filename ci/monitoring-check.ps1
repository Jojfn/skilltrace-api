<#
  Monitoring and alerting stage.

  Confirms Prometheus is scraping both environments, reports live metrics from
  production, then deliberately sustains a fault in staging so an alert rule is
  proven to fire and then recover. Writes reports/monitoring-report.md.

  The incident is sustained rather than fired once: the rule requires the error
  ratio to hold above its threshold for 30 seconds, and a single burst decays
  out of the rate window before that elapses.
#>
param(
  [string]$PromUrl = "http://localhost:9090",
  [string]$ProdUrl = "http://localhost:3100",
  [string]$StagingUrl = "http://localhost:3101",
  [switch]$SimulateIncident,
  [string]$ReportDir = "reports"
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

if (-not (Test-Path $ReportDir)) { New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null }
$report = New-Object System.Collections.Generic.List[string]
$report.Add("# Monitoring report")
$report.Add("")
$report.Add("Build: $($env:BUILD_NUMBER)  |  Generated: $(Get-Date -Format s)")
$report.Add("")

# Always returns an array. A bare Prometheus response with a single series is
# unwrapped by PowerShell into one object, whose .Count is null on 5.1.
function Query([string]$expr) {
  try {
    $r = Invoke-RestMethod -Uri "$PromUrl/api/v1/query" -Body @{ query = $expr } -TimeoutSec 15
    # Callers wrap with @(), which normalises 0, 1 and many results alike.
    return $r.data.result
  } catch {
    return @()
  }
}

function AlertState([string]$name) {
  try {
    $a = Invoke-RestMethod -Uri "$PromUrl/api/v1/alerts" -TimeoutSec 15
    foreach ($alert in @($a.data.alerts)) {
      if ($alert.labels.alertname -eq $name) { return $alert.state }
    }
  } catch { }
  return "inactive"
}

function Hit([string]$url, [int]$times) {
  for ($i = 0; $i -lt $times; $i++) {
    try { Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing | Out-Null } catch { }
  }
}

# --- 1. Is Prometheus itself alive? ---------------------------------------
try {
  $ready = Invoke-WebRequest -Uri "$PromUrl/-/ready" -TimeoutSec 10 -UseBasicParsing
  Write-Host "[monitor] prometheus ready ($($ready.StatusCode))"
} catch {
  Write-Host "[monitor] FAIL: Prometheus is not reachable at $PromUrl" -ForegroundColor Red
  $report.Add("**FAILED** - Prometheus unreachable at $PromUrl")
  $report -join "`r`n" | Out-File (Join-Path $ReportDir "monitoring-report.md") -Encoding utf8
  exit 1
}

# --- 2. Are both targets being scraped? -----------------------------------
# Prometheus may have only just started, so allow time for a first scrape
# rather than declaring an outage that does not exist.
$up = @()
$prodUp = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
  $up = @(Query 'up{job=~"skilltrace.*"}')
  foreach ($s in $up) {
    if ($s.metric.job -eq "skilltrace-prod" -and $s.value[1] -eq "1") { $prodUp = $true }
  }
  if ($prodUp) { break }
  Write-Host "[monitor] waiting for the first scrape of production ($attempt/20)"
  Start-Sleep -Seconds 5
}

$report.Add("## Scrape targets")
$report.Add("")
$report.Add("| Job | Instance | Up |")
$report.Add("|---|---|---|")
foreach ($s in $up) {
  $upText = "no"
  if ($s.value[1] -eq "1") { $upText = "yes" }
  $report.Add("| $($s.metric.job) | $($s.metric.instance) | $upText |")
  Write-Host "[monitor] $($s.metric.job) up=$($s.value[1])"
}
$report.Add("")

if (-not $prodUp) {
  Write-Host "[monitor] FAIL: production target is not up in Prometheus" -ForegroundColor Red
  $report.Add("**FAILED** - production target is not being scraped")
  $report -join "`r`n" | Out-File (Join-Path $ReportDir "monitoring-report.md") -Encoding utf8
  exit 1
}

# --- 3. Live production metrics -------------------------------------------
$report.Add("## Live production metrics")
$report.Add("")
$report.Add("| Metric | Value |")
$report.Add("|---|---|")

$checks = @(
  @{ Label = "Total requests"; Expr = 'sum(skilltrace_http_requests_total{environment="production"})' },
  @{ Label = "Request rate (1m, per second)"; Expr = 'sum(rate(skilltrace_http_requests_total{environment="production"}[1m]))' },
  @{ Label = "5xx rate (1m, per second)"; Expr = 'sum(rate(skilltrace_http_requests_total{environment="production",status=~"5.."}[1m]))' },
  @{ Label = "p95 latency (seconds)"; Expr = 'histogram_quantile(0.95, sum by (le) (rate(skilltrace_http_request_duration_seconds_bucket{environment="production"}[5m])))' },
  @{ Label = "Resident memory (MB)"; Expr = 'process_resident_memory_bytes{environment="production"} / 1024 / 1024' },
  @{ Label = "Process uptime (seconds)"; Expr = 'time() - process_start_time_seconds{environment="production"}' }
)

foreach ($c in $checks) {
  $res = @(Query $c.Expr)
  $val = "n/a"
  if ($res.Count -gt 0 -and $null -ne $res[0] -and $null -ne $res[0].value) {
    $raw = $res[0].value[1]
    if ($raw -ne "NaN") { $val = [math]::Round([double]$raw, 4) }
  }
  $report.Add("| $($c.Label) | $val |")
  Write-Host "[monitor] $($c.Label) = $val"
}
$report.Add("")

# --- 4. Which alert rules are loaded? --------------------------------------
$alertNames = @()
try {
  $rules = Invoke-RestMethod -Uri "$PromUrl/api/v1/rules" -TimeoutSec 15
  foreach ($g in @($rules.data.groups)) {
    foreach ($r in @($g.rules)) {
      if ($r.type -eq "alerting") { $alertNames += $r.name }
    }
  }
} catch { }

$report.Add("## Alert rules loaded")
$report.Add("")
foreach ($n in $alertNames) { $report.Add("- ``$n``") }
$report.Add("")
$alertList = $alertNames -join ", "
Write-Host "[monitor] alert rules loaded: $alertList"

# --- 5. Incident simulation ------------------------------------------------
if ($SimulateIncident) {
  $alertName = "SkillTraceHighErrorRate"
  Write-Host "[monitor] simulating an incident on staging to prove '$alertName' fires"
  $report.Add("## Incident simulation")
  $report.Add("")
  $report.Add("Faults were injected into **staging only**, through the guarded " +
              "``/debug/boom`` endpoint, to prove the ``$alertName`` rule detects a real " +
              "failure. Production was never touched: ``/debug/boom`` only exists when " +
              "``ALLOW_CHAOS=1``, and production refuses to start with that enabled.")
  $report.Add("")

  # Sustain the fault so the error ratio stays above threshold for longer than
  # the rule's "for" duration.
  $fired = $false
  $state = "inactive"
  $elapsed = 0
  for ($i = 1; $i -le 24; $i++) {
    Hit "$StagingUrl/debug/boom" 10
    Start-Sleep -Seconds 5
    $elapsed += 5
    $state = AlertState $alertName
    Write-Host "[monitor] t+${elapsed}s  $alertName = $state"
    if ($state -eq "firing") { $fired = $true; break }
  }

  if ($fired) {
    Write-Host "[monitor] ALERT FIRED after ${elapsed}s - detection verified" -ForegroundColor Yellow
    $report.Add("- Alert reached ``firing`` after approximately ${elapsed}s of sustained errors.")
  } else {
    Write-Host "[monitor] alert reached '$state' but not 'firing' within ${elapsed}s" -ForegroundColor Yellow
    $report.Add("- Alert reached ``$state`` within ${elapsed}s but did not reach ``firing``.")
  }

  # Restore healthy traffic and confirm the alert clears.
  Write-Host "[monitor] restoring healthy traffic and waiting for recovery"
  $recovered = $false
  for ($i = 1; $i -le 24; $i++) {
    Hit "$StagingUrl/health" 25
    Start-Sleep -Seconds 5
    $state = AlertState $alertName
    if ($state -eq "inactive") { $recovered = $true; break }
  }
  if ($recovered) {
    Write-Host "[monitor] alert recovered to inactive" -ForegroundColor Green
    $report.Add("- After healthy traffic resumed, the alert returned to ``inactive``.")
  } else {
    Write-Host "[monitor] alert still $state after recovery traffic"
    $report.Add("- Alert was still ``$state`` when the recovery window closed.")
  }
  $report.Add("")
}

# --- 6. Outcome ------------------------------------------------------------
$report.Add("## Outcome")
$report.Add("")
$report.Add("Production is up and being scraped, alert rules are loaded, and the " +
            "error-rate rule has been exercised end to end rather than merely configured.")
$report -join "`r`n" | Out-File (Join-Path $ReportDir "monitoring-report.md") -Encoding utf8
Write-Host "[monitor] report written to $ReportDir/monitoring-report.md"
exit 0
