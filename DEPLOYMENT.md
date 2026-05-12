# Deploy Plethora on Railway

This document covers hosting the **API** (Fastify + Prisma) and **Web** (Next.js) on [Railway](https://railway.app) using the **Nixpacks** builder and the **npm workspace** layout at the repository root.

For local development, see the [README](README.md).

---

## How the monorepo maps to Railway

Plethora is a single Git repo with workspaces `apps/api` and `apps/web`, and a root `package-lock.json`. Each Railway service clones the same repo and should use:

| | **API service** | **Web service** |
|---|-----------------|-----------------|
| **Root Directory** | Blank or `/` (repository root) | Same |
| **Builder** | Nixpacks (from config-as-code) | Same |
| **Config-as-code path** | `apps/api/railway.toml` | `apps/web/railway.toml` |

Do **not** point Root Directory at `apps/api` or `apps/web` alone: the lockfile and workspace install live at the repo root.

Each service’s `railway.toml` ([`apps/api/railway.toml`](apps/api/railway.toml), [`apps/web/railway.toml`](apps/web/railway.toml)) sets `builder = "NIXPACKS"`, a **`buildCommand`** that runs only the workspace **`npm run build`** (Nixpacks already runs **`npm ci`** in its install phase; duplicating `npm ci` in `buildCommand` can fail on Railway with `EBUSY` on `node_modules/.cache`), plus **watch patterns** and deploy commands. The API uses **`preDeployCommand`** for `prisma migrate deploy` so the process can start and serve `/health` without blocking on migrations in the same process.

---

## Phase 1: Project and GitHub

1. In [Railway](https://railway.app/dashboard), create a **New Project** → **Deploy from GitHub repo**.
2. Select this repository.

---

## Phase 2: PostgreSQL

1. In the project, **+ New** → **Database** → **PostgreSQL**.
2. Open the database service → **Variables** and note `DATABASE_URL` (or use Railway’s variable reference from the API service).

---

## Phase 3: API service

1. **+ New** → connect the same GitHub repo (or add a service from the repo).
2. **Settings**:
   - **Root Directory**: leave blank or `/`.
   - **Config-as-code path**: `apps/api/railway.toml`.
   - Leave dashboard **Build Command** / **Start Command** empty unless you need to override; `railway.toml` supplies them.

3. **Variables** (minimum):

   | Variable | Notes |
   |----------|--------|
   | `DATABASE_URL` | Reference the Postgres service, e.g. `${{Postgres.DATABASE_URL}}` (adjust service name to match yours). |
   | `JWT_SECRET` | Strong random string (32+ characters). |
   | `JWT_REFRESH_SECRET` | Different strong random string. |
   | `NODE_ENV` | `production` (required for production JWT checks in the API). |
   | `CORS_ORIGIN` | Web app origin(s), comma-separated if several. Use a placeholder until the web URL exists, then update. |
   | `FRONTEND_URL` | Public web URL (invite / setup-password links). |
   | `PORT` | Leave unset — Railway sets `PORT`. |

4. **Networking** → **Generate Domain** for the API.
5. Deploy and confirm logs: pre-deploy migrate succeeds, then `Plethora API running at…`, then `GET /health` returns `{"status":"ok"}`.

---

## Phase 4: Web service

1. **+ New** → same repository again for the frontend.
2. **Settings**:
   - **Root Directory**: blank or `/`.
   - **Config-as-code path**: `apps/web/railway.toml`.

3. **Variables** — set **`NEXT_PUBLIC_API_URL`** to the API’s public origin (with `https://`, or a bare hostname; see `apps/web/.env.example` and `next.config.js`) **before** the first successful build. Next.js bakes this into the client and into the `/api/*` rewrite.

   | Variable | Notes |
   |----------|--------|
   | `NEXT_PUBLIC_API_URL` | API public URL, e.g. `https://your-api.up.railway.app`. |
   | `NEXT_PUBLIC_API_PATH_PREFIX` | Leave empty unless the API is behind a path prefix. |

4. **Networking** → **Generate Domain** for the web app.
5. **API CORS**: On the API service, set `CORS_ORIGIN` (and `FRONTEND_URL` if needed) to the web URL, then redeploy the API.
6. If you change `NEXT_PUBLIC_API_URL` later, **redeploy the web service** so the bundle and rewrites rebuild.

---

## Phase 5: Smoke test

1. Open the web URL — login page should load.
2. `https://<api-domain>/health` should return `{"status":"ok"}`.

---

## WhatsApp (optional)

See [docs/WHATSAPP_PRODUCTION.md](docs/WHATSAPP_PRODUCTION.md) for `WHATSAPP_*` variables and Meta webhook URL on your API domain.

---

## Troubleshooting

- **Build fails on `npm ci`**: Ensure **Root Directory** is the repo root so `package-lock.json` is present. Both services share the same root.
- **`EBUSY: rmdir '/app/node_modules/.cache'`** (or similar during build): Caused by running **`npm ci` twice** when Nixpacks already ran install; our `railway.toml` `buildCommand` must be **`npm run build --workspace=…` only** (no leading `npm ci`).
- **`NEXT_PUBLIC_API_URL` / rewrites**: Must be valid for Next (full URL with scheme, or bare host per `apps/web/next.config.js`). Rebuild the web service after changes.
- **Prisma / pre-deploy**: If pre-deploy fails, the deployment stops; read the **pre-deploy** log section. If the API crashes at runtime, look for `FATAL: API failed to initialize` in logs (JWT, DB, etc.).
- **`FATAL: API failed to initialize` / `Invalid production JWT configuration`**: With **`NODE_ENV=production`** (Nixpacks sets this), the API requires **`JWT_SECRET`** and **`JWT_REFRESH_SECRET`** on the **API** service — two **different** random strings of **at least 32 characters** each. Set them under Railway → your API service → **Variables** (not only on Postgres or the web service). Redeploy after saving.
- **CORS**: `CORS_ORIGIN` must include the exact browser origin (scheme + host, no trailing path).
- **Uploads**: Default is local disk under the API process; attach a Railway **Volume** and set `UPLOADS_DIR` if you need persistence across deploys.
- **PDF / Puppeteer**: The API may need extra system packages or `PUPPETEER_EXECUTABLE_PATH`; not covered by the default Nixpacks Node image — plan accordingly if you use PDF features.
