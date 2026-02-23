# Webhook do checkout próprio (passo a passo)

Este guia explica como fazer o pagamento cair no seu sistema e virar saldo interno sem duplicar crédito.

## 1) Objetivo do fluxo

1. Usuário cria um pedido na loja.
2. Seu backend chama a API do checkout próprio.
3. Checkout confirma pagamento via webhook.
4. Seu backend valida assinatura do webhook.
5. Seu backend chama a função SQL `apply_checkout_paid_event(...)`.
6. O banco marca pedido como pago e credita saldo.

---

## 2) Pré-requisitos

- Script `setup_wallet_store_checkout.sql` executado no Supabase SQL Editor.
- Endpoint público no seu backend para receber webhook.
- Segredo de assinatura do webhook salvo no backend (NUNCA no front-end).

---

## 3) Tabelas usadas no webhook

- `checkout_orders`: pedido criado antes do pagamento.
- `checkout_webhook_events`: histórico do webhook (idempotência).
- `wallet_transactions`: extrato (crédito/débito).
- `wallet_balances`: saldo atual consolidado.

---

## 4) Fluxo correto do endpoint webhook

Endpoint sugerido: `POST /api/webhooks/checkout`

No handler do backend:

1. Ler body bruto da requisição (raw body).
2. Validar assinatura (`x-signature`) com o segredo do checkout.
3. Extrair:
   - `provider_event_id`
   - `provider_order_id`
   - `event_type`
4. Chamar RPC no Supabase (service role):
   - `apply_checkout_paid_event(provider, event_id, order_id, event_type, payload)`
5. Responder `200` para o checkout.

> Importante: responder rápido. Não faça lógica longa antes da validação.

---

## 5) Por que essa função SQL evita duplicidade

A função `apply_checkout_paid_event` já protege:

- **Evento duplicado**: não processa duas vezes o mesmo `provider_event_id`.
- **Pedido já pago**: não credita novamente.
- **Extrato único**: `wallet_transactions` usa referência única por pedido.

Resultado: mesmo que o checkout reenvie webhook, o saldo não duplica.

---

## 6) Exemplo de pseudo-código (Node/Express)

```js
app.post('/api/webhooks/checkout', async (req, res) => {
  const rawBody = getRawBody(req);
  const signature = req.headers['x-signature'];

  const isValid = validateHmac(rawBody, signature, process.env.CHECKOUT_WEBHOOK_SECRET);
  if (!isValid) return res.status(401).json({ error: 'invalid signature' });

  const payload = JSON.parse(rawBody.toString('utf8'));

  const providerEventId = payload.event_id;
  const providerOrderId = payload.order_id;
  const eventType = payload.event_type;

  const { data, error } = await supabaseAdmin.rpc('apply_checkout_paid_event', {
    p_provider_name: 'checkout_proprio',
    p_provider_event_id: providerEventId,
    p_provider_order_id: providerOrderId,
    p_event_type: eventType,
    p_payload: payload,
  });

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true, result: data });
});
```

---

## 7) Testes obrigatórios

1. **Pagamento aprovado**
   - Esperado: pedido `paid`, crédito no extrato, saldo incrementado.
2. **Mesmo webhook enviado 2 vezes**
   - Esperado: apenas 1 crédito no saldo.
3. **Webhook com assinatura inválida**
   - Esperado: `401` e nada alterado no banco.
4. **Webhook de falha** (`payment.failed`)
   - Esperado: pedido marcado como `failed`, sem crédito.

---

## 8) O que você vai me enviar depois (para fechar 100%)

- Valores de cada acesso individual.
- Valores de cada combo.
- Planos personalizados (nome, preço e quantos créditos entregam).
- Documentação da API do checkout próprio:
  - endpoint para criar cobrança
  - payload esperado
  - formato do webhook
  - header de assinatura

Com isso eu finalizo a integração ponta a ponta (pedido -> pagamento -> saldo -> acesso).
