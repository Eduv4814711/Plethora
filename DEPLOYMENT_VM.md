# Plethora ERP — Single-VM Deployment (Docker Compose)

This guide describes how to run the full Plethora stack on **one Ubuntu VM**
(Sive.host) using Docker Compose. Everything — frontend, backend, PostgreSQL,
Redis — runs in containers on a private Docker network. **Only Caddy** is
exposed publicly (ports 80/443) and it terminates TLS and reverse-proxies to
the internal services.

```
Sive.host VM (102.211.186.94)
└── Docker network: plethora_network  (internal only)
    ├── caddy        ->  public 80/443, TLS, reverse proxy
    ├── web          ->  Next.js (internal :3000)
    ├── api          ->  Fastify + Prisma (internal :3001)
    ├── postgres     ->  PostgreSQL 16 (internal :5432)
    └── redis        ->  Redis 7 (internal :6379)

Persistent data (bind mounts):
  /opt/plethora/data/postgres   -> PostgreSQL data
  /opt/plethora/data/redis      -> Redis AOF data
  /opt/plethora/data/uploads    -> uploaded files
  /opt/plethora/data/caddy      -> Caddy certs/state
  /opt/plethora/backups         -> database backups
  /opt/plethora/caddy/Caddyfile -> reverse proxy config
```

---

## 1. Required VM specs

| Item     | Minimum / Used                          |
| -------- | --------------------------------------- |
| OS       | Ubuntu 24.04 LTS                        |
| CPU      | 4 cores                                 |
| RAM      | 8 GB                                    |
| Disk     | 193 GB                                  |
| Public IP| 102.211.186.94                          |
| Firewall | UFW: allow **22, 80, 443** only         |

Do **not** open 3000/3001/5432/6379 publicly — they stay on the internal
Docker network.

## 2. Required installed tools

Already present on the VM:

- Docker Engine + Docker Compose plugin (`docker compose`)
- Git
- (Optional) `psql` 16 client and Node.js 20 for ad-hoc tasks

Verify:

```bash
docker --version
docker compose version
git --version
```

## 3. Directory structure

```
/opt/plethora
├── apps/Plethora        # the git checkout (this repo)
├── backups              # pg_dump output
├── caddy/Caddyfile      # reverse proxy config (copied from the repo)
├── data
│   ├── postgres         # PostgreSQL volume
│   ├── redis            # Redis volume
│   ├── uploads          # uploaded files
│   └── caddy            # Caddy certs/state (created automatically)
├── logs                 # log output (cron/backup)
├── .env                 # real secrets (NOT in git)
└── docker-compose.yml   # symlink -> apps/Plethora/docker-compose.yml
```

Create the directories (most already exist):

```bash
sudo mkdir -p /opt/plethora/{apps,backups,caddy,data/postgres,data/redis,data/uploads,data/caddy,logs}
sudo chown -R "$USER":"$USER" /opt/plethora
```

## 4. Clone the repository

```bash
cd /opt/plethora/apps
git clone https://github.com/Plethora-ERP/Plethora.git
```

This produces `/opt/plethora/apps/Plethora`.

## 5. Create the environment file

```bash
cp /opt/plethora/apps/Plethora/.env.production.example /opt/plethora/.env
nano /opt/plethora/.env
```

Fill in **real** values. At minimum set:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `DATABASE_URL` — keep host `postgres` and match the POSTGRES_* values above
- `JWT_SECRET` and `JWT_REFRESH_SECRET` — two **different** random strings, each
  ≥ 32 chars. Generate with `openssl rand -base64 48`
- `FRONTEND_URL`, `CORS_ORIGIN`, `API_URL`, `NEXT_PUBLIC_API_URL` — your real
  domains (e.g. `https://app.example.co.za` / `https://api.example.co.za`)

> The API will **refuse to start** if the JWT secrets are weak/placeholder/equal
> or if `DATABASE_URL` / `CORS_ORIGIN` are missing. This is intentional.

> `NEXT_PUBLIC_API_URL` is baked into the frontend at **build time**, so if you
> change it later you must `docker compose build web` again.

## 6. Configure Caddy

```bash
cp /opt/plethora/apps/Plethora/deploy/caddy/Caddyfile /opt/plethora/caddy/Caddyfile
nano /opt/plethora/caddy/Caddyfile
```

Replace the example domains and the `email` with your real values. **DNS A
records for both domains must already point at `102.211.186.94`** before Caddy
can obtain Let's Encrypt certificates.

## 7. Start the stack

```bash
cd /opt/plethora

# One-time: link the compose file so `docker compose` works from /opt/plethora
ln -s apps/Plethora/docker-compose.yml docker-compose.yml   # deploy.sh also does this

docker compose build
docker compose up -d
docker ps
```

On first boot the `api` container runs `prisma migrate deploy` automatically
before starting, creating the schema in the fresh PostgreSQL database.

Then browse to:

- https://app.example.co.za  (frontend)
- https://api.example.co.za/health  → `{"status":"ok","service":"plethora-api"}`

## 8. View logs

```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f caddy
docker compose logs -f postgres
docker compose logs -f redis
```

## 9. Restart services

```bash
docker compose restart api          # one service
docker compose restart              # everything
docker compose up -d                # apply config/image changes
docker compose down                 # stop & remove containers (data volumes are bind mounts, so safe)
```

## 10. Run database migrations

Migrations run automatically on `api` startup (`prisma migrate deploy`). To run
them manually (e.g. after pulling new migrations without a full rebuild):

```bash
docker compose exec api npx prisma migrate deploy
```

Other Prisma tasks:

```bash
docker compose exec api npx prisma migrate status
docker compose exec api npm run db:seed --workspace=api   # seed (first install only)
```

## 11. Access the database from the VM

From inside the container (no public port needed):

```bash
docker compose exec postgres psql -U plethora_admin -d plethora_prod
```

Or using the host `psql` client through a temporary port-forward:

```bash
# Opens 127.0.0.1:5433 -> container 5432 for this shell session only
docker compose exec postgres pg_isready
```

(Postgres is intentionally **not** published to the host; use `docker compose
exec` for access.)

## 12. Backup PostgreSQL

```bash
/opt/plethora/apps/Plethora/scripts/backup-postgres.sh
```

Writes a timestamped `*.sql.gz` to `/opt/plethora/backups` and prunes dumps
older than 14 days. Schedule it daily with cron (`crontab -e`):

```cron
30 2 * * * /opt/plethora/apps/Plethora/scripts/backup-postgres.sh >> /opt/plethora/logs/backup.log 2>&1
```

## 13. Restore PostgreSQL

```bash
docker compose stop api
/opt/plethora/apps/Plethora/scripts/restore-postgres.sh \
  /opt/plethora/backups/plethora_plethora_prod_YYYYMMDD_HHMMSS.sql.gz
docker compose start api
```

The script asks you to type the database name to confirm (it is destructive).

## 14. Update the app after a git pull

Use the deploy script (recommended):

```bash
/opt/plethora/apps/Plethora/deploy.sh
```

It pulls `main`, rebuilds the images, restarts containers and shows status.
Equivalent manual steps:

```bash
cd /opt/plethora/apps/Plethora
git pull origin main
cd /opt/plethora
docker compose build
docker compose up -d
docker ps
```

## 15. Backups checklist

- Database: `scripts/backup-postgres.sh` → `/opt/plethora/backups`
- Uploads: back up `/opt/plethora/data/uploads` (e.g. `tar`/`rsync` to off-box)
- Env: keep a secure copy of `/opt/plethora/.env` (contains secrets)

## 16. Troubleshooting

**`api` keeps restarting / exits immediately**
```bash
docker compose logs --tail=100 api
```
Usually a missing/weak env var. Check `JWT_SECRET`, `JWT_REFRESH_SECRET`
(≥32 chars, different), `DATABASE_URL`, `CORS_ORIGIN` in `/opt/plethora/.env`.

**Caddy can't get a certificate**
- DNS A records for both domains must resolve to `102.211.186.94`.
- Ports 80 and 443 must be open in UFW and not used by another process.
- For testing, enable the staging CA line in the Caddyfile to avoid rate limits.
```bash
docker compose logs -f caddy
```

**Database connection refused from the API**
- Confirm `DATABASE_URL` host is `postgres` (the service name), not `localhost`.
- Check Postgres health: `docker compose ps` / `docker compose logs postgres`.

**Frontend calls the wrong API URL**
- `NEXT_PUBLIC_API_URL` is inlined at build time. After changing it:
  `docker compose build web && docker compose up -d web`.

**Migrations didn't apply**
```bash
docker compose exec api npx prisma migrate status
docker compose exec api npx prisma migrate deploy
```

**Free up space / clean old images**
```bash
docker image prune -f
docker system df
```

**Check what's listening publicly (should be only 22/80/443)**
```bash
sudo ufw status
sudo ss -tlnp
```

---

### Notes / manual confirmations

- **Node version:** the containers build on **Node 24** because the repo pins
  `"node": "24.x"` with `engine-strict=true`. The VM's Node 20 (via nvm) is only
  for occasional host-side commands and does not affect the Docker builds. If
  you specifically need the images on Node 20, lower the `engines` constraint in
  `package.json` / `apps/*/package.json` and the `FROM node:24-...` lines first.
- **Redis** is provisioned and persisted but the application code does not use
  it yet; it is included per the target architecture and is ready for caching/
  queues. No action needed.
- **Uploads** use local disk (`STORAGE_DRIVER=local`) persisted to
  `/opt/plethora/data/uploads`. The legacy S3 driver remains available but is
  not used in this VM deployment.
- The repo's `DEPLOYMENT.md`, `ecosystem.config.cjs` and `docs/AWS_*` files
  describe the older AWS/PM2 (non-Docker) path and are **not** used here.
