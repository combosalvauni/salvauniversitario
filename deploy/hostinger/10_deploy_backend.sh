#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/var/www/concursaflix}
REPO_URL=${REPO_URL:-}
BRANCH=${BRANCH:-main}
API_DOMAIN=${API_DOMAIN:-}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo REPO_URL=<repo> API_DOMAIN=<dominio> bash deploy/hostinger/10_deploy_backend.sh"
  exit 1
fi

if [[ -z "${REPO_URL}" || -z "${API_DOMAIN}" ]]; then
  echo "Informe REPO_URL e API_DOMAIN"
  echo "Exemplo:"
  echo "sudo REPO_URL=https://github.com/seu/repo.git API_DOMAIN=api.seudominio.com bash deploy/hostinger/10_deploy_backend.sh"
  exit 1
fi

mkdir -p "${APP_DIR}"
if [[ ! -d "${APP_DIR}/.git" ]]; then
  git clone "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"
git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"

npm ci

if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/deploy/hostinger/backend.env.example" "${APP_DIR}/.env"
  echo "Arquivo .env criado em ${APP_DIR}/.env. Preencha as variáveis antes de continuar."
fi

cp "${APP_DIR}/deploy/hostinger/nginx.api.conf" "/etc/nginx/sites-available/concursaflix-api"
sed -i "s/__API_DOMAIN__/${API_DOMAIN}/g" "/etc/nginx/sites-available/concursaflix-api"

ln -sf /etc/nginx/sites-available/concursaflix-api /etc/nginx/sites-enabled/concursaflix-api
nginx -t
systemctl restart nginx

pm2 delete concursaflix-backend >/dev/null 2>&1 || true
pm2 start "${APP_DIR}/server/babylonProxy.mjs" --name concursaflix-backend
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "Deploy backend concluído."
echo "Teste: https://${API_DOMAIN}/health"
