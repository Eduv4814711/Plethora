# Plethora API (Fastify + Prisma) — production image
# Build context: REPO ROOT (this is a npm-workspaces monorepo with a shared lockfile).
#   docker build -f apps/api/Dockerfile -t plethora-api .
#
# NOTE on Node version: the repo pins Node 24.x (package.json "engines" +
# .nvmrc) with engine-strict=true, so the image uses node:24 even though the
# VM host runs Node 20 via nvm. Host Node is irrelevant to container builds.
#
# Multi-stage:
#   1) builder  -> install all deps, prisma generate, tsc build, copy templates
#   2) runtime  -> prod-only deps + compiled dist + prisma schema/migrations + chromium

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Never download Chromium during `npm install` (we use the system chromium at runtime).
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# OpenSSL is required by Prisma's query engine; python3/make/g++ let native
# modules (e.g. bcrypt) compile if no prebuilt binary is available.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
# All workspace package.json files referenced by the root "workspaces" glob must
# be present for `npm ci` to resolve the workspace tree.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

# Copy the API source and build it (prisma generate && tsc && copy templates).
COPY apps/api ./apps/api
RUN npm run build --workspace=api

# Drop dev dependencies, then regenerate the Prisma client into the pruned tree.
RUN npm prune --omit=dev \
 && npm run db:generate --workspace=api

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app/apps/api

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Runtime libraries: OpenSSL (Prisma) + Chromium (HTML->PDF via puppeteer-core).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# Copy the fully built, dev-pruned monorepo tree (hoisted root node_modules,
# any nested workspace node_modules, compiled dist, Prisma schema + migrations).
COPY --from=builder /app /app

# Uploads volume mount point (bind-mounted to /opt/plethora/data/uploads).
RUN mkdir -p /app/uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Apply pending migrations, then start the compiled server.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
