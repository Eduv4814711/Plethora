# Plethora ERP Railway Deployment

Plethora ERP is deployed on Railway only.

## Architecture

Railway project: `Plethora ERP`

Services:

- `api` — Fastify app in `apps/api`
- `web` — Next.js app in `apps/web`
- `postgres` — Railway managed PostgreSQL
- `redis` — optional Railway Redis if a feature needs `REDIS_URL`

Public domains:

- Web: `https://plethora.quickbophasecurity.co.za`
- API: Railway-generated URL first, later `https://api.quickbophasecurity.co.za`

The frontend calls the backend through `NEXT_PUBLIC_API_URL` and optional
`NEXT_PUBLIC_API_PATH_PREFIX`. The Railway production default is an external API
origin, not same-origin `/api`.

## Why Services Use Repo Root

This repo is an npm workspaces monorepo with a root `package-lock.json`.
Railway should install from the repo root so `npm ci` can resolve both
workspaces correctly.

Use this setup for both Railway services:

- Root directory: repo root, leave Railway Root Directory blank or set `/`
- Builder: Nixpacks
- Config-as-code path: service-specific `railway.toml`

Do not set the service root to `apps/api` or `apps/web` unless the install
strategy is redesigned around separate lockfiles.

## Connect GitHub To Railway

1. In Railway, create a project named `Plethora ERP`.
2. Add a new service from the GitHub repository for `api`.
3. Add another service from the same repository for `web`.
4. Add Railway PostgreSQL.
5. Add Railway Redis only if a feature needs it.

## API Service

Settings:

- Root directory: repo root, blank or `/`
- Config-as-code path: `apps/api/railway.toml`
- Build command: `npm run build --workspace=api`
- Start command: `cd apps/api && npm run start:with-migrate`
- Healthcheck path: `/health`

Variables:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_SECRET=<long random secret>
JWT_REFRESH_SECRET=<different long random secret>
JWT_EXPIRES_IN=7d
FRONTEND_URL=https://plethora.quickbophasecurity.co.za
CORS_ORIGIN=https://plethora.quickbophasecurity.co.za
API_URL=https://plethora-api-production.up.railway.app
TRUST_PROXY=true
UPLOADS_DIR=/tmp/uploads
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_API_VERSION=v20.0
ENCRYPTION_KEY=<required app format>
CLOCK_IN_WINDOW_MINUTES=15
```

If Redis is not provisioned, omit `REDIS_URL`.

`PORT` may be left unset because Railway injects it. The API code reads
`process.env.PORT` through validated env, defaults to `3001`, and binds to
`0.0.0.0`.

## PostgreSQL

1. In Railway, add PostgreSQL to the `Plethora ERP` project.
2. On the API service, set `DATABASE_URL` to the PostgreSQL service reference,
   usually `${{Postgres.DATABASE_URL}}`.
3. Do not create or run production PostgreSQL locally for Railway.

Prisma uses `DATABASE_URL`. Production migration command:

```bash
npm run db:migrate:deploy --workspace=api
```

The API production start path is:

```bash
npm run start:with-migrate --workspace=api
```

That runs:

```bash
prisma migrate deploy && node dist/index.js
```

## Redis

Redis is optional. Add Railway Redis only when an app feature needs it.

If used, set:

```bash
REDIS_URL=${{Redis.REDIS_URL}}
```

## Web Service

Settings:

- Root directory: repo root, blank or `/`
- Config-as-code path: `apps/web/railway.toml`
- Build command: `npm run build --workspace=web`
- Start command: `cd apps/web && npm run start`
- Healthcheck path: `/`

Variables for the Railway-generated API URL:

```bash
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://plethora-api-production.up.railway.app
NEXT_PUBLIC_API_PATH_PREFIX=
```

After the custom API domain is active:

```bash
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.quickbophasecurity.co.za
NEXT_PUBLIC_API_PATH_PREFIX=
```

The final browser calls should be:

- `https://plethora-api-production.up.railway.app/health`
- `https://plethora-api-production.up.railway.app/auth/login`
- Later: `https://api.quickbophasecurity.co.za/health`
- Later: `https://api.quickbophasecurity.co.za/auth/login`

Redeploy the web service after changing any `NEXT_PUBLIC_*` variable because
Next.js inlines those values at build time.

## CORS

For production, do not use wildcard CORS.

Set the API service:

```bash
CORS_ORIGIN=https://plethora.quickbophasecurity.co.za
```

Multiple origins are comma-separated:

```bash
CORS_ORIGIN=https://plethora.quickbophasecurity.co.za,http://localhost:3000
```

## Health And Connectivity Tests

API health:

```bash
curl https://<railway-api-domain>/health
```

Expected response:

```json
{"status":"ok","service":"plethora-api"}
```

Frontend-to-API:

1. Open the web service URL.
2. Open browser DevTools Network tab.
3. Confirm login or health checks call the configured API origin.
4. Confirm there are no CORS errors.
5. Confirm `POST /auth/login` reaches the API origin without duplicate slashes,
   missing slashes, `undefined`, or duplicate path prefixes.

## Custom Domains

Configure domains in the Railway dashboard:

1. Add `plethora.quickbophasecurity.co.za` to the `web` service.
2. Add `api.quickbophasecurity.co.za` to the `api` service when ready.
3. Railway will provide the DNS target or verification details for each custom
   domain. This is usually a CNAME target, but follow the exact Railway
   dashboard instructions.

## Afrihost DNS

In Afrihost DNS, create or update records using the targets Railway provides.

Typical setup:

- `plethora.quickbophasecurity.co.za` — CNAME or verification record provided by Railway for the web service.
- `api.quickbophasecurity.co.za` — CNAME or verification record provided by Railway for the API service.

Copy Railway's DNS target exactly into Afrihost. Wait for DNS propagation, then
verify the custom domain in Railway.

## Deploy Updates

Railway deploys from GitHub. Push to the connected branch:

```bash
git push
```

Railway will rebuild only the service affected by its watch patterns:

- API watches `apps/api/**`, `package.json`, `package-lock.json`.
- Web watches `apps/web/**`, `package.json`, `package-lock.json`.

## Troubleshooting

Build fails on dependency install:

- Confirm Root Directory is repo root.
- Confirm `package-lock.json` is present at repo root.
- Do not add a second `npm ci` in Railway build commands; Nixpacks handles install.

API deploy fails during migration:

- Check `DATABASE_URL` references the Railway PostgreSQL service.
- Check the PostgreSQL service is running.
- Run `npm run db:migrate:deploy --workspace=api` only against the intended Railway database.
- Do not use `db:push` in production.

API starts but Railway says it cannot respond:

- Confirm the service uses `cd apps/api && npm run start:with-migrate`.
- Confirm logs show the API listening on `0.0.0.0` and Railway's `PORT`.
- Confirm `/health` returns `{"status":"ok","service":"plethora-api"}`.

JWT or environment validation fails:

- `JWT_SECRET` and `JWT_REFRESH_SECRET` must be different, non-placeholder values.
- In production they must be at least 32 characters.
- `DATABASE_URL` and `CORS_ORIGIN` are required.

Web build succeeds but calls the wrong API:

- Confirm `NEXT_PUBLIC_API_URL` is set before build.
- Confirm `NEXT_PUBLIC_API_PATH_PREFIX` is empty for the Railway API root.
- Redeploy the web service after changing `NEXT_PUBLIC_*`.

CORS errors:

- Confirm `CORS_ORIGIN` exactly matches the browser origin, including scheme.
- For multiple origins, use comma-separated values without wildcard production CORS.

Uploads:

- The example uses `UPLOADS_DIR=/tmp/uploads`, which is ephemeral.
- Add a Railway Volume and point `UPLOADS_DIR` at the mounted path if upload
  persistence is required.

PDF generation:

- Puppeteer may require additional system packages in the Railway build/runtime.
- Check API runtime logs for Chromium or executable-path errors if PDF features fail.
