# React + Vite

## Integração Banco Babylon (segura)

Este projeto já está preparado para usar a API do Banco Babylon via proxy backend local, sem expor credenciais no frontend.

### 1) Configurar variáveis

Copie `.env.example` para `.env` e preencha:

- `BABYLON_SECRET_KEY`
- `BABYLON_COMPANY_ID`
- `BABYLON_BASE_URL` (padrão: `https://api.bancobabylon.com/functions/v1`)
- `BABYLON_PROXY_PORT` (padrão: `8787`)
- `CHECKOUT_EMAILS_ENABLED=true` se quiser habilitar os e-mails do checkout público
- `CHECKOUT_EMAIL_PROVIDER=resend`
- `CHECKOUT_EMAIL_FROM` com o remetente validado no Resend
- `RESEND_API_KEY` com a chave da conta Resend

### 2) Rodar em desenvolvimento

Em um terminal:

```bash
npm run dev:babylon
```

Em outro terminal:

```bash
npm run dev
```

O frontend pode chamar a API via `/api/babylon/*`.

### 2.1) Webhook com liberação automática de acesso

Para liberação automática de plataforma após pagamento aprovado:

1. Execute no Supabase o script `setup_checkout_auto_access.sql`.
2. Configure no `.env`:
	- `SUPABASE_URL`
	- `SUPABASE_SERVICE_ROLE_KEY`
	- `BABYLON_WEBHOOK_TOKEN`
	- `BABYLON_ALLOWED_ORIGINS` (ex: `http://localhost:5173` no dev; em produção use apenas seus domínios `https://...` sem path)
	- `BABYLON_PROXY_REQUIRE_AUTH` (`false` no dev local)
3. Configure no painel da Babylon o webhook para:
	- `POST http://SEU_HOST:8787/webhooks/babylon`
	- Header `x-babylon-webhook-token: <seu_token>` (se definido)

Quando chegar evento `payment.approved` (ou equivalente), o backend chama a RPC
`apply_checkout_paid_and_grant_access` para:

- marcar `checkout_orders` como `paid`
- gravar evento em `checkout_webhook_events` (idempotente)
- alocar conta em `platform_accounts` e inserir em `platform_account_assignments`

Assim o usuário normal passa a ver o acesso automaticamente na página de plataformas.

### 2.2) E-mails transacionais do checkout público

Se `CHECKOUT_EMAILS_ENABLED=true`, o proxy envia dois e-mails personalizados no checkout público:

- quando o checkout avança e o PIX é gerado
- quando o pagamento é aprovado (via webhook ou fallback de status)

Variáveis usadas:

- `CHECKOUT_EMAIL_PROVIDER=resend`
- `CHECKOUT_EMAIL_FROM=Sua Marca <remetente-validado@seudominio.com>`
- `CHECKOUT_EMAIL_REPLY_TO=<opcional>`
- `CHECKOUT_EMAIL_BCC=<opcional, separados por vírgula>`
- `CHECKOUT_EMAIL_BRAND_NAME=<opcional>`
- `CHECKOUT_EMAIL_ASSET_BASE_URL=https://seudominio.com` para usar os assets padrão em `/email-assets/*` (o host precisa responder `200` nesses arquivos)
- `CHECKOUT_EMAIL_LOGO_URL=<opcional>`
- `CHECKOUT_EMAIL_HERO_URL=<opcional>`
- `CHECKOUT_EMAIL_BADGE_URL=<opcional>`
- `CHECKOUT_EMAIL_TESTIMONIAL_URL=<opcional>`
- `CHECKOUT_EMAIL_PRIMARY_CTA_URL=<opcional>`
- `CHECKOUT_EMAIL_SUPPORT_URL=<opcional>`
- `RESEND_API_KEY=<sua-chave>`

Observação: o envio é feito no backend para não expor a chave da API de e-mail no frontend.

Para mudar design e texto com facilidade, edite:

- `server/checkoutEmailContent.mjs` para assunto, títulos, textos e cores
- `.env` para remetente, reply-to, bcc e nome da marca

Assets padrão criados para o e-mail:

- `public/email-assets/logo-salva-universitario.png`
- `public/email-assets/hero-salva-universitario.jpg`
- `public/email-assets/garantia-30-dias.png`
- `public/email-assets/depoimento-bel.webp`

Preview local do template:

- suba o backend com `npm run dev:babylon`
- abra `http://localhost:8787/api/dev/checkout-email-preview?type=pix_ready`
- para ver o aprovado, use `http://localhost:8787/api/dev/checkout-email-preview?type=payment_approved`

### 3) Exemplo de uso no frontend

Use `src/lib/babylonApi.js`:

- `babylonRequest('/transactions', { method: 'GET' })`
- `createBabylonTransaction(payload)`

### Segurança

- Nunca coloque `Secret Key` no código cliente ou em variáveis `VITE_*`.
- Se uma chave já foi compartilhada, faça rotação imediata no painel da Babylon.

## Deploy no Render (produção)

### 1) Backend (proxy + webhook)

Crie um **Web Service** no Render apontando para este repositório.

- Runtime: `Node`
- Build Command: `npm ci`
- Start Command: `node server/babylonProxy.mjs`

Variáveis obrigatórias do serviço backend:

- `BABYLON_SECRET_KEY`
- `BABYLON_COMPANY_ID`
- `BABYLON_BASE_URL=https://api.bancobabylon.com/functions/v1`
- `BABYLON_PROXY_PORT=10000` (Render usa porta interna)
- `BABYLON_WEBHOOK_TOKEN=<token-forte>`
- `BABYLON_ALLOWED_ORIGINS=https://combosalvauniversitario.site,https://app.combosalvauniversitario.site`
- `BABYLON_PROXY_REQUIRE_AUTH=true`
- `NODE_ENV=production`
- `PUBLIC_APP_URL=https://combosalvauniversitario.site`
- `SUPABASE_URL=https://SEU-PROJETO.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<service-role-key>`
- `CHECKOUT_EMAILS_ENABLED=true`
- `CHECKOUT_EMAIL_PROVIDER=resend`
- `CHECKOUT_EMAIL_FROM=Sua Marca <remetente-validado@seudominio.com>`
- `CHECKOUT_EMAIL_REPLY_TO=<opcional>`
- `CHECKOUT_EMAIL_BCC=<opcional>`
- `CHECKOUT_EMAIL_BRAND_NAME=Combo Salva Universitario`
- `CHECKOUT_EMAIL_ASSET_BASE_URL=https://api.combosalvauniversitario.site`
- `CHECKOUT_EMAIL_PRIMARY_CTA_URL=https://combosalvauniversitario.site`
- `CHECKOUT_EMAIL_SUPPORT_URL=<opcional>`
- `RESEND_API_KEY=<resend-api-key>`

Quando publicar, você terá uma URL tipo:

- `https://seu-backend.onrender.com`

Webhook Babylon:

- URL: `https://seu-backend.onrender.com/webhooks/babylon`
- Método: `POST`
- Header: `x-babylon-webhook-token: <token-forte>`

### 2) Frontend

Você pode usar **Static Site** no Render (ou Vercel/Netlify).

No frontend, configure:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BABYLON_PROXY_URL=https://seu-backend.onrender.com`

Assim o app chamará `/api/babylon/*` via backend público, sem expor credenciais.

### 3) Banco (Supabase)

No SQL Editor, execute:

- `setup_wallet_store_checkout.sql`
- `setup_checkout_auto_access.sql`
- `setup_pending_checkout_benefits.sql`
- `setup_admin_invite_links.sql`

Isso habilita status pago + liberação automática de acesso para usuário normal.

## Deploy na Hostinger (VPS)

Se você preferir VPS da Hostinger, use o guia pronto em:

- `deploy/hostinger/README.md`

Scripts incluídos:

- `deploy/hostinger/00_setup_vps.sh`
- `deploy/hostinger/10_deploy_backend.sh`
- `deploy/hostinger/20_configure_ssl.sh`

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
