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

// ── Payment gateway selection (mutable — toggled via admin API) ──
let activeGateway = String(process.env.PAYMENT_GATEWAY || 'babylon').trim().toLowerCase();
const AMPLOPAY_BASE_URL = 'https://app.amplopay.com/api/v1';
const AMPLOPAY_PUBLIC_KEY = String(process.env.AMPLOPAY_PUBLIC_KEY || '').trim();
const AMPLOPAY_SECRET_KEY = String(process.env.AMPLOPAY_SECRET_KEY || '').trim();
const AMPLOPAY_WEBHOOK_TOKEN = String(process.env.AMPLOPAY_WEBHOOK_TOKEN || '').trim();
let isAmploPay = activeGateway === 'amplopay';

const babylonWebhookCallbackUrl = (() => {
  const directUrl = String(process.env.BABYLON_WEBHOOK_CALLBACK_URL || '').trim();
  if (directUrl) return directUrl;
  if (!publicAppUrl) return null;
  const apiBase = publicAppUrl.replace(/^https?:\/\/(?:www\.|app\.)?/, 'https://api.');
  return `${apiBase}/webhooks/babylon`;
})();

const amploPayWebhookCallbackUrl = (() => {
  const directUrl = String(process.env.AMPLOPAY_WEBHOOK_CALLBACK_URL || '').trim();
  if (directUrl) return directUrl;
  if (!publicAppUrl) return null;
  const apiBase = publicAppUrl.replace(/^https?:\/\/(?:www\.|app\.)?/, 'https://api.');
  return `${apiBase}/webhooks/amplopay`;
})();
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

// ── Meta Conversions API (server-side) ──
const META_PIXEL_ID = String(process.env.META_PIXEL_ID || '1580553502953265').trim();
const META_CAPI_ACCESS_TOKEN = String(process.env.META_CAPI_ACCESS_TOKEN || '').trim();
const META_CAPI_ENDPOINT = `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`;

async function sendMetaConversionEvent({ eventName, eventId, email, phone, value, currency, transactionId, sourceUrl, ipAddress, userAgent }) {
  if (!META_CAPI_ACCESS_TOKEN || !META_PIXEL_ID) {
    return;
  }

  try {
    const userData = {};
    if (email) {
      userData.em = [createHash('sha256').update(email.trim().toLowerCase()).digest('hex')];
    }
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 10) {
        userData.ph = [createHash('sha256').update(digits).digest('hex')];
      }
    }
    if (ipAddress) {
      userData.client_ip_address = ipAddress;
    }
    if (userAgent) {
      userData.client_user_agent = userAgent;
    }
    userData.country = [createHash('sha256').update('br').digest('hex')];

    const eventData = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: userData,
    };

    if (eventId) {
      eventData.event_id = eventId;
    }

    if (sourceUrl) {
      eventData.event_source_url = sourceUrl;
    }

    const customData = {};
    if (currency) customData.currency = currency;
    if (value != null && Number.isFinite(Number(value)) && Number(value) > 0) {
      customData.value = Number(Number(value).toFixed(2));
    }
    if (transactionId) customData.order_id = transactionId;
    if (Object.keys(customData).length > 0) {
      eventData.custom_data = customData;
    }

    const body = JSON.stringify({
      data: [eventData],
      access_token: META_CAPI_ACCESS_TOKEN,
    });

    const response = await fetch(META_CAPI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (response.ok) {
      console.log(`[meta-capi] ${eventName} sent | eventId=${eventId || 'none'} | value=${value || 0}`);
    } else {
      const errText = await response.text().catch(() => '');
      console.warn(`[meta-capi] ${eventName} failed HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[meta-capi] ${eventName} error: ${err?.message}`);
  }
}

// ── Rate limiter (in-memory, per IP) ──
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = isProduction ? 60 : 300;
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 1 };
    rateLimitMap.set(ip, entry);
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Limpa IPs antigos a cada 2 minutos para evitar memory leak
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, entry] of rateLimitMap) {
    if (entry.windowStart < cutoff) rateLimitMap.delete(ip);
  }
  for (const [ip, entry] of checkoutRateLimitMap) {
    if (entry.windowStart < cutoff) checkoutRateLimitMap.delete(ip);
  }
}, 120_000).unref();

// ── Checkout-specific rate limiter (tighter: 5 req/min per IP) ──
const CHECKOUT_RATE_LIMIT_MAX = 5;
const checkoutRateLimitMap = new Map();

function isCheckoutRateLimited(ip) {
  const now = Date.now();
  let entry = checkoutRateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 1 };
    checkoutRateLimitMap.set(ip, entry);
    return false;
  }
  entry.count += 1;
  return entry.count > CHECKOUT_RATE_LIMIT_MAX;
}

function getAuthHeader() {
  const secretKey = process.env.BABYLON_SECRET_KEY;
  const companyId = process.env.BABYLON_COMPANY_ID;

  if (!secretKey || !companyId) {
    return null;
  }

  const credentials = Buffer.from(`${secretKey}:${companyId}`).toString('base64');
  return `Basic ${credentials}`;
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
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

function generateValidCpf() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  // Rejeita sequências de dígitos iguais (ex: 000000000)
  if (d.every((v) => v === d[0])) d[8] = (d[0] + 1) % 10;
  const calc = (digits, len) => {
    const sum = digits.reduce((s, n, i) => s + n * (len + 1 - i), 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  d.push(calc(d, 9));
  d.push(calc(d, 10));
  return d.join('');
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

// ── AmploPay helpers ──
function amploPayHeaders() {
  return {
    'x-public-key': AMPLOPAY_PUBLIC_KEY,
    'x-secret-key': AMPLOPAY_SECRET_KEY,
    'Content-Type': 'application/json',
    'User-Agent': 'ConcursaFlix-Backend/1.0',
  };
}

function isAmploPayConfigured() {
  return Boolean(AMPLOPAY_PUBLIC_KEY && AMPLOPAY_SECRET_KEY);
}

function normalizeAmploPayStatus(status) {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'COMPLETED' || s === 'OK') return 'approved';
  if (s === 'PENDING') return 'pending';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'CANCELED') return 'failed';
  if (s === 'REFUNDED' || s === 'CHARGED_BACK') return 'refunded';
  return s.toLowerCase();
}

function isAmploPayApprovedEvent(event) {
  const e = String(event || '').trim().toUpperCase();
  return e === 'TRANSACTION_PAID';
}

function isAmploPayFailureEvent(event) {
  const e = String(event || '').trim().toUpperCase();
  return ['TRANSACTION_CANCELED', 'TRANSACTION_REFUNDED'].includes(e);
}

async function createAmploPayPix({ identifier, amount, amountBrl, client, products, callbackUrl, metadata }) {
  const resolvedAmount = amount ?? amountBrl ?? 0;
  const body = {
    identifier,
    amount: resolvedAmount,
    client: {
      name: client.name || 'Cliente',
      email: client.email,
      phone: client.phone || '',
      document: client.document || client.cpf || '',
    },
    ...(products && products.length > 0 ? {
      products: products.map((p, idx) => ({
        id: p.id || `item_${idx + 1}`,
        name: p.name || p.title || 'Produto',
        quantity: p.quantity || 1,
        price: p.price || p.unitPrice || 0,
      })),
    } : {}),
    ...(callbackUrl ? { callbackUrl } : {}),
    ...(metadata ? { metadata } : {}),
  };

  const response = await fetch(`${AMPLOPAY_BASE_URL}/gateway/pix/receive`, {
    method: 'POST',
    headers: amploPayHeaders(),
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function fetchAmploPayTransaction(transactionId) {
  const url = `${AMPLOPAY_BASE_URL}/gateway/transactions?id=${encodeURIComponent(transactionId)}`;
  const response = await fetch(url, { method: 'GET', headers: amploPayHeaders() });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
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
    responseData?.pix?.qrCode,
    responseData?.pix?.qrcode,
    responseData?.data?.pix?.qrCode,
    responseData?.data?.pix?.qrcode,
    responseData?.pixInformation?.qrCode,
    responseData?.transaction?.pixInformation?.qrCode,
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
  const requiresGatewayAuth = options?.requiresBabylonAuth !== false;
  const requiresPublicAppUrl = options?.requiresPublicAppUrl === true;
  const issues = [];

  if (requiresGatewayAuth) {
    if (isAmploPay) {
      if (!isAmploPayConfigured()) {
        issues.push('Defina AMPLOPAY_PUBLIC_KEY e AMPLOPAY_SECRET_KEY para uso do gateway AmploPay.');
      }
    } else {
      const hasAuthHeader = Boolean(getAuthHeader());
      if (!hasAuthHeader) {
        issues.push('Defina BABYLON_SECRET_KEY e BABYLON_COMPANY_ID.');
      }
    }
  }

  if (requiresWebhookToken) {
    if (!AMPLOPAY_WEBHOOK_TOKEN) {
      issues.push('Defina AMPLOPAY_WEBHOOK_TOKEN para validar o webhook AmploPay.');
    }
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

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  // Security headers em toda resposta
  setSecurityHeaders(res);

  // Rate limiting por IP
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Retry-After', '60');
    res.writeHead(429);
    res.end(JSON.stringify({ error: 'Too many requests. Try again later.' }));
    return;
  }

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
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    // In production, only expose minimal health info — no infrastructure details
    if (isProduction) {
      const healthy = (isAmploPay ? isAmploPayConfigured() : configured) && supabaseConfigured;
      res.end(JSON.stringify({ ok: true, status: healthy ? 'healthy' : 'degraded' }));
    } else {
      const webhookTokenConfigured = Boolean(process.env.BABYLON_WEBHOOK_TOKEN);
      const amploPayConfigured = isAmploPayConfigured();
      res.end(JSON.stringify({
        ok: true,
        activeGateway,
        configured: isAmploPay ? amploPayConfigured : configured,
        supabaseConfigured,
        webhookTokenConfigured: isAmploPay ? Boolean(AMPLOPAY_WEBHOOK_TOKEN) : webhookTokenConfigured,
        babylonConfigured: configured,
        amploPayConfigured,
        status: (isAmploPay ? amploPayConfigured : configured) && supabaseConfigured ? 'healthy' : 'degraded',
      }));
    }
    return;
  }

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = requestUrl.pathname;
  const needsSupabase = pathname === '/webhooks/babylon'
    || pathname === '/webhooks/amplopay'
    || pathname === '/api/store/checkout-status'
    || pathname.startsWith('/api/public/first-offer/checkout-status')
    || pathname.startsWith('/api/admin/invite-links')
    || pathname.startsWith('/api/admin/users')
    || pathname.startsWith('/api/admin/payment-gateway')
    || pathname.startsWith('/api/babylon');
  const needsBabylonAuth = pathname === '/webhooks/babylon'
    || pathname.startsWith('/api/public/first-offer/checkout')
    || pathname === '/api/store/checkout-status'
    || pathname.startsWith('/api/babylon');
  const needsWebhookToken = pathname === '/webhooks/amplopay'
    && (isProduction || Boolean(AMPLOPAY_WEBHOOK_TOKEN));
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
    try {
      const webhookIp = req.socket?.remoteAddress || 'unknown';
      console.log(`[webhook:babylon] Incoming webhook from IP: ${webhookIp} | UA: ${req.headers['user-agent'] || 'unknown'}`);

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
        || payload?.data?.id
        || payload?.objectId
        || ''
      ).trim();

      const checkoutOrderIdRaw = String(
        payload?.external_id
        || payload?.metadata?.checkout_order_id
        || payload?.data?.external_id
        || payload?.data?.metadata?.checkout_order_id
        || payload?.data?.externalRef
        || ''
      ).trim();

      const checkoutOrderId = UUID_REGEX.test(checkoutOrderIdRaw) ? checkoutOrderIdRaw : null;

      // ── Reverse Verification: confirm payment status directly with Babylon API ──
      // This is the most secure approach when the provider doesn't support webhook signing.
      // Even if an attacker forges a webhook payload, we verify with Babylon before processing.
      let verifiedEventType = String(
        payload?.event_type
        || payload?.event
        || payload?.type
        || payload?.status
        || payload?.data?.status
        || ''
      ).trim();

      if (providerOrderId && getAuthHeader()) {
        try {
          const verifyUrl = `${baseUrl}/transactions/${encodeURIComponent(providerOrderId)}`;
          const verifyResponse = await fetch(verifyUrl, {
            method: 'GET',
            headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
          });

          if (verifyResponse.ok) {
            const verifyText = await verifyResponse.text();
            let verifyData;
            try { verifyData = verifyText ? JSON.parse(verifyText) : {}; } catch { verifyData = {}; }

            const confirmedStatus = String(
              verifyData?.status || verifyData?.data?.status || ''
            ).trim().toLowerCase();

            if (confirmedStatus) {
              // Use the verified status from the API, not the webhook payload
              verifiedEventType = confirmedStatus;
              console.log(`[webhook:babylon] Reverse-verified transaction ${providerOrderId}: status="${confirmedStatus}"`);
            }
          } else {
            console.warn(`[webhook:babylon] Reverse verification failed for ${providerOrderId}: HTTP ${verifyResponse.status} — rejecting webhook`);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'Reverse verification failed' }));
            return;
          }
        } catch (verifyErr) {
          console.warn(`[webhook:babylon] Reverse verification error for ${providerOrderId}: ${verifyErr?.message} — rejecting webhook`);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'Reverse verification unavailable' }));
          return;
        }
      } else if (!providerOrderId) {
        console.warn('[webhook:babylon] No providerOrderId found in payload — cannot reverse-verify');
      }

      const eventType = verifiedEventType || 'payment.approved';

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

          // Auto-apply: se o perfil já existe, aplica benefícios imediatamente
          if (!error && data?.profile_id) {
            try {
              await supabaseAdmin.rpc('apply_pending_checkout_benefits_for_profile', {
                p_profile_id: data.profile_id,
                p_email: buyerEmail || null,
              });
            } catch (_autoApplyErr) {
              // Não bloqueia o webhook se auto-apply falhar — será feito no login
            }
          }

          // Meta CAPI: Purchase server-side
          if (!error) {
            sendMetaConversionEvent({
              eventName: 'Purchase',
              eventId: `purchase_${providerOrderId || checkoutOrderId || eventId}`,
              email: buyerEmail,
              phone: buyerPhone,
              value: amountCents > 0 ? (amountCents / 100) : null,
              currency: 'BRL',
              transactionId: providerOrderId,
              sourceUrl: publicAppUrl || 'https://combosalvauniversitario.com',
              ipAddress: webhookIp,
            });
          }
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

              // Auto-apply: se o perfil já existe, aplica benefícios imediatamente
              if (data?.profile_id) {
                try {
                  await supabaseAdmin.rpc('apply_pending_checkout_benefits_for_profile', {
                    p_profile_id: data.profile_id,
                    p_email: fallbackEmail || null,
                  });
                } catch (_autoApplyErr) {
                  // Não bloqueia o webhook se auto-apply falhar
                }
              }

              // Meta CAPI: Purchase server-side (fallback path)
              sendMetaConversionEvent({
                eventName: 'Purchase',
                eventId: `purchase_${providerOrderId || checkoutOrderId || eventId}`,
                email: fallbackEmail,
                phone: fallbackPhone,
                value: fallbackAmountCents > 0 ? (fallbackAmountCents / 100) : null,
                currency: 'BRL',
                transactionId: providerOrderId,
                sourceUrl: publicAppUrl || 'https://combosalvauniversitario.com',
                ipAddress: webhookIp,
              });
            }
          }
        }
      }

      if (error) {
        console.error(`[webhook:babylon] Supabase RPC error: ${error.message}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({
          error: 'Erro ao aplicar webhook no Supabase',
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
      }));
    }
    return;
  }

  // ── AmploPay webhook ──
  if (pathname === '/webhooks/amplopay' && req.method === 'POST') {
    try {
      const rawBody = await readRequestBody(req);
      const textBody = rawBody.toString('utf8') || '{}';
      const payload = textBody ? JSON.parse(textBody) : {};

      // Validate webhook token (REQUIRED in production, strongly recommended in dev)
      if (!AMPLOPAY_WEBHOOK_TOKEN) {
        console.error('[webhook:amplopay] AMPLOPAY_WEBHOOK_TOKEN not configured — rejecting webhook for security');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Webhook token not configured on server' }));
        return;
      }

      const receivedToken = String(payload?.token || '').trim();
      if (!receivedToken || receivedToken !== AMPLOPAY_WEBHOOK_TOKEN) {
        console.error(`[webhook:amplopay] TOKEN MISMATCH — received: "${String(receivedToken || '').slice(0, 12)}..." | IP: ${req.socket?.remoteAddress || 'unknown'}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized webhook token' }));
        return;
      }

      const event = String(payload?.event || '').trim();
      const providerName = 'amplopay';
      const transactionId = String(payload?.transaction?.id || '').trim();
      const transactionIdentifier = String(payload?.transaction?.identifier || '').trim();
      const clientEmail = normalizeEmail(payload?.client?.email || '');
      const clientPhone = String(payload?.client?.phone || '').trim();
      const amountBrl = Number(payload?.transaction?.amount || 0);
      const amountCents = Math.round(amountBrl * 100);

      const checkoutOrderIdRaw = transactionIdentifier;
      const checkoutOrderId = UUID_REGEX.test(checkoutOrderIdRaw) ? checkoutOrderIdRaw : null;

      const fallbackEventHash = createHash('sha256').update(textBody).digest('hex');
      const eventId = transactionId || `amplopay_${fallbackEventHash}`;

      // Map AmploPay event to generic event type
      let eventType;
      if (isAmploPayApprovedEvent(event)) {
        eventType = 'payment.approved';
      } else if (isAmploPayFailureEvent(event)) {
        eventType = event === 'TRANSACTION_CANCELED' ? 'canceled' : 'refunded';
      } else {
        eventType = event || 'unknown';
      }

      // Route through the same Supabase logic as Babylon
      const checkoutSource = (() => {
        const metaSource = String(payload?.transaction?.metadata?.source || '').trim().toLowerCase();
        if (metaSource) return metaSource;
        if (checkoutOrderId) {
          // Will be resolved below
          return '';
        }
        return 'first_offer_public_checkout';
      })();

      let resolvedSource = checkoutSource;
      if (!resolvedSource && checkoutOrderId) {
        const { data: orderData } = await supabaseAdmin
          .from('checkout_orders')
          .select('metadata')
          .eq('id', checkoutOrderId)
          .maybeSingle();
        resolvedSource = String(orderData?.metadata?.source || '').trim().toLowerCase();
      }

      let data;
      let error;

      if (resolvedSource === 'wallet_topup') {
        const result = await supabaseAdmin.rpc('apply_checkout_paid_event', {
          p_provider_name: providerName,
          p_provider_event_id: eventId,
          p_provider_order_id: transactionId || null,
          p_event_type: eventType,
          p_payload: payload,
        });
        data = result.data;
        error = result.error;
      } else if (resolvedSource === 'first_offer_public_checkout' || !resolvedSource) {
        if (!isAmploPayApprovedEvent(event)) {
          data = { status: 'ignored_event_type', event_type: event };
          error = null;
        } else {
          const creditAmount = resolveCreditAmountFromCents(amountCents);
          const result = await supabaseAdmin.rpc('register_pending_checkout_benefit', {
            p_provider_name: providerName,
            p_provider_event_id: eventId,
            p_provider_order_id: transactionId || null,
            p_checkout_order_id: checkoutOrderId || transactionIdentifier || null,
            p_payer_email: clientEmail,
            p_payer_phone: clientPhone || null,
            p_amount_cents: amountCents,
            p_credit_amount: creditAmount,
            p_activate_store: true,
            p_metadata: payload,
          });
          data = result.data;
          error = result.error;

          if (!error && data?.profile_id) {
            try {
              await supabaseAdmin.rpc('apply_pending_checkout_benefits_for_profile', {
                p_profile_id: data.profile_id,
                p_email: clientEmail || null,
              });
            } catch (_autoApplyErr) { /* will be applied on login */ }
          }

          // Meta CAPI: Purchase server-side (AmploPay webhook)
          if (!error) {
            sendMetaConversionEvent({
              eventName: 'Purchase',
              eventId: `purchase_${transactionId || checkoutOrderId || eventId}`,
              email: clientEmail,
              phone: clientPhone,
              value: amountCents > 0 ? (amountCents / 100) : null,
              currency: 'BRL',
              transactionId: transactionId,
              sourceUrl: publicAppUrl || 'https://combosalvauniversitario.com',
            });
          }
        }
      } else {
        const result = await supabaseAdmin.rpc('apply_checkout_paid_and_grant_access', {
          p_provider_name: providerName,
          p_provider_event_id: eventId,
          p_provider_order_id: transactionId || null,
          p_checkout_order_id: checkoutOrderId,
          p_event_type: eventType,
          p_payload: payload,
        });
        data = result.data;
        error = result.error;
      }

      if (error) {
        console.error(`[webhook:amplopay] RPC error: ${error.message}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao aplicar webhook AmploPay' }));
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, result: data }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Webhook inválido' }));
    }
    return;
  }

  // ── Authenticated checkout status poll (store access and wallet top-up) ──
  if (pathname === '/api/store/checkout-status' && req.method === 'GET') {
    try {
      const authResult = await authenticateRequestUser(req);
      if (!authResult.user) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(authResult.status);
        res.end(JSON.stringify({ error: authResult.error }));
        return;
      }

      const storeRequestUrl = new URL(req.url, 'http://localhost');
      const checkoutOrderId = String(storeRequestUrl.searchParams.get('checkoutOrderId') || '').trim();

      if (!checkoutOrderId || !UUID_REGEX.test(checkoutOrderId)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Informe checkoutOrderId válido' }));
        return;
      }

      // Fetch order and validate ownership
      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('checkout_orders')
        .select('id, status, provider_order_id, provider_name, metadata')
        .eq('id', checkoutOrderId)
        .eq('profile_id', authResult.user.id)
        .maybeSingle();

      if (orderError || !orderData?.id) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Pedido não encontrado' }));
        return;
      }

      // Already paid or failed — return immediately
      const currentStatus = String(orderData.status || 'pending').toLowerCase();
      if (currentStatus === 'paid' || currentStatus === 'failed' || currentStatus === 'canceled') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, status: currentStatus, matchedBy: 'order_status' }));
        return;
      }

      const providerOrderId = String(orderData.provider_order_id || '').trim();
      const providerName = String(orderData.provider_name || '').trim().toLowerCase();
      const checkoutSource = String(orderData?.metadata?.source || '').trim().toLowerCase();
      let gatewayStatus = null;
      let paymentApplied = false;

      if (providerOrderId) {
        let approved = false;
        let failed = false;
        let eventType = 'payment.approved';

        if (providerName === 'amplopay') {
          const ampResult = await fetchAmploPayTransaction(providerOrderId);
          if (ampResult.ok && ampResult.data) {
            gatewayStatus = normalizeAmploPayStatus(String(ampResult.data?.status || ''));
            approved = gatewayStatus === 'approved' || gatewayStatus === 'paid';
            failed = isFailurePaymentStatus(gatewayStatus);
          }
        } else {
          const upstreamResponse = await fetch(`${baseUrl}/transactions/${encodeURIComponent(providerOrderId)}`, {
            method: 'GET',
            headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
          });
          if (upstreamResponse.ok) {
            const upstreamText = await upstreamResponse.text();
            let upstreamData;
            try { upstreamData = upstreamText ? JSON.parse(upstreamText) : {}; } catch { upstreamData = {}; }
            gatewayStatus = String(upstreamData?.status || upstreamData?.data?.status || '').toLowerCase() || null;
            approved = isApprovedPaymentEvent(gatewayStatus);
            failed = isFailurePaymentStatus(gatewayStatus);
          }
        }

        if (approved) {
          const pollEventId = `store_status_poll_${providerOrderId}_${Date.now()}`;
          const rpcResult = checkoutSource === 'wallet_topup'
            ? await supabaseAdmin.rpc('apply_checkout_paid_event', {
              p_provider_name: providerName || 'banco_babylon',
              p_provider_event_id: pollEventId,
              p_provider_order_id: providerOrderId,
              p_event_type: eventType,
              p_payload: { source: 'store_status_poll', checkout_source: checkoutSource, gateway_status: gatewayStatus },
            })
            : await supabaseAdmin.rpc('apply_checkout_paid_and_grant_access', {
              p_provider_name: providerName || 'banco_babylon',
              p_provider_event_id: pollEventId,
              p_provider_order_id: providerOrderId,
              p_checkout_order_id: checkoutOrderId,
              p_event_type: eventType,
              p_payload: { source: 'store_status_poll', checkout_source: checkoutSource, gateway_status: gatewayStatus },
            });

          if (!rpcResult.error) {
            const rpcStatus = String(rpcResult.data?.status || '').toLowerCase();
            if (
              rpcStatus === 'paid_and_access_granted'
              || rpcStatus === 'paid_applied'
              || rpcStatus === 'already_paid'
              || rpcStatus === 'duplicate_event'
            ) {
              paymentApplied = true;
              console.log(`[store-checkout-status] Checkout applied via poll for order ${checkoutOrderId} (${checkoutSource || 'store'})`);
            }
          } else {
            console.error(`[store-checkout-status] RPC error for order ${checkoutOrderId}: ${rpcResult.error.message}`);
          }
        } else if (failed) {
          await supabaseAdmin
            .from('checkout_orders')
            .update({ status: 'failed' })
            .eq('id', checkoutOrderId)
            .eq('status', 'pending');
        }
      }

      const finalStatus = paymentApplied ? 'paid' : (gatewayStatus && isFailurePaymentStatus(gatewayStatus) ? 'failed' : 'pending');

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        status: finalStatus,
        gatewayStatus,
        checkoutSource,
        paymentApplied,
      }));
    } catch (error) {
      console.error(`[store-checkout-status] Error: ${error?.message}`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Falha ao verificar status do checkout' }));
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
        let upstreamData = null;
        let upstreamOk = false;

        if (isAmploPay) {
          // ── AmploPay status poll ──
          const ampResult = await fetchAmploPayTransaction(providerOrderId);
          upstreamOk = ampResult.ok;
          upstreamData = ampResult.data;
          if (upstreamOk && upstreamData) {
            const rawStatus = String(upstreamData?.status || '').toUpperCase();
            gatewayStatus = normalizeAmploPayStatus(rawStatus);
            const approved = gatewayStatus === 'approved' || gatewayStatus === 'paid';
            if (approved) {
              const buyerEmail = normalizeEmail(upstreamData?.client?.email || '');
              const buyerPhone = String(upstreamData?.client?.phone || '').trim();
              const amountBrl = Number(upstreamData?.amount || 0);
              const amountCents = Math.round(amountBrl * 100);
              const creditAmount = resolveCreditAmountFromCents(amountCents);

              const resolvedCheckoutOrderIdRaw = String(
                checkoutOrderId || upstreamData?.clientIdentifier || upstreamData?.metadata?.checkout_order_id || ''
              ).trim();
              const resolvedCheckoutOrderId = UUID_REGEX.test(resolvedCheckoutOrderIdRaw) ? resolvedCheckoutOrderIdRaw : null;

              const fallbackEventHash = createHash('sha256').update(JSON.stringify(upstreamData || {})).digest('hex').slice(0, 24);
              const fallbackEventId = `status_poll_${providerOrderId}_${fallbackEventHash}`;

              const { data: fallbackData, error: fallbackError } = await supabaseAdmin.rpc('register_pending_checkout_benefit', {
                p_provider_name: 'amplopay',
                p_provider_event_id: fallbackEventId,
                p_provider_order_id: providerOrderId,
                p_checkout_order_id: resolvedCheckoutOrderId || resolvedCheckoutOrderIdRaw || null,
                p_payer_email: buyerEmail,
                p_payer_phone: buyerPhone || null,
                p_amount_cents: amountCents,
                p_credit_amount: creditAmount,
                p_activate_store: true,
                p_metadata: { source: 'checkout_status_poll_fallback', gateway_status: gatewayStatus, transaction: upstreamData },
              });

              if (fallbackError) {
                console.error(`[checkout-status] AmploPay fallback RPC error: ${fallbackError.message}`);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Falha ao registrar benefício via fallback de status' }));
                return;
              }

              const fallbackStatus = String(fallbackData?.status || '').toLowerCase();
              if (fallbackStatus === 'pending_registered') {
                status = 'paid';
                matchedBy = 'provider_status_poll';
                fallbackApplied = true;

                // ── Meta CAPI: server-side Purchase (AmploPay status poll fallback) ──
                sendMetaConversionEvent({
                  eventName: 'Purchase',
                  eventId: `purchase_poll_amplopay_${providerOrderId}`,
                  email: buyerEmail,
                  phone: buyerPhone,
                  value: amountBrl > 0 ? amountBrl : (amountCents > 0 ? (amountCents / 100) : null),
                  currency: 'BRL',
                  transactionId: providerOrderId,
                  sourceUrl: 'https://combosalvauniversitario.com',
                  ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
                  userAgent: req.headers['user-agent'],
                });

                if (fallbackData?.profile_id) {
                  try {
                    await supabaseAdmin.rpc('apply_pending_checkout_benefits_for_profile', { p_profile_id: fallbackData.profile_id, p_email: buyerEmail || null });
                  } catch (_autoApplyErr) { /* will be applied on login */ }
                }
              }
            } else if (gatewayStatus && (gatewayStatus === 'failed' || gatewayStatus === 'refused')) {
              status = 'failed';
              matchedBy = 'provider_status_poll';
            }
          }
        } else {
          // ── Babylon status poll ──
          const upstreamResponse = await fetch(`${baseUrl}/transactions/${encodeURIComponent(providerOrderId)}`, {
            method: 'GET',
            headers: {
              Authorization: getAuthHeader(),
              'Content-Type': 'application/json',
            },
          });

          const upstreamText = await upstreamResponse.text();
          try {
            upstreamData = upstreamText ? JSON.parse(upstreamText) : {};
          } catch {
            upstreamData = upstreamText;
          }
          upstreamOk = upstreamResponse.ok;

          if (upstreamOk) {
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
                console.error(`[checkout-status] Babylon fallback RPC error: ${fallbackError.message}`);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.writeHead(500);
                res.end(JSON.stringify({
                  error: 'Falha ao registrar benefício via fallback de status',
                }));
                return;
              }

              const fallbackStatus = String(fallbackData?.status || '').toLowerCase();
              if (fallbackStatus === 'pending_registered') {
                status = 'paid';
                matchedBy = 'provider_status_poll';
                fallbackApplied = true;

                // ── Meta CAPI: server-side Purchase (Babylon status poll fallback) ──
                sendMetaConversionEvent({
                  eventName: 'Purchase',
                  eventId: `purchase_poll_babylon_${providerOrderId}`,
                  email: buyerEmail,
                  phone: buyerPhone,
                  value: amountCents > 0 ? (amountCents / 100) : null,
                  currency: 'BRL',
                  transactionId: providerOrderId,
                  sourceUrl: 'https://combosalvauniversitario.com',
                  ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
                  userAgent: req.headers['user-agent'],
                });

                if (fallbackData?.profile_id) {
                  try {
                    await supabaseAdmin.rpc('apply_pending_checkout_benefits_for_profile', {
                      p_profile_id: fallbackData.profile_id,
                      p_email: buyerEmail || null,
                    });
                  } catch (_autoApplyErr) {
                    // Não bloqueia o status poll se auto-apply falhar
                  }
                }
              }
            } else if (gatewayStatus && isFailurePaymentStatus(gatewayStatus)) {
              status = 'failed';
              matchedBy = 'provider_status_poll';
            }
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
      }));
    }
    return;
  }

  if (req.url === '/api/public/first-offer/checkout' && req.method === 'POST') {
    // Tighter rate limit for checkout creation
    if (isCheckoutRateLimited(clientIp)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Retry-After', '60');
      res.writeHead(429);
      res.end(JSON.stringify({ error: 'Muitas tentativas de checkout. Aguarde um momento.' }));
      return;
    }

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

      let upstreamData;
      let upstreamOk;
      let upstreamStatus;

      if (isAmploPay) {
        // ── AmploPay PIX ──
        const amountBrl = Math.round(amountCents) / 100;
        const cpf = normalizeDigits(payload?.customer?.cpf || payload?.customer?.document || '').slice(0, 11);
        const phone = phoneDigits.length >= 10 ? phoneDigits.slice(0, 11) : '';

        const amploPayload = {
          identifier: checkoutOrderId,
          amount: amountBrl,
          client: {
            name,
            email,
            ...(phone ? { phone } : {}),
            ...(cpf ? { document: cpf } : {}),
          },
          ...(amploPayWebhookCallbackUrl ? { callbackUrl: amploPayWebhookCallbackUrl } : {}),
          metadata: {
            checkout_order_id: checkoutOrderId,
            source: 'first_offer_public_checkout',
            customer_email: email,
            idempotency_key: idempotencyKey,
          },
        };

        const result = await createAmploPayPix(amploPayload);
        upstreamOk = result.ok;
        upstreamStatus = result.status;
        upstreamData = result.data;
      } else {
        // ── Babylon ──
        const gatewayPayload = {
          amount: Math.round(amountCents),
          currency: 'BRL',
          payment_method: 'PIX',
          paymentMethod: 'PIX',
          ...(babylonWebhookCallbackUrl ? { postback_url: babylonWebhookCallbackUrl, postbackUrl: babylonWebhookCallbackUrl } : {}),
          customer: {
            name,
            email,
            phone: phoneDigits.length >= 10 ? phoneDigits.slice(0, 11) : '11999999999',
            document: {
              type: 'CPF',
              number: normalizeDigits(payload?.customer?.cpf || payload?.customer?.document || '').slice(0, 11) || generateValidCpf(),
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

        upstreamStatus = upstreamResponse.status;
        upstreamOk = upstreamResponse.ok;
        const upstreamText = await upstreamResponse.text();
        try {
          upstreamData = upstreamText ? JSON.parse(upstreamText) : {};
        } catch {
          upstreamData = upstreamText;
        }
      }

      if (!upstreamOk) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(upstreamStatus || 502);
        res.end(JSON.stringify({
          error: `Falha ao criar transação no gateway (${isAmploPay ? 'AmploPay' : 'Babylon'})`,
          detail: upstreamData,
        }));
        return;
      }

      const providerOrderId = isAmploPay
        ? (upstreamData?.transactionId || upstreamData?.id || null)
        : (upstreamData?.provider_order_id || upstreamData?.order_id || upstreamData?.transaction_id || upstreamData?.id || upstreamData?.data?.id || null);

      const gatewayStatus = isAmploPay
        ? normalizeAmploPayStatus(String(upstreamData?.status || 'PENDING'))
        : String(upstreamData?.status || upstreamData?.data?.status || 'pending').toLowerCase();

      // Tratar transação recusada como erro
      if (isFailurePaymentStatus(gatewayStatus)) {
        const refusedDescription = upstreamData?.refusedReason?.description
          || upstreamData?.refusedReason?.message
          || upstreamData?.data?.refusedReason?.description
          || 'Transação recusada pelo gateway de pagamento';

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(422);
        res.end(JSON.stringify({
          ok: false,
          error: refusedDescription,
          gatewayStatus,
          orderId: checkoutOrderId,
          providerOrderId,
          raw: upstreamData,
        }));
        return;
      }

      const artifacts = collectCheckoutArtifacts(upstreamData);

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        orderId: checkoutOrderId,
        providerOrderId,
        gatewayStatus,
        pixCopyPasteCode: artifacts.pixCopyPasteCode,
        pixQrUrl: artifacts.pixQrUrl,
        raw: upstreamData,
      }));
    } catch (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({
        error: 'Falha no checkout público',
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
        res.end(JSON.stringify({ error: 'Erro ao excluir usuário' }));
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Erro ao excluir usuário' }));
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
        res.end(JSON.stringify({ error: 'Erro ao atualizar saldo' }));
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
      res.end(JSON.stringify({ error: 'Erro ao atualizar saldo' }));
    }
    return;
  }

  // ── Public: Get active payment gateway name ──
  if (pathname === '/api/public/active-gateway' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({ activeGateway }));
    return;
  }

  // ── Admin: Get active payment gateway ──
  if (pathname === '/api/admin/payment-gateway' && req.method === 'GET') {
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
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      activeGateway,
      babylonConfigured: Boolean(getAuthHeader()),
      amploPayConfigured: isAmploPayConfigured(),
    }));
    return;
  }

  // ── Admin: Switch active payment gateway ──
  if (pathname === '/api/admin/payment-gateway' && req.method === 'PUT') {
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
    try {
      const rawBody = await readRequestBody(req);
      const body = parseJsonSafe(rawBody);
      const gateway = String(body?.gateway || '').trim().toLowerCase();
      if (gateway !== 'babylon' && gateway !== 'amplopay') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Gateway inválido. Use "babylon" ou "amplopay".' }));
        return;
      }
      activeGateway = gateway;
      isAmploPay = gateway === 'amplopay';
      console.log(`[ADMIN] Payment gateway switched to: ${activeGateway} by user ${authResult.user.id}`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        activeGateway,
        babylonConfigured: Boolean(getAuthHeader()),
        amploPayConfigured: isAmploPayConfigured(),
      }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Erro ao alterar gateway' }));
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
      res.end(JSON.stringify({ error: 'Erro ao listar convites' }));
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
      res.end(JSON.stringify({ error: 'Erro ao criar convite' }));
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
      res.end(JSON.stringify({ error: 'Erro ao revogar convite' }));
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
      res.end(JSON.stringify({ error: 'Erro ao resgatar convite' }));
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

    let requestBody = await readRequestBody(req);
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

      // ── AmploPay routing for wallet top-up / generic transactions ──
      if (isAmploPay && isAmploPayConfigured() && payload) {
        const topupCredits = Number(payload?.metadata?.topup_credits || 0);
        const amountCents = Number(payload?.amount || 0);
        const amountBrl = Math.round(amountCents) / 100;
        const customerName = payload?.customer?.name || payload?.customer?.full_name || 'Cliente';
        const customerEmail = payload?.customer?.email || '';
        const customerPhone = normalizeDigits(payload?.customer?.phone || '').slice(0, 11);
        const customerDoc = normalizeDigits(payload?.customer?.cpf || payload?.customer?.document?.number || payload?.customer?.document || '').slice(0, 11);

        const amploPayload = {
          identifier: checkoutOrderId,
          amount: amountBrl,
          client: {
            name: customerName,
            email: customerEmail,
            ...(customerPhone ? { phone: customerPhone } : {}),
            ...(customerDoc ? { document: customerDoc } : {}),
          },
          ...(amploPayWebhookCallbackUrl ? { callbackUrl: amploPayWebhookCallbackUrl } : {}),
          metadata: {
            checkout_order_id: checkoutOrderId,
            source: payload?.metadata?.source || 'wallet_topup',
            ...(topupCredits ? { topup_credits: topupCredits } : {}),
          },
        };

        const result = await createAmploPayPix(amploPayload);

        if (!result.ok) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(result.status || 502);
          res.end(JSON.stringify({
            error: 'Falha ao criar transação no AmploPay',
            detail: result.data,
          }));
          return;
        }

        const providerOrderId = result.data?.transactionId || result.data?.id || null;
        const gatewayStatus = normalizeAmploPayStatus(String(result.data?.status || 'PENDING'));
        const artifacts = collectCheckoutArtifacts(result.data);

        // Update checkout_orders with AmploPay provider info
        await supabaseAdmin
          .from('checkout_orders')
          .update({
            status: isFailurePaymentStatus(gatewayStatus) ? 'failed' : 'pending',
            provider_name: 'amplopay',
            provider_order_id: providerOrderId,
          })
          .eq('id', checkoutOrderId);

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(200);
        res.end(JSON.stringify({
          ok: true,
          id: providerOrderId,
          status: gatewayStatus,
          provider_order_id: providerOrderId,
          transaction_id: providerOrderId,
          pix: {
            code: artifacts.pixCopyPasteCode || '',
            qrCode: artifacts.pixCopyPasteCode || '',
          },
          ...(artifacts.pixQrUrl ? { pixQrUrl: artifacts.pixQrUrl } : {}),
          ...(artifacts.checkoutUrl ? { checkoutUrl: artifacts.checkoutUrl } : {}),
        }));
        return;
      }

      // Inject postbackUrl so Babylon sends webhook notifications
      if (babylonWebhookCallbackUrl && payload) {
        payload.postback_url = babylonWebhookCallbackUrl;
        payload.postbackUrl = babylonWebhookCallbackUrl;
        requestBody = Buffer.from(JSON.stringify(payload), 'utf8');
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
    }));
  }
});

server.listen(port, () => {
  console.log(`[babylon-proxy] running on http://localhost:${port}`);
  if (babylonWebhookCallbackUrl) {
    console.log(`[babylon-proxy] webhook callback URL: ${babylonWebhookCallbackUrl}`);
  } else {
    console.log('[babylon-proxy] WARNING: no webhook callback URL configured (set PUBLIC_APP_URL or BABYLON_WEBHOOK_CALLBACK_URL)');
  }
});
