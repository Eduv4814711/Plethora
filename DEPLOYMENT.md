# Deploy Plethora

The **Next.js** dashboard (`apps/web`) can run on [Vercel](https://vercel.com). The **Fastify** API (`apps/api`) is easiest to host on a long-lived Node service (Railway, Render, Fly.io, a VM, or Kubernetes) with PostgreSQL. **Option C** documents an experimental **API on Vercel Serverless** path (Puppeteer + uploads have platform limits; see that section).

This document covers **Vercel + API elsewhere** (Option A), **all-in-one Railway** (Option B), and **web + API + Postgres on Vercel** (Option C).

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
   | `NEXT_PUBLIC_API_PATH_PREFIX` | Leave empty when the API serves routes at the origin root (`/health`, `/auth`, …). Set to **`/api`** when the API is deployed as Vercel Serverless (Option C) so browser rewrites target `…/api/health`, `…/api/auth`, … |

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

1. Open the Vercel URL; you should see the Plethora login page.
2. Call the API health endpoint at the path your API uses: root-hosted APIs use `GET <NEXT_PUBLIC_API_URL>/health`; Vercel Serverless (Option C) uses `GET <NEXT_PUBLIC_API_URL>/api/health` before the API strips the prefix internally.
3. If the UI loads but API calls fail, re-check `NEXT_PUBLIC_API_URL` (rebuild after changing it), `NEXT_PUBLIC_API_PATH_PREFIX` if you use Option C, and `CORS_ORIGIN`.

---

## Option C: Web + API + Postgres on Vercel

Use **two Vercel projects** (dashboard and API) plus **PostgreSQL** from the Vercel Marketplace (e.g. **Neon**). Expect **cold starts**, **function time/size limits**, **ephemeral `/tmp` for uploaded files** (logos and attachments are not durable across invocations unless you add object storage such as Vercel Blob or S3), and **PDF generation** tuned for serverless Chromium (`@sparticuz/chromium` + `puppeteer-core`).

### C.1 Database (Neon)

1. In the Vercel dashboard, open (or create) the **API** project, add **Neon Postgres** from the [Marketplace](https://vercel.com/marketplace), and link it so `DATABASE_URL` is available to that project.
2. Ensure `DATABASE_URL` is set for **Production** (and **Preview** if you use preview databases). The API **build** runs `prisma migrate deploy` (see [`apps/api/package.json`](apps/api/package.json) script `build:vercel`), so migrations apply at deploy time when this variable is present.

### C.2 API project (`apps/api`)

1. **Add New → Project**, import the same Git repository.
2. **Root Directory**: `apps/api`.
3. Leave **Install Command** / **Build Command** empty so Vercel uses [`apps/api/vercel.json`](apps/api/vercel.json): install runs `npm ci` from the monorepo root; build runs `npm run build:api:vercel` (generate client, migrate deploy, compile TypeScript, copy HTML templates).
4. **Environment variables** (minimum):

   | Name | Notes |
   |------|--------|
   | `DATABASE_URL` | From Neon (required for build and runtime). |
   | `JWT_SECRET` | Strong random string (not the dev default). |
   | `JWT_REFRESH_SECRET` | Different strong random string. |
   | `CORS_ORIGIN` | Comma-separated web origins, e.g. `https://your-web.vercel.app`. |
   | `FRONTEND_URL` | Primary browser URL for invite/password links (your web deployment). |

   Optional: WhatsApp variables from [docs/WHATSAPP_PRODUCTION.md](docs/WHATSAPP_PRODUCTION.md). Set the Meta webhook to **`https://<your-api>.vercel.app/api/webhook`** (the `/api` prefix matches how Vercel routes serverless functions).

5. Deploy and copy the API hostname (e.g. `https://plethora-api.vercel.app`).

### C.3 Web project (`apps/web`)

1. **Root Directory**: `apps/web` (see [`apps/web/vercel.json`](apps/web/vercel.json)).
2. Environment variables:

   | Name | Value |
   |------|--------|
   | `NEXT_PUBLIC_API_URL` | Same origin as C.2, **no trailing slash**, e.g. `https://plethora-api.vercel.app`. |
   | `NEXT_PUBLIC_API_PATH_PREFIX` | **`/api`** (required for this layout so `/api/*` rewrites target the API’s `/api/*` routes; the API strips `/api` before routing). |

3. Redeploy the web app whenever `NEXT_PUBLIC_API_URL` or `NEXT_PUBLIC_API_PATH_PREFIX` changes (they are baked in at build time; see [`apps/web/next.config.js`](apps/web/next.config.js)).

### C.4 Uploads on Vercel

With `VERCEL=1`, uploads go under **`/tmp`** (see [`apps/api/src/lib/uploads-root.ts`](apps/api/src/lib/uploads-root.ts)). Files are **not** guaranteed to persist. For production durability, plan **Vercel Blob** or another object store and adjust upload routes accordingly.

### C.5 Verify

1. `GET https://<api>.vercel.app/api/health` → `{"status":"ok"}`.
2. Open the web URL, sign in, and exercise PDF and attachment flows knowing `/tmp` and serverless timeouts may affect heavy use.

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

### Vercel (API, Option C)

- **404 on `GET /health`**: The serverless entry is mounted under `/api` on the deployment host. Use `GET /api/health`, and set **`NEXT_PUBLIC_API_PATH_PREFIX=/api`** on the web project so rewrites hit `/api/...` on the API origin.
- **Prisma “query engine not found” on Vercel**: The schema includes `binaryTargets` for Linux; run `npx prisma generate` locally after pulling changes, commit if you vendor nothing, and redeploy so the build regenerates the client.
- **Build fails at `prisma migrate deploy`**: The API Vercel project must have **`DATABASE_URL`** available at **build** time (Neon integration or manual env).

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
