# Plethora ERP

Plethora ERP is a multi-tenant workforce operations platform for security
companies. It includes rostering, attendance, payroll, academy, WhatsApp,
reporting, audit, document, approval, and task-management modules.

This repository is an npm workspaces monorepo:

- `apps/api` - Fastify API, Prisma schema, migrations, seed scripts, services,
  and integrations.
- `apps/web` - Next.js App Router frontend.
- `docs` - product, security, deployment, and module documentation.
- `scripts` - local utility scripts.

## Windows Local Setup

These instructions are for running Plethora on a Windows development machine
with PowerShell.

## Required Tools

Install these before running the project:

1. **Git for Windows**
   - Download: <https://git-scm.com/download/win>
   - During install, choose the option that adds Git to your PATH.
   - Verify in a new PowerShell window:

     ```powershell
     git --version
     ```

2. **Node.js 24.x LTS and npm 11.x**
   - The project declares Node `24.x` and npm `11.x` in `package.json`, with
     Node 24 mirrored in `.node-version` and `.nvmrc`.
   - Download Node 24 LTS from <https://nodejs.org/>.
   - Verify:

     ```powershell
     node --version
     npm --version
     ```

   - `node --version` should print `v26...` and `npm --version` should print
     `11...`.

3. **PostgreSQL**
   - Download: <https://www.postgresql.org/download/windows/>
   - Install PostgreSQL locally.
   - Remember the password you set for the `postgres` database user.
   - Keep the default port `5432` unless you already use another port.
   - Verify:

     ```powershell
     psql --version
     ```

   If `psql` is not found, add PostgreSQL's `bin` folder to your PATH. It is
   usually similar to:

   ```text
   C:\Program Files\PostgreSQL\16\bin
   ```

4. **Visual Studio Code or another editor**
   - Recommended extensions:
     - Prisma
     - ESLint
     - Tailwind CSS IntelliSense
     - Prettier

5. **Optional: Google Chrome or Chromium**
   - The API uses Puppeteer for PDF generation. The `puppeteer` package can
     download a browser during `npm install`, but on some machines you may want
     to use an installed Chrome executable and set `PUPPETEER_EXECUTABLE_PATH`
     in `apps/api/.env`.

## Get The Code

If you have not already downloaded the project, clone it:

```powershell
git clone <repository-url>
cd Plethora-main
```

If you already have the project folder, open PowerShell in the repository root.
The root is the folder that contains `package.json`, `apps`, and `docs`.

## Install Dependencies

From the repository root:

```powershell
npm install
```

This installs dependencies for the root workspace, `apps/api`, and `apps/web`.

If installation fails on `bcrypt` or another native package, confirm you are
using Node 24 LTS and npm 11. Installing the latest Visual Studio
Build Tools can also help with native dependency compilation on Windows.

## Create The Local PostgreSQL Database

Open PowerShell and create a database named `plethora`.

If your PostgreSQL install includes the `createdb` command:

```powershell
createdb -U postgres plethora
```

If that prompts for a password, enter the PostgreSQL password you created during
installation.

Alternatively, use `psql`:

```powershell
psql -U postgres
```

Then run:

```sql
CREATE DATABASE plethora;
\q
```

## Configure Environment Files

Create local environment files from the examples:

```powershell
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\web\.env.example apps\web\.env.local
```

Open `apps\api\.env` and set `DATABASE_URL` for your local PostgreSQL database.
For the default local `postgres` user, it should look like this:

```env
DATABASE_URL="postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/plethora?schema=public"
JWT_SECRET="change-this-in-production"
JWT_REFRESH_SECRET="change-this-refresh-in-production"
CORS_ORIGIN="http://localhost:3000"
FRONTEND_URL="http://localhost:3000"
PORT=3001
```

Replace `YOUR_POSTGRES_PASSWORD` with your actual local PostgreSQL password.

For local development, the placeholder JWT values are acceptable. In production,
they must be replaced with different random strings of at least 32 characters.

Open `apps\web\.env.local` and confirm it points to the local API:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_API_PATH_PREFIX=
```

## Set Up The Database Schema

Generate Prisma Client:

```powershell
npm run db:generate
```

Apply the database schema locally:

```powershell
npm run db:migrate
```

If you want a quick local schema sync instead of migration history while
developing, you can use:

```powershell
npm run db:push
```

Seed the local database with the initial company and admin user:

```powershell
$env:SEED_ADMIN_EMAIL="admin@example.test"
$env:SEED_ADMIN_PASSWORD="replace-with-a-strong-random-credential"
npm run db:seed
```

The seed refuses missing or weak credentials and never prints the password.

## Run Plethora Locally

Start the API and web app together from the repository root:

```powershell
npm run dev:all
```

This starts:

- API: `http://localhost:3001`
- Web app: `http://localhost:3000`

Open the app in your browser:

```text
http://localhost:3000
```

Sign in with the seed credentials you supplied above.

## Run Services Separately

If you prefer separate terminals, open two PowerShell windows.

Terminal 1:

```powershell
npm run dev:api
```

Terminal 2:

```powershell
npm run dev:web
```

## Verify Everything Works

Check the API health endpoint:

```powershell
Invoke-RestMethod http://localhost:3001/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "plethora-api"
}
```

Then open `http://localhost:3000`, log in, and confirm the dashboard loads.

## Useful Development Commands

Run all tests for the API:

```powershell
npm run test --workspace=api
```

Run web tests:

```powershell
npm run test:web
```

Build the API and web app:

```powershell
npm run build
```

Build only the API:

```powershell
npm run build:api
```

Build only the web app:

```powershell
npm run build:web
```

Open Prisma Studio:

```powershell
npm run db:studio --workspace=api
```

Check database connectivity:

```powershell
npm run db:check --workspace=api
```

Reset the seeded admin password:

```powershell
Set-Location apps\api
npx tsx prisma/reset-admin.ts
Set-Location ..\..
```

## Optional Integrations

### WhatsApp Cloud API

WhatsApp is optional and disabled by default. Set `WHATSAPP_ENABLED=true` only
when testing Meta WhatsApp webhooks with all four credentials:

```env
WHATSAPP_ENABLED=false
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_API_VERSION=v21.0
```

For production setup, read `docs/WHATSAPP_PRODUCTION.md`.

### Uploads

By default, uploaded files are stored under an `uploads` folder relative to the
API working directory. To use a custom writable directory:

```env
UPLOADS_DIR=C:\plethora\uploads
```

### PDF Browser

If PDF generation cannot find a browser, install Chrome and set:

```env
PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

## Troubleshooting

### `git` is not recognized

Install Git for Windows and make sure the installer adds Git to your PATH. Close
and reopen PowerShell, then run:

```powershell
git --version
```

### `node` is the wrong version

Install Node.js 24.x LTS with npm 11.x. Close and reopen PowerShell, then verify:

```powershell
node --version
```

### API fails with `Could not connect to PostgreSQL`

Check that PostgreSQL is running and `apps\api\.env` has the correct
`DATABASE_URL`.

Common local format:

```env
DATABASE_URL="postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/plethora?schema=public"
```

Also confirm the database exists:

```powershell
psql -U postgres -l
```

### Port `3000` or `3001` is already in use

Find the process using the port:

```powershell
netstat -ano | findstr :3000
netstat -ano | findstr :3001
```

Stop the process from Task Manager, or change the API `PORT` in
`apps\api\.env`. If you change the API port, update `NEXT_PUBLIC_API_URL` in
`apps\web\.env.local` too.

### Prisma Client is missing or out of date

Run:

```powershell
npm run db:generate
```

Then restart the dev servers.

### Login does not work

Make sure you seeded the database:

```powershell
$env:SEED_ADMIN_EMAIL="admin@example.test"
$env:SEED_ADMIN_PASSWORD="replace-with-a-strong-random-credential"
npm run db:seed
```

Use the same email and password you supplied to the seed command.

### Browser cannot reach the API

Confirm the web environment file contains:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Then restart the Next.js dev server. Next.js only reads `.env.local` when the
server starts.

## Deployment

Plethora ERP is deployed on Railway. See `DEPLOYMENT_RAILWAY.md` for production
deployment instructions and environment variables.

`DEPLOYMENT_AZURE.md` is a research proposal for migrating that deployment to
Azure (Container Apps + PostgreSQL Flexible Server). It is not provisioned;
Railway remains production.

## Additional Documentation

- `docs/PLETHORA-USER-MANUAL.md`
- `docs/ROSTER_ENGINE.md`
- `docs/SECURITY.md`
- `docs/WHATSAPP_PRODUCTION.md`
- `apps/api/prisma/schema.prisma`

## License

Proprietary. Internal use only unless separately authorised.
