# Hourly fail-open cleanup for stale Semble/Playwright MCP helper processes.
# Invokes mcp/cleanup-processes.mjs. Safe to run when node/repo are missing.
# Designed to be registered as an S4U scheduled task via
# install-mcp-cleanup-scheduled-task.ps1 (hidden via run-ps1-hidden.vbs).
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'SilentlyContinue'

$repoRoot = Split-Path $PSScriptRoot -Parent
$repoScript = Join-Path $repoRoot 'mcp\cleanup-processes.mjs'
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$logDir = Join-Path $env:USERPROFILE '.local\state\lattice'
$logPath = Join-Path $logDir 'mcp-cleanup.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not $node) {
  "[$(Get-Date -Format o)] skipped: node.exe not found" | Add-Content -Path $logPath
  exit 0
}

if (-not (Test-Path -LiteralPath $repoScript)) {
  "[$(Get-Date -Format o)] skipped: missing $repoScript" | Add-Content -Path $logPath
  exit 0
}

$nodeArgs = @($repoScript)
if ($DryRun) {
  $nodeArgs += '--dry-run'
}

if (-not $env:LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS) { $env:LATTICE_MCP_CLEANUP_CPU_SAMPLE_MS = '1200' }
if (-not $env:LATTICE_MCP_CLEANUP_SEMBLE_GRACE_HOURS) { $env:LATTICE_MCP_CLEANUP_SEMBLE_GRACE_HOURS = '1.0' }
if (-not $env:LATTICE_MCP_CLEANUP_PLAYWRIGHT_GRACE_HOURS) { $env:LATTICE_MCP_CLEANUP_PLAYWRIGHT_GRACE_HOURS = '1.0' }

$output = & $node @nodeArgs 2>&1
$exitCode = $LASTEXITCODE

if ($output) {
  "[$(Get-Date -Format o)] exit=$exitCode" | Add-Content -Path $logPath
  $output | Add-Content -Path $logPath
}

exit 0
