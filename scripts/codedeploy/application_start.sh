#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-af-south-1}"
APP_SECRET_ID="${PLETHORA_APP_SECRET_ID:-plethora-prod-app-secrets}"
DB_SECRET_ID="${PLETHORA_DB_SECRET_ID:-plethora-prod-db-secret}"
S3_BUCKET="${PLETHORA_UPLOADS_BUCKET:-}"

# Fetch non-secret runtime metadata from EC2 tags or instance environment
if [[ -f /etc/plethora/instance.env ]]; then
  # shellcheck disable=SC1091
  source /etc/plethora/instance.env
  APP_SECRET_ID="${PLETHORA_APP_SECRET_ID:-$APP_SECRET_ID}"
  DB_SECRET_ID="${PLETHORA_DB_SECRET_ID:-$DB_SECRET_ID}"
  S3_BUCKET="${PLETHORA_UPLOADS_BUCKET:-$S3_BUCKET}"
fi

mkdir -p /run/plethora

DB_JSON="$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$DB_SECRET_ID" --query SecretString --output text)"
APP_JSON="$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$APP_SECRET_ID" --query SecretString --output text)"

DB_HOST="$(echo "$DB_JSON" | jq -r '.host')"
DB_PORT="$(echo "$DB_JSON" | jq -r '.port // 5432')"
DB_NAME="$(echo "$DB_JSON" | jq -r '.dbname // "plethora"')"
DB_USER="$(echo "$DB_JSON" | jq -r '.username')"
DB_PASS="$(echo "$DB_JSON" | jq -r '.password')"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require"

{
  echo "NODE_ENV=production"
  echo "HOST=0.0.0.0"
  echo "PORT=3001"
  echo "TRUST_PROXY=true"
  echo "AWS_REGION=${AWS_REGION}"
  echo "STORAGE_DRIVER=s3"
  echo "AWS_S3_BUCKET=${S3_BUCKET}"
  echo "DATABASE_URL=${DATABASE_URL}"
  echo "AI_ENABLED=$(echo "$APP_JSON" | jq -r '.AI_ENABLED // "true"')"
  echo "AI_PROVIDER=bedrock"
  echo "AI_REGION=${AWS_REGION}"
  echo "AI_MODEL=global.moonshotai.kimi-k3.1"
  echo "AI_TIMEOUT_MS=15000"
  echo "JWT_SECRET=$(echo "$APP_JSON" | jq -r '.JWT_SECRET')"
  echo "JWT_REFRESH_SECRET=$(echo "$APP_JSON" | jq -r '.JWT_REFRESH_SECRET')"
  echo "ENCRYPTION_KEY=$(echo "$APP_JSON" | jq -r '.ENCRYPTION_KEY')"
  echo "CRON_SECRET=$(echo "$APP_JSON" | jq -r '.CRON_SECRET')"
  echo "CORS_ORIGIN=$(echo "$APP_JSON" | jq -r '.CORS_ORIGIN // "https://plethora.quickbophasecurity.co.za"')"
  echo "FRONTEND_URL=$(echo "$APP_JSON" | jq -r '.FRONTEND_URL // "https://plethora.quickbophasecurity.co.za"')"
  echo "WHATSAPP_ENABLED=$(echo "$APP_JSON" | jq -r '.WHATSAPP_ENABLED // "false"')"
  echo "WHATSAPP_PHONE_NUMBER_ID=$(echo "$APP_JSON" | jq -r '.WHATSAPP_PHONE_NUMBER_ID // ""')"
  echo "WHATSAPP_WABA_ID=$(echo "$APP_JSON" | jq -r '.WHATSAPP_WABA_ID // ""')"
  echo "WHATSAPP_ACCESS_TOKEN=$(echo "$APP_JSON" | jq -r '.WHATSAPP_ACCESS_TOKEN // ""')"
  echo "WHATSAPP_VERIFY_TOKEN=$(echo "$APP_JSON" | jq -r '.WHATSAPP_VERIFY_TOKEN // ""')"
  echo "WHATSAPP_APP_SECRET=$(echo "$APP_JSON" | jq -r '.WHATSAPP_APP_SECRET // ""')"
  echo "WHATSAPP_API_VERSION=$(echo "$APP_JSON" | jq -r '.WHATSAPP_API_VERSION // "v26.0"')"
} > /run/plethora/env

{
  echo "NODE_ENV=production"
  echo "NEXT_PUBLIC_API_URL=$(echo "$APP_JSON" | jq -r '.NEXT_PUBLIC_API_URL // "https://api.quickbophasecurity.co.za"')"
  echo "NEXT_PUBLIC_API_PATH_PREFIX="
} > /run/plethora/web.env

chown plethora:plethora /run/plethora/env /run/plethora/web.env
chmod 0600 /run/plethora/env /run/plethora/web.env

systemctl restart plethora-api
systemctl restart plethora-web
