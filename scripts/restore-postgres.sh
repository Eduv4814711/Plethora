#!/usr/bin/env bash
#
# Plethora ERP — PostgreSQL restore.
#
# Restores a gzipped pg_dump produced by backup-postgres.sh into the running
# `postgres` container. DESTRUCTIVE: this drops and recreates schema objects
# contained in the dump. Stop the API first to avoid concurrent writes.
#
# Usage:
#   docker compose stop api
#   /opt/plethora/apps/Plethora/scripts/restore-postgres.sh /opt/plethora/backups/plethora_plethora_prod_20260101_023000.sql.gz
#   docker compose start api
#
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/plethora}"
ENV_FILE="${ENV_FILE:-${DEPLOY_ROOT}/.env}"
CONTAINER="${POSTGRES_CONTAINER:-plethora_postgres}"

BACKUP_FILE="${1:-}"
if [[ -z "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 <path-to-backup.sql.gz>" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env file not found: ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER missing in ${ENV_FILE}}"
POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB missing in ${ENV_FILE}}"

echo "WARNING: This will restore '${BACKUP_FILE}' into database '${POSTGRES_DB}'."
read -r -p "Type the database name to confirm: " CONFIRM
if [[ "${CONFIRM}" != "${POSTGRES_DB}" ]]; then
  echo "Aborted." >&2
  exit 1
fi

echo "==> Restoring into '${POSTGRES_DB}' (container '${CONTAINER}')"
gunzip -c "${BACKUP_FILE}" \
  | docker exec -i "${CONTAINER}" psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

echo "==> Restore complete. Remember to restart the API: docker compose start api"
