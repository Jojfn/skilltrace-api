<#
  Deploys a built artefact to an environment and (re)starts it under PM2.

  Releases are kept side by side under <TargetRoot>\releases\<build> and the
  running process points at a junction called "current", so a rollback is a
  repoint rather than a rebuild.
#>
param(
  [Parameter(Mandatory = $true)][string]$ArtefactZip,
  [Parameter(Mandatory = $true)][string]$TargetRoot,
  [Parameter(Mandatory = $true)][string]$AppName,
  [Parameter(Mandatory = $true)][string]$Port,
  [Parameter(Mandatory = $true)][string]$EnvName,
  [Parameter(Mandatory = $true)][string]$BuildNumber,
  [string]$Pm2Cmd = "C:\Users\Maflapy\AppData\Roaming\npm\pm2.cmd",
  [string]$Pm2Home = "C:\skilltrace\.pm2",
  [string]$AllowChaos = "0"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$env:PM2_HOME = $Pm2Home

if (-not (Test-Path $ArtefactZip)) { throw "artefact not found: $ArtefactZip" }
if (-not (Test-Path $Pm2Cmd)) { throw "pm2 not found at $Pm2Cmd" }

$releases = Join-Path $TargetRoot "releases"
$release  = Join-Path $releases $BuildNumber
$current  = Join-Path $TargetRoot "current"
$dataDir  = Join-Path $TargetRoot "data"
$logDir   = Join-Path $TargetRoot "logs"

foreach ($d in @($releases, $dataDir, $logDir, $Pm2Home)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# --- 1. Unpack this build into its own release directory -------------------
if (Test-Path $release) { Remove-Item $release -Recurse -Force }
New-Item -ItemType Directory -Path $release -Force | Out-Null
Expand-Archive -Path $ArtefactZip -DestinationPath $release -Force
# The archive contains a single "app" folder; flatten it.
$inner = Join-Path $release "app"
if (Test-Path $inner) {
  Get-ChildItem -Path $inner -Force | Move-Item -Destination $release -Force
  Remove-Item $inner -Recurse -Force
}
Write-Host "[deploy] unpacked build $BuildNumber to $release"

# --- 2. Environment secret, generated once and kept off the repo -----------
$secretFile = Join-Path $TargetRoot "jwt.secret"
if (-not (Test-Path $secretFile)) {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes) | Set-Content -Path $secretFile -NoNewline -Encoding ascii
  Write-Host "[deploy] generated a new signing secret for $EnvName"
}
$jwtSecret = (Get-Content -Path $secretFile -Raw).Trim()

# --- 3. Point "current" at this release ------------------------------------
$previous = $null
if (Test-Path $current) {
  $previous = (Get-Item $current).Target
  cmd /c rmdir "$current" | Out-Null
}
cmd /c mklink /J "$current" "$release" | Out-Null
if (-not (Test-Path $current)) { throw "failed to point current at $release" }
Write-Host "[deploy] current -> $release"

# --- 4. Start or reload under PM2 ------------------------------------------
$env:NODE_ENV    = $EnvName
$env:PORT        = $Port
$env:DATA_FILE   = (Join-Path $dataDir "skilltrace.json")
$env:ALLOW_CHAOS = $AllowChaos
$env:JWT_SECRET  = $jwtSecret

# Removing a process that was never started is not an error, but pm2 writes
# to stderr when it happens and PowerShell would treat that as fatal. Route
# it through cmd so the noise is swallowed either way.
cmd /c "`"$Pm2Cmd`" delete $AppName >nul 2>&1"

& $Pm2Cmd start (Join-Path $current "src\server.js") --name $AppName `
    --time --output (Join-Path $logDir "out.log") --error (Join-Path $logDir "err.log") `
    --update-env
if ($LASTEXITCODE -ne 0) { throw "pm2 failed to start $AppName" }

cmd /c "`"$Pm2Cmd`" save --force >nul 2>&1"
Write-Host "[deploy] $AppName running on port $Port (env=$EnvName)"
if ($previous) { Write-Host "[deploy] previous release retained for rollback: $previous" }
exit 0
