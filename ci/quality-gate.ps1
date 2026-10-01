<#
  Code Quality stage: runs the SonarCloud scanner, waits for server-side
  analysis to finish, then reads the project's quality gate and fails the
  build if the gate is red.
#>
param(
  [Parameter(Mandatory = $true)][string]$SonarToken,
  [string]$ScannerVersion = "7.3.0.5189",
  [string]$ProjectKey = "Jojfn_skilltrace-api",
  [switch]$FailOnGate
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$zip = "sonar-scanner-cli.zip"
$dir = "sonar-scanner"
if (-not (Test-Path $zip)) {
  Write-Host "[quality] downloading SonarScanner CLI $ScannerVersion"
  Invoke-WebRequest -Uri "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-$ScannerVersion-windows-x64.zip" -OutFile $zip
}
if (-not (Test-Path $dir)) {
  Expand-Archive -Path $zip -DestinationPath $dir -Force
}
$scanner = Get-ChildItem -Path $dir -Recurse -Filter "sonar-scanner.bat" | Select-Object -First 1
if (-not $scanner) { throw "sonar-scanner.bat not found after extraction" }

Write-Host "[quality] running analysis"
& $scanner.FullName "-Dsonar.token=$SonarToken" "-Dsonar.scm.revision=$($env:GIT_COMMIT)" "-Dsonar.buildString=$($env:BUILD_NUMBER)"
if ($LASTEXITCODE -ne 0) { throw "sonar-scanner exited with $LASTEXITCODE" }

# --- wait for the server-side compute engine task -------------------------
$taskFile = ".scannerwork\report-task.txt"
if (-not (Test-Path $taskFile)) { throw "report-task.txt not produced by the scanner" }
$props = @{}
foreach ($line in Get-Content $taskFile) {
  if ($line -match "^([^=]+)=(.*)$") { $props[$Matches[1]] = $Matches[2] }
}
$ceTaskUrl = $props["ceTaskUrl"]
Write-Host "[quality] analysis task: $ceTaskUrl"

$pair = "$SonarToken`:"
$auth = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair)) }

$analysisId = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 5
  $task = Invoke-RestMethod -Uri $ceTaskUrl -Headers $auth -TimeoutSec 20
  $status = $task.task.status
  Write-Host "[quality] task status: $status"
  if ($status -eq "SUCCESS") { $analysisId = $task.task.analysisId; break }
  if ($status -eq "FAILED" -or $status -eq "CANCELED") { throw "Sonar analysis $status" }
}
if (-not $analysisId) { throw "timed out waiting for Sonar analysis to complete" }

# --- read the quality gate ------------------------------------------------
$gateUrl = "https://sonarcloud.io/api/qualitygates/project_status?analysisId=$analysisId"
$gate = Invoke-RestMethod -Uri $gateUrl -Headers $auth -TimeoutSec 20
$status = $gate.projectStatus.status
Write-Host ""
Write-Host "[quality] QUALITY GATE: $status"
Write-Host "[quality] conditions:"
foreach ($c in $gate.projectStatus.conditions) {
  $line = "  - {0}: {1} (actual {2}, threshold {3} {4})" -f `
    $c.metricKey, $c.status, $c.actualValue, $c.comparator, $c.errorThreshold
  Write-Host $line
}

if (-not (Test-Path "reports")) { New-Item -ItemType Directory -Path "reports" -Force | Out-Null }
$gate.projectStatus | ConvertTo-Json -Depth 6 | Out-File "reports\quality-gate.json" -Encoding utf8

if ($status -ne "OK" -and $FailOnGate) {
  Write-Host "[quality] gate is $status - failing the build" -ForegroundColor Red
  exit 1
}
exit 0
