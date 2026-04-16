# 🚀 GUIA DE ATUALIZAÇÃO NA VPS

## ✅ Alterações Commitadas

As seguintes alterações foram commitadas e enviadas para o GitHub:

```
Commit: 374f32c
Mensagem: fix: corrigir problema de identidades ausentes no Supabase
```

**Arquivos alterados:**
- ✅ `create_admin_user.js` - Corrigido para sempre criar identidade
- ✅ `check_all_users_integrity.js` - Script de verificação
- ✅ `fix_all_users_without_identity.js` - Script de correção em massa
- ✅ `test_new_user_signup.js` - Script de teste
- ✅ `RELATORIO_CORRECAO_LOGIN.md` - Documentação completa

---

## 📋 OPÇÃO 1: Atualização Automática (Recomendado)

### Passo 1: Conectar na VPS via SSH

```bash
ssh root@SEU_IP_DA_VPS
```

Ou se usar chave SSH:

```bash
ssh -i appsalva_prod_ed25519 root@SEU_IP_DA_VPS
```

### Passo 2: Executar script de atualização

```bash
cd /var/www/concursaflix
git pull origin main
sudo bash update_vps.sh
```

**O script fará automaticamente:**
1. ✅ Backup do .env atual
2. ✅ Atualizar código do repositório
3. ✅ Instalar dependências
4. ✅ Reiniciar backend com PM2
5. ✅ Mostrar status e logs

---

## 📋 OPÇÃO 2: Atualização Manual

Se preferir executar passo a passo:

### 1. Conectar na VPS

```bash
ssh root@SEU_IP_DA_VPS
```

### 2. Navegar para o diretório do projeto

```bash
cd /var/www/concursaflix
```

### 3. Fazer backup do .env

```bash
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
```

### 4. Atualizar código

```bash
git fetch origin
git checkout main
git pull origin main
```

### 5. Instalar dependências

```bash
npm ci
```

### 6. Reiniciar backend

```bash
pm2 restart concursaflix-backend
pm2 save
```

### 7. Verificar status

```bash
pm2 list
pm2 logs concursaflix-backend --lines 50
```

### 8. Testar API

```bash
curl https://api.combosalvauniversitario.site/health
```

---

## ✅ Verificação Pós-Atualização

### 1. Verificar integridade dos usuários

```bash
cd /var/www/concursaflix
node check_all_users_integrity.js
```

**Resultado esperado:**
```
📊 Total de usuários: 50
✅ Com identidade: 50 (100%)
❌ Sem identidade: 0 (0%)
```

### 2. Testar novo cadastro

Acesse: `https://app.combosalvauniversitario.site`

1. Clique em "Cadastre-se"
2. Preencha os dados
3. Faça login com as credenciais

**Deve funcionar normalmente!** ✅

### 3. Testar login de usuário corrigido

Use as credenciais:
- Email: `danieldasilsoares75@gmail.com`
- Senha: `TempSenha@2026`

**Deve fazer login com sucesso!** ✅

---

## 📧 COMUNICAR AOS USUÁRIOS

Após confirmar que tudo está funcionando, envie esta mensagem aos usuários:

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

## 🛡️ Monitoramento Contínuo

### Verificação Semanal

Execute toda semana para garantir que não há problemas:

```bash
cd /var/www/concursaflix
node check_all_users_integrity.js
```

### Logs do Backend

Para ver logs em tempo real:

```bash
pm2 logs concursaflix-backend
```

Para ver últimas 100 linhas:

```bash
pm2 logs concursaflix-backend --lines 100
```

---

## 🆘 Troubleshooting

### Problema: Backend não reinicia

```bash
pm2 delete concursaflix-backend
pm2 start /var/www/concursaflix/server/babylonProxy.mjs --name concursaflix-backend
pm2 save
```

### Problema: Erro de permissões

```bash
cd /var/www/concursaflix
chown -R root:root .
chmod -R 755 .
```

### Problema: Dependências não instalam

```bash
cd /var/www/concursaflix
rm -rf node_modules package-lock.json
npm install
```

### Problema: Git pull falha

```bash
cd /var/www/concursaflix
git stash
git pull origin main
git stash pop
```

---

## 📊 Resumo da Correção

**Problema identificado:**
- 50 usuários (100%) sem identidade no Supabase
- Ninguém conseguia fazer login

**Correção aplicada:**
- ✅ Todos os 50 usuários corrigidos
- ✅ Senha temporária: `TempSenha@2026`
- ✅ Código corrigido para prevenir recorrência
- ✅ Novos cadastros validados e funcionando

**Status atual:**
- ✅ Sistema 100% funcional
- ✅ Todos podem fazer login
- ✅ Novos cadastros funcionam normalmente
- ✅ Scripts de monitoramento implementados

---

## 📞 Suporte

Se encontrar algum problema durante a atualização:

1. Verifique os logs: `pm2 logs concursaflix-backend`
2. Verifique o status: `pm2 list`
3. Teste a API: `curl https://api.combosalvauniversitario.site/health`

**Tudo pronto para atualizar!** 🚀
