#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# 30_setup_evolution_api.sh — Instala e configura Evolution API v2
# para envio de WhatsApp gratuito (self-hosted).
#
# Uso:
#   sudo bash deploy/hostinger/30_setup_evolution_api.sh
#
# Pré-requisitos: Docker instalado (o script instala se necessário)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo bash deploy/hostinger/30_setup_evolution_api.sh"
  exit 1
fi

EVOLUTION_PORT=${EVOLUTION_PORT:-8080}
EVOLUTION_API_KEY=${EVOLUTION_API_KEY:-$(openssl rand -hex 32)}
EVOLUTION_INSTANCE=${EVOLUTION_INSTANCE:-salva}
APP_DIR=${APP_DIR:-/var/www/concursaflix}

echo "════════════════════════════════════════════════"
echo " Evolution API — Setup"
echo "════════════════════════════════════════════════"
echo " Porta:      ${EVOLUTION_PORT}"
echo " Instância:  ${EVOLUTION_INSTANCE}"
echo " API Key:    ${EVOLUTION_API_KEY}"
echo "════════════════════════════════════════════════"

# ── 1. Instala Docker se não existir ──
if ! command -v docker >/dev/null 2>&1; then
  echo "[1/5] Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "[1/5] Docker já instalado."
fi

# ── 2. Para container antigo se existir ──
echo "[2/5] Removendo container anterior (se houver)..."
docker rm -f evolution-api 2>/dev/null || true

# ── 3. Cria volume para persistir sessão do WhatsApp ──
echo "[3/5] Criando volume para dados..."
docker volume create evolution_data 2>/dev/null || true

# ── 4. Inicia Evolution API ──
echo "[4/5] Iniciando Evolution API..."
docker run -d \
  --name evolution-api \
  --restart unless-stopped \
  -p "${EVOLUTION_PORT}:8080" \
  -e AUTHENTICATION_API_KEY="${EVOLUTION_API_KEY}" \
  -e AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true \
  -v evolution_data:/evolution/instances \
  atendai/evolution-api:latest

echo "Aguardando Evolution API iniciar..."
sleep 8

# Verifica se está rodando
if docker ps --filter name=evolution-api --format '{{.Status}}' | grep -q "Up"; then
  echo "✅ Evolution API rodando na porta ${EVOLUTION_PORT}"
else
  echo "❌ Evolution API falhou ao iniciar. Verifique: docker logs evolution-api"
  exit 1
fi

# ── 5. Cria instância automaticamente ──
echo "[5/5] Criando instância '${EVOLUTION_INSTANCE}'..."
CREATE_RESPONSE=$(curl -s -X POST "http://localhost:${EVOLUTION_PORT}/instance/create" \
  -H "apikey: ${EVOLUTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"instanceName\": \"${EVOLUTION_INSTANCE}\",
    \"integration\": \"WHATSAPP-BAILEYS\",
    \"qrcode\": true
  }" || echo '{"error":"request_failed"}')

echo ""
echo "${CREATE_RESPONSE}" | python3 -m json.tool 2>/dev/null || echo "${CREATE_RESPONSE}"

# ── 6. Atualiza .env do backend ──
if [[ -f "${APP_DIR}/.env" ]]; then
  echo ""
  echo "Atualizando ${APP_DIR}/.env com variáveis do Evolution API..."

  # Remove linhas antigas de WhatsApp/Evolution se existirem
  sed -i '/^WHATSAPP_ENABLED=/d' "${APP_DIR}/.env"
  sed -i '/^EVOLUTION_API_URL=/d' "${APP_DIR}/.env"
  sed -i '/^EVOLUTION_API_KEY=/d' "${APP_DIR}/.env"
  sed -i '/^EVOLUTION_INSTANCE=/d' "${APP_DIR}/.env"
  sed -i '/^WHATSAPP_AUDIO_URL=/d' "${APP_DIR}/.env"
  sed -i '/^# .* WhatsApp/d' "${APP_DIR}/.env"

  cat >> "${APP_DIR}/.env" <<EOF

# ── WhatsApp via Evolution API (self-hosted, gratuito) ──
WHATSAPP_ENABLED=true
EVOLUTION_API_URL=http://127.0.0.1:${EVOLUTION_PORT}
EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
EVOLUTION_INSTANCE=${EVOLUTION_INSTANCE}
WHATSAPP_AUDIO_URL=
EOF

  echo "✅ .env atualizado"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo " PRÓXIMO PASSO: Conectar seu WhatsApp"
echo ""
echo " 1. Abra no navegador:"
echo "    http://SEU_IP:${EVOLUTION_PORT}/instance/connect/${EVOLUTION_INSTANCE}"
echo ""
echo " Ou pegue o QR code via API:"
echo "    curl -s http://localhost:${EVOLUTION_PORT}/instance/connect/${EVOLUTION_INSTANCE} \\"
echo "      -H 'apikey: ${EVOLUTION_API_KEY}' | python3 -m json.tool"
echo ""
echo " 2. Escaneie o QR code com WhatsApp > Aparelhos conectados > Conectar"
echo ""
echo " 3. Após conectar, reinicie o backend:"
echo "    pm2 restart concursaflix-backend"
echo ""
echo " 4. (Opcional) Para enviar áudio, hospede um .ogg e preencha:"
echo "    WHATSAPP_AUDIO_URL=https://seu-dominio.com/audio/boas-vindas.ogg"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Credenciais salvas — copie a API Key se precisar:"
echo "  EVOLUTION_API_KEY=${EVOLUTION_API_KEY}"
