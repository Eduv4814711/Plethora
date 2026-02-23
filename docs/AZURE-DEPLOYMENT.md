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
   - `CORS_ORIGIN` – `https://plethora-web.azurewebsites.net` (or your Front Door URL if using it)
5. **GitHub secret** `AZURE_WEBAPP_PUBLISH_PROFILE` – Publish profile for `plethora-api`

---

## 7. Azure Front Door (multi-region traffic)

Use Azure Front Door when your app receives traffic from multiple regions. It provides global load balancing, edge caching, and SSL termination.

### Prerequisites

- Web App (`plethora-web`) already deployed and running
- Azure CLI installed and signed in (`az login`)

### Step 1: Create Front Door profile

**Azure Portal:**
1. Go to [Azure Portal](https://portal.azure.com) → **Create a resource**
2. Search for **Front Door and CDN profiles**
3. Click **Create** → choose **Azure Front Door**
4. **Basics:**
   - Resource group: `plethora-rg` (or your existing one)
   - Profile name: `plethora-fd` (globally unique)
   - Tier: **Standard** (or **Premium** for WAF managed rules)

**Azure CLI:**
```bash
az afd profile create \
  --profile-name plethora-fd \
  --resource-group plethora-rg \
  --sku Standard_AzureFrontDoor
```

### Step 2: Create an endpoint

The endpoint is the public hostname users will reach.

**Azure Portal:**
1. Open your Front Door profile → **Endpoints** → **+ Add**
2. Endpoint name: `plethora-frontend`
3. Click **Add**

**Azure CLI:**
```bash
az afd endpoint create \
  --resource-group plethora-rg \
  --profile-name plethora-fd \
  --endpoint-name plethora-frontend \
  --enabled-state Enabled
```

### Step 3: Create origin group

**Azure Portal:**
1. Open profile → **Origin groups** → **+ Add**
2. Origin group name: `plethora-og`
3. **Health probe:** Path `/`, Protocol `HTTP`, Interval `60` seconds
4. Click **Add**

**Azure CLI:**
```bash
az afd origin-group create \
  --resource-group plethora-rg \
  --profile-name plethora-fd \
  --origin-group-name plethora-og \
  --probe-request-type GET \
  --probe-protocol Http \
  --probe-interval-in-seconds 60 \
  --probe-path / \
  --sample-size 4 \
  --successful-samples-required 3 \
  --additional-latency-in-milliseconds 50
```

### Step 4: Add your Web App as origin

Replace `plethora-web` with your actual Web App name if different.

**Azure Portal:**
1. Open profile → **Origins** → **+ Add**
2. Origin name: `plethora-web-origin`
3. Origin hostname: `plethora-web.azurewebsites.net`
4. Origin host header: `plethora-web.azurewebsites.net`
5. Origin group: `plethora-og`
6. HTTP port: `80`, HTTPS port: `443`
7. Click **Add**

**Azure CLI:**
```bash
az afd origin create \
  --resource-group plethora-rg \
  --profile-name plethora-fd \
  --origin-group-name plethora-og \
  --origin-name plethora-web-origin \
  --host-name plethora-web.azurewebsites.net \
  --origin-host-header plethora-web.azurewebsites.net \
  --priority 1 \
  --weight 1000 \
  --enabled-state Enabled \
  --http-port 80 \
  --https-port 443
```

### Step 5: Create route

**Azure Portal:**
1. Open profile → **Routes** → **+ Add**
2. Route name: `plethora-route`
3. Endpoint: `plethora-frontend`
4. Origin group: `plethora-og`
5. Patterns to match: `/*`
6. Supported protocols: **HTTP and HTTPS**
7. Redirect HTTP to HTTPS: **Enabled**
8. Link to default domain: **Enabled**
9. Click **Add**

**Azure CLI:**
```bash
az afd route create \
  --resource-group plethora-rg \
  --profile-name plethora-fd \
  --endpoint-name plethora-frontend \
  --route-name plethora-route \
  --origin-group plethora-og \
  --supported-protocols Http Https \
  --https-redirect Enabled \
  --forwarding-protocol MatchRequest \
  --link-to-default-domain Enabled
```

### Step 6: Get your Front Door URL

**Azure Portal:**
- Open profile → **Overview** → note the **Endpoint hostname** (e.g. `plethora-frontend-xxxxx.z01.azurefd.net`)

**Azure CLI:**
```bash
az afd endpoint show \
  --resource-group plethora-rg \
  --profile-name plethora-fd \
  --endpoint-name plethora-frontend \
  --query "hostName" -o tsv
```

Use `https://<endpoint-hostname>` as your app URL. Propagation can take a few minutes.

### Step 7 (optional): Add custom domain

1. Open profile → **Domains** → **+ Add**
2. Select your custom domain and follow the CNAME verification steps
3. Update your route to use the custom domain instead of the default

### Step 8 (optional): Caching for static assets

To cache Next.js static files at the edge:

1. Open profile → **Routes** → select `plethora-route` → **Edit**
2. Enable **Caching**
3. Add a cache rule for `/_next/static/*` with a suitable TTL (e.g. 1 year)

### Quick setup script

Run the PowerShell script to configure Front Door via CLI:

```powershell
.\scripts\azure-setup-frontdoor.ps1 -ResourceGroup plethora-rg -AppName plethora-web
```

---

## Troubleshooting

### App fails to start

- Confirm **Startup Command** is set to `npm run start --workspace=web`
- Check **Log stream** in Azure Portal for errors
- Verify Node.js version (20.x recommended)

### 502 Bad Gateway

- App may still be starting; wait a minute and retry
- Check **Log stream** and **Diagnose and solve problems**

### Front Door returns 503 or 504

- Verify the Web App origin is running (check App Service directly)
- Check health probe path: `/` must return 200
- Ensure origin host header matches the Web App hostname

### API connection errors

- Ensure `NEXT_PUBLIC_API_URL` matches your deployed API URL
- Ensure `CORS_ORIGIN` on the API includes your web app URL (or Front Door URL if using it)
- Rebuild and redeploy the web app after changing `NEXT_PUBLIC_API_URL` (it’s baked into the build)
