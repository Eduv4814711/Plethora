#!/usr/bin/env bash
set -euo pipefail

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/health/ready >/dev/null && curl -fsS http://127.0.0.1:3000/ >/dev/null; then
    echo "Plethora API and Web services are healthy."
    exit 0
  fi
  sleep 2
done

echo "Health check failed after 60s."
journalctl -u plethora-api -n 40 --no-pager || true
journalctl -u plethora-web -n 40 --no-pager || true
exit 1
