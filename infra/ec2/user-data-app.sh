#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get upgrade -y
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  jq \
  ruby-full \
  wget \
  unzip \
  chromium \
  fonts-liberation \
  libnss3 \
  libatk-bridge2.0-0 \
  libgtk-3-0 \
  libasound2t64 || apt-get install -y libasound2 \
  libxss1 \
  libgbm1

# Install Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
npm install -g npm@11.17.0

# Install AWS CLI v2 (detect architecture for ARM64 Graviton or x86_64)
ARCH="$(uname -m)"
if [[ "$ARCH" == "aarch64" ]]; then
  AWS_CLI_URL="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"
else
  AWS_CLI_URL="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"
fi
curl -fsSL "$AWS_CLI_URL" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install --update
rm -rf /tmp/aws /tmp/awscliv2.zip

# Install AWS CodeDeploy Agent for af-south-1
cd /tmp
wget -q "https://aws-codedeploy-af-south-1.s3.af-south-1.amazonaws.com/latest/install" -O codedeploy-install
chmod +x ./codedeploy-install
./codedeploy-install auto
systemctl enable codedeploy-agent
systemctl start codedeploy-agent
rm -f /tmp/codedeploy-install

# Create dedicated service user and application directories
id -u plethora >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin plethora
mkdir -p /opt/plethora/current /opt/plethora/release /run/plethora
chown -R plethora:plethora /opt/plethora /run/plethora
