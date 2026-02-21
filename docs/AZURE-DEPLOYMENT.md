# Deploy Plethora to Azure

This guide walks you through deploying the Plethora web app (and API) to Azure App Service.

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- Azure subscription
- GitHub repository with the Plethora codebase

---

## 1. Create Azure Resources

### Option A: Azure Portal

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a **Resource Group** (e.g. `plethora-rg`)
3. Create **Web App** for the frontend:
   - Name: `plethora-web` (or your choice; must be globally unique)
   - Runtime: **Node 20 LTS**
   - OS: **Linux**
   - Region: Your preferred region

### Option B: Azure CLI

```bash
# Sign in
az login

# Create resource group
az group create --name plethora-rg --location eastus

# Create web app for Next.js frontend
az webapp create \
  --resource-group plethora-rg \
  --plan plethora-plan \
  --name plethora-web \
  --runtime "NODE:20-lts"
```

> **Note:** Create an App Service Plan first if needed:  
> `az appservice plan create --resource-group plethora-rg --name plethora-plan --sku B1 --is-linux`

---

## 2. Configure the Web App

### Startup Command (required for monorepo)

The app lives in `apps/web`. Set the startup command so Azure runs the correct package:

**Azure Portal:**
1. Go to your Web App → **Configuration** → **General settings**
2. Set **Startup Command** to:
   ```
   npm run start --workspace=web
   ```

**Azure CLI:**
```bash
az webapp config set \
  --resource-group plethora-rg \
  --name plethora-web \
  --startup-file "npm run start --workspace=web"
```

### App Settings (Environment Variables)

In **Configuration** → **Application settings**, add:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_API_URL` | `https://plethora-api.azurewebsites.net` (or your API URL) |

### Node.js Version (optional)

```bash
az webapp config appsettings set \
  --resource-group plethora-rg \
  --name plethora-web \
  --settings WEBSITE_NODE_DEFAULT_VERSION="~20"
```

---

## 3. Get Publish Profile for GitHub Actions

1. In Azure Portal, open your Web App → **Get publish profile**
2. Download the `.PublishSettings` file
3. Open the file and copy its **entire contents**

---

## 4. Configure GitHub Secrets

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `AZURE_WEBAPP_PUBLISH_PROFILE_WEB` | Contents of the publish profile for `plethora-web` |

**Optional** (if your API URL differs from default):
| Secret Name | Value |
|-------------|-------|
| `NEXT_PUBLIC_API_URL` | Your API base URL (e.g. `https://plethora-api.azurewebsites.net`) |

---

## 5. Deploy

### Automatic deployment (recommended)

Push to the `main` branch. The workflow `.github/workflows/main_plethora-web.yml` runs when:
- Files in `apps/web/**` change
- `package.json` or `package-lock.json` change

### Manual deployment

1. Go to **Actions** → **Deploy Plethora Web to Azure**
2. Click **Run workflow** → **Run workflow**

---

## 6. API Deployment (if using the backend)

Deploy the API first so the web app can reach it. You’ll need:

1. **PostgreSQL database** (e.g. Azure Database for PostgreSQL)
2. **Web App** for the API (`plethora-api`)
3. **Startup command** for the API:
   ```
   npm run start --workspace=api
   ```
4. **App settings** for the API:
   - `DATABASE_URL` – PostgreSQL connection string
   - `JWT_SECRET` – Secret for access tokens
   - `JWT_REFRESH_SECRET` – Secret for refresh tokens
   - `CORS_ORIGIN` – `https://plethora-web.azurewebsites.net` (your web app URL)
5. **GitHub secret** `AZURE_WEBAPP_PUBLISH_PROFILE` – Publish profile for `plethora-api`

---

## Troubleshooting

### App fails to start

- Confirm **Startup Command** is set to `npm run start --workspace=web`
- Check **Log stream** in Azure Portal for errors
- Verify Node.js version (20.x recommended)

### 502 Bad Gateway

- App may still be starting; wait a minute and retry
- Check **Log stream** and **Diagnose and solve problems**

### API connection errors

- Ensure `NEXT_PUBLIC_API_URL` matches your deployed API URL
- Ensure `CORS_ORIGIN` on the API includes your web app URL
- Rebuild and redeploy the web app after changing `NEXT_PUBLIC_API_URL` (it’s baked into the build)
