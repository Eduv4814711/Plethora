# AWS Deployment Readiness Report

Audit date: 2026-05-23  
Scope: Phase 1 readiness review — documentation only; no runtime code changes.

---

## Current architecture summary

Plethora is an **npm workspace monorepo** (`apps/api`, `apps/web`) deployed as **two independent services**:

| Service | Stack | Default port | Health check |
|---------|-------|--------------|--------------|
| **API** | Fastify 4 · Prisma 5 · PostgreSQL | `3001` | `GET /health` → `{"status":"ok"}` |
| **Web** | Next.js 14 (App Router) · standalone Docker output | `3000` | `GET /` |

**Request flow (production):**

```
Browser → Web (ALB) → Next.js
                          ├─ static pages / SSR
                          └─ /api/* rewrite → API (ALB or internal)
```

- The web client always calls **`/api`** (relative). `apps/web/lib/api.ts` sets `API_BASE = "/api"` with `credentials: "include"` for HttpOnly refresh cookies and CSRF.
- `apps/web/next.config.js` rewrites `/api/:path*` to `NEXT_PUBLIC_API_URL/:path*`. In Docker/ECS, `NEXT_PUBLIC_API_URL` is a **build-time** argument (baked into the bundle and rewrite config).
- The API listens on **`HOST=0.0.0.0`** (default in `env.ts` and Dockerfiles) and is otherwise stateless.
- **WhatsApp** is split across route prefixes:
  - Meta webhook: **`GET/POST /webhook`** (API root — not under `/whatsapp`)
  - Dashboard/API routes: **`/whatsapp/*`** (send, contacts, messages, templates)
- **Uploads** are stored on the **local filesystem** under `UPLOADS_DIR` (default: `./uploads` relative to API cwd), served via `@fastify/static` at `/uploads/`.
- **Database**: PostgreSQL via Prisma. Active migrations live in `apps/api/prisma/migrations/` (5 migrations after baseline). `prisma migrate deploy` is the production path; `db push` is dev-only.
- **Current hosting**: Railway (Nixpacks + `railway.toml` per service), plus optional Docker/GCP (`Dockerfile.*`, `cloudbuild.yaml`).

---

## What already supports AWS deployment

### Build and container images

| Asset | AWS relevance |
|-------|---------------|
| [`Dockerfile.api`](../Dockerfile.api) | Multi-stage Node 24 image; Chromium for PDF; non-root user; `HEALTHCHECK` on `/health`; `VOLUME` for uploads |
| [`Dockerfile.web`](../Dockerfile.web) | Standalone Next.js output; build-args for `NEXT_PUBLIC_*`; `HEALTHCHECK` on `/` |
| [`scripts/docker-api-entrypoint.sh`](../scripts/docker-api-entrypoint.sh) | Optional `RUN_MIGRATIONS=true` → `prisma migrate deploy` before start |
| [`.dockerignore`](../.dockerignore) | Excludes secrets, tests, local uploads |
| [`.env.example`](../.env.example) | Orchestration env reference for Docker/ECS |

### Application runtime

| Area | Status |
|------|--------|
| **Env validation** (`apps/api/src/lib/env.ts`) | Production requires `DATABASE_URL`, JWT secrets (≥32 chars), and `CORS_ORIGIN`; fails fast at boot |
| **Binding** | `HOST` defaults to `0.0.0.0`; `PORT` configurable (ECS can inject `PORT` or use fixed container port) |
| **Health endpoint** | `/health` registered in `app.ts` — suitable for ALB target group |
| **Prisma on Linux** | `binaryTargets = ["native", "rhel-openssl-3.0.x"]` in schema — compatible with ECS Fargate (Amazon Linux) |
| **Migrations** | `db:migrate:deploy` in root and API scripts; CI applies migrations before tests |
| **Security middleware** | Helmet, rate limit, CORS, cookie auth with `secure` cookies in production |
| **PDF generation** | `Dockerfile.api` installs Chromium; `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` set in image |

### npm scripts (workspace)

**Root [`package.json`](../package.json):**

| Script | Purpose |
|--------|---------|
| `build` / `build:api` / `build:web` | Workspace builds |
| `db:generate` / `db:migrate` / `db:migrate:deploy` | Prisma via API workspace |
| `dev:api` / `dev:web` / `dev:all` | Local development (unchanged by AWS) |

**[`apps/api/package.json`](../apps/api/package.json):**

| Script | Purpose |
|--------|---------|
| `build` | `prisma generate && tsc && copy-templates` |
| `start` / `start:server` | `node dist/index.js` |
| `start:with-migrate` | `prisma migrate deploy && node dist/index.js` |
| `db:migrate:deploy` | Production migrations |

**[`apps/web/package.json`](../apps/web/package.json):**

| Script | Purpose |
|--------|---------|
| `build` | `next build` |
| `start` | `next start` (Docker uses standalone `node server.js` instead) |

### CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) validates install, Prisma generate, **`migrate deploy`**, build, and API tests against PostgreSQL 16 — a good pre-AWS gate. No Docker build or ECR push yet.

### Railway config (leave untouched)

These files support the existing Railway deployment and should **not** be removed or modified for AWS work:

- [`apps/api/railway.toml`](../apps/api/railway.toml) — Nixpacks build, `preDeployCommand` migrations, `/health` check
- [`apps/web/railway.toml`](../apps/web/railway.toml) — Nixpacks build, start from `apps/web`
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — Railway runbook

---

## Blockers and risks

### High priority

| Risk | Detail | Mitigation |
|------|--------|------------|
| **No AWS CI/CD or infra** | No ECR push workflow, ECS task definitions, or IaC in repo | Phase 2+: GitHub Actions (OIDC → ECR), task defs, optional Terraform/CDK |
| **Local filesystem uploads** | Logos, task attachments, academy documents write to disk via `uploadsRoot` | Single ECS task + EFS volume works short-term; multi-replica or zero-downtime deploys need **EFS** or **S3** backend |
| **WhatsApp webhook must hit API directly** | Meta calls `https://<api-host>/webhook`; cannot rely on Next.js `/api` rewrite | Dedicated API hostname on ALB (e.g. `api.example.com`); TLS via ACM |
| **`NEXT_PUBLIC_API_URL` is build-time** | Changing API URL requires **rebuilding** the web image | Bake stable API URL into web Docker build; document in ECS/CodePipeline |

### Medium priority

| Risk | Detail | Mitigation |
|------|--------|------------|
| **No `trustProxy` on Fastify** | Behind ALB, client IP and rate limiting may see the load balancer IP | Enable Fastify `trustProxy` when behind ALB (future code change) |
| **Migration timing** | Railway runs migrations in `preDeployCommand`; Docker uses `RUN_MIGRATIONS` in entrypoint | Prefer **one-off ECS task** or init container for `migrate deploy` to avoid race with multiple API tasks |
| **Upload URLs mix `/api` and `/uploads` paths** | Logo upload returns `/api/uploads/logos/...`; task attachments use `/uploads/tasks/...` | Works today via Next rewrite + static serving; S3 migration must preserve URL semantics |
| **Secrets not in `env.ts` schema** | `UPLOADS_DIR`, `RUN_MIGRATIONS`, `PUPPETEER_EXECUTABLE_PATH` read directly from `process.env` | Document in ECS task secrets/env; no validation gap for core secrets |
| **Docker image size / PDF** | Chromium adds image size and memory | Size Fargate tasks accordingly (≥1 GB RAM recommended for PDF paths) |

### Low priority

| Risk | Detail |
|------|--------|
| **`dotenv/config` in API entry** | Harmless on ECS when env is injected by task definition; `.env` not in image |
| **`migrations_archived/`** | Historical SQL only; not applied by `migrate deploy` — safe to ignore |
| **`ENCRYPTION_KEY` optional** | Required only if encrypted SMTP settings are used |
| **GCP `cloudbuild.yaml`** | Parallel deployment path; keep for reference |

---

## Required codebase changes (future phases)

No runtime changes in Phase 1. Recommended follow-up work:

| Phase | Change | Touches runtime? |
|-------|--------|------------------|
| **2** | GitHub Actions: build + push `Dockerfile.api` / `Dockerfile.web` to ECR | No |
| **2** | Docker build validation in CI (build both images on PR) | No |
| **3** | ECS task definition templates (API, Web, env/secrets placeholders) | No |
| **3** | `docs/DEPLOYMENT_AWS.md` operational runbook | No |
| **4** | ECS one-off migration task pattern (document + task def) | No |
| **5** | Fastify `trustProxy: true` when `TRUST_PROXY=true` (ALB) | Yes (small) |
| **6** | S3 upload adapter (optional; multi-replica production) | Yes |
| **6** | Link README §16 to AWS doc | No |

---

## Recommended AWS services

| Concern | AWS service | Notes |
|---------|-------------|-------|
| **Compute** | ECS Fargate | Two services: `plethora-api`, `plethora-web` |
| **Images** | ECR | Two repositories (or one repo, two tags) |
| **Database** | RDS PostgreSQL 16 | Same major version as CI; enable automated backups |
| **Load balancing** | ALB | Host-based routing: `api.*` → API TG, `app.*` → Web TG |
| **TLS** | ACM + Route 53 | Certificates for API and web hostnames |
| **Secrets** | Secrets Manager or SSM Parameter Store | JWT secrets, `DATABASE_URL`, WhatsApp tokens |
| **Logs** | CloudWatch Logs | FireLens or `awslogs` driver on task definitions |
| **Uploads (interim)** | EFS | Mount at `/app/apps/api/uploads` (matches Dockerfile `VOLUME`) |
| **Uploads (long-term)** | S3 + optional CloudFront | Requires code change in Phase 6 |
| **CI/CD** | GitHub Actions + OIDC | Push to ECR; deploy via ECS `update-service` or CodePipeline |
| **WhatsApp webhook** | Public API ALB listener | `https://api.<domain>/webhook` |

---

## Migration approach: current DB → AWS RDS

### Prerequisites

- RDS PostgreSQL 16 instance in the same VPC as ECS tasks (private subnets).
- Security group: ECS → RDS on port 5432 only.
- `DATABASE_URL` with TLS if RDS enforces SSL (`?sslmode=require`).

### Recommended steps

1. **Freeze writes** (maintenance window) or accept brief read-only period on source.
2. **Dump source database** (Railway Postgres or current host):
   ```bash
   pg_dump "$SOURCE_DATABASE_URL" \
     --format=custom \
     --no-owner \
     --no-acl \
     -f plethora.dump
   ```
3. **Create empty RDS instance**; note endpoint and master credentials.
4. **Restore to RDS**:
   ```bash
   pg_restore -d "$RDS_DATABASE_URL" --no-owner --no-acl plethora.dump
   ```
   For large databases, consider **AWS DMS** for minimal-downtime replication instead of dump/restore.
5. **Apply pending Prisma migrations** (idempotent if dump already includes schema):
   ```bash
   DATABASE_URL="$RDS_DATABASE_URL" npm run db:migrate:deploy --workspace=api
   ```
6. **Verify**: row counts, admin login, `/health`, sample payroll/roster query.
7. **Point API** at RDS via Secrets Manager `DATABASE_URL`; deploy API tasks.
8. **Cut over web** `NEXT_PUBLIC_API_URL` to production API URL; rebuild and deploy web image.
9. **Keep source DB** read-only for rollback until smoke tests pass.

### Prisma-specific notes

- Production must use **`prisma migrate deploy`**, never `db push`.
- Baseline migration `20240101000000_baseline` plus 4 incremental migrations are the active chain.
- Railway’s `preDeployCommand` and Docker’s `RUN_MIGRATIONS=true` both run `migrate deploy` — replicate one pattern on ECS (prefer dedicated migration task over every replica).

---

## WhatsApp webhook considerations

| Item | Value / requirement |
|------|---------------------|
| **Callback URL** | `https://<api-public-host>/webhook` (no trailing slash) |
| **Routes** | `GET /webhook` — Meta verification (`hub.verify_token` vs `WHATSAPP_VERIFY_TOKEN`); `POST /webhook` — inbound messages |
| **Not proxied via web** | Meta must reach the **API service** directly; configure ALB rule on API hostname |
| **TLS** | Meta requires HTTPS; terminate at ALB with ACM |
| **Env vars** | All three required for `whatsapp.enabled`: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` |
| **Token type** | Permanent System User token (not 24h temp token) — see [`docs/WHATSAPP_PRODUCTION.md`](WHATSAPP_PRODUCTION.md) |
| **Webhook field** | Subscribe to **messages** in Meta Developer Console |
| **Response time** | Handler returns `200` immediately; processing is async — suitable for Fargate |
| **DB dependency** | Inbound messages persist to `WhatsAppMessage`; RDS must be reachable before webhook traffic |
| **Rate limits** | API global rate limit (100/min) applies to webhook path — monitor if Meta sends bursts |

After cutover, update Meta webhook URL from Railway hostname to `https://api.<your-domain>/webhook` and re-verify.

---

## Production environment variables checklist

### API (ECS task / Secrets Manager)

| Variable | Required | Source | Notes |
|----------|----------|--------|-------|
| `NODE_ENV` | Yes | Plain | `production` |
| `DATABASE_URL` | Yes | Secret | RDS connection string |
| `JWT_SECRET` | Yes | Secret | ≥32 chars, not placeholder |
| `JWT_REFRESH_SECRET` | Yes | Secret | Different from `JWT_SECRET`, ≥32 chars |
| `CORS_ORIGIN` | Yes | Plain/Secret | Web origin(s), comma-separated, e.g. `https://app.example.com` |
| `FRONTEND_URL` | Recommended | Plain | Public web URL for invite/setup-password links |
| `HOST` | Optional | Plain | Default `0.0.0.0` |
| `PORT` | Optional | Plain | Default `3001`; map in task definition |
| `RUN_MIGRATIONS` | Deploy only | Plain | `true` on migration task; `false` on steady-state API tasks |
| `UPLOADS_DIR` | If using EFS | Plain | e.g. `/app/apps/api/uploads` |
| `WHATSAPP_PHONE_NUMBER_ID` | If WhatsApp | Secret | |
| `WHATSAPP_ACCESS_TOKEN` | If WhatsApp | Secret | Permanent token |
| `WHATSAPP_VERIFY_TOKEN` | If WhatsApp | Secret | Must match Meta webhook config |
| `WHATSAPP_API_VERSION` | Optional | Plain | Default `v21.0` |
| `PUPPETEER_EXECUTABLE_PATH` | In Docker | Plain | Set in `Dockerfile.api` to `/usr/bin/chromium` |
| `CLOCK_IN_WINDOW_MINUTES` | Optional | Plain | Default `15` |
| `ENCRYPTION_KEY` | If email SMTP | Secret | ≥16 chars |

### Web (ECS task — runtime)

| Variable | Required | Notes |
|----------|----------|-------|
| `NODE_ENV` | Yes | `production` |
| `HOSTNAME` | Optional | `0.0.0.0` (set in Dockerfile) |
| `PORT` | Optional | Default `3000` |

### Web (Docker build-args — not runtime)

| Build arg | Required | Notes |
|-----------|----------|-------|
| `NEXT_PUBLIC_API_URL` | Yes | Public API origin, e.g. `https://api.example.com` |
| `NEXT_PUBLIC_API_PATH_PREFIX` | Optional | Empty unless API is path-prefixed |

### GitHub Actions / CI (not production runtime)

| Variable | Purpose |
|----------|---------|
| `AWS_ROLE_ARN` | OIDC role for ECR push (future) |
| `AWS_REGION` | ECR/ECS region |
| `ECR_REGISTRY` | Image registry URL |

---

## File audit reference

| # | File | AWS readiness |
|---|------|---------------|
| 1 | Root `package.json` | ✅ Workspace scripts include `build:*`, `db:migrate:deploy` |
| 2 | `apps/api/package.json` | ✅ `start:with-migrate`, Prisma scripts, Node 24 engine |
| 3 | `apps/web/package.json` | ✅ Standard Next build/start; Docker uses standalone |
| 4 | `apps/web/next.config.js` | ✅ `/api` rewrite, standalone when `DOCKER_BUILD=1`, URL normalization |
| 5 | `apps/api/src/lib/env.ts` | ✅ Production validation; WhatsApp optional bundle |
| 6 | `apps/api/src/index.ts` | ✅ Binds `env.host`/`env.port`; fail-fast init |
| 7 | `apps/api/src/whatsapp/routes/webhook.ts` | ✅ Root `/webhook`; verify + async processing |
| 8 | Prisma schema/migrations | ✅ PostgreSQL, `migrate deploy` chain, Fargate binary target |
| 9 | Upload storage | ⚠️ Local FS only (`uploads-root.ts`, `@fastify/static`, multipart routes) |
| 10 | Railway config | ✅ Present; do not modify for AWS |

---

## Summary

The repo is **well prepared for containerized AWS deployment**: production Dockerfiles, health checks, Prisma migrate deploy, and environment validation are already in place. The main gaps are **AWS-specific automation** (ECR, ECS, secrets wiring), **durable shared storage for uploads**, and **operational docs** for ALB host routing (especially the WhatsApp webhook on the API hostname). Railway and local development paths can coexist unchanged.

**Suggested next phase:** add CI Docker image builds and an ECR publish workflow — no application code changes required.
