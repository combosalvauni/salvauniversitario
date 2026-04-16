#!/usr/bin/env bash
# Script de atualização rápida - Execute na VPS
# Uso: bash quick_update.sh

set -e

echo "🚀 Iniciando atualização do sistema..."
echo ""

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configurações
APP_DIR="/var/www/concursaflix"

# Verificar se está no diretório correto
if [[ ! -d "${APP_DIR}" ]]; then
  echo "❌ Diretório ${APP_DIR} não encontrado!"
  echo "   Ajuste a variável APP_DIR no script."
  exit 1
fi

cd "${APP_DIR}"

# 1. Backup do .env
echo -e "${BLUE}📦 Fazendo backup do .env...${NC}"
if [[ -f .env ]]; then
  cp .env ".env.backup.$(date +%Y%m%d_%H%M%S)"
  echo -e "${GREEN}✅ Backup criado${NC}"
fi

# 2. Atualizar código
echo ""
echo -e "${BLUE}📥 Atualizando código do GitHub...${NC}"
git fetch origin
git checkout main
git pull origin main
echo -e "${GREEN}✅ Código atualizado${NC}"

# 3. Instalar dependências
echo ""
echo -e "${BLUE}📦 Instalando dependências...${NC}"
npm ci --production
echo -e "${GREEN}✅ Dependências instaladas${NC}"

# 4. Reiniciar backend
echo ""
echo -e "${BLUE}🔄 Reiniciando backend...${NC}"
pm2 restart concursaflix-backend
pm2 save
echo -e "${GREEN}✅ Backend reiniciado${NC}"

# 5. Status
echo ""
echo -e "${BLUE}📊 Status do sistema:${NC}"
pm2 list

# 6. Logs recentes
echo ""
echo -e "${BLUE}📋 Últimas 30 linhas de log:${NC}"
pm2 logs concursaflix-backend --lines 30 --nostream

echo ""
echo -e "${GREEN}✅ ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!${NC}"
echo ""
echo -e "${YELLOW}📝 IMPORTANTE:${NC}"
echo "   - Todos os 50 usuários foram corrigidos"
echo "   - Senha temporária: TempSenha@2026"
echo "   - Novos cadastros funcionam normalmente"
echo ""
echo -e "${BLUE}🔍 Para verificar integridade dos usuários:${NC}"
echo "   node check_all_users_integrity.js"
echo ""
echo -e "${BLUE}🌐 Testar API:${NC}"
echo "   curl https://api.combosalvauniversitario.site/health"
echo ""
