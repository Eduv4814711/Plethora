# Google Cloud Run (Docker)

Deploy the Plethora **API** and **Web** as separate Cloud Run services using the root Dockerfiles [`Dockerfile.api`](../Dockerfile.api) and [`Dockerfile.web`](../Dockerfile.web). Build context is always the **monorepo root** (`.`).

## Prerequisites

- **Google Cloud project** with billing enabled, APIs enabled: Cloud Run, Artifact Registry (or Container Registry), Cloud Build (optional).
- **Artifact Registry** Docker repository (example: `REGION-docker.pkg.dev/PROJECT/plethora`).
- **PostgreSQL** reachable from Cloud Run (common pattern: [**Cloud SQL**](https://cloud.google.com/sql/docs/postgres/connect-run) with the Cloud SQL Auth Proxy sidecar or Unix socket; or a managed Postgres URL that allows your Cloud Run egress IPs / VPC connector).
- **Secrets**: store `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and any third-party tokens in [Secret Manager](https://cloud.google.com/secret-manager) and mount them as env vars on deploy — do not commit secrets to the repo.

## Build and push images

Set variables (example):

```bash
export PROJECT_ID=your-gcp-project
export REGION=europe-west1
export REPO=plethora
export REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
```

**API image**

```bash
docker build -f Dockerfile.api -t "${REGISTRY}/plethora-api:latest" .
docker push "${REGISTRY}/plethora-api:latest"
```

**Web image** — `NEXT_PUBLIC_*` values are fixed at **build** time for the browser bundle and for `next.config.js` rewrites.

```bash
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_URL="https://your-api-xxxxx.run.app" \
  --build-arg NEXT_PUBLIC_API_PATH_PREFIX="" \
  -t "${REGISTRY}/plethora-web:latest" .
docker push "${REGISTRY}/plethora-web:latest"
```

## Deploy to Cloud Run

Minimal examples (adjust memory/CPU, VPC connector, Cloud SQL attachment, and service accounts as needed):

**API**

```bash
gcloud run deploy plethora-api \
  --image "${REGISTRY}/plethora-api:latest" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --set-env-vars "NODE_ENV=production,CORS_ORIGIN=https://your-web-xxxxx.run.app,FRONTEND_URL=https://your-web-xxxxx.run.app" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest"
```

**Web**

```bash
gcloud run deploy plethora-web \
  --image "${REGISTRY}/plethora-web:latest" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --set-env-vars "NODE_ENV=production"
```

Cloud Run injects **`PORT`**; both apps read it (Fastify in the API, Next.js for the web server). Default `8080` in the Dockerfiles matches Cloud Run’s convention when you wire `--port 8080`.

## Environment variables checklist

| Service | Variable | Notes |
|--------|----------|--------|
| API | `DATABASE_URL` | Postgres connection string (Cloud SQL often uses socket host or proxy). |
| API | `JWT_SECRET` / `JWT_REFRESH_SECRET` | Required for auth; use strong random values. |
| API | `CORS_ORIGIN` | Web origin(s), comma-separated if multiple; include `https://`. |
| API | `FRONTEND_URL` | Base URL for invite/setup-password links in emails. |
| API | `PORT` | Optional; Cloud Run sets this. |
| Web | `NEXT_PUBLIC_API_URL` | **Build-arg** when building `Dockerfile.web`, not only at runtime. |
| Web | `NEXT_PUBLIC_API_PATH_PREFIX` | Optional build-arg if the API is behind a path prefix. |

Add any variables from [`apps/api/.env.example`](../apps/api/.env.example) / [`apps/web/.env.example`](../apps/web/.env.example) that you use in production (e.g. WhatsApp, `PUPPETEER_EXECUTABLE_PATH`).

## Uploads, PDFs, and ephemeral disks

- **Uploads**: the API stores files under a local `uploads` directory by default. Cloud Run’s filesystem is **ephemeral** unless you mount a volume (e.g. Cloud Storage FUSE or a network filesystem). For production, point uploads at **Google Cloud Storage** or another durable store, or accept that local files are lost on scale-to-zero / new revisions.
- **PDF generation**: the API can use **Puppeteer** or **puppeteer-core** with `PUPPETEER_EXECUTABLE_PATH`. The slim Node image may need extra OS libraries or a bundled Chromium path; PDF routes may fail until Chromium and its dependencies are available in the container. See comments in `apps/api/.env.example` and [`apps/api/src/lib/pdf-browser.ts`](../apps/api/src/lib/pdf-browser.ts).

## Prisma migrations

The API image runs `prisma migrate deploy` on **`npm start`** before `node dist/index.js`. Ensure `apps/api/prisma/migrations` is present in the image (it is copied with `apps/api` in the builder). Archived migrations are excluded from the Docker **build context** via `.dockerignore` but are not required for `migrate deploy`.

## Related docs

- Railway-focused steps: [DEPLOYMENT.md](../DEPLOYMENT.md)
