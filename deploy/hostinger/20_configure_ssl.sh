#!/usr/bin/env bash
set -euo pipefail

API_DOMAIN=${API_DOMAIN:-}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo API_DOMAIN=<dominio> bash deploy/hostinger/20_configure_ssl.sh"
  exit 1
fi

if [[ -z "${API_DOMAIN}" ]]; then
  echo "Informe API_DOMAIN"
  echo "Exemplo: sudo API_DOMAIN=api.seudominio.com bash deploy/hostinger/20_configure_ssl.sh"
  exit 1
fi

apt update
apt install -y certbot python3-certbot-nginx
certbot --nginx -d "${API_DOMAIN}"

systemctl reload nginx

echo "SSL configurado para ${API_DOMAIN}."
