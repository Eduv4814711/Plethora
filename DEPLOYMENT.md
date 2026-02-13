# Deploy Plethora to Coolify (VPS)

This guide covers deploying Plethora to a VPS using Coolify.

## Prerequisites

- **VPS**: Linux server with SSH (e.g. Hetzner, DigitalOcean). Minimum 4GB RAM, 50GB storage.
- **Domain**: Two subdomains (e.g. `plethora.yourdomain.com` and `api.plethora.yourdomain.com`).
- **Git**: Repository pushed to GitHub or GitLab.

---

## Phase 1: Install Coolify

1. SSH into your server as root.
2. Run:
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
   ```
3. Access Coolify at `http://YOUR_SERVER_IP:8000` and create the admin account.
4. Connect your Git provider (GitHub App recommended) in Coolify settings.

---

## Phase 2: Add PostgreSQL

1. In Coolify: **Project** → **Add Resource** → **Database** → **PostgreSQL**.
2. Configure:
   - **Database name**: `plethora`
   - **Username**: `postgres`
   - **Password**: Set a strong password (save it).
3. Deploy. Copy the **internal connection URL** for the API.

---

## Phase 3: Deploy API

1. **Add Resource** → **Application** → **Dockerfile**.
2. **Source**: Connect your Git repo.
3. **Build Pack**: Dockerfile
4. **Dockerfile Location**: `apps/api/Dockerfile`
5. **Build Context**: `apps/api`
6. **Port**: `3001`
7. **Environment variables**:
   | Variable | Value |
   |----------|-------|
   | DATABASE_URL | PostgreSQL internal URL from Phase 2 |
   | JWT_SECRET | Random 32+ character string |
   | JWT_REFRESH_SECRET | Random 32+ character string |
   | CORS_ORIGIN | `https://plethora.yourdomain.com` |
   | PORT | `3001` |
8. **Domain**: Assign `api.plethora.yourdomain.com`.
9. Deploy.

---

## Phase 4: Deploy Web

1. **Add Resource** → **Application** → **Dockerfile**.
2. **Source**: Same Git repo.
3. **Build Pack**: Dockerfile
4. **Dockerfile Location**: `apps/web/Dockerfile`
5. **Build Context**: `apps/web`
6. **Port**: `3000`
7. **Environment variables** (build + runtime):
   | Variable | Value |
   |----------|-------|
   | NEXT_PUBLIC_API_URL | `https://api.plethora.yourdomain.com` |
8. **Domain**: Assign `plethora.yourdomain.com`.
9. Deploy.

---

## Phase 5: DNS and SSL

1. Point DNS A records to your server IP:
   - `plethora.yourdomain.com` → server IP
   - `api.plethora.yourdomain.com` → server IP
2. Coolify will automatically issue Let's Encrypt SSL certificates once DNS resolves.
3. Login at `https://plethora.yourdomain.com` with `admin@quickbopha.com` / `admin123`.

---

## Troubleshooting

- **CORS errors**: Ensure `CORS_ORIGIN` exactly matches your web URL (including `https://`).
- **Build fails**: Use Dockerfile Build Pack, not Nixpacks (Prisma support is limited in Nixpacks).
- **Database connection**: Use the internal Coolify URL for `DATABASE_URL`, not `localhost`.
