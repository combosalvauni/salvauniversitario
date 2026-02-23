# Deploy Hostinger VPS (ConcursaFlix)

Este diretório contém um fluxo pronto para VPS Ubuntu (Hostinger).

## Pré-requisitos
- VPS Ubuntu 22.04+
- Domínio/subdomínio apontado para o IP da VPS (ex: `api.seudominio.com`)
- Repositório no GitHub

## 1) Setup base da VPS
No servidor:

```bash
sudo bash deploy/hostinger/00_setup_vps.sh
```

## 2) Deploy backend + Nginx + PM2
No servidor:

```bash
sudo REPO_URL=https://github.com/SEU_USUARIO/SEU_REPO.git API_DOMAIN=api.seudominio.com bash deploy/hostinger/10_deploy_backend.sh
```

Esse passo cria/atualiza o app em `/var/www/concursaflix`, configura Nginx e inicia o backend com PM2.

## 3) Preencher variáveis de ambiente
Edite:

- `/var/www/concursaflix/.env`

Use como base:

- `deploy/hostinger/backend.env.example`

Campos obrigatórios de segurança no `.env` do backend:

- `BABYLON_WEBHOOK_TOKEN`
- `BABYLON_ALLOWED_ORIGINS=https://combosalvauniversitario.site,https://app.combosalvauniversitario.site` (somente domínios, sem paths)
- `BABYLON_PROXY_REQUIRE_AUTH=true`
- `NODE_ENV=production`

Depois reinicie o backend:

```bash
pm2 restart concursaflix-backend
```

## 4) Ativar SSL
No servidor:

```bash
sudo API_DOMAIN=api.seudominio.com bash deploy/hostinger/20_configure_ssl.sh
```

## 5) Configurar webhook Babylon
No painel da Babylon:
- URL: `https://api.seudominio.com/webhooks/babylon`
- Método: `POST`
- Header: `x-babylon-webhook-token: <seu_token>`

## 6) Configurar frontend
No frontend publicado, configure:
- `VITE_BABYLON_PROXY_URL=https://api.seudominio.com`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 7) SQL no Supabase
No SQL Editor execute:
- `setup_wallet_store_checkout.sql`
- `setup_checkout_auto_access.sql`

## Testes rápidos
```bash
curl https://api.seudominio.com/health
pm2 logs concursaflix-backend --lines 100
```
