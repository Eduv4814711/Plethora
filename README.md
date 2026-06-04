# Plethora ERP

Plethora ERP is a multi-tenant workforce operations, rostering, attendance,
payroll, academy, WhatsApp, reporting and audit platform for Quick Bopha
Security and related deployments.

## Repository Layout

This is an npm workspaces monorepo:

- `apps/api` — Fastify API, Prisma schema and migrations, domain services, WhatsApp integration.
- `apps/web` — Next.js App Router frontend.
- `docs` — product, security and module documentation.
- `scripts` — local utility scripts that are not production deployment paths.

## Local Development

Use Node.js 24.x and npm.

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run db:push
npm run dev:all
```

The API defaults to `http://localhost:3001`. The web app defaults to
`http://localhost:3000` and calls the API through `NEXT_PUBLIC_API_URL`.

## Database

Prisma schema and migrations live in `apps/api/prisma`.

Useful root commands:

- `npm run db:generate`
- `npm run db:migrate`
- `npm run db:migrate:deploy`
- `npm run db:push` for local development only
- `npm run db:seed`

## Build And Test

```bash
npm run build
npm run test --workspace=api
```

## Deployment

Plethora ERP is deployed on Railway. See `DEPLOYMENT_RAILWAY.md`.

## Documentation

- `docs/PLETHORA-USER-MANUAL.md`
- `docs/ROSTER_ENGINE.md`
- `docs/SECURITY.md`
- `docs/WHATSAPP_PRODUCTION.md`
- `apps/api/prisma/schema.prisma`

## License

Proprietary. Internal use only unless separately authorised.
