# Plethora Web (Next.js 16) — production image (standalone output)
# Build context: REPO ROOT (npm-workspaces monorepo with a shared lockfile).
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.co.za -t plethora-web .
#
# NEXT_PUBLIC_* values are inlined at BUILD time, so the public API URL must be
# passed as a build arg (see docker-compose.yml -> web.build.args).
#
# NOTE on Node version: the repo pins Node 24.x (engines + engine-strict), so
# this image uses node:24 even though the VM host runs Node 20 via nvm.

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# DOCKER_BUILD=1 switches next.config.js to `output: "standalone"`.
ENV DOCKER_BUILD=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Build tools so any native module in the shared workspace lockfile (e.g. the
# api's bcrypt) can compile during `npm ci` if no prebuilt binary is available.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci

# Public, build-time configuration (inlined into the client bundle).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_PATH_PREFIX=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_API_PATH_PREFIX=$NEXT_PUBLIC_API_PATH_PREFIX

# Build the web workspace.
COPY apps/web ./apps/web
RUN npm run build --workspace=web

# ---------------------------------------------------------------------------
# Stage 2: runner
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Standalone server + static assets + public files.
# outputFileTracingRoot is the monorepo root, so the standalone tree mirrors
# /app and the server entrypoint lives at /app/apps/web/server.js.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
