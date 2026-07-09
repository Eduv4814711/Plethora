#!/usr/bin/env bash
# Clean local start for Plethora (API :3001 + Web :3000)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Stopping leftover Next/API processes for this repo..."
pkill -f "$ROOT/node_modules/.bin/next" 2>/dev/null || true
pkill -f "$ROOT/node_modules/.bin/tsx watch" 2>/dev/null || true
pkill -f "concurrently.*dev:api.*dev:web" 2>/dev/null || true
pkill -f "next-server \\(v16" 2>/dev/null || true
sleep 1

echo "==> Cleaning corrupted .next cache..."
rm -rf "$ROOT/apps/web/.next"

echo "==> Checking database..."
cd "$ROOT/apps/api"
if ! node --input-type=module -e "
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  await p.\$queryRaw\`SELECT 1\`;
  console.log('Database reachable');
  process.exitCode = 0;
} catch (e) {
  console.error('Database NOT reachable:', String(e.message).split('\\n')[0]);
  console.error('Fix apps/api/.env DATABASE_URL (Railway must be online, or use local Postgres).');
  process.exitCode = 1;
} finally {
  await p.\$disconnect();
}
"; then
  exit 1
fi

echo "==> Applying migrations..."
npx prisma migrate deploy

echo "==> Starting API + Web (npm run dev:all)..."
cd "$ROOT"
exec npm run dev:all
