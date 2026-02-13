# Deploy Plethora to Railway

This guide covers deploying Plethora to Railway. All components (web, API, database) run in one Railway project.

## Prerequisites

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
   - **Start Command**: `npx prisma db push --accept-data-loss && npx prisma db seed && node dist/index.js`
   - **Watch Paths**: `apps/api/**` (optional, for faster rebuilds)
4. Go to **Variables** and add:

   | Variable | Value |
   |----------|-------|
   | DATABASE_URL | `${{Postgres.DATABASE_URL}}` (or your PostgreSQL service name – use Railway's variable reference) |
   | JWT_SECRET | Random 32+ character string |
   | JWT_REFRESH_SECRET | Random 32+ character string |
   | CORS_ORIGIN | Your web app URL (e.g. `https://your-app.up.railway.app`) – set after Phase 4 |
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
2. Default login: `admin@quickbopha.com` / `admin123` (from seed).
3. Check API health: `https://your-api.up.railway.app/health` should return `{"status":"ok"}`.

---

## Phase 6: Custom Domains (Optional)

1. In each service (API and Web), go to **Settings** → **Networking** → **Custom Domain**.
2. Add your domain (e.g. `api.plethora.yourdomain.com`, `plethora.yourdomain.com`).
3. Add the CNAME records Railway provides to your DNS.
4. Update `NEXT_PUBLIC_API_URL` and `CORS_ORIGIN` to use the new API domain.
5. Redeploy both services.

---

## Troubleshooting

- **`secret JWT_REFRESH_SECRET: not found`** (or similar): Railway requires all env vars used by the API to exist **before** the build. In your API service → **Variables**, add every variable from the table in Phase 3, including:
  - `DATABASE_URL`
  - `JWT_SECRET` (e.g. a random 32+ char string)
  - `JWT_REFRESH_SECRET` (e.g. a different random 32+ char string)
  - `CORS_ORIGIN` (use a placeholder like `https://placeholder.up.railway.app` until the web URL exists, then update)
  - `PORT` = `3001`
- **CORS errors**: Ensure `CORS_ORIGIN` exactly matches your web URL (including `https://`).
- **Database connection**: Use Railway's variable reference to link the PostgreSQL service, e.g. `${{Postgres.DATABASE_URL}}`. Replace `Postgres` with your database service name.
- **Build fails**: Check that Root Directory is set correctly (`apps/api` or `apps/web`).
- **Prisma errors**: Ensure the build command includes `npx prisma generate` before `npm run build`.
