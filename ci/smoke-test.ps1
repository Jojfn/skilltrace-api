<#
  Smoke test for a deployed SkillTrace environment.
  Verifies the service is up, reports the expected build, and that the core
  user journey works end to end.
#>
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [string]$ExpectedBuild = "",
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Fail([string]$msg) {
  Write-Host "[smoke] FAIL: $msg" -ForegroundColor Red
  exit 1
}

Write-Host "[smoke] target $BaseUrl"

# 1. Wait for the service to answer.
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$health = $null
while ((Get-Date) -lt $deadline) {
  try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 5
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}
if ($null -eq $health) { Fail "service did not become healthy within $TimeoutSec seconds" }
if ($health.status -ne "ok") { Fail "health status was '$($health.status)'" }
Write-Host "[smoke] health ok - version $($health.version) build $($health.build) env $($health.env)"

# 2. Confirm the running build is the one we just deployed.
if ($ExpectedBuild -ne "" -and "$($health.build)" -ne "$ExpectedBuild") {
  Fail "expected build $ExpectedBuild but the service reports $($health.build)"
}

# 3. Exercise the core journey: register -> login -> create -> submit -> map.
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$student = @{ email = "smoke-$suffix@example.com"; password = "smoke-test-password"; name = "Smoke $suffix" }
$headers = @{ "Content-Type" = "application/json" }

try {
  $reg = Invoke-RestMethod -Uri "$BaseUrl/api/auth/register" -Method Post `
    -Body ($student | ConvertTo-Json) -Headers $headers -TimeoutSec 10
  if (-not $reg.id) { Fail "register did not return an id" }

  $login = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method Post `
    -Body (@{ email = $student.email; password = $student.password } | ConvertTo-Json) `
    -Headers $headers -TimeoutSec 10
  if (-not $login.token) { Fail "login did not return a token" }
  $auth = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $($login.token)" }

  $evidence = Invoke-RestMethod -Uri "$BaseUrl/api/evidence" -Method Post -Headers $auth `
    -Body (@{ title = "Smoke test evidence"; skillCode = "PROG"; result = "Deployed by Jenkins" } | ConvertTo-Json) `
    -TimeoutSec 10
  if ($evidence.status -ne "draft") { Fail "created evidence was not a draft" }

  $submitted = Invoke-RestMethod -Uri "$BaseUrl/api/evidence/$($evidence.id)/submit" `
    -Method Post -Headers $auth -TimeoutSec 10
  if ($submitted.status -ne "submitted") { Fail "evidence did not move to submitted" }

  $mapped = Invoke-RestMethod -Uri "$BaseUrl/api/skills/map" -Method Post -Headers $auth `
    -Body (@{ contributions = @("Add JWT authentication", "Add jest tests", "Implement endpoint") } | ConvertTo-Json) `
    -TimeoutSec 10
  if ($mapped.matches.Count -lt 1) { Fail "skill mapping returned no matches" }

  $metrics = Invoke-WebRequest -Uri "$BaseUrl/metrics" -TimeoutSec 10 -UseBasicParsing
  if ($metrics.Content -notmatch "skilltrace_http_requests_total") {
    Fail "metrics endpoint did not expose skilltrace counters"
  }
} catch {
  Fail "journey failed: $($_.Exception.Message)"
}

Write-Host "[smoke] PASS - register, login, create, submit, map and metrics all healthy" -ForegroundColor Green
exit 0
