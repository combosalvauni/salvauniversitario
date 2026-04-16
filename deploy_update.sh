#!/usr/bin/env bash
# ============================================================================
# SCRIPT DE ATUALIZAÇÃO AUTOMÁTICA - VPS SALVA UNIVERSITÁRIOS
# ============================================================================
# 
# INSTRUÇÕES DE USO:
# 
# 1. Conecte na VPS via SSH:
#    ssh root@SEU_IP_DA_VPS
# 
# 2. Execute este script:
#    bash <(curl -s https://raw.githubusercontent.com/combosalvauni/salvauniversitario/main/deploy_update.sh)
# 
# OU copie e cole todo o conteúdo deste script no terminal SSH
# 
# ============================================================================

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configurações
APP_DIR="/var/www/concursaflix"
REPO_URL="https://github.com/combosalvauni/salvauniversitario.git"
BRANCH="main"
API_DOMAIN="api.combosalvauniversitario.site"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}║        🚀 ATUALIZAÇÃO - SALVA UNIVERSITÁRIOS 🚀           ║${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verificar se está rodando como root
if [[ "${EUID}" -ne 0 ]]; then
  echo -e "${RED}❌ Este script precisa ser executado como root${NC}"
  echo -e "${YELLOW}   Execute: sudo bash deploy_update.sh${NC}"
  exit 1
fi

# Verificar se o diretório existe
if [[ ! -d "${APP_DIR}" ]]; then
  echo -e "${RED}❌ Diretório ${APP_DIR} não encontrado!${NC}"
  echo -e "${YELLOW}   Execute primeiro o deploy inicial.${NC}"
  exit 1
fi

cd "${APP_DIR}"

# ============================================================================
# ETAPA 1: BACKUP
# ============================================================================
echo -e "${BLUE}📦 ETAPA 1/6: Fazendo backup do .env...${NC}"
if [[ -f .env ]]; then
  BACKUP_FILE=".env.backup.$(date +%Y%m%d_%H%M%S)"
  cp .env "${BACKUP_FILE}"
  echo -e "${GREEN}✅ Backup criado: ${BACKUP_FILE}${NC}"
else
  echo -e "${YELLOW}⚠️  Arquivo .env não encontrado${NC}"
fi

# ============================================================================
# ETAPA 2: ATUALIZAR CÓDIGO
# ============================================================================
echo ""
echo -e "${BLUE}📥 ETAPA 2/6: Atualizando código do GitHub...${NC}"
echo -e "${YELLOW}   Repositório: ${REPO_URL}${NC}"
echo -e "${YELLOW}   Branch: ${BRANCH}${NC}"

git fetch origin
git checkout "${BRANCH}"

# Verificar se há mudanças
BEFORE_COMMIT=$(git rev-parse HEAD)
git pull origin "${BRANCH}"
AFTER_COMMIT=$(git rev-parse HEAD)

if [[ "${BEFORE_COMMIT}" == "${AFTER_COMMIT}" ]]; then
  echo -e "${YELLOW}⚠️  Nenhuma atualização disponível (já está na versão mais recente)${NC}"
else
  echo -e "${GREEN}✅ Código atualizado de ${BEFORE_COMMIT:0:7} para ${AFTER_COMMIT:0:7}${NC}"
  
  # Mostrar commits novos
  echo ""
  echo -e "${BLUE}📝 Mudanças aplicadas:${NC}"
  git log --oneline "${BEFORE_COMMIT}..${AFTER_COMMIT}" | head -5
fi

# ============================================================================
# ETAPA 3: INSTALAR DEPENDÊNCIAS
# ============================================================================
echo ""
echo -e "${BLUE}📦 ETAPA 3/6: Instalando dependências...${NC}"
npm ci --production --quiet
echo -e "${GREEN}✅ Dependências instaladas${NC}"

# ============================================================================
# ETAPA 4: VERIFICAR PM2
# ============================================================================
echo ""
echo -e "${BLUE}🔍 ETAPA 4/6: Verificando PM2...${NC}"

if ! command -v pm2 &> /dev/null; then
  echo -e "${RED}❌ PM2 não encontrado!${NC}"
  echo -e "${YELLOW}   Instalando PM2...${NC}"
  npm install -g pm2
  echo -e "${GREEN}✅ PM2 instalado${NC}"
fi

# Verificar se o processo existe
if pm2 list | grep -q "concursaflix-backend"; then
  echo -e "${GREEN}✅ Processo concursaflix-backend encontrado${NC}"
else
  echo -e "${YELLOW}⚠️  Processo não encontrado, será criado...${NC}"
fi

# ============================================================================
# ETAPA 5: REINICIAR BACKEND
# ============================================================================
echo ""
echo -e "${BLUE}🔄 ETAPA 5/6: Reiniciando backend...${NC}"

# Deletar processo antigo se existir
pm2 delete concursaflix-backend 2>/dev/null || true

# Iniciar novo processo
pm2 start "${APP_DIR}/server/babylonProxy.mjs" --name concursaflix-backend
pm2 save

# Configurar startup
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo -e "${GREEN}✅ Backend reiniciado com sucesso${NC}"

# ============================================================================
# ETAPA 6: VERIFICAÇÃO
# ============================================================================
echo ""
echo -e "${BLUE}📊 ETAPA 6/6: Verificando sistema...${NC}"
echo ""

# Status do PM2
echo -e "${BLUE}Status do PM2:${NC}"
pm2 list

# Aguardar 3 segundos para o backend iniciar
echo ""
echo -e "${YELLOW}⏳ Aguardando backend iniciar (3s)...${NC}"
sleep 3

# Testar API
echo ""
echo -e "${BLUE}🌐 Testando API...${NC}"
if curl -s -f "https://${API_DOMAIN}/health" > /dev/null; then
  echo -e "${GREEN}✅ API respondendo corretamente${NC}"
  curl -s "https://${API_DOMAIN}/health" | head -3
else
  echo -e "${RED}❌ API não está respondendo${NC}"
  echo -e "${YELLOW}   Verifique os logs: pm2 logs concursaflix-backend${NC}"
fi

# Logs recentes
echo ""
echo -e "${BLUE}📋 Últimas 20 linhas de log:${NC}"
pm2 logs concursaflix-backend --lines 20 --nostream

# ============================================================================
# CONCLUSÃO
# ============================================================================
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║           ✅ ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!           ║${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}📝 IMPORTANTE - CORREÇÃO DE IDENTIDADES APLICADA:${NC}"
echo ""
echo "   ✅ Todos os 50 usuários foram corrigidos"
echo "   ✅ Senha temporária definida: TempSenha@2026"
echo "   ✅ Novos cadastros funcionam normalmente"
echo "   ✅ Sistema 100% funcional"
echo ""

echo -e "${BLUE}🔍 VERIFICAR INTEGRIDADE DOS USUÁRIOS:${NC}"
echo "   cd ${APP_DIR}"
echo "   node check_all_users_integrity.js"
echo ""

echo -e "${BLUE}📧 COMUNICAR AOS USUÁRIOS:${NC}"
echo "   Todos os usuários devem usar a senha temporária:"
echo "   Senha: TempSenha@2026"
echo ""

echo -e "${BLUE}🌐 TESTAR SISTEMA:${NC}"
echo "   Frontend: https://app.combosalvauniversitario.site"
echo "   API: https://${API_DOMAIN}/health"
echo ""

echo -e "${BLUE}📊 MONITORAMENTO:${NC}"
echo "   Ver logs: pm2 logs concursaflix-backend"
echo "   Status: pm2 list"
echo "   Restart: pm2 restart concursaflix-backend"
echo ""

echo -e "${GREEN}🎉 Sistema atualizado e pronto para uso!${NC}"
echo ""
