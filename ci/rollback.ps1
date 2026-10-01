<#
  Repoints an environment at its previous release and restarts it.
  Used by the pipeline when a post-release smoke test fails.
#>
param(
  [Parameter(Mandatory = $true)][string]$TargetRoot,
  [Parameter(Mandatory = $true)][string]$AppName,
  [string]$Pm2Cmd = "C:\Users\Maflapy\AppData\Roaming\npm\pm2.cmd",
  [string]$Pm2Home = "C:\skilltrace\.pm2"
)

$ErrorActionPreference = "Stop"
$env:PM2_HOME = $Pm2Home

$releases = Join-Path $TargetRoot "releases"
$current  = Join-Path $TargetRoot "current"

$currentTarget = if (Test-Path $current) { (Get-Item $current).Target } else { $null }
$candidates = Get-ChildItem -Path $releases -Directory |
  Where-Object { $_.FullName -ne $currentTarget } |
  Sort-Object LastWriteTime -Descending

if ($candidates.Count -eq 0) {
  Write-Host "[rollback] no previous release available"
  exit 1
}

$target = $candidates[0].FullName
if (Test-Path $current) { cmd /c rmdir "$current" | Out-Null }
cmd /c mklink /J "$current" "$target" | Out-Null
& $Pm2Cmd restart $AppName --update-env | Out-Null
Write-Host "[rollback] $AppName rolled back to $target"
exit 0
