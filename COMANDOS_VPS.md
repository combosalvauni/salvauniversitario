# 🚀 COMANDOS PARA EXECUTAR NA VPS

## ✅ TUDO PRONTO! Copie e cole estes comandos na VPS

### OPÇÃO 1: Atualização Automática Completa (Recomendado)

Conecte na VPS e execute:

```bash
ssh root@SEU_IP_DA_VPS
```

Depois execute este comando único:

```bash
cd /var/www/concursaflix && git pull origin main && bash deploy_update.sh
```

**Pronto!** O script fará tudo automaticamente com output colorido e informativo.

---

### OPÇÃO 2: Passo a Passo Manual

Se preferir ver cada etapa:

```bash
# 1. Conectar na VPS
ssh root@SEU_IP_DA_VPS

# 2. Ir para o diretório
cd /var/www/concursaflix

# 3. Backup do .env
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# 4. Atualizar código
git pull origin main

# 5. Instalar dependências
npm ci --production

# 6. Reiniciar backend
pm2 restart concursaflix-backend
pm2 save

# 7. Ver status
pm2 list

# 8. Ver logs
pm2 logs concursaflix-backend --lines 50
```

---

## 📋 Verificação Pós-Atualização

Após executar, verifique se tudo está OK:

```bash
# Verificar integridade dos usuários
cd /var/www/concursaflix
node check_all_users_integrity.js
```

**Resultado esperado:**
```
✅ Com identidade: 50 (100%)
❌ Sem identidade: 0 (0%)
```

---

## 🌐 Testar o Sistema

### Testar API:
```bash
curl https://api.combosalvauniversitario.site/health
```

### Testar Frontend:
Abra no navegador: https://app.combosalvauniversitario.site

### Testar Login:
- Email: `danieldasilsoares75@gmail.com`
- Senha: `TempSenha@2026`

**Deve funcionar!** ✅

---

## 📧 IMPORTANTE: Comunicar aos Usuários

Após confirmar que está funcionando, envie esta mensagem aos 50 usuários:

```
Olá!

Realizamos uma atualização de segurança no sistema.
Sua senha foi resetada temporariamente.

🔑 Nova senha temporária: TempSenha@2026

Por favor:
1. Acesse: https://app.combosalvauniversitario.site
2. Faça login com a senha temporária
3. Altere sua senha imediatamente após o login

Qualquer dúvida, entre em contato.

Equipe Salva Universitários
```

---

## 🔍 Comandos Úteis

### Ver logs em tempo real:
```bash
pm2 logs concursaflix-backend
```

### Reiniciar backend:
```bash
pm2 restart concursaflix-backend
```

### Ver status:
```bash
pm2 list
```

### Verificar integridade semanal:
```bash
cd /var/www/concursaflix
node check_all_users_integrity.js
```

---

## ✅ Resumo do que foi Corrigido

**Problema:**
- 50 usuários (100%) sem identidade no Supabase
- Ninguém conseguia fazer login

**Correção:**
- ✅ Todos os 50 usuários corrigidos
- ✅ Senha temporária: `TempSenha@2026`
- ✅ Código corrigido para prevenir recorrência
- ✅ Novos cadastros validados e funcionando

**Arquivos Atualizados:**
- ✅ `create_admin_user.js` - Sempre cria identidade
- ✅ `check_all_users_integrity.js` - Verificação
- ✅ `fix_all_users_without_identity.js` - Correção em massa
- ✅ `test_new_user_signup.js` - Teste de cadastros
- ✅ `deploy_update.sh` - Script de atualização automática

---

## 🎯 EXECUTE AGORA

**Comando único para atualizar tudo:**

```bash
ssh root@SEU_IP_DA_VPS -c "cd /var/www/concursaflix && git pull origin main && bash deploy_update.sh"
```

Ou se preferir conectar primeiro:

```bash
ssh root@SEU_IP_DA_VPS
cd /var/www/concursaflix && git pull origin main && bash deploy_update.sh
```

**Pronto para executar!** 🚀
