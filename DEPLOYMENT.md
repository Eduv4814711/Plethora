# Deploy Plethora

This document describes deploying Plethora to **Railway** (web, API, and PostgreSQL). For running the stack on your machine, see the [README](README.md).

**Railway:** deploy the API and web services with the root **Dockerfiles** and per-app **`railway.toml`** files ([`Dockerfile.api`](Dockerfile.api), [`Dockerfile.web`](Dockerfile.web), [`apps/api/railway.toml`](apps/api/railway.toml), [`apps/web/railway.toml`](apps/web/railway.toml)). That is the supported path for this monorepo (lockfile and workspaces at the repo root). A short **Nixpacks** fallback is at the [end of this document](#nixpacks-fallback-not-recommended) only if you cannot use Docker.

**Google Cloud Run (Docker):** use the same root `Dockerfile.api` and `Dockerfile.web` with a monorepo build context; see [docs/CLOUD_RUN.md](docs/CLOUD_RUN.md) for build/push/deploy examples, env vars, and uploads/PDF caveats.

---

## Deploy on Railway

All components (web, API, database) run in one Railway project.

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

## How Railway builds Plethora (Docker)

Plethora is an **npm workspace monorepo**. On Railway, use the **Dockerfile** builder with the **repository root** as the build context (leave **Root Directory** blank or `/`) so `package.json`, `package-lock.json`, and both workspaces are visible to the image build.

- **Images:** root [`Dockerfile.api`](Dockerfile.api) (API) and [`Dockerfile.web`](Dockerfile.web) (web).
- **Config-as-code:** set **Config-as-code path** to [`apps/api/railway.toml`](apps/api/railway.toml) or [`apps/web/railway.toml`](apps/web/railway.toml). Each file sets `builder = "DOCKERFILE"`, pins the Dockerfile path, defines **watch patterns**, and (for the API) sets `healthcheckPath = "/health"` in [`apps/api/railway.toml`](apps/api/railway.toml).
- **Commands:** leave Railway **Build Command** / **Start Command** empty; the Dockerfiles run `npm ci`, workspace builds, and the correct start commands (API: `prisma migrate deploy` before `node dist/index.js`; web: `next start` on `$PORT`).

Do not set **Root Directory** to `apps/api` or `apps/web` when using this Docker path—that would shrink the build context and break the Dockerfiles.

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
3. Open the API service **Settings** and configure the **Dockerfile** path (see [How Railway builds Plethora (Docker)](#how-railway-builds-plethora-docker)):
   - **Root Directory**: repo root (blank or `/`).
   - **Builder**: Dockerfile (driven by [`apps/api/railway.toml`](apps/api/railway.toml)).
   - **Config-as-code path**: `apps/api/railway.toml` (pins `Dockerfile.api`, `/health`, and watch patterns).
   - **Build / Start Command**: leave blank.

4. Go to **Variables** and add:

   | Variable | Value |
   |----------|-------|
   | DATABASE_URL | `${{Postgres.DATABASE_URL}}` (or your PostgreSQL service name – use Railway's variable reference) |
   | JWT_SECRET | Random 32+ character string |
   | JWT_REFRESH_SECRET | Random 32+ character string |
   | NODE_ENV | `production` (the API Dockerfile sets this; omit if already set by the image) |
   | CORS_ORIGIN | Your web app URL (e.g. `https://your-app.up.railway.app`) – set after Phase 4 |
   | FRONTEND_URL | Your web app URL (e.g. `https://your-web.up.railway.app`) for invite/setup-password links |
   | PORT | Leave unset on Railway — Railway injects `$PORT` and the API binds to it. Only set if you self-host. |

5. Go to **Settings** → **Networking** → **Generate Domain** to get a public URL for the API.
6. Deploy. Copy the API domain (e.g. `https://your-api.up.railway.app`).

---

## Phase 4: Deploy Web Service

1. Click **+ New** → **GitHub Repo**.
2. Select the same repository.
3. Open the Web service **Settings** and configure the **Dockerfile** path (see [How Railway builds Plethora (Docker)](#how-railway-builds-plethora-docker)):
   - **Root Directory**: repo root (blank or `/`).
   - **Builder**: Dockerfile (driven by [`apps/web/railway.toml`](apps/web/railway.toml)).
   - **Config-as-code path**: `apps/web/railway.toml` (pins `Dockerfile.web` and watch patterns).
   - **Build / Start Command**: leave blank.
   - Railway passes this service’s **Variables** as Docker build args, so set `NEXT_PUBLIC_API_URL` (below) **before** the first build so it is baked into the client bundle and the `/api/*` rewrite.

4. Go to **Variables** and add:

   | Variable | Value |
   |----------|-------|
   | NEXT_PUBLIC_API_URL | Your API domain from Phase 3 (e.g. `https://your-api.up.railway.app`). Required **before** the first build — Next.js bakes it into the client bundle and the `/api/*` rewrite. |
   | NEXT_PUBLIC_API_PATH_PREFIX | Leave empty unless the API is served behind a path prefix (uncommon for Railway). |

5. Go to **Settings** → **Networking** → **Generate Domain** to get a public URL for the web app.
6. **Update API CORS**: Go back to the API service → **Variables** → set `CORS_ORIGIN` to the web app domain (e.g. `https://your-web.up.railway.app`).
7. Redeploy the API so the new CORS origin takes effect. If you change `NEXT_PUBLIC_API_URL` later, **redeploy the web service** as well so the new value is rebuilt into the client bundle.

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
- **Build fails (Dockerfile)**: Keep **Root Directory** at the repo root (blank or `/`) so the context includes `package.json`, `package-lock.json`, and both workspaces. Confirm **Config-as-code path** is `apps/api/railway.toml` or `apps/web/railway.toml`. If you are on the [Nixpacks fallback](#nixpacks-fallback-not-recommended) instead, Root Directory must be `apps/api` or `apps/web`.
- **Prisma errors**: The API Dockerfile runs `prisma generate` via the workspace build. If you bypass Docker, ensure `npx prisma generate` runs before `npm run build` in the API service.
- **Web API calls go to the wrong host**: `NEXT_PUBLIC_API_URL` is baked in at **build** time. Set it on the web service, then redeploy the web app. With Docker on Railway, service variables are passed as build args automatically.
- **Deployments not updating** (code changes pushed but live site shows old version):
  1. **Force a fresh build**: In the Web service → **Variables**, add `NO_CACHE=1` (temporary). Redeploy. Remove it after a successful deploy if you want faster builds.
  2. **Watch Paths**: Clear the Watch Paths field so any repo change triggers a deploy, or ensure it matches your Root Directory (e.g. `apps/web/**`).
  3. **Branch**: Confirm **Settings** → **Source** is set to the branch you push to (e.g. `main`).
  4. **Manual redeploy**: In **Deployments**, click **⋮** on the latest deployment → **Redeploy**.
  5. **Browser cache**: Hard refresh (Ctrl+Shift+R) or open incognito when checking the live site.

---

## Nixpacks fallback (not recommended)

Railway’s **Nixpacks** auto-builder can run with **Root Directory** `apps/api` or `apps/web` and the package’s usual `npm run build` / `npm start` (or `npm run start` for web). That is **not** the supported layout for this repo: the root **Dockerfiles** and [`apps/api/railway.toml`](apps/api/railway.toml) / [`apps/web/railway.toml`](apps/web/railway.toml) assume a **repo-root** build context and are what you should use on Railway.

If you cannot use Docker and must try Nixpacks: **API** — root `apps/api`, build `npm run build`, start `npm start`, health `/health`, optional watch `apps/api/**`. **Web** — root `apps/web`, use Nixpacks defaults (typically `npm run build` / `npm run start`), optional watch `apps/web/**`. Confirm `npx prisma generate` runs before the API TypeScript build if your script does not already include it.
