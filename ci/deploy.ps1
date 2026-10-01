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

# PM2 is invoked through Start-Process with its handles redirected to files.
# PM2 leaves a background daemon running, and if that daemon inherits the
# output pipe of the calling shell, Jenkins never sees the command finish and
# the stage hangs instead of completing. Redirecting to files breaks the
# inheritance, and passing arguments as an array avoids nested-quote parsing
# problems in the process path.
$pm2Out = Join-Path $logDir "pm2.out.log"
$pm2Err = Join-Path $logDir "pm2.err.log"

function Invoke-Pm2 {
  param([string[]]$Arguments)
  $proc = Start-Process -FilePath $Pm2Cmd -ArgumentList $Arguments -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $pm2Out -RedirectStandardError $pm2Err
  return $proc.ExitCode
}

# Removing a process that was never started is not an error here.
Invoke-Pm2 @("delete", $AppName) | Out-Null

$startArgs = @(
  "start", (Join-Path $current "src\server.js"),
  "--name", $AppName,
  "--time",
  "--output", (Join-Path $logDir "out.log"),
  "--error",  (Join-Path $logDir "err.log"),
  "--update-env"
)
$code = Invoke-Pm2 $startArgs
Get-Content $pm2Out -ErrorAction SilentlyContinue | Select-Object -First 3
if ($code -ne 0) {
  Get-Content $pm2Err -ErrorAction SilentlyContinue | Select-Object -Last 20
  throw "pm2 failed to start $AppName (exit $code)"
}

Invoke-Pm2 @("save", "--force") | Out-Null

# Confirm PM2 really has it running before the stage claims success.
# (pm2 jlist is not used here: its JSON carries both "username" and "USERNAME",
# which PowerShell's case-insensitive ConvertFrom-Json rejects as duplicate keys.)
$pidFile = Join-Path $logDir "pm2.pid.txt"
Start-Process -FilePath $Pm2Cmd -ArgumentList @("pid", $AppName) -NoNewWindow -Wait `
  -RedirectStandardOutput $pidFile -RedirectStandardError $pm2Err | Out-Null
$runningPid = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
if ($runningPid -match '^\d+$' -and [int]$runningPid -gt 0) {
  Write-Host "[deploy] pm2 reports $AppName online (pid $runningPid)"
} else {
  throw "pm2 did not report a running pid for $AppName"
}

Write-Host "[deploy] $AppName running on port $Port (env=$EnvName)"
if ($previous) { Write-Host "[deploy] previous release retained for rollback: $previous" }
exit 0
