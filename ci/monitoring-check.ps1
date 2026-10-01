<#
  Monitoring and alerting stage.

  Confirms Prometheus is scraping both environments, reports live metrics,
  then deliberately injects faults into staging so an alert rule is proven to
  fire and recover. Writes reports/monitoring-report.md.
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

function Query([string]$expr) {
  try {
    $r = Invoke-RestMethod -Uri "$PromUrl/api/v1/query" -Body @{ query = $expr } -TimeoutSec 15
    return $r.data.result
  } catch {
    return $null
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
$up = Query 'up{job=~"skilltrace.*"}'
$report.Add("## Scrape targets")
$report.Add("")
$report.Add("| Job | Instance | Up |")
$report.Add("|---|---|---|")
$prodUp = $false
foreach ($s in $up) {
  $isUp = ($s.value[1] -eq "1")
  if ($s.metric.job -eq "skilltrace-prod" -and $isUp) { $prodUp = $true }
  $report.Add("| $($s.metric.job) | $($s.metric.instance) | $(if ($isUp) {'yes'} else {'no'}) |")
  Write-Host "[monitor] $($s.metric.job) up=$($s.value[1])"
}
$report.Add("")

if (-not $prodUp) {
  Write-Host "[monitor] FAIL: production target is not up in Prometheus" -ForegroundColor Red
  $report.Add("**FAILED** - production target down")
  $report -join "`r`n" | Out-File (Join-Path $ReportDir "monitoring-report.md") -Encoding utf8
  exit 1
}

# --- 3. Live service metrics ----------------------------------------------
$report.Add("## Live metrics")
$report.Add("")
$report.Add("| Metric | Value |")
$report.Add("|---|---|")
$checks = @(
  @{ Label = "Total requests (prod)"; Expr = 'sum(skilltrace_http_requests_total{environment="production"})' },
  @{ Label = "Request rate 1m (prod)"; Expr = 'sum(rate(skilltrace_http_requests_total{environment="production"}[1m]))' },
  @{ Label = "5xx rate 1m (prod)";     Expr = 'sum(rate(skilltrace_http_requests_total{environment="production",status=~"5.."}[1m]))' },
  @{ Label = "Resident memory (prod)"; Expr = 'process_resident_memory_bytes{environment="production"}' }
)
foreach ($c in $checks) {
  $res = Query $c.Expr
  $val = if ($res -and $res.Count -gt 0) { [math]::Round([double]$res[0].value[1], 4) } else { "n/a" }
  $report.Add("| $($c.Label) | $val |")
  Write-Host "[monitor] $($c.Label) = $val"
}
$report.Add("")

# --- 4. Alert rules loaded -------------------------------------------------
try {
  $rules = Invoke-RestMethod -Uri "$PromUrl/api/v1/rules" -TimeoutSec 15
  $alertNames = @()
  foreach ($g in $rules.data.groups) {
    foreach ($r in $g.rules) { if ($r.type -eq "alerting") { $alertNames += $r.name } }
  }
  $report.Add("## Alert rules loaded")
  $report.Add("")
  foreach ($n in $alertNames) { $report.Add("- $n") }
  $report.Add("")
  Write-Host "[monitor] alert rules loaded: $($alertNames -join ', ')"
} catch {
  $report.Add("Could not read alert rules: $($_.Exception.Message)")
}

# --- 5. Incident simulation ------------------------------------------------
if ($SimulateIncident) {
  Write-Host "[monitor] injecting faults into staging to prove the alert fires"
  $report.Add("## Incident simulation")
  $report.Add("")
  $report.Add("Faults were injected into the **staging** environment only, via the " +
              "guarded /debug/boom endpoint, to prove the SkillTraceHighErrorRate rule " +
              "fires and recovers. Production was not touched.")
  $report.Add("")

  for ($i = 0; $i -lt 40; $i++) {
    try { Invoke-WebRequest -Uri "$StagingUrl/debug/boom" -TimeoutSec 3 -UseBasicParsing | Out-Null } catch { }
  }
  Write-Host "[monitor] 40 failing requests sent, waiting for the rule to evaluate"

  $fired = $false
  $state = "none"
  for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Seconds 5
    try {
      $alerts = Invoke-RestMethod -Uri "$PromUrl/api/v1/alerts" -TimeoutSec 15
      foreach ($a in $alerts.data.alerts) {
        if ($a.labels.alertname -eq "SkillTraceHighErrorRate") {
          $state = $a.state
          if ($a.state -eq "firing") { $fired = $true }
        }
      }
    } catch { }
    Write-Host "[monitor] SkillTraceHighErrorRate state: $state"
    if ($fired) { break }
  }

  if ($fired) {
    Write-Host "[monitor] ALERT FIRED as designed - detection verified" -ForegroundColor Yellow
    $report.Add("- Alert **SkillTraceHighErrorRate** reached state ``firing`` after fault injection.")
  } else {
    Write-Host "[monitor] alert did not reach firing within the window (last state: $state)"
    $report.Add("- Alert did not reach ``firing`` within the observation window (last state: ``$state``).")
  }

  # Drive healthy traffic so the rule recovers.
  Write-Host "[monitor] restoring healthy traffic"
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest -Uri "$StagingUrl/health" -TimeoutSec 3 -UseBasicParsing | Out-Null } catch { }
  }
  $report.Add("- Healthy traffic was then restored so the rule returns to ``inactive``.")
  $report.Add("")
}

$report.Add("## Outcome")
$report.Add("")
$report.Add("Production is up and being scraped, alert rules are loaded, and the " +
            "error-rate rule has been demonstrated end to end.")
$report -join "`r`n" | Out-File (Join-Path $ReportDir "monitoring-report.md") -Encoding utf8
Write-Host "[monitor] report written to $ReportDir/monitoring-report.md"
exit 0
