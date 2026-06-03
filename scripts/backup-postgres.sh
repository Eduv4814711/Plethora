#!/usr/bin/env bash
#
# Plethora ERP — PostgreSQL backup.
#
# Dumps the database from the running `postgres` container to a compressed file
# under /opt/plethora/backups using pg_dump via `docker exec`. Connection
# details are read from /opt/plethora/.env (POSTGRES_USER / POSTGRES_DB).
#
# Usage:
#   /opt/plethora/apps/Plethora/scripts/backup-postgres.sh
#
# Schedule daily at 02:30 with cron (crontab -e):
#   30 2 * * * /opt/plethora/apps/Plethora/scripts/backup-postgres.sh >> /opt/plethora/logs/backup.log 2>&1
#
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/plethora}"
BACKUP_DIR="${BACKUP_DIR:-${DEPLOY_ROOT}/backups}"
ENV_FILE="${ENV_FILE:-${DEPLOY_ROOT}/.env}"
CONTAINER="${POSTGRES_CONTAINER:-plethora_postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env file not found: ${ENV_FILE}" >&2
  exit 1
fi

# Load POSTGRES_* without leaking the whole env into the shell history.
# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER missing in ${ENV_FILE}}"
POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB missing in ${ENV_FILE}}"

mkdir -p "${BACKUP_DIR}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTFILE="${BACKUP_DIR}/plethora_${POSTGRES_DB}_${TIMESTAMP}.sql.gz"

echo "==> Backing up database '${POSTGRES_DB}' from container '${CONTAINER}'"
docker exec -t "${CONTAINER}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  | gzip > "${OUTFILE}"

echo "==> Backup written: ${OUTFILE} ($(du -h "${OUTFILE}" | cut -f1))"

# Retention: delete dumps older than RETENTION_DAYS.
find "${BACKUP_DIR}" -name "plethora_*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete \
  | sed 's/^/==> Removed old backup: /' || true

echo "==> Done."
