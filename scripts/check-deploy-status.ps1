param(
  [string]$Profile = "Plethora-prod",
  [string]$Region = "af-south-1"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Local & Remote Git main ==="
git fetch origin main --quiet
Write-Host ("Local HEAD : {0}" -f (git rev-parse HEAD))
Write-Host ("origin/main: {0}" -f (git rev-parse origin/main))

Write-Host "`n=== Latest AWS CodeBuild (plethora-main-deploy) ==="
$idsJson = aws codebuild list-builds-for-project --project-name "plethora-main-deploy" --region $Region --profile $Profile --max-items 3 --query "ids" --output json
$ids = $idsJson | ConvertFrom-Json
if ($ids -and $ids.Count -gt 0) {
  aws codebuild batch-get-builds --ids $ids --region $Region --profile $Profile --query "builds[*].{id:id,status:buildStatus,phase:currentPhase,sha:resolvedSourceVersion,started:startTime,ended:endTime}" --output table
} else {
  Write-Host "No builds found for plethora-main-deploy."
}

Write-Host "`n=== Live Production HTTPS Health ==="
Write-Host "API (/health/ready):"
(curl.exe -sS -i --max-time 10 https://api.quickbophasecurity.co.za/health/ready) | Select-Object -First 6
curl.exe -sS --max-time 10 https://api.quickbophasecurity.co.za/health/ready
Write-Host "`n`nWeb (/):"
(curl.exe -sS -I --max-time 10 https://plethora.quickbophasecurity.co.za/) | Select-Object -First 6
