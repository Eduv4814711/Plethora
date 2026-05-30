# Plethora — AWS EC2 Non-Docker Deployment Guide

A complete, beginner-friendly guide to deploying Plethora on AWS **without Docker**,
using EC2 + PM2 + ALB + Route 53 + ACM + RDS PostgreSQL + S3.

> **Do not use Docker for this deployment.** The repo still contains
> `Dockerfile.*` and `railway.toml` files for other hosting paths — ignore them here.
> This guide does **not** use ECS, ECR, Fargate, or Kubernetes.

---

## 1. Overview of the deployment approach

```
User / Browser
   │  HTTPS
   ▼
Route 53 (DNS)
   │
   ▼
AWS Application Load Balancer (ALB)  ── ACM TLS certificate
   │
   ├── app.plethora.quickbophasecurity.co.za  ─▶  EC2 :3000  (Next.js web)
   └── api.plethora.quickbophasecurity.co.za  ─▶  EC2 :3001  (Fastify API)
                                                      │
                                                      ├──▶ RDS PostgreSQL
                                                      └──▶ S3 (uploads)
```

- A **single EC2 Ubuntu instance** runs both processes, managed by **PM2**:
  - Next.js web app on port **3000**
  - Fastify API on port **3001**
- The **ALB** terminates HTTPS (via an **ACM** certificate) and routes by host header
  to the correct port. **EC2 ports 3000/3001 are never exposed to the internet** —
  only the ALB security group may reach them.
- **RDS PostgreSQL** stores all data. **S3** stores all uploaded files.
- The EC2 instance accesses S3 through an **IAM role** — no AWS keys in `.env`.

This is intentionally simple (one instance). You can later add more EC2 instances behind
the same ALB target groups because both apps are stateless (uploads live in S3, sessions
are JWTs, and all instances share RDS).

---

## 2. AWS services used

| Service | Purpose |
| --- | --- |
| EC2 (Ubuntu 24.04 LTS) | Runs Next.js + Fastify under PM2 |
| Application Load Balancer | HTTPS termination + host-based routing |
| ACM | TLS certificate for `*.plethora.quickbophasecurity.co.za` |
| Route 53 | DNS for the `app` and `api` subdomains |
| RDS PostgreSQL | Managed database |
| S3 | File/upload storage |
| IAM | Role granting EC2 least-privilege access to the S3 bucket |

---

## 3. Security group setup

Create three security groups in the **same VPC**:

1. **`plethora-alb-sg`** (for the ALB)
   - Inbound: TCP **443** from `0.0.0.0/0` (and optionally **80** for HTTP→HTTPS redirect).
   - Outbound: allow all (default).

2. **`plethora-ec2-sg`** (for the EC2 instance)
   - Inbound: TCP **3000** from source = `plethora-alb-sg`.
   - Inbound: TCP **3001** from source = `plethora-alb-sg`.
   - Inbound: TCP **22** (SSH) from **your office/admin IP only** (e.g. `1.2.3.4/32`).
   - Do **not** open 3000/3001 to `0.0.0.0/0`.

3. **`plethora-rds-sg`** (for RDS)
   - Inbound: TCP **5432** from source = `plethora-ec2-sg` only.

> Rule of thumb: ALB is the only thing the internet talks to. EC2 only accepts app
> traffic from the ALB and SSH from you. RDS only accepts traffic from EC2.

---

## 4. RDS PostgreSQL setup

1. RDS → Create database → **Standard create** → **PostgreSQL** (15 or newer).
2. Templates: Production (or Dev/Test to save cost while testing).
3. Set master username/password (store the password somewhere safe).
4. Connectivity:
   - Place RDS in the **same VPC** as EC2.
   - **Public access: No.**
   - VPC security group: **`plethora-rds-sg`**.
5. Additional configuration → Initial database name: `plethora`.
6. Create. When available, copy the **endpoint** (e.g. `plethora-db.xxxx.af-south-1.rds.amazonaws.com`).

Create the application database user (run from the EC2 box once it can reach RDS — see §9):

```bash
psql "postgresql://masteruser:MASTER_PASSWORD@YOUR_RDS_ENDPOINT:5432/postgres?sslmode=require"
```

```sql
CREATE USER plethora_user WITH PASSWORD 'STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON DATABASE plethora TO plethora_user;
\q
```

Your `DATABASE_URL` will be:

```
postgresql://plethora_user:STRONG_PASSWORD_HERE@YOUR_RDS_ENDPOINT:5432/plethora?schema=public&sslmode=require
```

> RDS enforces TLS, so keep `sslmode=require`.

---

## 5. S3 bucket setup

1. S3 → Create bucket → name e.g. **`plethora-prod-uploads`**, region **`af-south-1`**.
2. **Block all public access: ON** (recommended). The app uses the AWS SDK / signed URLs;
   it does not need a public bucket.
3. Enable **Bucket Versioning** (protects against accidental overwrite/delete).
4. (Optional) Add a lifecycle rule to expire old noncurrent versions to control cost.

> If you instead want public object URLs (via `S3_PUBLIC_BASE_URL` / CloudFront),
> set that up separately. The default configuration returns
> `https://<bucket>.s3.<region>.amazonaws.com/<key>` URLs and works with the app.

---

## 6. IAM role setup for EC2 to access S3

Create an IAM **role** for EC2 (trusted entity: EC2) with a least-privilege policy
scoped to your bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PlethoraS3ObjectAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::plethora-prod-uploads/*"
    },
    {
      "Sid": "PlethoraS3ListBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::plethora-prod-uploads"
    }
  ]
}
```

Attach this role to the EC2 instance (Actions → Security → Modify IAM role).
The AWS SDK in `apps/api/src/lib/storage.ts` automatically picks up credentials from
the instance metadata — **so you never put AWS keys in `.env`.**

---

## 7. EC2 Ubuntu setup

1. EC2 → Launch instance.
   - AMI: **Ubuntu Server 24.04 LTS**.
   - Type: **t3.small** or larger (Puppeteer/PDF + Next.js need RAM; t3.micro is tight).
   - Security group: **`plethora-ec2-sg`**.
   - IAM instance profile: the role from §6.
   - Storage: 20 GB+ gp3.
2. SSH in:

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 8. Installing Node.js 24

The repo pins Node `24.x` (`engines` in every `package.json`). Install via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # expect v24.x
npm -v
```

Install PM2 globally:

```bash
sudo npm install -g pm2
```

---

## 9. Installing PostgreSQL client

Needed to run `psql` (user creation, manual checks):

```bash
sudo apt install -y postgresql-client
psql --version
```

---

## 10. Installing Chromium for Puppeteer / PDF generation

Plethora generates PDFs via `puppeteer-core` using `PUPPETEER_EXECUTABLE_PATH`.
Install Chromium and its libraries:

```bash
sudo apt install -y chromium-browser \
  fonts-liberation libnss3 libatk-bridge2.0-0 libgtk-3-0 \
  libasound2t64 libgbm1 libxshmfence1
which chromium-browser   # confirm the path
```

If `chromium-browser` is unavailable on your distro, use the snap or `chromium` package
and set `PUPPETEER_EXECUTABLE_PATH` to the resulting binary path (e.g. `/usr/bin/chromium`).

Set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` in `apps/api/.env` (see §13).

---

## 11. Cloning the repo

```bash
sudo mkdir -p /var/www
sudo chown -R ubuntu:ubuntu /var/www
cd /var/www
git clone YOUR_REPO_URL plethora
cd plethora
```

> The PM2 config (`ecosystem.config.cjs`) expects the repo at **`/var/www/plethora`**.

---

## 12. Installing dependencies

From the repo root (installs all workspaces):

```bash
cd /var/www/plethora
npm install
```

---

## 13. Creating `apps/api/.env`

```bash
cp apps/api/.env.production.example apps/api/.env
nano apps/api/.env
```

Fill in real values:

- `DATABASE_URL` → your RDS connection string (with `sslmode=require`).
- `JWT_SECRET` / `JWT_REFRESH_SECRET` → two different random strings ≥32 chars.
  Generate each with: `openssl rand -base64 48`
- `CORS_ORIGIN` / `FRONTEND_URL` → `https://app.plethora.quickbophasecurity.co.za`
- `STORAGE_DRIVER=s3`, `AWS_REGION=af-south-1`, `S3_BUCKET_NAME=plethora-prod-uploads`
- `TRUST_PROXY=true` (required behind the ALB)
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`
- **Do not** add `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — the IAM role handles auth.

---

## 14. Creating `apps/web/.env.production`

`NEXT_PUBLIC_*` values are baked in at **build time**, so create this **before** building:

```bash
cp apps/web/.env.production.example apps/web/.env.production
nano apps/web/.env.production
```

Set:

```
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.plethora.quickbophasecurity.co.za
NEXT_PUBLIC_API_PATH_PREFIX=
```

---

## 15. Running Prisma migrations

Use **`migrate deploy`** in production (applies committed migrations only). **Never** use
`db push` in production.

```bash
cd /var/www/plethora
npm run prod:migrate        # = prisma migrate deploy (apps/api)
```

Optional first-time seed (only if you intend to seed reference data):

```bash
npm run db:seed
```

---

## 16. Building API and web

```bash
cd /var/www/plethora
npm run prod:build          # builds apps/api (tsc) then apps/web (next build)
```

This produces `apps/api/dist/index.js` and `apps/web/.next`.

---

## 17. Starting with PM2

```bash
cd /var/www/plethora
npm run prod:start:pm2      # = pm2 start ecosystem.config.cjs
pm2 status                  # both plethora-api and plethora-web should be "online"
```

> If `plethora-web` fails because `node_modules/next/dist/bin/next` is missing (npm
> workspaces sometimes hoist `next` to the repo-root `node_modules`), either run
> `npm install --workspace=web` to keep a local copy, or change the web app's `script`
> in `ecosystem.config.cjs` to `../../node_modules/next/dist/bin/next`.

Useful commands:

```bash
npm run prod:logs           # pm2 logs
npm run prod:status         # pm2 status
npm run prod:restart:pm2    # after a new build/deploy
```

---

## 18. Saving PM2 startup process

Make PM2 restart your apps automatically after a reboot:

```bash
pm2 save
pm2 startup systemd
# Run the exact `sudo env PATH=... pm2 startup systemd -u ubuntu --hp /home/ubuntu`
# command that the previous line prints, then:
pm2 save
```

---

## 19. Creating ALB target groups

Create **two target groups** (type: **Instances**, protocol **HTTP**):

1. **`plethora-web-tg`** → port **3000**, health check path **`/`** (or `/login`).
2. **`plethora-api-tg`** → port **3001**, health check path **`/health`**.

Register your EC2 instance in both target groups. Wait for both to report **healthy**.

> The API exposes `GET /health` → `{ "status": "ok" }` (see `apps/api/src/app.ts`).

---

## 20. Creating ALB listener rules

1. EC2 → Load Balancers → Create **Application Load Balancer** (internet-facing).
   - Subnets: at least two public subnets.
   - Security group: **`plethora-alb-sg`**.
2. **HTTPS :443 listener** (uses the ACM cert from §21). Add host-header rules:
   - Host `app.plethora.quickbophasecurity.co.za` → forward to **`plethora-web-tg`**.
   - Host `api.plethora.quickbophasecurity.co.za` → forward to **`plethora-api-tg`**.
   - Default action: forward to `plethora-web-tg` (or return 404).
3. (Recommended) **HTTP :80 listener** → redirect to HTTPS 443.

---

## 21. Setting up ACM SSL certificate

1. ACM (in the **same region as the ALB**) → Request a public certificate.
2. Domain names:
   - `app.plethora.quickbophasecurity.co.za`
   - `api.plethora.quickbophasecurity.co.za`
   - (or a wildcard `*.plethora.quickbophasecurity.co.za`)
3. Validation method: **DNS validation** (easiest with Route 53 — "Create records in Route 53").
4. Wait for status **Issued**, then select this cert on the ALB HTTPS listener (§20).

---

## 22. Setting up Route 53 DNS records

In the Route 53 hosted zone for `quickbophasecurity.co.za`, create two **A — Alias** records:

| Name | Type | Alias target |
| --- | --- | --- |
| `app.plethora` | A (Alias) | your ALB DNS name |
| `api.plethora` | A (Alias) | your ALB DNS name |

(Both point at the same ALB; the listener host rules route them to the right port.)

---

## 23. Testing `/health`

From your laptop:

```bash
curl -i https://api.plethora.quickbophasecurity.co.za/health
# Expect: HTTP/2 200  and body {"status":"ok"}
```

If this fails, check (in order): Route 53 record, ACM cert on listener, target group health,
EC2 security group, and `pm2 logs`.

---

## 24. Testing login / register

1. Open `https://app.plethora.quickbophasecurity.co.za` in a browser.
2. Register a company / admin (or log in with seeded credentials).
3. The browser calls `/api/*`, which Next.js rewrites to `NEXT_PUBLIC_API_URL`.
4. Confirm you can log in and the dashboard loads.

If login returns network errors, verify `NEXT_PUBLIC_API_URL`, `CORS_ORIGIN`, and that
the API target group is healthy.

---

## 25. Testing S3 file uploads

1. In the app, upload a **company logo** (Settings) or a **task attachment**.
2. Confirm the object appears in the `plethora-prod-uploads` bucket.
3. Confirm the image/file renders back in the UI.

If uploads fail with access-denied, re-check the EC2 IAM role policy (§6) and that
`STORAGE_DRIVER=s3`, `AWS_REGION`, and `S3_BUCKET_NAME` are set in `apps/api/.env`.

---

## 26. Rollback steps

Plethora deploys are just "pull + build + restart", so rollback is straightforward:

```bash
cd /var/www/plethora

# 1. Roll the code back to the last known-good commit/tag:
git fetch --all
git checkout <previous-good-commit-or-tag>

# 2. Reinstall deps in case they changed, then rebuild:
npm install
npm run prod:build

# 3. Restart the processes:
npm run prod:restart:pm2
pm2 status
```

- **Database:** if a migration caused the problem, restore from the latest **RDS automated
  backup / snapshot** (RDS → Restore to point in time). Avoid manually editing data.
- **Uploads:** S3 **versioning** lets you restore overwritten/deleted objects.
- Keep the previous build until the new one is verified healthy.

---

## 27. Production checklist

- [ ] Security groups locked down (ALB→internet only; EC2 3000/3001 only from ALB; RDS 5432 only from EC2).
- [ ] RDS not publicly accessible; automated backups enabled.
- [ ] S3 "Block all public access" ON; versioning enabled.
- [ ] EC2 IAM role attached (no AWS keys in `.env`).
- [ ] `apps/api/.env`: strong `JWT_SECRET`/`JWT_REFRESH_SECRET`, correct `DATABASE_URL`, `TRUST_PROXY=true`, `STORAGE_DRIVER=s3`.
- [ ] `apps/web/.env.production`: correct `NEXT_PUBLIC_API_URL`.
- [ ] `npm run prod:migrate` succeeded (used `migrate deploy`, **not** `db push`).
- [ ] `npm run prod:build` succeeded.
- [ ] PM2 shows both apps online; `pm2 save` + `pm2 startup` done.
- [ ] ACM cert issued; ALB HTTPS listener uses it; HTTP→HTTPS redirect set.
- [ ] Route 53 `app`/`api` records resolve; HTTPS works.
- [ ] `/health` returns 200; login works; upload works.
- [ ] Monitoring/log alarms configured (CloudWatch).

---

## Appendix A — Optional: systemd instead of PM2

**PM2 is the supported, beginner-friendly process manager for this deployment.** This
section is optional, for teams that prefer native `systemd` units. If you use systemd,
you do **not** also run PM2 for the same apps.

Create `/etc/systemd/system/plethora-api.service`:

```ini
[Unit]
Description=Plethora API (Fastify)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/var/www/plethora/apps/api
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/plethora-web.service`:

```ini
[Unit]
Description=Plethora Web (Next.js)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/var/www/plethora/apps/web
Environment=NODE_ENV=production
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now plethora-api plethora-web
sudo systemctl status plethora-api plethora-web
journalctl -u plethora-api -f      # logs
```

> The API still reads `apps/api/.env` via the app's own dotenv loading. If `next` is
> hoisted to the repo-root `node_modules`, adjust the web `ExecStart` path to
> `/var/www/plethora/node_modules/next/dist/bin/next`.
