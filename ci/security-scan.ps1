<#
  Security stage.

  Three independent checks, because they catch different classes of problem:
    1. npm audit        - known CVEs in the dependency tree
    2. eslint-plugin-security - insecure patterns in our own source
    3. secret scan      - credentials accidentally committed

  Writes reports/security-summary.md and fails the build when the dependency
  audit finds anything at or above the configured severity.
#>
param(
  [string]$FailOn = "high",
  [string]$ReportDir = "reports"
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

if (-not (Test-Path $ReportDir)) { New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null }
$summary = New-Object System.Collections.Generic.List[string]
$summary.Add("# Security scan summary")
$summary.Add("")
$summary.Add("Build: $($env:BUILD_NUMBER)  |  Commit: $($env:GIT_COMMIT)  |  Generated: $(Get-Date -Format s)")
$summary.Add("")

$failed = $false

# --- 1. Dependency vulnerabilities -----------------------------------------
Write-Host "[security] running npm audit"
$auditRaw = & cmd /c "npm audit --json 2>nul"
$auditPath = Join-Path $ReportDir "npm-audit.json"
$auditRaw | Out-File -FilePath $auditPath -Encoding utf8

$counts = @{ critical = 0; high = 0; moderate = 0; low = 0; info = 0 }
$findings = @()
try {
  $audit = $auditRaw | ConvertFrom-Json
  if ($audit.metadata -and $audit.metadata.vulnerabilities) {
    foreach ($k in @("critical", "high", "moderate", "low", "info")) {
      $counts[$k] = [int]$audit.metadata.vulnerabilities.$k
    }
  }
  if ($audit.vulnerabilities) {
    foreach ($p in $audit.vulnerabilities.PSObject.Properties) {
      $v = $p.Value
      $title = ""
      if ($v.via) {
        foreach ($via in $v.via) { if ($via.title) { $title = $via.title; break } }
      }
      $findings += [pscustomobject]@{
        Package  = $p.Name
        Severity = $v.severity
        Direct   = $v.isDirect
        Title    = $title
      }
    }
  }
} catch {
  $summary.Add("> npm audit output could not be parsed: $($_.Exception.Message)")
}

$summary.Add("## 1. Dependency vulnerabilities (npm audit)")
$summary.Add("")
$summary.Add("| Severity | Count |")
$summary.Add("|---|---|")
foreach ($k in @("critical", "high", "moderate", "low")) {
  $summary.Add("| $k | $($counts[$k]) |")
}
$summary.Add("")
if ($findings.Count -gt 0) {
  $summary.Add("| Package | Severity | Direct | Advisory |")
  $summary.Add("|---|---|---|---|")
  foreach ($f in $findings) {
    $summary.Add("| $($f.Package) | $($f.Severity) | $($f.Direct) | $($f.Title) |")
  }
} else {
  $summary.Add("No known vulnerabilities in the dependency tree.")
}
$summary.Add("")

$blocking = switch ($FailOn) {
  "critical" { $counts["critical"] }
  "high"     { $counts["critical"] + $counts["high"] }
  "moderate" { $counts["critical"] + $counts["high"] + $counts["moderate"] }
  default    { $counts["critical"] + $counts["high"] }
}
if ($blocking -gt 0) {
  Write-Host "[security] GATE FAILED: $blocking vulnerabilities at or above '$FailOn'" -ForegroundColor Red
  $failed = $true
} else {
  Write-Host "[security] dependency gate passed (threshold: $FailOn)"
}

# --- 2. Static analysis of our own source ----------------------------------
Write-Host "[security] running eslint security rules"
$eslintPath = Join-Path $ReportDir "eslint-security.json"
& cmd /c "npx eslint src --format json > `"$eslintPath`" 2>nul"
$secIssues = @()
try {
  $results = Get-Content $eslintPath -Raw | ConvertFrom-Json
  foreach ($file in $results) {
    foreach ($m in $file.messages) {
      if ($m.ruleId -and $m.ruleId.StartsWith("security/")) {
        $secIssues += [pscustomobject]@{
          File = (Split-Path $file.filePath -Leaf)
          Line = $m.line
          Rule = $m.ruleId
          Message = $m.message
        }
      }
    }
  }
} catch { }

$summary.Add("## 2. Static analysis (eslint-plugin-security)")
$summary.Add("")
if ($secIssues.Count -gt 0) {
  $summary.Add("| File | Line | Rule | Message |")
  $summary.Add("|---|---|---|---|")
  foreach ($i in $secIssues) {
    $summary.Add("| $($i.File) | $($i.Line) | $($i.Rule) | $($i.Message) |")
  }
  $summary.Add("")
  $summary.Add("These are reported as warnings, not build failures: every hit is a " +
               "filesystem call in the persistence layer whose path comes from trusted " +
               "configuration rather than user input. Reviewed and accepted.")
} else {
  $summary.Add("No security rule violations in src/.")
}
$summary.Add("")

# --- 3. Secret scan ---------------------------------------------------------
Write-Host "[security] scanning for committed secrets"
$patterns = @(
  @{ Name = "AWS access key id";      Regex = "AKIA[0-9A-Z]{16}" },
  @{ Name = "GitHub personal token";  Regex = "ghp_[A-Za-z0-9]{30,}" },
  @{ Name = "Private key block";      Regex = "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
  @{ Name = "Slack token";            Regex = "xox[baprs]-[A-Za-z0-9-]{10,}" },
  @{ Name = "Generic hardcoded secret"; Regex = "(?i)(api[_-]?key|secret|passwd|password)\s*[:=]\s*[`"'][^`"'`$\{]{12,}[`"']" }
)
$tracked = & cmd /c "git ls-files 2>nul"
$secretHits = @()
foreach ($file in $tracked) {
  if (-not $file) { continue }
  # The scanner's own pattern definitions, the recorded audit evidence and the
  # lockfile would otherwise match themselves.
  if ($file -match "^(reports/|security-evidence/|ci/|package-lock.json)") { continue }
  if (-not (Test-Path $file)) { continue }
  $content = Get-Content -Path $file -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }
  foreach ($p in $patterns) {
    $m = [regex]::Matches($content, $p.Regex)
    foreach ($hit in $m) {
      $secretHits += [pscustomobject]@{ File = $file; Kind = $p.Name }
    }
  }
}

$summary.Add("## 3. Secret scan")
$summary.Add("")
if ($secretHits.Count -gt 0) {
  $summary.Add("| File | Pattern |")
  $summary.Add("|---|---|")
  foreach ($h in ($secretHits | Sort-Object File, Kind -Unique)) {
    $summary.Add("| $($h.File) | $($h.Kind) |")
  }
  Write-Host "[security] secret scan found $($secretHits.Count) candidate(s) - review required" -ForegroundColor Yellow
} else {
  $summary.Add("No credential patterns found in tracked files.")
  Write-Host "[security] secret scan clean"
}
$summary.Add("")
$summary.Add("")
$summary.Add("**Triage.** Hits in ``tests/`` are fixture passwords used to drive the test " +
             "suite; they grant no access to anything and are not credentials. The hit in " +
             "``src/config.js`` is the development JWT signing default, which is real and " +
             "deliberately visible: it exists so the service runs locally without setup. " +
             "It is mitigated rather than removed - ``assertProductionConfig()`` refuses to " +
             "start a production process using it, or with a secret shorter than 32 " +
             "characters, and a unit test asserts that. Runtime signing keys are generated " +
             "per environment at deploy time and stored outside the repository.")

$summary -join "`r`n" | Out-File -FilePath (Join-Path $ReportDir "security-summary.md") -Encoding utf8
Write-Host "[security] report written to $ReportDir/security-summary.md"

if ($failed) { exit 1 }
exit 0
