# Plethora — AWS EC2 (Non-Docker) Deployment Checklist

Practical, tickable checklist for the EC2 + PM2 + ALB + Route 53 + ACM + RDS + S3
deployment. Full instructions: [`AWS_EC2_NON_DOCKER_DEPLOYMENT.md`](AWS_EC2_NON_DOCKER_DEPLOYMENT.md).

> Do **not** use Docker for this path. Do **not** run `db:push` in production — use
> `npm run prod:migrate` (`prisma migrate deploy`). Use the EC2 IAM role for S3; never put
> AWS keys in `.env`. Never expose EC2 ports 3000/3001 publicly — only the ALB may reach them.

---

## Codebase readiness

- [ ] Env templates added (`apps/api/.env.production.example`, `apps/web/.env.production.example`)
- [ ] PM2 config added (`ecosystem.config.cjs`)
- [ ] Production scripts added (`prod:build`, `prod:migrate`, `prod:start:pm2`, `prod:restart:pm2`, `prod:logs`, `prod:status`)
- [ ] API builds successfully (`npm run build:api`)
- [ ] Web builds successfully (`npm run build:web`)
- [ ] Prisma client generates successfully (`npm run db:generate`)
- [ ] `TRUST_PROXY` supported by API (`apps/api/src/app.ts` + `env.ts`)
- [ ] No secrets committed (`.env`, `.env.production` are git-ignored / not staged)

## AWS readiness

- [ ] RDS PostgreSQL created (private, `sslmode=require`, initial DB `plethora`)
- [ ] Application DB user `plethora_user` created
- [ ] S3 bucket created (`plethora-prod-uploads`, Block Public Access ON, versioning ON)
- [ ] EC2 IAM role created and attached (least-privilege S3 access to the bucket)
- [ ] ALB created (internet-facing, in public subnets)
- [ ] ACM certificate issued for `app.` and `api.` subdomains (DNS-validated)
- [ ] Route 53 A-Alias records created for `app.plethora` and `api.plethora`
- [ ] Security groups locked down (ALB→internet; EC2 3000/3001 from ALB only; RDS 5432 from EC2 only; SSH from admin IP only)

## Deployment readiness

- [ ] Node.js 24 + PM2 + Chromium + postgresql-client installed on EC2
- [ ] Repo cloned to `/var/www/plethora`
- [ ] `npm install` completed
- [ ] `apps/api/.env` created from template and filled in (incl. `TRUST_PROXY=true`, `STORAGE_DRIVER=s3`)
- [ ] `apps/web/.env.production` created from template and filled in (before building)
- [ ] `npm run prod:migrate` completed
- [ ] `npm run prod:build` completed
- [ ] PM2 processes running (`plethora-api` + `plethora-web` online)
- [ ] API health check passing (`/health` → 200)
- [ ] Web app loading
- [ ] Login tested
- [ ] Upload tested (object appears in S3 and renders in UI)
- [ ] Logs checked (`npm run prod:logs`)

## Go-live readiness

- [ ] DNS propagated (`app.` and `api.` resolve to the ALB)
- [ ] HTTPS working (valid cert, HTTP→HTTPS redirect)
- [ ] RDS automated backups enabled
- [ ] S3 versioning enabled
- [ ] PM2 startup saved (`pm2 save` + `pm2 startup systemd`)
- [ ] Monitoring configured (CloudWatch metrics/alarms, log retention)
- [ ] Rollback plan ready (previous build kept; RDS snapshot/restore understood)
