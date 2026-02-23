# One-time setup for Azure Front Door in front of Plethora Web App
# Usage: .\scripts\azure-setup-frontdoor.ps1 -ResourceGroup plethora-rg -AppName plethora-web
#
# Prerequisites: Web App must already exist and be deployed.
# Run az login before executing.

param(
    [string]$ResourceGroup = "plethora-rg",
    [string]$AppName = "plethora-web",
    [string]$ProfileName = "plethora-fd",
    [string]$EndpointName = "plethora-frontend",
    [string]$OriginGroupName = "plethora-og",
    [string]$OriginName = "plethora-web-origin",
    [string]$RouteName = "plethora-route"
)

$ErrorActionPreference = "Stop"

Write-Host "Setting up Azure Front Door for: $AppName (resource group: $ResourceGroup)" -ForegroundColor Cyan

# Ensure Front Door extension is installed
Write-Host "Checking Azure Front Door extension..." -ForegroundColor Yellow
az extension add --name front-door --only-show-errors 2>$null

$hostName = "$AppName.azurewebsites.net"

# Step 1: Create Front Door profile (Standard tier)
Write-Host "`n[1/5] Creating Front Door profile: $ProfileName" -ForegroundColor Yellow
az afd profile create `
  --profile-name $ProfileName `
  --resource-group $ResourceGroup `
  --sku Standard_AzureFrontDoor `
  --output none

# Step 2: Create endpoint
Write-Host "[2/5] Creating endpoint: $EndpointName" -ForegroundColor Yellow
az afd endpoint create `
  --resource-group $ResourceGroup `
  --profile-name $ProfileName `
  --endpoint-name $EndpointName `
  --enabled-state Enabled `
  --output none

# Step 3: Create origin group
Write-Host "[3/5] Creating origin group: $OriginGroupName" -ForegroundColor Yellow
az afd origin-group create `
  --resource-group $ResourceGroup `
  --profile-name $ProfileName `
  --origin-group-name $OriginGroupName `
  --probe-request-type GET `
  --probe-protocol Http `
  --probe-interval-in-seconds 60 `
  --probe-path / `
  --sample-size 4 `
  --successful-samples-required 3 `
  --additional-latency-in-milliseconds 50 `
  --output none

# Step 4: Add Web App as origin
Write-Host "[4/5] Adding origin: $hostName" -ForegroundColor Yellow
az afd origin create `
  --resource-group $ResourceGroup `
  --profile-name $ProfileName `
  --origin-group-name $OriginGroupName `
  --origin-name $OriginName `
  --host-name $hostName `
  --origin-host-header $hostName `
  --priority 1 `
  --weight 1000 `
  --enabled-state Enabled `
  --http-port 80 `
  --https-port 443 `
  --output none

# Step 5: Create route
Write-Host "[5/5] Creating route: $RouteName" -ForegroundColor Yellow
az afd route create `
  --resource-group $ResourceGroup `
  --profile-name $ProfileName `
  --endpoint-name $EndpointName `
  --route-name $RouteName `
  --origin-group $OriginGroupName `
  --supported-protocols Http Https `
  --https-redirect Enabled `
  --forwarding-protocol MatchRequest `
  --link-to-default-domain Enabled `
  --output none

# Get Front Door URL
$fdHost = az afd endpoint show `
  --resource-group $ResourceGroup `
  --profile-name $ProfileName `
  --endpoint-name $EndpointName `
  --query "hostName" -o tsv

Write-Host "`nDone! Azure Front Door is configured." -ForegroundColor Green
Write-Host "Your app is now available at: https://$fdHost" -ForegroundColor Green
Write-Host "`nNote: Propagation may take a few minutes. Update CORS_ORIGIN on your API if needed." -ForegroundColor Gray
