import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});

const port = Number(process.env.BABYLON_PROXY_PORT || 8787);
const baseUrl = process.env.BABYLON_BASE_URL || 'https://api.bancobabylon.com/functions/v1';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
const isProduction = nodeEnv === 'production';
const requireApiAuth = isProduction
  ? true
  : String(process.env.BABYLON_PROXY_REQUIRE_AUTH || 'true').toLowerCase() !== 'false';
const publicAppUrl = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
const allowedOrigins = new Set(
  String(
    process.env.BABYLON_ALLOWED_ORIGINS
    || (isProduction ? '' : 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5500,http://127.0.0.1:5500')
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAuthHeader() {
  const secretKey = process.env.BABYLON_SECRET_KEY;
  const companyId = process.env.BABYLON_COMPANY_ID;

  if (!secretKey || !companyId) {
    return null;
  }

  const credentials = Buffer.from(`${secretKey}:${companyId}`).toString('base64');
  return `Basic ${credentials}`;
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-babylon-webhook-token');
  res.setHeader('Vary', 'Origin');
}

function setCorsOrigin(res, origin) {
  if (!origin) return;
  if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.size === 0) return false;
  return allowedOrigins.has(origin);
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function authenticateRequestUser(req) {
  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    return { user: null, status: 401, error: 'Unauthorized: missing bearer token' };
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
  if (authError || !authData?.user?.id) {
    return { user: null, status: 401, error: 'Unauthorized: invalid bearer token' };
  }

  return { user: authData.user, status: 200, error: null };
}

async function assertAdminUser(userId) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: 'Não foi possível validar perfil admin' };
  }

  if (!profile || profile.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden: admin only' };
  }

  return { ok: true, status: 200, error: null };
}

function parseJsonSafe(buffer) {
  const text = buffer.toString('utf8');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isApprovedPaymentEvent(eventType) {
  const normalized = String(eventType || '').trim().toLowerCase();
  return ['payment.approved', 'order.paid', 'paid', 'approved', 'succeeded', 'success'].includes(normalized);
}

function resolveAmountCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isInteger(amount)) return Math.round(amount * 100);
  return Math.round(amount);
}

function resolveCreditAmountFromCents(value) {
  const amountCents = Number(value);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  return Math.floor(amountCents / 100);
}

function isFailurePaymentStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['refused', 'failed', 'canceled', 'cancelled', 'denied', 'error', 'voided', 'expired'].includes(normalized);
}

function sanitizeOfferLabel(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function collectStringValues(value, bucket = [], depth = 0) {
  if (depth > 6 || value == null) return bucket;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) bucket.push(trimmed);
    return bucket;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, bucket, depth + 1));
    return bucket;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectStringValues(item, bucket, depth + 1));
  }

  return bucket;
}

function looksLikePixCode(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  if (normalized.length < 40) return false;
  return normalized.startsWith('000201')
    || normalized.includes('BR.GOV.BCB.PIX')
    || normalized.includes('PIX');
}

function looksLikeQrImage(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.startsWith('data:image/')
    || /^https?:\/\//i.test(text) && /(qr|qrcode|pix)/i.test(text);
}

function collectCheckoutArtifacts(responseData) {
  const candidatesPixCode = [
    responseData?.pix?.copyAndPaste,
    responseData?.pix?.copy_paste,
    responseData?.pix?.copyPaste,
    responseData?.pix?.payload,
    responseData?.pix?.emv,
    responseData?.pix?.code,
    responseData?.data?.pix?.copyAndPaste,
    responseData?.data?.pix?.copy_paste,
    responseData?.data?.pix?.copyPaste,
    responseData?.data?.pix?.payload,
    responseData?.data?.pix?.emv,
    responseData?.data?.pix?.code,
    responseData?.pixCopiaECola,
    responseData?.pix_code,
    responseData?.pixCode,
    responseData?.brCode,
    responseData?.br_code,
    responseData?.qrCodeText,
    responseData?.qr_code_text,
  ].filter(Boolean);

  const candidatesQr = [
    responseData?.pix?.qrCodeUrl,
    responseData?.pix?.qr_code_url,
    responseData?.pix?.qrCodeImage,
    responseData?.pix?.qr_code_image,
    responseData?.data?.pix?.qrCodeUrl,
    responseData?.data?.pix?.qr_code_url,
    responseData?.data?.pix?.qrCodeImage,
    responseData?.data?.pix?.qr_code_image,
  ].filter(Boolean);

  const allStrings = collectStringValues(responseData);

  const pixCopyPasteCode = [
    ...candidatesPixCode,
    ...allStrings,
  ].find((value) => looksLikePixCode(String(value)));

  const pixQrUrl = [
    ...candidatesQr,
    ...allStrings,
  ].find((value) => looksLikeQrImage(String(value))) || null;

  return {
    pixCopyPasteCode: pixCopyPasteCode ? String(pixCopyPasteCode).trim() : null,
    pixQrUrl,
  };
}

function isTransactionCreatePath(pathname) {
  if (!pathname) return false;
  return pathname === '/transactions' || pathname === '/transactions/';
}

function ensureRequiredConfiguration(options = {}) {
  const requiresSupabase = options?.requiresSupabase !== false;
  const requiresWebhookToken = options?.requiresWebhookToken === true;
  const requiresBabylonAuth = options?.requiresBabylonAuth !== false;
  const requiresPublicAppUrl = options?.requiresPublicAppUrl === true;
  const issues = [];
  const hasAuthHeader = Boolean(getAuthHeader());

  if (requiresBabylonAuth && !hasAuthHeader) {
    issues.push('Defina BABYLON_SECRET_KEY e BABYLON_COMPANY_ID.');
  }

  if (requiresWebhookToken && !process.env.BABYLON_WEBHOOK_TOKEN) {
    issues.push('Defina BABYLON_WEBHOOK_TOKEN para validar o webhook.');
  }

  if (requiresSupabase && !supabaseAdmin) {
    issues.push('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para processar webhook/benefícios e (se habilitado) validar JWT no proxy.');
  }

  if (isProduction && allowedOrigins.size === 0) {
    issues.push('Defina BABYLON_ALLOWED_ORIGINS com os domínios autorizados do frontend.');
  }

  if (requiresPublicAppUrl && !publicAppUrl) {
    issues.push('Defina PUBLIC_APP_URL para geração segura de links públicos.');
  }

  return issues;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!isAllowedOrigin(origin)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Origin not allowed' }));
    return;
  }

  setCorsOrigin(res, origin);
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    const configured = Boolean(getAuthHeader());
    const supabaseConfigured = Boolean(supabaseAdmin);
    const webhookTokenConfigured = Boolean(process.env.BABYLON_WEBHOOK_TOKEN);
    const configurationIssues = ensureRequiredConfiguration({
      requiresSupabase: true,
      requiresWebhookToken: isProduction,
    });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      provider: 'banco-babylon',
      configured,
      supabaseConfigured,
      webhookTokenConfigured,
      requireApiAuth,
      allowedOrigins: Array.from(allowedOrigins),
      configurationIssues,
    }));
    return;
  }

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = requestUrl.pathname;
  const needsSupabase = pathname === '/webhooks/babylon'
    || pathname.startsWith('/api/public/first-offer/checkout-status')
    || pathname.startsWith('/api/admin/invite-links')
    || pathname.startsWith('/api/admin/users')
    || pathname.startsWith('/api/babylon');
  const needsBabylonAuth = pathname === '/webhooks/babylon'
    || pathname.startsWith('/api/public/first-offer/checkout')
    || pathname.startsWith('/api/babylon');
  const needsWebhookToken = pathname === '/webhooks/babylon'
    && (isProduction || Boolean(process.env.BABYLON_WEBHOOK_TOKEN));
  const needsPublicAppUrl = isProduction && pathname.startsWith('/api/admin/invite-links');

  const requiredConfigurationIssues = ensureRequiredConfiguration({
    requiresSupabase: needsSupabase,
    requiresBabylonAuth: needsBabylonAuth,
    requiresWebhookToken: needsWebhookToken,
    requiresPublicAppUrl: needsPublicAppUrl,
  });
  if (requiredConfigurationIssues.length) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(500);
    res.end(JSON.stringify({
      error: 'Configuração incompleta',
      message: requiredConfigurationIssues.join(' '),
    }));
    return;
  }

  if (pathname === '/webhooks/babylon' && req.method === 'POST') {
    const expectedToken = process.env.BABYLON_WEBHOOK_TOKEN;
    const receivedToken = req.headers['x-babylon-webhook-token'];
    if (receivedToken !== expectedToken) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized webhook token' }));
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const textBody = rawBody.toString('utf8') || '{}';
      const payload = textBody ? JSON.parse(textBody) : {};

      const providerName = 'banco_babylon';
      const providerOrderId = String(
        payload?.provider_order_id
        || payload?.order_id
        || payload?.transaction_id
        || payload?.data?.order_id
        || payload?.data?.transaction_id
        || ''
      ).trim();

      const checkoutOrderIdRaw = String(
        payload?.external_id
        || payload?.metadata?.checkout_order_id
        || payload?.data?.external_id
        || payload?.data?.metadata?.checkout_order_id
        || ''
      ).trim();

      const checkoutOrderId = UUID_REGEX.test(checkoutOrderIdRaw) ? checkoutOrderIdRaw : null;

      const eventType = String(
        payload?.event_type
        || payload?.event
        || payload?.type
        || payload?.status
        || 'payment.approved'
      ).trim();

      const fallbackEventHash = createHash('sha256').update(textBody).digest('hex');
      const eventId = String(
        payload?.event_id
        || payload?.id
        || payload?.data?.event_id
        || payload?.data?.id
        || `${providerOrderId || checkoutOrderId || 'event'}_${fallbackEventHash}`
      ).trim();

      let checkoutSource = String(
        payload?.metadata?.source
        || payload?.data?.metadata?.source
        || ''
      ).trim().toLowerCase();

      if (!checkoutSource && checkoutOrderId) {
        const { data: orderData } = await supabaseAdmin
          .from('checkout_orders')
          .select('metadata')
          .eq('id', checkoutOrderId)
          .maybeSingle();
        checkoutSource = String(orderData?.metadata?.source || '').trim().toLowerCase();
      }

      let data;
      let error;

      if (checkoutSource === 'wallet_topup') {
        const result = await supabaseAdmin.rpc('apply_checkout_paid_event', {
          p_provider_name: providerName,
          p_provider_event_id: eventId,
          p_provider_order_id: providerOrderId || null,
          p_event_type: eventType,
          p_payload: payload,
        });
        data = result.data;
        error = result.error;
      } else if (checkoutSource === 'first_offer_public_checkout') {
        if (!isApprovedPaymentEvent(eventType)) {
          data = { status: 'ignored_event_type', event_type: eventType };
          error = null;
        } else {
          const buyerEmail = String(
            payload?.customer?.email
            || payload?.data?.customer?.email
            || payload?.metadata?.customer_email
            || payload?.data?.metadata?.customer_email
            || ''
          ).trim().toLowerCase();

          const buyerPhone = String(
            payload?.customer?.phone
            || payload?.data?.customer?.phone
            || payload?.metadata?.customer_phone
            || payload?.data?.metadata?.customer_phone
            || ''
          ).trim();

          const amountCents = [
            payload?.metadata?.total_amount_cents,
            payload?.data?.metadata?.total_amount_cents,
            payload?.amount_cents,
            payload?.data?.amount_cents,
            payload?.amount,
            payload?.data?.amount,
          ]
            .map((value) => resolveAmountCents(value))
            .find((value) => value > 0) || 0;
          const creditAmount = resolveCreditAmountFromCents(amountCents);

          const result = await supabaseAdmin.rpc('register_pending_checkout_benefit', {
            p_provider_name: providerName,
            p_provider_event_id: eventId,
            p_provider_order_id: providerOrderId || null,
            p_checkout_order_id: checkoutOrderId || checkoutOrderIdRaw || null,
            p_payer_email: buyerEmail,
            p_payer_phone: buyerPhone || null,
            p_amount_cents: amountCents,
            p_credit_amount: creditAmount,
            p_activate_store: true,
            p_metadata: payload,
          });

          data = result.data;
          error = result.error;
        }
      } else {
        const result = await supabaseAdmin.rpc('apply_checkout_paid_and_grant_access', {
          p_provider_name: providerName,
          p_provider_event_id: eventId,
          p_provider_order_id: providerOrderId || null,
          p_checkout_order_id: checkoutOrderId,
          p_event_type: eventType,
          p_payload: payload,
        });
        data = result.data;
        error = result.error;

        // Fallback: se order_not_found, tenta registrar como benefício pendente
        // (cobre o caso em que a Babylon não ecoa metadata.source no webhook)
        if (!error && String(data?.status || '').toLowerCase() === 'order_not_found' && isApprovedPaymentEvent(eventType)) {
          const fallbackEmail = normalizeEmail(
            payload?.customer?.email
            || payload?.data?.customer?.email
            || payload?.metadata?.customer_email
            || payload?.data?.metadata?.customer_email
            || ''
          );

          if (fallbackEmail) {
            const fallbackPhone = String(
              payload?.customer?.phone
              || payload?.data?.customer?.phone
              || payload?.metadata?.customer_phone
              || payload?.data?.metadata?.customer_phone
              || ''
            ).trim();

            const fallbackAmountCents = [
              payload?.metadata?.total_amount_cents,
              payload?.data?.metadata?.total_amount_cents,
              payload?.amount_cents,
              payload?.data?.amount_cents,
              payload?.amount,
              payload?.data?.amount,
            ]
              .map((value) => resolveAmountCents(value))
              .find((value) => value > 0) || 0;
            const fallbackCreditAmount = resolveCreditAmountFromCents(fallbackAmountCents);

            const fallbackResult = await supabaseAdmin.rpc('register_pending_checkout_benefit', {
              p_provider_name: providerName,
              p_provider_event_id: eventId,
              p_provider_order_id: providerOrderId || null,
              p_checkout_order_id: checkoutOrderId || null,
              p_payer_email: fallbackEmail,
              p_payer_phone: fallbackPhone || null,
              p_amount_cents: fallbackAmountCents,
              p_credit_amount: fallbackCreditAmount,
              p_activate_store: true,
              p_metadata: { source: 'webhook_order_not_found_fallback', original_payload: payload },
            });

            if (!fallbackResult.error) {
              data = fallbackResult.data;
              error = null;
            }
          }
        }
      }

      if (error) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({
          error: 'Erro ao aplicar webhook no Supabase',
          message: error.message,
        }));
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, result: data }));
    } catch (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({
        error: 'Webhook inválido',
        message: error?.message || 'Não foi possível processar payload JSON',
      }));
    }
    return;
  }

  if (req.url?.startsWith('/api/public/first-offer/checkout-status') && req.method === 'GET') {
    try {
      const requestUrl = new URL(req.url, 'http://localhost');
      const providerOrderId = String(requestUrl.searchParams.get('providerOrderId') || '').trim();
      const checkoutOrderId = String(requestUrl.searchParams.get('checkoutOrderId') || '').trim();
      const payerEmailParam = normalizeEmail(requestUrl.searchParams.get('payerEmail') || '');

      if (!providerOrderId && !checkoutOrderId) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Informe providerOrderId ou checkoutOrderId' }));
        return;
      }

      let status = 'pending';
      let matchedBy = null;

      if (providerOrderId) {
        const { data: byProviderOrder } = await supabaseAdmin
          .from('checkout_pending_benefits')
          .select('id, status')
          .eq('provider_order_id', providerOrderId)
          .limit(1)
          .maybeSingle();

        if (byProviderOrder?.id) {
          status = 'paid';
          matchedBy = 'provider_order_id';
        }
      }

      if (status !== 'paid' && checkoutOrderId) {
        const { data: byCheckoutOrder } = await supabaseAdmin
          .from('checkout_pending_benefits')
          .select('id, status')
          .eq('checkout_order_id', checkoutOrderId)
          .limit(1)
          .maybeSingle();

        if (byCheckoutOrder?.id) {
          status = 'paid';
          matchedBy = 'checkout_order_id';
        }
      }

      let fallbackApplied = false;
      let gatewayStatus = null;

      if (status !== 'paid' && providerOrderId) {
        const upstreamResponse = await fetch(`${baseUrl}/transactions/${encodeURIComponent(providerOrderId)}`, {
          method: 'GET',
          headers: {
            Authorization: getAuthHeader(),
            'Content-Type': 'application/json',
          },
        });

        const upstreamText = await upstreamResponse.text();
        let upstreamData = upstreamText;
        try {
          upstreamData = upstreamText ? JSON.parse(upstreamText) : {};
        } catch {
          upstreamData = upstreamText;
        }

        if (upstreamResponse.ok) {
          gatewayStatus = String(
            upstreamData?.status
            || upstreamData?.data?.status
            || upstreamData?.transaction?.status
            || ''
          ).trim().toLowerCase() || null;

          const approved = isApprovedPaymentEvent(gatewayStatus);

          if (approved) {
            const buyerEmail = normalizeEmail(
              upstreamData?.customer?.email
              || upstreamData?.data?.customer?.email
              || upstreamData?.buyer?.email
              || upstreamData?.data?.buyer?.email
              || upstreamData?.metadata?.customer_email
              || upstreamData?.data?.metadata?.customer_email
              || upstreamData?.payer?.email
              || upstreamData?.data?.payer?.email
              || payerEmailParam
              || ''
            );

            const buyerPhone = String(
              upstreamData?.customer?.phone
              || upstreamData?.data?.customer?.phone
              || upstreamData?.buyer?.phone
              || upstreamData?.data?.buyer?.phone
              || ''
            ).trim();

            const amountCents = [
              upstreamData?.amount_cents,
              upstreamData?.data?.amount_cents,
              upstreamData?.amount,
              upstreamData?.data?.amount,
              upstreamData?.paid_amount_cents,
              upstreamData?.data?.paid_amount_cents,
            ]
              .map((value) => resolveAmountCents(value))
              .find((value) => value > 0) || 0;
            const creditAmount = resolveCreditAmountFromCents(amountCents);

            const resolvedCheckoutOrderIdRaw = String(
              checkoutOrderId
              || upstreamData?.external_id
              || upstreamData?.data?.external_id
              || upstreamData?.metadata?.checkout_order_id
              || upstreamData?.data?.metadata?.checkout_order_id
              || ''
            ).trim();
            const resolvedCheckoutOrderId = UUID_REGEX.test(resolvedCheckoutOrderIdRaw)
              ? resolvedCheckoutOrderIdRaw
              : null;

            const fallbackEventHash = createHash('sha256')
              .update(JSON.stringify(upstreamData || {}))
              .digest('hex')
              .slice(0, 24);
            const fallbackEventId = `status_poll_${providerOrderId}_${fallbackEventHash}`;

            const { data: fallbackData, error: fallbackError } = await supabaseAdmin.rpc('register_pending_checkout_benefit', {
              p_provider_name: 'banco_babylon',
              p_provider_event_id: fallbackEventId,
              p_provider_order_id: providerOrderId,
              p_checkout_order_id: resolvedCheckoutOrderId || resolvedCheckoutOrderIdRaw || null,
              p_payer_email: buyerEmail,
              p_payer_phone: buyerPhone || null,
              p_amount_cents: amountCents,
              p_credit_amount: creditAmount,
              p_activate_store: true,
              p_metadata: {
                source: 'checkout_status_poll_fallback',
                gateway_status: gatewayStatus,
                transaction: upstreamData,
              },
            });

            if (fallbackError) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.writeHead(500);
              res.end(JSON.stringify({
                error: 'Falha ao registrar benefício via fallback de status',
                message: fallbackError.message,
              }));
              return;
            }

            const fallbackStatus = String(fallbackData?.status || '').toLowerCase();
            if (fallbackStatus === 'pending_registered') {
              status = 'paid';
              matchedBy = 'provider_status_poll';
              fallbackApplied = true;
            }
          } else if (gatewayStatus && isFailurePaymentStatus(gatewayStatus)) {
            status = 'failed';
            matchedBy = 'provider_status_poll';
          }
        }
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        status,
        matchedBy,
        gatewayStatus,
        fallbackApplied,
      }));
    } catch (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({
        error: 'Falha ao consultar status do checkout',
        message: error?.message || 'Erro desconhecido',
      }));
    }
    return;
  }

  if (req.url === '/api/public/first-offer/checkout' && req.method === 'POST') {
    try {
      const requestBody = await readRequestBody(req);
      const payload = parseJsonSafe(requestBody) || {};

      const email = String(payload?.customer?.email || '').trim().toLowerCase();
      const name = String(payload?.customer?.name || '').trim() || 'Cliente';
      const phoneDigits = normalizeDigits(payload?.customer?.phone || '');
      const requestedOfferName = String(payload?.offerName || '').trim();
      const normalizedOfferName = requestedOfferName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const offerCatalog = {
        'combo mensal': { offerName: 'Combo mensal', amountCents: 3990 },
        'combo trimestral': { offerName: 'Combo trimestral', amountCents: 9490 },
        'combo semestral': { offerName: 'Combo semestral', amountCents: 15990 },
      };

      // Catálogo de upsells aceitos (preço em centavos)
      const upsellCatalog = {
        'streaming - 30 dias': 1790,
        'acesso extra (+1 login simultaneo)': 1990,
        'grupo vip de networking - vitalicio': 990,
        'afiliacao': 3990,
      };

      function normalizeItemTitle(title) {
        return String(title || '')
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
      }

      const selectedOffer = offerCatalog[normalizedOfferName] || null;

      const orderItems = Array.isArray(payload?.items) ? payload.items : [];

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'E-mail inválido' }));
        return;
      }

      if (!selectedOffer) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Oferta inválida para checkout público' }));
        return;
      }

      const offerName = selectedOffer.offerName;
      let amountCents = selectedOffer.amountCents;

      // Processar upsells do request
      const validatedItems = [{ title: offerName, unitPriceCents: amountCents, quantity: 1 }];

      for (const item of orderItems) {
        const itemTitle = normalizeItemTitle(item?.title);
        // Pular o item base (já incluído acima)
        if (itemTitle === normalizedOfferName) continue;
        // Verificar se é um upsell conhecido
        const catalogPrice = upsellCatalog[itemTitle];
        if (catalogPrice != null) {
          const qty = Math.max(1, Math.min(Number(item?.quantity || 1), 5));
          amountCents += catalogPrice * qty;
          validatedItems.push({
            title: String(item?.title || '').trim(),
            unitPriceCents: catalogPrice,
            quantity: qty,
          });
        }
      }

      const totalItems = validatedItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

      const checkoutOrderId = randomUUID();
      const idempotencyKey = `first_offer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const gatewayPayload = {
        amount: Math.round(amountCents),
        currency: 'BRL',
        payment_method: 'PIX',
        paymentMethod: 'PIX',
        customer: {
          name,
          email,
          phone: phoneDigits.length >= 10 ? phoneDigits.slice(0, 11) : '11999999999',
          document: {
            type: 'CPF',
            number: '25448606695',
          },
        },
        items: validatedItems.map((item) => ({
          title: item.title,
          unitPrice: Math.round(item.unitPriceCents),
          quantity: item.quantity,
          externalRef: checkoutOrderId,
        })),
        external_id: checkoutOrderId,
        externalRef: checkoutOrderId,
        idempotency_key: idempotencyKey,
        description: validatedItems.map((item) => item.title).join(' + '),
        metadata: {
          checkout_order_id: checkoutOrderId,
          source: 'first_offer_public_checkout',
          customer_email: email,
          customer_phone: phoneDigits.length >= 10 ? phoneDigits.slice(0, 11) : null,
          total_items: totalItems,
          total_amount_cents: Math.round(amountCents),
          items_breakdown: validatedItems,
        },
      };

      const upstreamResponse = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gatewayPayload),
      });

      const upstreamText = await upstreamResponse.text();
      let upstreamData = upstreamText;
      try {
        upstreamData = upstreamText ? JSON.parse(upstreamText) : {};
      } catch {
        upstreamData = upstreamText;
      }

      if (!upstreamResponse.ok) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(upstreamResponse.status);
        res.end(JSON.stringify({
          error: 'Falha ao criar transação na Babylon',
          detail: upstreamData,
        }));
        return;
      }

      const providerOrderId = upstreamData?.provider_order_id
        || upstreamData?.order_id
        || upstreamData?.transaction_id
        || upstreamData?.id
        || upstreamData?.data?.id
        || null;

      const artifacts = collectCheckoutArtifacts(upstreamData);

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        orderId: checkoutOrderId,
        providerOrderId,
        gatewayStatus: String(upstreamData?.status || upstreamData?.data?.status || 'pending').toLowerCase(),
        pixCopyPasteCode: artifacts.pixCopyPasteCode,
        pixQrUrl: artifacts.pixQrUrl,
        raw: upstreamData,
      }));
    } catch (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({
        error: 'Falha no checkout público',
        message: error?.message || 'Erro desconhecido',
      }));
    }
    return;
  }

  // ── Admin: Delete user ──
  const deleteUserMatch = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/i);
  if (deleteUserMatch && req.method === 'DELETE') {
    const targetUserId = deleteUserMatch[1];

    const authResult = await authenticateRequestUser(req);
    if (!authResult.user) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(authResult.status);
      res.end(JSON.stringify({ error: authResult.error }));
      return;
    }

    const adminResult = await assertAdminUser(authResult.user.id);
    if (!adminResult.ok) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(adminResult.status);
      res.end(JSON.stringify({ error: adminResult.error }));
      return;
    }

    if (targetUserId === authResult.user.id) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Não é possível excluir a si mesmo' }));
      return;
    }

    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
      if (error) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao excluir usuário', message: error.message }));
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Erro ao excluir usuário', message: err?.message || 'Erro desconhecido' }));
    }
    return;
  }

  // ── Admin: Set wallet balance ──
  const walletMatch = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})\/wallet$/i);
  if (walletMatch && req.method === 'PATCH') {
    const targetUserId = walletMatch[1];

    const authResult = await authenticateRequestUser(req);
    if (!authResult.user) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(authResult.status);
      res.end(JSON.stringify({ error: authResult.error }));
      return;
    }

    const adminResult = await assertAdminUser(authResult.user.id);
    if (!adminResult.ok) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(adminResult.status);
      res.end(JSON.stringify({ error: adminResult.error }));
      return;
    }

    const requestBody = await readRequestBody(req);
    const payload = parseJsonSafe(requestBody);
    const newBalance = Number(payload?.balance);

    if (!Number.isFinite(newBalance) || newBalance < 0) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Valor de saldo inválido. Deve ser um número >= 0.' }));
      return;
    }

    try {
      const roundedBalance = Math.round(newBalance);

      const { data: existing } = await supabaseAdmin
        .from('wallet_balances')
        .select('profile_id')
        .eq('profile_id', targetUserId)
        .maybeSingle();

      let error;
      if (existing) {
        ({ error } = await supabaseAdmin
          .from('wallet_balances')
          .update({ balance: roundedBalance, updated_at: new Date().toISOString() })
          .eq('profile_id', targetUserId));
      } else {
        ({ error } = await supabaseAdmin
          .from('wallet_balances')
          .insert({ profile_id: targetUserId, balance: roundedBalance }));
      }

      if (error) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao atualizar saldo', message: error.message }));
        return;
      }

      // Log the change in wallet_transactions
      await supabaseAdmin
        .from('wallet_transactions')
        .insert({
          profile_id: targetUserId,
          amount: roundedBalance - (existing ? 0 : 0),
          type: 'admin_set',
          description: `Saldo definido manualmente para ${roundedBalance} créditos pelo admin`,
        })
        .then(() => {})
        .catch(() => {});

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, balance: roundedBalance }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Erro ao atualizar saldo', message: err?.message || 'Erro desconhecido' }));
    }
    return;
  }

  if (pathname === '/api/admin/invite-links' && req.method === 'GET') {
    const authResult = await authenticateRequestUser(req);
    if (!authResult.user) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(authResult.status);
      res.end(JSON.stringify({ error: authResult.error }));
      return;
    }

    const adminResult = await assertAdminUser(authResult.user.id);
    if (!adminResult.ok) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(adminResult.status);
      res.end(JSON.stringify({ error: adminResult.error }));
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('admin_invite_links')
      .select('id, created_at, updated_at, target_email, max_uses, used_count, grant_store_access, grant_credits, status, note, expires_at, last_used_at, last_used_by')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Erro ao listar convites', message: error.message }));
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, invites: data || [] }));
    return;
  }

  if (pathname === '/api/admin/invite-links' && req.method === 'POST') {
    const authResult = await authenticateRequestUser(req);
    if (!authResult.user) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(authResult.status);
      res.end(JSON.stringify({ error: authResult.error }));
      return;
    }

    const adminResult = await assertAdminUser(authResult.user.id);
    if (!adminResult.ok) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(adminResult.status);
      res.end(JSON.stringify({ error: adminResult.error }));
      return;
    }

    const requestBody = await readRequestBody(req);
    const payload = parseJsonSafe(requestBody) || {};

    const expiresInDaysRaw = Number(payload?.expiresInDays);
    const expiresInDays = Number.isFinite(expiresInDaysRaw)
      ? Math.min(Math.max(Math.round(expiresInDaysRaw), 1), 90)
      : 7;

    const targetEmailRaw = String(payload?.targetEmail || '').trim().toLowerCase();
    const targetEmail = targetEmailRaw || null;
    const maxUsesRaw = Number(payload?.maxUses);
    const maxUses = Number.isFinite(maxUsesRaw)
      ? Math.min(Math.max(Math.round(maxUsesRaw), 1), 100)
      : 1;
    const grantCreditsRaw = Number(payload?.grantCredits);
    const grantCredits = Number.isFinite(grantCreditsRaw)
      ? Math.min(Math.max(Math.round(grantCreditsRaw), 0), 1000000)
      : 0;
    const grantStoreAccess = payload?.grantStoreAccess !== false;
    const note = String(payload?.note || '').trim().slice(0, 300) || null;

    if (targetEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'targetEmail inválido' }));
      return;
    }

    const token = `${randomUUID()}${randomBytes(24).toString('hex')}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + (expiresInDays * 24 * 60 * 60 * 1000)).toISOString();

    const { data, error } = await supabaseAdmin
      .from('admin_invite_links')
      .insert({
        token_hash: tokenHash,
        created_by: authResult.user.id,
        target_email: targetEmail,
        max_uses: maxUses,
        grant_store_access: grantStoreAccess,
        grant_credits: grantCredits,
        note,
        expires_at: expiresAt,
      })
      .select('id, created_at, target_email, max_uses, used_count, grant_store_access, grant_credits, status, note, expires_at')
      .single();

    if (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Erro ao criar convite', message: error.message }));
      return;
    }

    const inviteBaseUrl = publicAppUrl || origin || 'http://localhost:5173';
    const inviteUrl = `${inviteBaseUrl}/login?invite=${encodeURIComponent(token)}`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      invite: data,
      inviteUrl,
    }));
    return;
  }

  if (pathname === '/api/admin/invite-links/revoke' && req.method === 'POST') {
    const authResult = await authenticateRequestUser(req);
    if (!authResult.user) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(authResult.status);
      res.end(JSON.stringify({ error: authResult.error }));
      return;
    }

    const adminResult = await assertAdminUser(authResult.user.id);
    if (!adminResult.ok) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(adminResult.status);
      res.end(JSON.stringify({ error: adminResult.error }));
      return;
    }

    const requestBody = await readRequestBody(req);
    const payload = parseJsonSafe(requestBody) || {};
    const inviteId = String(payload?.inviteId || '').trim();

    if (!UUID_REGEX.test(inviteId)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'inviteId inválido' }));
      return;
    }

    const { error } = await supabaseAdmin
      .from('admin_invite_links')
      .update({ status: 'revoked' })
      .eq('id', inviteId)
      .eq('status', 'active');

    if (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Erro ao revogar convite', message: error.message }));
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/api/admin/invite-links/claim' && req.method === 'POST') {
    const authResult = await authenticateRequestUser(req);
    if (!authResult.user) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(authResult.status);
      res.end(JSON.stringify({ error: authResult.error }));
      return;
    }

    const requestBody = await readRequestBody(req);
    const payload = parseJsonSafe(requestBody) || {};
    const token = String(payload?.token || '').trim();

    if (!token || token.length < 20) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Token de convite inválido' }));
      return;
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const { data, error } = await supabaseAdmin.rpc('claim_admin_invite_link', {
      p_token_hash: tokenHash,
      p_profile_id: authResult.user.id,
      p_profile_email: authResult.user.email || null,
      p_ip: req.socket?.remoteAddress || null,
    });

    if (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Erro ao resgatar convite', message: error.message }));
      return;
    }

    const status = String(data?.status || '').toLowerCase();
    const acceptedStatuses = new Set(['claimed', 'already_used', 'expired', 'revoked', 'email_mismatch', 'invalid_token']);

    if (!acceptedStatuses.has(status)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Resposta inválida do resgate de convite', result: data }));
      return;
    }

    const httpStatus = status === 'claimed' ? 200 : 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(httpStatus);
    res.end(JSON.stringify({ ok: status === 'claimed', result: data }));
    return;
  }

  if (!req.url?.startsWith('/api/babylon')) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const authHeader = getAuthHeader();

  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const upstreamPath = requestUrl.pathname.replace('/api/babylon', '');
    const upstreamUrl = `${baseUrl}${upstreamPath}${requestUrl.search}`;

    const requestBody = await readRequestBody(req);
    const hasBody = requestBody.length > 0;
    const isClaimPendingBenefitsPath = req.method === 'POST' && upstreamPath === '/claim-pending-benefits';

    let authenticatedUser = null;
    if (requireApiAuth || isClaimPendingBenefitsPath) {
      const bearerToken = getBearerToken(req);
      if (!bearerToken) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized: missing bearer token' }));
        return;
      }

      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
      if (authError || !authData?.user?.id) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized: invalid bearer token' }));
        return;
      }

      authenticatedUser = authData.user;
    }

    if (req.method === 'POST' && isTransactionCreatePath(upstreamPath)) {
      const payload = parseJsonSafe(requestBody);
      const checkoutOrderIdRaw = String(payload?.external_id || payload?.externalRef || payload?.metadata?.checkout_order_id || '').trim();
      const checkoutOrderId = UUID_REGEX.test(checkoutOrderIdRaw) ? checkoutOrderIdRaw : null;

      if (!checkoutOrderId) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'external_id inválido para transação Babylon' }));
        return;
      }

      if (authenticatedUser?.id) {
        const { data: checkoutOrder, error: checkoutOrderError } = await supabaseAdmin
          .from('checkout_orders')
          .select('id')
          .eq('id', checkoutOrderId)
          .eq('profile_id', authenticatedUser.id)
          .maybeSingle();

        if (checkoutOrderError || !checkoutOrder?.id) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'Forbidden: checkout order não pertence ao usuário autenticado' }));
          return;
        }
      }
    }

    if (req.method === 'POST' && upstreamPath === '/claim-pending-benefits') {
      if (!authenticatedUser?.id) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const { data, error } = await supabaseAdmin.rpc('apply_pending_checkout_benefits_for_profile', {
        p_profile_id: authenticatedUser.id,
        p_email: authenticatedUser.email || null,
      });

      if (error) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({
          error: 'Erro ao aplicar benefícios pendentes',
          message: error.message,
        }));
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, result: data }));
      return;
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: hasBody ? requestBody : undefined,
    });

    const upstreamText = await upstreamResponse.text();
    const upstreamContentType = upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8';

    res.setHeader('Content-Type', upstreamContentType);
    res.writeHead(upstreamResponse.status);
    res.end(upstreamText);
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(502);
    res.end(JSON.stringify({
      error: 'Falha ao comunicar com Banco Babylon',
      message: error?.message || 'Erro desconhecido',
    }));
  }
});

server.listen(port, () => {
  console.log(`[babylon-proxy] running on http://localhost:${port}`);
});
