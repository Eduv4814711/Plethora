#!/bin/bash
# One-time setup for Plethora Web on Azure App Service
# Usage: ./scripts/azure-setup-web.sh <resource-group> <app-name>
# Example: ./scripts/azure-setup-web.sh plethora-rg plethora-web

set -e

RESOURCE_GROUP=${1:-plethora-rg}
APP_NAME=${2:-plethora-web}

echo "Configuring Azure Web App: $APP_NAME (resource group: $RESOURCE_GROUP)"

# Set startup command for monorepo (runs Next.js from apps/web)
az webapp config set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_NAME" \
  --startup-file "npm run start --workspace=web"

# Set Node.js version
az webapp config appsettings set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_NAME" \
  --settings WEBSITE_NODE_DEFAULT_VERSION="~20" \
  --output none

echo "Done. Add NEXT_PUBLIC_API_URL in Azure Portal if your API URL differs from default."
