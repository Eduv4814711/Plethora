#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export HOME=/root
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"

apt-get update -y
apt-get install -y ca-certificates curl

# Install Ollama natively (no Docker)
curl -fsSL https://ollama.com/install.sh | sh

# Bind Ollama to all VPC interfaces on port 11434 and keep model loaded in RAM
mkdir -p /etc/systemd/system/ollama.service.d
cat <<'EOF' > /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=24h"
Environment="OLLAMA_NUM_PARALLEL=2"
EOF

systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama

# Wait for Ollama daemon to listen before pulling the model
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

ollama pull "$OLLAMA_MODEL"
