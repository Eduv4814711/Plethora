# Plethora ERP — Azure Migration And Deployment Research

Status: research / proposal. Nothing in this document has been provisioned.
Production today is Railway (see `DEPLOYMENT_RAILWAY.md`), which stays the
system of record until the cutover in section 12 completes.

---

## 1. What Plethora actually is (constraints that drive the design)

| Fact | Source | Consequence for Azure |
|------|--------|-----------------------|
| npm workspaces monorepo, root `package-lock.json`, `engines: node 24.x / npm 11.x` | `package.json` | Build must install from repo root. Node 24 is available on App Service Linux and in any container base image. |
| `apps/api` — Fastify 5, ESM, `tsc` build to `dist`, started with `node dist/index.js` | `apps/api/package.json` | Plain long-running Node HTTP server. Fits App Service or Container Apps. |
| `apps/web` — Next.js 16, `next start`, rewrites `/api/:path*` to the API origin, `NEXT_PUBLIC_API_URL` inlined **at build time** | `apps/web/next.config.js` | Needs a Node host (not Static Web Apps). Every API-origin change requires a rebuild, not just a restart. |
| Prisma 7 + PostgreSQL, `prisma migrate deploy` run in a **separate pre-deploy container** before the API starts | `apps/api/railway.toml` | Azure has no pre-deploy hook. Migrations become an explicit CI/CD step or a Container Apps Job. |
| One migration installs `btree_gist` inside the same transaction as its DDL | `prisma/migrations/20260721120000_leave_source_of_truth` | Azure Postgres Flexible Server refuses `CREATE EXTENSION` unless the extension is allow-listed in `azure.extensions` first. Blocking issue — see 6.3. |
| A composite FK `Company_owner_same_company_fkey` exists in the DB but cannot be expressed in `schema.prisma` | `prisma/schema.prisma` header comment | Any dump/restore must preserve it; `prisma migrate diff` will always report it as drift. Never "fix" it. |
| Uploads written to a local filesystem; root resolved from `UPLOADS_DIR` **or `RAILWAY_VOLUME_MOUNT_PATH`**, and production throws at boot if neither is set | `apps/api/src/lib/uploads-root.ts` | The Railway env var name is hard-coded. Either set `UPLOADS_DIR` on Azure (works today, no code change) or clean up the coupling. |
| Storage is behind an interface, `StorageDriver = "local"`, `isLocalStorage()` returns `true` | `apps/api/src/lib/storage.ts` | Clean seam for an Azure Blob driver later. Not required for cutover. |
| PDF generation via Puppeteer/Chromium (`payslip-pdf`, `roster-pdf`, `render-pdf`) | `apps/api/src/lib/pdf-browser.ts` | Chromium needs OS libraries. This is the single strongest argument for containerising the API rather than using App Service's built-in Node runtime. |
| `@fastify/rate-limit` with default in-memory store | `apps/api/src/app.ts` | Limits are per-instance. Correct only at 1 replica, or with a Redis store. |
| Health: `/health`, `/health/live` (always 200), `/health/ready` (503 if DB unreachable) | `apps/api/src/app.ts` | Maps directly onto Azure liveness/readiness/startup probes. |
| Auth uses cookies on the web origin; browser traffic goes through the web app's same-origin `/api` proxy | `next.config.js`, `@fastify/cookie` | Keep the two-origin model: `plethora.…` (web) and `api.…` (API). CORS stays exact-origin. |
| `TRUST_PROXY=true` | env templates | Required on Azure too — every option here puts a reverse proxy in front. |
| Daily cron: `POST /internal/cron/auto-roster` with `Authorization: Bearer $CRON_SECRET` | `DEPLOYMENT_RAILWAY.md` | Replaced by a Container Apps Job or a Logic App timer. |
| Optional WhatsApp webhook (disabled by default, signed with `WHATSAPP_APP_SECRET`) | env templates | Public inbound path; if enabled, the API's public hostname must stay stable. |
| CI gate: `Production readiness` workflow (Postgres service, migrations, both test suites, both builds, production startup smoke test) | `.github/workflows/production-readiness.yml` | Reuse verbatim as the gate before any Azure deploy job. Railway's "Wait for CI" becomes a workflow `needs:` dependency. |

---

## 2. Recommended target architecture

**Azure Container Apps for both services + Azure Database for PostgreSQL Flexible Server.**

```
Afrihost DNS
  plethora.quickbophasecurity.co.za  CNAME ─┐
  api.quickbophasecurity.co.za       CNAME ─┤
                                            ▼
                    ┌──────────────────────────────────────────┐
                    │ Azure Container Apps Environment          │
                    │  (managed ingress, TLS, HTTP/2, scaling)  │
                    │                                           │
                    │  ca-plethora-web   Next.js 16  :3000      │
                    │      │  /api/* rewrite (server-side)      │
                    │      ▼                                    │
                    │  ca-plethora-api   Fastify 5   :3001      │
                    │      │        ▲                           │
                    │      │        └── job-auto-roster (cron)  │
                    │      │        └── job-db-migrate (manual) │
                    └──────┼────────────────────────────────────┘
                           │ private endpoint / VNet
        ┌──────────────────┼───────────────────────┐
        ▼                  ▼                       ▼
  PostgreSQL          Azure Files share       Azure Key Vault
  Flexible Server     (uploads, RWX)          (JWT/CRON/ENCRYPTION
  + PITR backups      → Blob later            secrets, ref'd by CA)

  Azure Container Registry  ←  GitHub Actions (OIDC, no stored creds)
  Log Analytics + Application Insights  ←  all of the above
```

Why Container Apps rather than the alternatives:

- **Chromium.** Puppeteer needs `libnss3`, `libatk`, fonts, etc. In a Dockerfile that is three lines. On App Service's built-in Node runtime it is a fight, and the officially supported answer there is a custom container anyway — so pick the platform that is container-native from the start.
- **Scale-to-N and revisions.** Container Apps gives blue/green traffic splitting per revision, which is exactly the rollback story Railway does not have.
- **Jobs.** `job-auto-roster` (scheduled) and `job-db-migrate` (manual/CI-triggered) replace Railway's cron service and pre-deploy container with first-class primitives, using the *same image* as the API — so migrations always run the code that is about to serve traffic.
- **Cost shape.** Consumption pricing with a small always-on minimum matches a workforce app with business-hours load better than a fixed App Service Plan.

### Options considered and rejected

| Option | Verdict |
|--------|---------|
| **App Service (Linux, built-in Node 24)** | Viable for `web`; painful for `api` because of Chromium. Also no pre-deploy hook, and Oryx builds a monorepo workspace awkwardly. Reasonable fallback if the team has existing App Service expertise — run both as **custom containers** on App Service and most of this document still applies. |
| **Azure Static Web Apps for the frontend** | Rejected. Next 16 with server-side rewrites and cookie-based auth is not a static site; SWA's hybrid Next support constrains the runtime and adds an extra hop for no gain. |
| **AKS** | Rejected. Two stateless services and one database do not justify a cluster's operational surface or cost. Revisit only at genuine multi-tenant scale. |
| **Azure Container Instances** | Rejected. No managed ingress, no revisions, no autoscale — a step down from Railway. |
| **Cosmos DB / Azure SQL** | Rejected. Prisma schema is PostgreSQL-specific (`btree_gist`, Postgres FKs, JSON columns). Migrating engines is a rewrite, not a migration. |

---

## 3. Service-by-service mapping

| Railway | Azure | Notes |
|---------|-------|-------|
| `api` service (Railpack) | Container App `ca-plethora-api` | Dockerfile with Chromium; ingress external on `api.` hostname |
| `web` service (Railpack) | Container App `ca-plethora-web` | Dockerfile; ingress external on `plethora.` hostname |
| Railway PostgreSQL | Azure DB for PostgreSQL **Flexible Server** 16 | Zone-redundant HA optional; PITR 7–35 days |
| Railway Volume `/data/uploads` | Azure Files share mounted at `/data/uploads` | Or the Blob driver in section 5.2 |
| Railway pre-deploy command | Container Apps Job `job-db-migrate`, triggered by the deploy workflow | Runs `prisma migrate deploy` and must succeed before the API revision is promoted |
| Railway Cron service | Container Apps Job `job-auto-roster`, cron `0 2 * * *` (UTC) | Same image, calls the internal endpoint with `CRON_SECRET` |
| Railway service variables | Container App env vars + **Key Vault** secret references via managed identity | Secrets never land in the repo or in GitHub |
| Railway "Wait for CI" | `deploy` job with `needs: verify` on the existing readiness workflow | Same gate, expressed in GitHub Actions |
| Railway custom domains + auto TLS | Container Apps custom domain + managed certificate | Afrihost gets a CNAME + a TXT `asuid.` validation record |
| Railway build logs / metrics | Log Analytics workspace + Application Insights | `console`/Fastify pino logs flow to `ContainerAppConsoleLogs_CL` |

---

## 4. Container images

Two Dockerfiles, both built from the repo root so the workspace lockfile resolves.

`apps/api/Dockerfile` (sketch):

```dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN npm run build --workspace=api      # prisma generate && tsc && copy-templates

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY package.json ./
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

Points that matter:

- `binaryTargets = ["native", "rhel-openssl-3.0.x"]` in `schema.prisma` covers Debian glibc builds via `native`; if the base image is swapped to Alpine, add `linux-musl-openssl-3.0.x` **and** re-check `bcrypt`, `sharp`, and Chromium. Recommendation: stay on `bookworm-slim`.
- `PUPPETEER_EXECUTABLE_PATH` makes `pdf-browser.ts` take the `puppeteer-core` path against the distro Chromium — smaller image, patched by apt, no download at build time.
- The web image is the same shape without Chromium. Adding `output: "standalone"` to `next.config.js` would cut the web image substantially; it is an optimisation, not a prerequisite.
- The API image is also the image used by both Jobs (`job-db-migrate`, `job-auto-roster`) — one artifact, three workloads.

---

## 5. Code changes required

### 5.1 Required before cutover

1. **`apps/api/src/lib/uploads-root.ts`** — the production guard mentions Railway by name and reads `RAILWAY_VOLUME_MOUNT_PATH`. Setting `UPLOADS_DIR=/data/uploads` on Azure satisfies it as written, so this is *not* a blocker; the tidy-up is to make the message platform-neutral and drop the Railway variable once Railway is retired.
2. **`DATABASE_URL` must carry TLS.** Azure Flexible Server requires SSL: append `?sslmode=require` (Prisma 7 + `@prisma/adapter-pg` honours it). Verify against a staging server before cutover.
3. **`next.config.js` `assertRailwayApiUrl`** keys off `RAILWAY_PROJECT_ID`, so the guard silently disappears on Azure. Add an equivalent guard for the Azure build (e.g. trip on `CONTAINER_APP_NAME`) or the web image can be built pointing at `localhost` and fail only in the browser.
4. **Migrations are no longer automatic.** Nothing in the code runs `migrate deploy` at boot, and Azure has no pre-deploy phase. The deploy workflow must run `job-db-migrate` and gate promotion on its exit code. Losing this step is the single easiest way to ship a broken deploy.

### 5.2 Recommended shortly after

5. **Azure Blob storage driver.** `StorageService` in `apps/api/src/lib/storage.ts` already defines `uploadFile` / `deleteFile` / `getSignedUrl` / `resolveKeyFromUrl`. An `@azure/storage-blob` driver behind `STORAGE_DRIVER=azure-blob` removes the shared-filesystem dependency and is the prerequisite for running the API at more than one replica comfortably. `isLocalStorage()` (currently `return true`) is the switch that also disables the `@fastify/static` `/uploads/logos/` route.
6. **Redis-backed rate limiting.** `@fastify/rate-limit` is in-memory; with N replicas the effective ceiling is N × 1000/min. Azure Cache for Redis (Basic C0) plus the plugin's `redis` option fixes it. Until then, pin the API to `--min-replicas 1 --max-replicas 1`.
7. **Graceful shutdown.** Railway's `drainingSeconds = 30` has no direct Azure equivalent; Container Apps sends `SIGTERM` and waits (default 30s). Confirm the Fastify server closes on `SIGTERM` — if it does not, in-flight payroll/PDF requests are cut during every revision swap.

### 5.3 Optional

8. `output: "standalone"` in `next.config.js` for a smaller web image.
9. Application Insights via `@azure/monitor-opentelemetry` for distributed traces; pino JSON to stdout is already usable without it.

---

## 6. Database migration

### 6.1 Target

- Azure Database for PostgreSQL **Flexible Server**, engine version matching Railway's (CI runs `postgres:16` — confirm the production major version first with `SELECT version();`).
- Start at **B2s / 2 vCPU / 4 GiB, 64 GiB storage**; General Purpose D2ds_v5 if payroll runs prove burst-heavy. Storage grows but never shrinks — start modest.
- **Enable PITR (7–35 days) before the first migration**, not after.
- Private access (VNet integration) with the Container Apps environment in the same VNet is the right end state. Public access with a firewall allow-list is acceptable for the first cutover if it shortens the window — but write down the follow-up.

### 6.2 Data transfer

The dataset is a single-tenant-ish ERP database; a dump/restore inside a maintenance window is simpler and safer than logical replication.

```bash
pg_dump --format=custom --no-owner --no-privileges \
        --dbname "$RAILWAY_DATABASE_URL" --file plethora.dump

pg_restore --no-owner --no-privileges --clean --if-exists \
           --dbname "$AZURE_DATABASE_URL" plethora.dump
```

Use a `pg_dump` whose major version is ≥ the server's. Verify after restore:
row counts per table, the `_prisma_migrations` table (same rows, same
checksums), and **explicitly** that `Company_owner_same_company_fkey` survived:

```sql
SELECT conname FROM pg_constraint WHERE conname = 'Company_owner_same_company_fkey';
```

If downtime must be near-zero, Azure Database Migration Service / native logical
replication is the alternative — materially more setup, and Railway's Postgres
must expose `wal_level=logical`. Recommendation: take the window.

### 6.3 `btree_gist` — the one blocking Azure-specific issue

Migration `20260721120000_leave_source_of_truth` runs `CREATE EXTENSION btree_gist`
inside the same transaction as its DDL. On Flexible Server, `CREATE EXTENSION`
fails unless the extension is allow-listed in the `azure.extensions` server
parameter, and because the migration is transaction-wrapped, that failure rolls
back the entire migration.

Do this **before** any restore or `migrate deploy`:

```bash
az postgres flexible-server parameter set \
  --resource-group rg-plethora-prod --server-name pg-plethora-prod \
  --name azure.extensions --value btree_gist
```

Then confirm from a psql session, as the exact role the deployment will use:

```sql
SHOW azure.extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- must succeed
```

The role must hold `CREATE` on the database. Rehearse this on a staging server
first — this is step 3 of the existing release gate in `DEPLOYMENT_RAILWAY.md`
and it carries over unchanged.

### 6.4 Migrations at deploy time

`job-db-migrate` — same image as the API, `command: ["npm","run","db:migrate:deploy","--workspace=api"]`,
trigger type `Manual`, started by the deploy workflow with
`az containerapp job start` and awaited. Non-zero exit stops the deploy before
the new API revision takes traffic. This preserves the Railway property that
migrations never run concurrently across replicas.

The release gate, the "do not use `db:push` in production" rule, and the
`prisma migrate resolve` guidance in `DEPLOYMENT_RAILWAY.md` all apply verbatim
on Azure. Copy them into the Azure runbook rather than re-deriving them.

---

## 7. Provisioning (Azure CLI sketch)

```bash
RG=rg-plethora-prod; LOC=southafricanorth   # closest region to the userbase
az group create -n $RG -l $LOC

# Registry
az acr create -g $RG -n acrplethora --sku Basic

# Postgres
az postgres flexible-server create -g $RG -n pg-plethora-prod \
  --tier Burstable --sku-name Standard_B2s --storage-size 64 \
  --version 16 --high-availability Disabled
az postgres flexible-server parameter set -g $RG -s pg-plethora-prod \
  --name azure.extensions --value btree_gist

# Key Vault
az keyvault create -g $RG -n kv-plethora-prod
for s in JWT_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY CRON_SECRET DATABASE_URL; do
  az keyvault secret set --vault-name kv-plethora-prod -n $s --value "…"
done

# Container Apps environment + Azure Files mount
az containerapp env create -g $RG -n cae-plethora -l $LOC
az containerapp env storage set -g $RG -n cae-plethora \
  --storage-name uploads --azure-file-account-name stplethora \
  --azure-file-share-name uploads --access-mode ReadWrite \
  --azure-file-account-key "$KEY"
```

Then the two apps, e.g. the API:

```bash
az containerapp create -g $RG -n ca-plethora-api --environment cae-plethora \
  --image acrplethora.azurecr.io/plethora-api:<sha> \
  --target-port 3001 --ingress external \
  --min-replicas 1 --max-replicas 1 \
  --system-assigned \
  --secrets jwt=keyvaultref:...,identityref:system \
  --env-vars NODE_ENV=production HOST=0.0.0.0 TRUST_PROXY=true \
             UPLOADS_DIR=/data/uploads \
             CORS_ORIGIN=https://plethora.quickbophasecurity.co.za \
             FRONTEND_URL=https://plethora.quickbophasecurity.co.za \
             WHATSAPP_ENABLED=false \
             JWT_SECRET=secretref:jwt …
```

Probes (set via the YAML/ARM shape, not the flat CLI):

| Probe | Path | Why |
|-------|------|-----|
| startup | `/health/live` | Prisma client init + template copy can take seconds |
| liveness | `/health/live` | Never fail liveness on a DB blip — that would restart-loop the app |
| readiness | `/health/ready` | 503 while the DB is unreachable pulls the replica out of rotation |

This mirrors the Railway healthcheck choice exactly, but splits liveness from
readiness — an improvement Railway's single `healthcheckPath` could not express.

Everything above should end up in **Bicep** (or Terraform) under `infra/`
rather than living as shell history. The CLI form here is for the spike.

---

## 8. CI/CD

Extend `.github/workflows/production-readiness.yml` rather than replacing it —
it is the existing gate and it already covers migrations, both test suites,
both builds, and a production startup smoke test.

```yaml
jobs:
  verify:            # unchanged, existing job
  deploy:
    needs: verify
    if: github.ref == 'refs/heads/main'
    environment: production        # manual approval = Railway's "Wait for CI", improved
    permissions: { id-token: write, contents: read }
    steps:
      - uses: azure/login@v2       # OIDC federated credential — no stored secrets
        with: { client-id: …, tenant-id: …, subscription-id: … }
      - run: az acr build -r acrplethora -t plethora-api:${{ github.sha }} -f apps/api/Dockerfile .
      - run: az acr build -r acrplethora -t plethora-web:${{ github.sha }} -f apps/web/Dockerfile \
               --build-arg NEXT_PUBLIC_API_URL=https://api.quickbophasecurity.co.za .
      - run: az containerapp job start -n job-db-migrate -g rg-plethora-prod   # await + check exit
      - run: az containerapp update -n ca-plethora-api -g rg-plethora-prod --image …:${{ github.sha }}
      - run: az containerapp update -n ca-plethora-web -g rg-plethora-prod --image …:${{ github.sha }}
```

Notes:

- `NEXT_PUBLIC_API_URL` is a **build arg**, not a runtime env var. Next inlines
  it. Changing the API hostname means rebuilding the web image — same trap as
  on Railway, one level deeper because the value is now baked into an image tag.
- Use OIDC federated credentials; do not store an Azure service principal
  secret in GitHub.
- Deploy API before web when the API change is backward compatible; deploy web
  first only when a migration removes something the old web build still calls.
- Container Apps revisions give a one-command rollback:
  `az containerapp ingress traffic set --revision-weight <previous>=100`.
  Note that this rolls back *code*, not *schema* — schema rollback is still PITR.

---

## 9. Networking, domains, TLS, CORS

1. Container Apps issues the ingress FQDN, e.g. `ca-plethora-web.<region>.azurecontainerapps.io`.
2. In Afrihost DNS add, per hostname: a `CNAME` to that FQDN and a `TXT` record
   at `asuid.<subdomain>` carrying the domain verification ID from
   `az containerapp show --query properties.customDomainVerificationId`.
3. `az containerapp hostname bind … --validation-method CNAME` then add a free
   managed certificate. Same for `api.quickbophasecurity.co.za`.
4. Keep `CORS_ORIGIN=https://plethora.quickbophasecurity.co.za` exactly — the
   API rejects wildcards in production and the web app already proxies browser
   traffic same-origin, so the API's public hostname is used mainly by the
   WhatsApp webhook and by direct integrations.
5. Keep `TRUST_PROXY=true`; Container Apps ingress terminates TLS and sets
   `X-Forwarded-*`. Without it, rate limiting and audit IPs see the proxy.
6. Optional hardening: Azure Front Door or Application Gateway + WAF in front,
   and internal-only ingress on the API with the web app as the sole caller.
   That is a genuinely better posture but adds a hop and a cost line; it can
   follow cutover.

---

## 10. Secrets, observability, backup

- **Secrets** — Key Vault, referenced by Container Apps through a system-assigned
  managed identity. `JWT_SECRET`, `JWT_REFRESH_SECRET` (must differ, ≥32 chars in
  production — the API's env validation enforces this), `ENCRYPTION_KEY`,
  `CRON_SECRET` (≥16), `DATABASE_URL`, and the four WhatsApp values if enabled.
- **Logs** — Container Apps → Log Analytics. Fastify's pino JSON survives intact;
  query `ContainerAppConsoleLogs_CL`. `genReqId` already emits a request id per
  request, so correlate on that.
- **Alerts** — readiness probe failures, revision restart count, Postgres CPU /
  storage / connection saturation, 5xx rate at ingress.
- **Backups** — Flexible Server automated backups + PITR (set retention ≥ 14 days
  for a payroll system), geo-redundant if the business requires cross-region.
  Azure Files share: enable soft delete and a backup policy — uploads (payslip
  attachments, incident evidence, employee documents) are not reconstructible.
- **Restore rehearsal** — the existing release gate demands a *tested* restore
  point. Rehearse a PITR restore into a scratch server before cutover, not after.

---

## 11. Indicative cost

Rough monthly, South Africa North, production-sized-small. Verify in the Azure
Pricing Calculator before committing — these are order-of-magnitude only.

| Item | Shape | ≈ USD/mo |
|------|-------|---------:|
| Container Apps (API) | 1 replica always on, 0.5 vCPU / 1 GiB | 25–40 |
| Container Apps (web) | 1 replica always on, 0.5 vCPU / 1 GiB | 25–40 |
| Container Apps Jobs | brief daily runs | <2 |
| PostgreSQL Flexible Server | B2s, 64 GiB, PITR 14d | 45–70 |
| Azure Files | 50 GiB transaction-optimised | 5–10 |
| ACR | Basic | 5 |
| Log Analytics | modest ingestion | 5–15 |
| Key Vault | secrets only | <1 |
| **Total** | | **≈ 110–180** |

Adding zone-redundant HA on Postgres roughly doubles the database line. Front
Door/WAF adds ~35+. Scale-to-zero on the web app is possible but introduces cold
starts on a Next server — not worth it for a staff-facing ERP.

---

## 12. Cutover runbook

**Phase 0 — build it alongside Railway (no user impact)**
1. Provision the resource group, ACR, Key Vault, Postgres, Container Apps env, Azure Files.
2. Set `azure.extensions=btree_gist`; prove `CREATE EXTENSION` works as the deploy role.
3. Land the two Dockerfiles and the required code changes (section 5.1) on a branch; CI green.
4. Deploy to a **staging** Container Apps environment against a restored copy of production data. Run `db:migrate:deploy`, then `npm run db:audit --workspace=api`.
5. Exercise the risky paths on staging: PDF payslip generation (Chromium), file upload + download (Azure Files mount), login/refresh cookie flow across the two hostnames, the auto-roster cron job, and — if enabled — the WhatsApp webhook signature check.
6. Rehearse a PITR restore. Record the restore point and the timing.

**Phase 1 — cutover window**
7. Announce the window. Put Railway into read-only or stop the web service.
8. Final `pg_dump` from Railway → `pg_restore` into Azure. Verify row counts, `_prisma_migrations`, and the composite FK.
9. `rsync`/`azcopy` the Railway volume contents into the Azure Files share.
10. Run `job-db-migrate` (should be a no-op if the dump was current) and confirm `db:migrate:status` is clean.
11. Deploy both images; confirm `/health/ready` returns 200 and `/health` returns `{"status":"ok","service":"plethora-api"}`.
12. Smoke test against the Azure FQDNs before touching DNS: login, a payroll read, an upload, a PDF.
13. Lower DNS TTL **24h beforehand**, then repoint the two CNAMEs at Afrihost. Bind custom domains and issue managed certificates.
14. Watch logs, 5xx rate, and Postgres connections for the first hour.

**Phase 2 — after**
15. Keep Railway warm and un-deleted for 7–14 days as the rollback path (repoint DNS back; accept that data written on Azure since cutover would need reconciliation — so the practical rollback window is hours, not days. Say this out loud before starting).
16. Then: Blob storage driver, Redis rate limiting, VNet-private Postgres, WAF, and delete the Railway project and its secrets.
17. Retire `DEPLOYMENT_RAILWAY.md` in favour of an Azure runbook, keeping its database release gate and troubleshooting sections — they are platform-independent and hard-won.

---

## 13. Risks and open questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| `btree_gist` not allow-listed → transaction-wrapped migration rolls back | **High** | Section 6.3, proven on staging first |
| Chromium missing/broken in the runtime image → payslip and roster PDFs fail | **High** | Explicit apt install + `PUPPETEER_EXECUTABLE_PATH`; PDF generation is a mandatory staging test |
| Migrations no longer run automatically → API deployed ahead of its schema | **High** | `job-db-migrate` gates promotion in the deploy workflow; never make it optional |
| Composite FK lost in dump/restore | Medium | Explicit post-restore constraint check |
| `NEXT_PUBLIC_API_URL` baked into the wrong image | Medium | Build arg per environment + an Azure equivalent of `assertRailwayApiUrl` |
| In-memory rate limit multiplied across replicas | Medium | Pin to 1 replica until Redis lands |
| Uploads on a single SMB mount become a bottleneck / block scale-out | Medium | Blob driver behind the existing `StorageService` seam |
| Region latency for SA users if deployed to Europe | Medium | Prefer South Africa North; confirm Container Apps and the chosen Postgres SKU are both available there |
| Rollback window narrower than it looks once Azure has new writes | Medium | Set an explicit go/no-go time in the window; after it, forward-fix only |
| Cost drift from Log Analytics ingestion and egress | Low | Budget alert on the resource group from day one |

**Open questions for the team**

1. Region: South Africa North (latency, data residency) vs West Europe (fuller service catalogue, sometimes cheaper). Confirm SKU availability before deciding.
2. Acceptable downtime for the cutover window — this decides dump/restore vs logical replication.
3. Production Postgres major version on Railway today (CI uses 16; confirm the live server).
4. Is WhatsApp expected to be enabled on Azure? If yes, the webhook hostname and app-secret rotation join the cutover checklist.
5. Existing Azure footprint — subscription, tenant, naming/tagging policy, and whether a landing zone or policy set constrains public ingress.
6. Who holds the Afrihost DNS credentials, and can TTLs be lowered 24h before the window?
