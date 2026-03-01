#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/var/www/concursaflix}
REPO_URL=${REPO_URL:-}
BRANCH=${BRANCH:-main}
API_DOMAIN=${API_DOMAIN:-}
FORCE_NGINX_UPDATE=${FORCE_NGINX_UPDATE:-false}

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

# ── Nginx: só copia config na primeira instalação ou com FORCE_NGINX_UPDATE=true ──
NGINX_CONF="/etc/nginx/sites-available/concursaflix-api"
NGINX_NEEDS_SETUP=false

if [[ ! -f "${NGINX_CONF}" ]]; then
  echo "Nginx: primeira instalação — copiando config da API..."
  NGINX_NEEDS_SETUP=true
elif [[ "${FORCE_NGINX_UPDATE}" == "true" ]]; then
  echo "Nginx: FORCE_NGINX_UPDATE=true — sobrescrevendo config da API..."
  NGINX_NEEDS_SETUP=true
else
  echo "Nginx: config da API já existe — pulando (use FORCE_NGINX_UPDATE=true para forçar)."
fi

if [[ "${NGINX_NEEDS_SETUP}" == "true" ]]; then
  cp "${APP_DIR}/deploy/hostinger/nginx.api.conf" "${NGINX_CONF}"
  sed -i "s/__API_DOMAIN__/${API_DOMAIN}/g" "${NGINX_CONF}"
  ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/concursaflix-api
  nginx -t
  systemctl reload nginx

  # Aplica SSL após copiar config HTTP-only
  if command -v certbot >/dev/null 2>&1; then
    echo "Aplicando SSL para ${API_DOMAIN} via certbot..."
    if certbot --nginx -d "${API_DOMAIN}" --non-interactive --agree-tos --redirect; then
      echo "SSL configurado com sucesso para ${API_DOMAIN}."
    else
      echo "[aviso] Falha ao aplicar SSL. Execute manualmente:"
      echo "  sudo API_DOMAIN=${API_DOMAIN} bash deploy/hostinger/20_configure_ssl.sh"
    fi
  else
    echo "[aviso] certbot não encontrado. Configure SSL manualmente:"
    echo "  sudo API_DOMAIN=${API_DOMAIN} bash deploy/hostinger/20_configure_ssl.sh"
  fi
fi

# ── Backend: restart com PM2 ──
pm2 delete concursaflix-backend >/dev/null 2>&1 || true
pm2 start "${APP_DIR}/server/babylonProxy.mjs" --name concursaflix-backend
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "Deploy backend concluído."
echo "Teste: https://${API_DOMAIN}/health"
