#!/usr/bin/env bash
set -euo pipefail

FILE="/etc/nginx/sites-available/concursaflix-api"
if [[ ! -f "$FILE" ]]; then
  echo "Arquivo não encontrado: $FILE"
  exit 1
fi

cp "$FILE" "${FILE}.bak"

# Remove bloqueio incorreto que quebra preflight CORS (OPTIONS)
sed -i '/if (\$http_authorization = "") { return 401; }/d' "$FILE"

nginx -t
systemctl reload nginx

echo "Nginx atualizado com sucesso."

echo "--- Teste preflight (deve retornar 204/200, não 401) ---"
curl -i -X OPTIONS 'https://api.combosalvauniversitario.site/api/babylon/transactions' \
  -H 'Origin: https://app.combosalvauniversitario.site' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization'
