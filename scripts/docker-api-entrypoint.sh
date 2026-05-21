#!/bin/sh
set -eu

cd /app/apps/api

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Running prisma migrate deploy..."
  npx prisma migrate deploy
fi

exec "$@"
