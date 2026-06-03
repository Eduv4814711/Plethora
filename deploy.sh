#!/usr/bin/env bash
#
# Plethora ERP — production deploy / update script for the Sive.host VM.
#
# Pulls the latest code, rebuilds the images and restarts the stack.
# Safe to re-run. Run as the deploy user (member of the docker group):
#
#   /opt/plethora/apps/Plethora/deploy.sh
#
set -euo pipefail

# --- Configuration (override via environment if your layout differs) --------
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/plethora}"
REPO_DIR="${REPO_DIR:-${DEPLOY_ROOT}/apps/Plethora}"
GIT_BRANCH="${GIT_BRANCH:-main}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# --- Pre-flight checks ------------------------------------------------------
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "ERROR: ${REPO_DIR} is not a git checkout. Clone the repo first:" >&2
  echo "  git clone https://github.com/Plethora-ERP/Plethora.git ${REPO_DIR}" >&2
  exit 1
fi

if [[ ! -f "${DEPLOY_ROOT}/.env" ]]; then
  echo "ERROR: ${DEPLOY_ROOT}/.env not found." >&2
  echo "  cp ${REPO_DIR}/.env.production.example ${DEPLOY_ROOT}/.env && nano ${DEPLOY_ROOT}/.env" >&2
  exit 1
fi

# --- Pull latest code -------------------------------------------------------
log "Updating ${REPO_DIR} (branch: ${GIT_BRANCH})"
cd "${REPO_DIR}"
git fetch --prune origin
git checkout "${GIT_BRANCH}"
git pull --ff-only origin "${GIT_BRANCH}"

# --- Ensure compose file is reachable from the deploy root ------------------
# docker compose is invoked from ${DEPLOY_ROOT} so it auto-loads ${DEPLOY_ROOT}/.env.
if [[ ! -e "${DEPLOY_ROOT}/docker-compose.yml" ]]; then
  log "Linking docker-compose.yml into ${DEPLOY_ROOT}"
  ln -s "${REPO_DIR}/docker-compose.yml" "${DEPLOY_ROOT}/docker-compose.yml"
fi

# --- Rebuild and restart ----------------------------------------------------
cd "${DEPLOY_ROOT}"

log "Building images"
docker compose build

log "Starting / updating containers"
docker compose up -d

log "Pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

log "Current containers"
docker compose ps

log "Deploy complete."
