#!/usr/bin/env bash
set -euo pipefail

# Swap release into /opt/plethora/current atomically
rm -rf /opt/plethora/previous
if [[ -d /opt/plethora/current ]]; then
  mv /opt/plethora/current /opt/plethora/previous
fi
mv /opt/plethora/release /opt/plethora/current
chown -R plethora:plethora /opt/plethora/current

# Ensure Amazon RDS Global CA Bundle is present for verified PostgreSQL TLS
if [[ ! -s /etc/ssl/certs/rds-global-bundle.pem ]]; then
  curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /etc/ssl/certs/rds-global-bundle.pem
  chmod 0644 /etc/ssl/certs/rds-global-bundle.pem
fi

# Install systemd unit files from the release bundle
cp /opt/plethora/current/infra/ec2/systemd/plethora-api.service /etc/systemd/system/plethora-api.service
cp /opt/plethora/current/infra/ec2/systemd/plethora-web.service /etc/systemd/system/plethora-web.service
systemctl daemon-reload
systemctl enable plethora-api plethora-web
