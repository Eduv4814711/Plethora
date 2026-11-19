param(
  [Parameter(Mandatory = $true)]
  [string]$Owner,

  [Parameter(Mandatory = $true)]
  [string]$Repo
)

$ErrorActionPreference = "Stop"

$configPath = Join-Path $PSScriptRoot "..\.github\branch-protection-main.json"
if (-not (Test-Path $configPath)) {
  throw "Branch protection JSON not found at $configPath"
}

Write-Host "Applying branch protection rules to $Owner/$Repo (branch: main)..."
gh api `
  --method PUT `
  -H "Accept: application/vnd.github+json" `
  "/repos/$Owner/$Repo/branches/main/protection" `
  --input $configPath

Write-Host "Done. Verify in GitHub -> Settings -> Branches."
