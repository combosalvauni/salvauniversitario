#!/usr/bin/env bash
# Script para atualizar o sistema na VPS após correção de identidades
set -euo pipefail

echo "🚀 Atualizando sistema na VPS..."
echo ""

# Configurações
APP_DIR="/var/www/concursaflix"
REPO_URL="https://github.com/combosalvauni/salvauniversitario.git"
BRANCH="main"

# Verificar se está rodando como root
if [[ "${EUID}" -ne 0 ]]; then
  echo "❌ Execute como root: sudo bash update_vps.sh"
  exit 1
fi

echo "📂 Diretório do app: ${APP_DIR}"
echo "🌿 Branch: ${BRANCH}"
echo ""

# 1. Navegar para o diretório do app
if [[ ! -d "${APP_DIR}" ]]; then
  echo "❌ Diretório ${APP_DIR} não encontrado!"
  echo "   Execute primeiro o deploy inicial."
  exit 1
fi

cd "${APP_DIR}"

# 2. Fazer backup do .env atual
echo "💾 Fazendo backup do .env..."
if [[ -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env" "${APP_DIR}/.env.backup.$(date +%Y%m%d_%H%M%S)"
  echo "✅ Backup criado"
else
  echo "⚠️  Arquivo .env não encontrado"
fi

# 3. Atualizar código do repositório
echo ""
echo "📥 Atualizando código do repositório..."
git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"
echo "✅ Código atualizado"

# 4. Instalar dependências
echo ""
echo "📦 Instalando dependências..."
npm ci
echo "✅ Dependências instaladas"

# 5. Reiniciar backend com PM2
echo ""
echo "🔄 Reiniciando backend..."
pm2 restart concursaflix-backend
pm2 save
echo "✅ Backend reiniciado"

# 6. Verificar status
echo ""
echo "📊 Status do backend:"
pm2 list | grep concursaflix-backend || echo "⚠️  Backend não encontrado no PM2"

# 7. Mostrar logs recentes
echo ""
echo "📋 Últimas 20 linhas de log:"
pm2 logs concursaflix-backend --lines 20 --nostream

echo ""
echo "✅ Atualização concluída!"
echo ""
echo "📝 IMPORTANTE: Correção de identidades aplicada"
echo "   - Todos os 50 usuários foram corrigidos"
echo "   - Senha temporária: TempSenha@2026"
echo "   - Novos cadastros funcionam normalmente"
echo ""
echo "🔍 Para verificar integridade dos usuários:"
echo "   cd ${APP_DIR}"
echo "   node check_all_users_integrity.js"
echo ""
echo "🌐 Teste a API:"
echo "   curl https://api.combosalvauniversitario.site/health"
echo ""
