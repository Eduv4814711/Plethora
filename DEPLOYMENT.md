# Deploy Plethora

The **Next.js** dashboard (`apps/web`) can run on [Vercel](https://vercel.com). The **Fastify** API (`apps/api`) uses Puppeteer, file uploads, and a writable disk; host it on a long-lived Node service (Railway, Render, Fly.io, a VM, or Kubernetes) with PostgreSQL—not on Vercel Serverless Functions.

This document covers **Vercel + API elsewhere** first, then an **all-in-one Railway** layout.

---

## Option A: Web on Vercel, API and database elsewhere

### A.1 Prerequisites

- **Vercel account** and GitHub repository access
- **API + PostgreSQL** reachable from the internet (see Option B phases 2–3 on Railway, or your own host)

### A.2 Create the Vercel project

1. In the Vercel dashboard, choose **Add New… → Project** and import your Git repository.
2. Under **Configure Project**:
   - **Root Directory**: `apps/web` (required for this monorepo).
   - **Framework Preset**: Next.js (should auto-detect).
   - Leave **Build Command** and **Install Command** empty so Vercel uses [`apps/web/vercel.json`](apps/web/vercel.json): install runs `npm ci` from the repository root and the build runs `npm run build:web`.
3. Add **Environment Variables** before the first production build:

   | Name | Notes |
   |------|--------|
   | `NEXT_PUBLIC_API_URL` | Public base URL of your API, e.g. `https://api.example.com`. **No trailing slash.** This is inlined at build time; wrong or missing values send `/api/*` rewrites to `http://localhost:3001` and break production. |

   Use the same value for **Preview** deployments if previews should talk to a shared staging API, or a different API URL per environment if you prefer.

4. Deploy. Vercel assigns a hostname such as `https://<project>.vercel.app`.

### A.3 CORS and invite links on the API

On the API host, set:

| Variable | Value |
|----------|--------|
| `CORS_ORIGIN` | Comma-separated list of browser origins that may call the API with cookies/credentials, e.g. `https://<project>.vercel.app,https://app.example.com`. |
| `FRONTEND_URL` | The URL users open in the browser (used for password-setup and other links), e.g. `https://app.example.com` or your primary Vercel URL. |

`CORS_ORIGIN` supports multiple origins (comma-separated) so preview and production frontends can both work against the same API when needed.

### A.4 Verify

1. Open the Vercel URL; you should see the login page.
2. `GET <NEXT_PUBLIC_API_URL>/health` should return `{"status":"ok"}` (or your API’s health payload).
3. If the UI loads but API calls fail, re-check `NEXT_PUBLIC_API_URL` (rebuild after changing it) and `CORS_ORIGIN`.

---

## Option B: Deploy everything to Railway

This guide covers deploying Plethora to Railway. All components (web, API, database) run in one Railway project.

### Prerequisites

- **Railway account**: Sign up at [railway.app](https://railway.app)
- **GitHub**: Repository pushed to GitHub
- **Domain** (optional): Custom domains for web and API

---

## Phase 1: Create Project and Connect GitHub

1. Go to [railway.app/dashboard](https://railway.app/dashboard) and click **New Project**.
2. Choose **Deploy from GitHub repo**.
3. Select your repository: `Plethora-ERP/official-plethora-folder`.
4. Railway will create a project. Start with an **Empty Project** if you want to configure services manually, or use the template flow.

---

## Phase 2: Add PostgreSQL

1. In your project, click **+ New** → **Database** → **PostgreSQL**.
2. Railway provisions PostgreSQL. Click the database service.
3. Go to **Variables** and copy the `DATABASE_URL` (or `DATABASE_PRIVATE_URL` for internal use).
4. You will reference this in the API service.

---

## Phase 3: Deploy API Service

1. Click **+ New** → **GitHub Repo** (or **Empty Service** if you prefer to configure from scratch).
2. Select the same repository.
3. Open the API service **Settings**:
   - **Root Directory**: `apps/api`
   - **Build Command**: `npx prisma generate && npm run build`
   - **Start Command**: `npx prisma db push --accept-data-loss && node dist/index.js`
   - **Watch Paths**: `apps/api/**` (optional, for faster rebuilds)
4. Go to **Variables** and add:

   | Variable | Value |
   |----------|-------|
   | DATABASE_URL | `${{Postgres.DATABASE_URL}}` (or your PostgreSQL service name – use Railway's variable reference) |
   | JWT_SECRET | Random 32+ character string |
   | JWT_REFRESH_SECRET | Random 32+ character string |
   | CORS_ORIGIN | Your web app URL (e.g. `https://your-app.up.railway.app`) – set after Phase 4 |
   | FRONTEND_URL | Your web app URL (e.g. `https://your-web.up.railway.app`) for invite/setup-password links |
   | PORT | `3001` |

5. Go to **Settings** → **Networking** → **Generate Domain** to get a public URL for the API.
6. Deploy. Copy the API domain (e.g. `https://your-api.up.railway.app`).

---

## Phase 4: Deploy Web Service

1. Click **+ New** → **GitHub Repo**.
2. Select the same repository.
3. Open the Web service **Settings**:
   - **Root Directory**: `apps/web`
   - **Build Command**: (default `npm run build` is fine)
   - **Start Command**: (default `npm run start` is fine)
   - **Watch Paths**: `apps/web/**` (optional)
4. Go to **Variables** and add:

   | Variable | Value |
   |----------|-------|
   | NEXT_PUBLIC_API_URL | Your API domain from Phase 3 (e.g. `https://your-api.up.railway.app`) |

5. Go to **Settings** → **Networking** → **Generate Domain** to get a public URL for the web app.
6. **Update API CORS**: Go back to the API service → **Variables** → set `CORS_ORIGIN` to the web app domain (e.g. `https://your-web.up.railway.app`).
7. Redeploy the API so the new CORS origin takes effect.

---

## Phase 5: Verify Deployment

1. Open the web app domain. You should see the Plethora login page.
2. Create an admin user via Settings → Users (or your preferred setup method).
3. Check API health: `https://your-api.up.railway.app/health` should return `{"status":"ok"}`.

---

## Phase 5.5: WhatsApp (Optional)

To enable WhatsApp commands (clock in, clock out, payslip, leave, help):

1. Add these variables to your **API** service:

   | Variable | Value |
   |----------|-------|
   | WHATSAPP_PHONE_NUMBER_ID | Your Meta WhatsApp phone number ID |
   | WHATSAPP_ACCESS_TOKEN | Permanent token from Meta (System User) |
   | WHATSAPP_VERIFY_TOKEN | A secret string you choose (e.g. `plethora_wa_verify_xyz`) |
   | WHATSAPP_API_VERSION | `v21.0` (optional) |

2. In [Meta for Developers](https://developers.facebook.com/) → Your App → WhatsApp → Configuration → Webhook:
   - **Callback URL**: `https://YOUR-API-URL/webhook` (use your Railway API domain)
   - **Verify token**: Same as `WHATSAPP_VERIFY_TOKEN`
3. Subscribe to the **messages** webhook field.
4. Redeploy the API.

See [docs/WHATSAPP_PRODUCTION.md](docs/WHATSAPP_PRODUCTION.md) for full details and permanent token setup.

---

## Phase 6: Custom Domains (Optional)

1. In each service (API and Web), go to **Settings** → **Networking** → **Custom Domain**.
2. Add your domain (e.g. `api.plethora.yourdomain.com`, `plethora.yourdomain.com`).
3. Add the CNAME records Railway provides to your DNS.
4. Update `NEXT_PUBLIC_API_URL` and `CORS_ORIGIN` to use the new API domain.
5. Redeploy both services.

---

## Troubleshooting

### Vercel (web)

- **API calls go to localhost or fail**: `NEXT_PUBLIC_API_URL` is baked in at **build** time. Set it in the Vercel project for Production (and Preview if needed), then trigger a new deployment.
- **CORS errors in the browser**: Your API’s `CORS_ORIGIN` must include the exact Vercel origin (e.g. `https://your-project.vercel.app`). Use a comma-separated list if you use multiple front-end URLs.

### Railway (all services)

- **`secret JWT_REFRESH_SECRET: not found`** (or similar): Railway requires all env vars used by the API to exist **before** the build. In your API service → **Variables**, add every variable from the table in Phase 3, including:
  - `DATABASE_URL`
  - `JWT_SECRET` (e.g. a random 32+ char string)
  - `JWT_REFRESH_SECRET` (e.g. a different random 32+ char string)
  - `CORS_ORIGIN` (use a placeholder like `https://placeholder.up.railway.app` until the web URL exists, then update)
  - `FRONTEND_URL` (set to your web app URL so setup-password links point to the frontend)
  - `PORT` = `3001`
- **CORS errors**: Ensure your web origin is listed in `CORS_ORIGIN` (including `https://`). For multiple front-end URLs, use a comma-separated list.
- **Database connection**: Use Railway's variable reference to link the PostgreSQL service, e.g. `${{Postgres.DATABASE_URL}}`. Replace `Postgres` with your database service name.
- **Build fails**: Check that Root Directory is set correctly (`apps/api` or `apps/web`).
- **Prisma errors**: Ensure the build command includes `npx prisma generate` before `npm run build`.
- **Deployments not updating** (code changes pushed but live site shows old version):
  1. **Force a fresh build**: In the Web service → **Variables**, add `NO_CACHE=1` (temporary). Redeploy. Remove it after a successful deploy if you want faster builds.
  2. **Watch Paths**: Clear the Watch Paths field so any repo change triggers a deploy, or ensure it matches your Root Directory (e.g. `apps/web/**`).
  3. **Branch**: Confirm **Settings** → **Source** is set to the branch you push to (e.g. `main`).
  4. **Manual redeploy**: In **Deployments**, click **⋮** on the latest deployment → **Redeploy**.
  5. **Browser cache**: Hard refresh (Ctrl+Shift+R) or open incognito when checking the live site.
