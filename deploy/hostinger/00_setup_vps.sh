#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo bash deploy/hostinger/00_setup_vps.sh"
  exit 1
fi

apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg ufw git nginx

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "Setup base concluído. Próximo passo: 10_deploy_backend.sh"
