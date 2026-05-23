# AWS Environment Variables

Reference for configuring Plethora on **ECS Fargate** with **RDS**, **Secrets Manager**, and **SSM Parameter Store**.

Safe templates (no real values):

- [`apps/api/.env.aws.example`](../apps/api/.env.aws.example)
- [`apps/web/.env.aws.example`](../apps/web/.env.aws.example)

Related: [`AWS_DEPLOYMENT_READINESS.md`](AWS_DEPLOYMENT_READINESS.md) · [`WHATSAPP_PRODUCTION.md`](WHATSAPP_PRODUCTION.md)

---

## Overview

Plethora runs as **two ECS services** (API and Web). Environment configuration splits into three layers:

| Layer | Where | Examples |
|-------|--------|----------|
| **Docker build** | CI / `docker build` | `NEXT_PUBLIC_API_URL`, `DOCKER_BUILD=1` |
| **ECS task environment** | Task definition `environment` | `NODE_ENV`, `PORT`, `HOST`, `AWS_REGION` |
| **ECS task secrets** | Task definition `secrets` → Secrets Manager or SSM | `DATABASE_URL`, `JWT_SECRET`, `WHATSAPP_ACCESS_TOKEN` |

Never commit filled-in env files, `.env`, or secrets to Git. Use the `.env.aws.example` files as checklists only.

---

## Variables in ECS task definitions

### API service (`plethora-api`)

Inject at **runtime** via the ECS task definition.

| Variable | Task `environment` | Task `secrets` | Notes |
|----------|:------------------:|:--------------:|-------|
| `NODE_ENV` | ✓ | | `production` |
| `HOST` | ✓ | | `0.0.0.0` |
| `PORT` | ✓ | | Default `3001`; match container port mapping |
| `DATABASE_URL` | | ✓ | RDS connection string |
| `JWT_SECRET` | | ✓ | ≥32 chars |
| `JWT_REFRESH_SECRET` | | ✓ | Different from `JWT_SECRET`, ≥32 chars |
| `CORS_ORIGIN` | ✓ or ✓ | | Web origin(s); can be SSM String if not highly sensitive |
| `FRONTEND_URL` | ✓ | | Public web URL |
| `WHATSAPP_PHONE_NUMBER_ID` | | ✓ | If WhatsApp enabled |
| `WHATSAPP_ACCESS_TOKEN` | | ✓ | **Always a secret** |
| `WHATSAPP_VERIFY_TOKEN` | | ✓ | Must match Meta webhook config |
| `WHATSAPP_API_VERSION` | ✓ | | Default `v21.0` |
| `CLOCK_IN_WINDOW_MINUTES` | ✓ | | Default `15` |
| `ENCRYPTION_KEY` | | ✓ | Only if encrypted SMTP is used |
| `AWS_REGION` | ✓ | | e.g. `af-south-1` — for AWS SDK |
| `S3_BUCKET_NAME` | ✓ | | Future S3 uploads; empty until implemented |
| `S3_PUBLIC_BASE_URL` | ✓ | | e.g. CloudFront URL; empty until implemented |
| `RUN_MIGRATIONS` | ✓ | | `true` on **migration task only**; `false` on steady-state API tasks |
| `UPLOADS_DIR` | ✓ | | EFS mount path, e.g. `/app/apps/api/uploads` |

`PUPPETEER_EXECUTABLE_PATH` is set in `Dockerfile.api` and normally does not need a task override.

### Web service (`plethora-web`)

| Variable | When | Where |
|----------|------|--------|
| `NODE_ENV` | Runtime | Task `environment` → `production` |
| `PORT` | Runtime | Task `environment` → `3000` |
| `HOSTNAME` | Runtime | Set in `Dockerfile.web` (`0.0.0.0`); override only if needed |
| `NEXT_PUBLIC_API_URL` | **Build time** | Docker `build-arg` / GitHub Actions — **not** the running task |
| `NEXT_PUBLIC_API_PATH_PREFIX` | **Build time** | Docker `build-arg`; usually empty |
| `DOCKER_BUILD=1` | **Build time** | Set in `Dockerfile.web`; do **not** add to the running ECS task |

The web container does not need database or JWT secrets. Browser auth uses HttpOnly cookies set through the Next.js `/api` proxy.

### One-off migration task

Use the **same API image** with a separate task definition or `run-task` override:

```json
{
  "environment": [
    { "name": "NODE_ENV", "value": "production" },
    { "name": "RUN_MIGRATIONS", "value": "true" }
  ],
  "secrets": [
    { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..." }
  ],
  "command": ["npm", "run", "start"]
}
```

Or rely on `docker-api-entrypoint.sh` with `RUN_MIGRATIONS=true` and the default `npm run start` command. Run **one task** before or during deploy; do not set `RUN_MIGRATIONS=true` on every API replica.

---

## Secrets Manager vs SSM Parameter Store

### Store in Secrets Manager (recommended)

Use **Secrets Manager** for credentials that must rotate, leak easily, or grant access:

| Secret | Why |
|--------|-----|
| `DATABASE_URL` | Full RDS credentials |
| `JWT_SECRET` | Signs access tokens |
| `JWT_REFRESH_SECRET` | Signs refresh tokens |
| `WHATSAPP_ACCESS_TOKEN` | Meta API bearer token; long-lived |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification secret |
| `ENCRYPTION_KEY` | Decrypts stored SMTP passwords |

**ECS wiring example:**

```json
{
  "secrets": [
    {
      "name": "DATABASE_URL",
      "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:plethora/prod/database-url:DATABASE_URL::"
    },
    {
      "name": "JWT_SECRET",
      "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:plethora/prod/jwt:JWT_SECRET::"
    }
  ]
}
```

Grant the **ECS task execution role** `secretsmanager:GetSecretValue` on those ARNs. Prefer one JSON secret per service (`plethora/prod/api`) with multiple keys, or separate secrets per value — match your IaC convention.

Enable **automatic rotation** for `DATABASE_URL` when using RDS integration; update JWT secrets only with a coordinated redeploy (all API tasks must share the same values).

### Plain SSM Parameter Store (String)

Use **SSM String parameters** (not SecureString duplicates of Secrets Manager) for **non-secret** configuration that may change without redeploying images:

| Parameter | Example value |
|-----------|----------------|
| `/plethora/prod/AWS_REGION` | `af-south-1` |
| `/plethora/prod/CORS_ORIGIN` | `https://app.example.com` |
| `/plethora/prod/FRONTEND_URL` | `https://app.example.com` |
| `/plethora/prod/WHATSAPP_API_VERSION` | `v21.0` |
| `/plethora/prod/CLOCK_IN_WINDOW_MINUTES` | `15` |
| `/plethora/prod/S3_BUCKET_NAME` | `plethora-prod-uploads` |
| `/plethora/prod/S3_PUBLIC_BASE_URL` | `https://cdn.example.com` |

Reference in ECS task definition:

```json
{
  "name": "CORS_ORIGIN",
  "valueFrom": "arn:aws:ssm:REGION:ACCOUNT:parameter/plethora/prod/CORS_ORIGIN"
}
```

**Rule of thumb:** if exposure would compromise the system or user data → **Secrets Manager**. If it is public or low-risk config → **SSM String** or inline task `environment`.

Do **not** put `WHATSAPP_ACCESS_TOKEN`, `JWT_*`, or `DATABASE_URL` in plain SSM String parameters or task `environment` blocks.

---

## CORS_ORIGIN and FRONTEND_URL

### CORS_ORIGIN

Required in production (`apps/api/src/lib/env.ts`). The API rejects startup without it when `NODE_ENV=production`.

- Set to the **exact browser origin** of the web app: scheme + host + port (if non-default), **no path**, **no trailing slash**.
- Example: `https://app.example.com`
- Multiple origins: comma-separated, e.g. `https://app.example.com,https://staging.example.com`

The web client calls `/api/*` on the **same origin** (Next.js rewrite). `CORS_ORIGIN` must still list that web origin because preflight and credentialed responses are validated against it.

### FRONTEND_URL

Used for links in emails and invite flows (setup-password, etc.). Set to the **public web URL** users open in a browser:

- Example: `https://app.example.com`
- Usually the same hostname as `CORS_ORIGIN` when there is a single web app
- Does not need to be comma-separated; use one canonical URL

### AWS layout example

| Hostname | Service | Purpose |
|----------|---------|---------|
| `app.example.com` | Web ALB → ECS web | UI; `CORS_ORIGIN` and `FRONTEND_URL` |
| `api.example.com` | API ALB → ECS API | Direct API + WhatsApp webhook `/webhook` |

Build the web image with:

```bash
NEXT_PUBLIC_API_URL=https://api.example.com npm run docker:build:web
```

---

## Why DATABASE_URL must point to RDS

1. **Production data store** — Plethora persists all tenant data in PostgreSQL via Prisma. ECS tasks are ephemeral; the database must live outside the container on **Amazon RDS PostgreSQL** (same major version as CI, e.g. 16).

2. **Network isolation** — RDS sits in **private subnets**. ECS tasks connect over the VPC; the URL uses the RDS endpoint, not `localhost`.

3. **Durability and ops** — RDS provides automated backups, Multi-AZ option, and patching. Task restarts or redeploys must not destroy data.

4. **Migrations** — Production schema changes use `prisma migrate deploy` (see `scripts/docker-api-entrypoint.sh`). The migration task and API tasks must share the **same** `DATABASE_URL`.

5. **Connection string format** — Example:

   ```
   postgresql://plethora_app:PASSWORD@plethora-prod.xxxx.af-south-1.rds.amazonaws.com:5432/plethora?schema=public&sslmode=require
   ```

   Store the full string in Secrets Manager. Restrict security groups so only ECS tasks (and admin bastion) reach port 5432.

Do not use SQLite, container-local Postgres, or `prisma db push` in production.

---

## Why WHATSAPP_ACCESS_TOKEN must never be committed

1. **It is a live API credential** — Anyone with the token can send WhatsApp messages as your business, read message metadata, and incur Meta billing.

2. **Long-lived in production** — Production uses a **System User permanent token**, not a short-lived dev token. A leaked token remains valid until revoked in Meta Business Manager.

3. **Git history is forever** — Committed secrets are copied to forks, CI logs, and backups. Rotation after a leak requires Meta console work and redeploying all API tasks.

4. **Compliance** — Message content and employee phone numbers are sensitive; the token is the key to that channel.

**Safe practices:**

- Store only in **Secrets Manager** (or CI secret store for deploy pipelines)
- Reference via ECS task `secrets`; never in task `environment`, Dockerfiles, or `.env` files in Git
- Use [`apps/api/.env.aws.example`](../apps/api/.env.aws.example) with empty placeholders
- Add `apps/api/.env.aws` to local ignore if you maintain a filled copy for debugging
- Rotate immediately if a token appears in a commit, ticket, or chat

Webhook URL (`https://api.example.com/webhook`) is public; the **verify token** and **access token** are not.

---

## Quick checklist

### Before first ECS deploy (API)

- [ ] RDS instance created; security groups allow ECS → 5432
- [ ] `DATABASE_URL` in Secrets Manager
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` generated (≥32 chars, different)
- [ ] `CORS_ORIGIN` and `FRONTEND_URL` set to web URL
- [ ] Migration task run with `RUN_MIGRATIONS=true`
- [ ] ALB health check on `/health`

### Before first ECS deploy (Web)

- [ ] Web image built with correct `NEXT_PUBLIC_API_URL`
- [ ] Task definition sets `NODE_ENV=production`, `PORT=3000`
- [ ] ALB health check on `/`

### WhatsApp (optional)

- [ ] `WHATSAPP_*` secrets in Secrets Manager
- [ ] Meta webhook: `https://api.example.com/webhook`
- [ ] `WHATSAPP_VERIFY_TOKEN` matches Meta dashboard

---

## File reference

| File | Purpose |
|------|---------|
| `apps/api/.env.aws.example` | API variable checklist for AWS |
| `apps/web/.env.aws.example` | Web build + runtime checklist |
| `apps/api/.env.example` | Local / Railway development |
| `apps/web/.env.example` | Local development |
| `.env.example` | Root Docker / orchestration reference |
