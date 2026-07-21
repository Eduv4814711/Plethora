# Plethora ERP Railway Deployment

Plethora ERP is deployed on Railway only.

## Architecture

Railway project: `Plethora ERP`

Services:

- `api` — Fastify app in `apps/api`
- `web` — Next.js app in `apps/web`
- `postgres` — Railway managed PostgreSQL

Public domains:

- Web: `https://plethora.quickbophasecurity.co.za`
- API: Railway-generated URL first, later `https://api.quickbophasecurity.co.za`

Browser requests use the web service's same-origin `/api` proxy. At build time,
`NEXT_PUBLIC_API_URL` and optional `NEXT_PUBLIC_API_PATH_PREFIX` configure that
proxy's upstream API origin, which keeps auth cookies on the web origin.

## Why Services Use Repo Root

This repo is an npm workspaces monorepo with a root `package-lock.json`.
Railway should install from the repo root so `npm ci` can resolve both
workspaces correctly.

Use this setup for both Railway services:

- Root directory: repo root, leave Railway Root Directory blank or set `/`
- Builder: Railpack
- Config-as-code path: service-specific `railway.toml`

Do not set the service root to `apps/api` or `apps/web` unless the install
strategy is redesigned around separate lockfiles.

## Connect GitHub To Railway

1. In Railway, create a project named `Plethora ERP`.
2. Add a new service from the GitHub repository for `api`.
3. Add another service from the same repository for `web`.
4. Add Railway PostgreSQL.
5. For both GitHub-backed services, enable **Wait for CI** in the service deployment settings. A production deployment must remain waiting until the repository's `Production readiness` GitHub Actions workflow succeeds; a failed workflow must skip the deployment.

Do not enable production autodeploy without **Wait for CI**. The API pre-deploy migration changes the production database, so allowing Railway to start a deployment while the same commit is still being tested creates an avoidable race between validation and migration.

## API Service

Settings:

- Root directory: repo root, blank or `/`
- Config-as-code path: `apps/api/railway.toml`
- Builder: Railpack
- Build command: `npm run build --workspace=api`
- Pre-deploy command: `cd apps/api && npm run db:migrate:deploy`
- Start command: `cd apps/api && npm run start:server`
- Healthcheck path: `/health`

Variables:

```bash
NODE_ENV=production
HOST=0.0.0.0
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<long random secret>
JWT_REFRESH_SECRET=<different long random secret>
FRONTEND_URL=https://plethora.quickbophasecurity.co.za
CORS_ORIGIN=https://plethora.quickbophasecurity.co.za
TRUST_PROXY=true
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_API_VERSION=v21.0
ENCRYPTION_KEY=<required app format>
CLOCK_IN_WINDOW_MINUTES=15
CRON_SECRET=<long random secret>
```

WhatsApp is optional, but its production configuration is all-or-nothing:

- To enable it, set `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_VERIFY_TOKEN`, and `WHATSAPP_APP_SECRET`. Obtain the app secret from
  **Meta App Dashboard > App settings > Basic**; it is not the access token or
  the verify token.
- To disable it, remove all four variables from the Railway API service.
  `WHATSAPP_API_VERSION` may remain set.

Older deployments that were configured with only the first three WhatsApp
variables must add `WHATSAPP_APP_SECRET` (or remove all four variables) before
deploying a release that verifies webhook signatures.

Do not define `PORT`; Railway injects it. The API code reads
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

Railway runs that command in the pre-deploy phase. If it fails, the new
deployment does not start. The runtime start path is:

```bash
npm run start:server --workspace=api
```

This separation avoids running migrations concurrently when the API is scaled
to more than one replica.

### Required database release gate

Before the first production deployment of a new migration:

1. Enable Railway PostgreSQL backups or point-in-time recovery and verify that a current restore point is visible. Rehearse restoration to a separate service; an untested backup is not a rollback plan.
2. Restore or copy representative production data into an isolated staging database and run `npm run db:migrate:deploy` there first.
3. On that staging clone, confirm `btree_gist` is available and can be installed by the deployment database role. The leave migration installs it inside the same transaction as the schema changes so a permission failure rolls back the whole migration.
4. Run `npm run db:migrate:status` against the intended target and save the output with the release record.
5. Review the users matched by the `20260721130000_hr_payroll_role_titles` migration before deployment. It promotes only title-matched users who already have employee/payroll write access and writes each previous role to `AuditLog`, but the affected list still requires an HR/security owner sign-off.
6. Record the migration start time and the verified restore point, then allow the CI-gated Railway deployment to proceed.

If a migration fails, do not use `db:push` and do not blindly rerun it. Preserve the deployment log, inspect `_prisma_migrations` and the actual schema, and compare them with the migration SQL. These leave migrations are transaction-wrapped, so first verify that their DDL rolled back. Use `prisma migrate resolve --rolled-back <migration-name>` only after confirming rollback or completing deliberate cleanup; use `--applied` only after independently proving that every statement is present. Restore to the verified backup/PITR point when the schema cannot be reconciled safely.

## Web Service

Settings:

- Root directory: repo root, blank or `/`
- Config-as-code path: `apps/web/railway.toml`
- Builder: Railpack
- Build command: `npm run build --workspace=web`
- Start command: `cd apps/web && npm exec next start -- --hostname 0.0.0.0 --port $PORT`
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
CORS_ORIGIN=https://plethora.quickbophasecurity.co.za,https://admin.quickbophasecurity.co.za
```

Production accepts exact HTTPS origins only. Add `http://localhost:3000` only to a non-production development environment.

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

Railway deploys from GitHub. Before pushing to the connected production branch, confirm that **Wait for CI** is enabled for both services and that the company-specific leave cutover gates in `docs/leave-management-review.md` have been completed. Push the reviewed commit:

```bash
git push
```

Railway should show the deployment as `WAITING` while the `Production readiness` workflow runs. Continue only when that workflow succeeds. A failure must leave the deployment `SKIPPED`; fix the failure rather than manually deploying the same commit.

Railway will rebuild only the service affected by its watch patterns:

- API watches `apps/api/**`, root package metadata, and Node version files.
- Web watches `apps/web/**`, root package metadata, and Node version files.

## Troubleshooting

Build fails on dependency install:

- Confirm Root Directory is repo root.
- Confirm `package-lock.json` is present at repo root.
- Do not add a second `npm ci` in Railway build commands; Railpack handles install.

API deploy fails during migration:

- Check `DATABASE_URL` references the Railway PostgreSQL service.
- Check the PostgreSQL service is running.
- Confirm a current, tested backup or PITR restore point exists before taking corrective action.
- Inspect `npm run db:migrate:status` and the failed row in `_prisma_migrations`; do not repeatedly rerun or mark a migration resolved without checking the actual schema.
- Run `npm run db:migrate:deploy --workspace=api` only against the intended Railway database.
- Do not use `db:push` in production.

API starts but Railway says it cannot respond:

- Confirm pre-deploy uses `npm run db:migrate:deploy` and start uses `npm run start:server`.
- Confirm logs show the API listening on `0.0.0.0` and Railway's `PORT`.
- Confirm `/health` returns `{"status":"ok","service":"plethora-api"}`.

JWT or environment validation fails:

- `JWT_SECRET` and `JWT_REFRESH_SECRET` must be different, non-placeholder values.
- In production they must be at least 32 characters.
- `DATABASE_URL` and `CORS_ORIGIN` are required.

WhatsApp environment validation fails:

- The startup error lists the missing variable names without exposing values.
- To enable WhatsApp, set all four required credentials listed in the variables
  section above. `WHATSAPP_APP_SECRET` comes from Meta App settings, not from the
  webhook verify token.
- To disable WhatsApp, remove all four credential variables and redeploy.
  `WHATSAPP_API_VERSION` may remain set.
- If the pre-deploy log says all migrations were successfully applied, do not
  roll them back or use `db:push`; correcting the environment and redeploying is
  sufficient.

Web build succeeds but calls the wrong API:

- Confirm `NEXT_PUBLIC_API_URL` is set before build.
- Confirm `NEXT_PUBLIC_API_PATH_PREFIX` is empty for the Railway API root.
- Redeploy the web service after changing `NEXT_PUBLIC_*`.

CORS errors:

- Confirm `CORS_ORIGIN` exactly matches the browser origin, including scheme.
- For multiple origins, use comma-separated values without wildcard production CORS.

Uploads:

- Attach a Railway Volume to the API service at `/data/uploads` before launch.
- The API automatically uses Railway's `RAILWAY_VOLUME_MOUNT_PATH`. Set
  `UPLOADS_DIR` only when intentionally overriding that mount.
- A volume is tied to one service instance; use object storage before enabling
  multiple API replicas.

PDF generation:

- Puppeteer may require additional system packages in the Railway build/runtime.
- Check API runtime logs for Chromium or executable-path errors if PDF features fail.

## Scheduled auto-roster (cron)

The API exposes an internal endpoint for daily automatic rostering:

```http
POST /internal/cron/auto-roster
Authorization: Bearer <CRON_SECRET>
```

### API service variables

Add to the **api** service:

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Shared secret (min 16 chars). Requests without a matching `Authorization: Bearer` token receive `401`. If unset, the endpoint returns `503`. |

Generate a strong random value, e.g. `openssl rand -hex 32`.

### Railway Cron Job

1. In the Railway project, add a **Cron** service (or use Railway's cron trigger on a lightweight worker).
2. Schedule: daily at 02:00 UTC (adjust per company timezone later).
3. Command / HTTP job: `POST` to `https://api.<your-domain>/internal/cron/auto-roster` with header `Authorization: Bearer $CRON_SECRET`.
4. Use the same `CRON_SECRET` value on the API service.

The job calls `runGlobalAutoRoster()`, which processes all companies and every site with `autoRosterEnabled`.

### Verify

```bash
curl -sS -X POST "https://api.example.com/internal/cron/auto-roster" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expect `200` with `{ "ok": true, "companiesProcessed": N, "result": ... }`.

See [docs/ROSTER_ENGINE.md](./docs/ROSTER_ENGINE.md) for payroll calendar and coverage-threshold behaviour.

