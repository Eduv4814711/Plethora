# One-time setup for Plethora Web on Azure App Service
# Usage: .\scripts\azure-setup-web.ps1 -ResourceGroup plethora-rg -AppName plethora-web

param(
    [string]$ResourceGroup = "plethora-rg",
    [string]$AppName = "plethora-web"
)

Write-Host "Configuring Azure Web App: $AppName (resource group: $ResourceGroup)"

# Set startup command for monorepo (runs Next.js from apps/web)
az webapp config set `
  --resource-group $ResourceGroup `
  --name $AppName `
  --startup-file "npm run start --workspace=web"

# Set Node.js version
az webapp config appsettings set `
  --resource-group $ResourceGroup `
  --name $AppName `
  --settings WEBSITE_NODE_DEFAULT_VERSION="~20" `
  --output none

Write-Host "Done. Add NEXT_PUBLIC_API_URL in Azure Portal if your API URL differs from default."
