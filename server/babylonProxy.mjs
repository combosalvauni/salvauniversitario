import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { checkoutEmailTheme, getCheckoutEmailCopy } from './checkoutEmailContent.mjs';
import * as waBaileys from './whatsappBaileys.mjs';
import { paymentApprovedMessage, pixReadyMessage, listTemplates as listWhatsAppTemplates } from './whatsappTemplates.mjs';
import { getConfig as getWaTemplateConfig, saveConfig as saveWaTemplateConfig, getAdminConfigData as getWaAdminConfigData, resolveTemplateForPlan, resolveStepsForPlan, findPlanKeyByOfferName, renderTemplate, loadConfig as loadWaTemplateConfig } from './whatsappTemplateConfig.mjs';
import * as waAutoReply from './whatsappAutoReply.mjs';

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

// Helper para logs condicionais (não loga dados sensíveis em produção)
function debugLog(...args) {
  if (!isProduction) {
    console.log(...args);
  }
}

function debugWarn(...args) {
  if (!isProduction) {
    console.warn(...args);
  }
}
const publicAppUrl = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
const CHECKOUT_EMAILS_ENABLED = String(process.env.CHECKOUT_EMAILS_ENABLED || 'false').trim().toLowerCase() === 'true';
const CHECKOUT_EMAIL_PROVIDER = String(process.env.CHECKOUT_EMAIL_PROVIDER || 'resend').trim().toLowerCase();
const CHECKOUT_EMAIL_FROM = String(process.env.CHECKOUT_EMAIL_FROM || '').trim();
const CHECKOUT_EMAIL_REPLY_TO = String(process.env.CHECKOUT_EMAIL_REPLY_TO || '').trim();
const CHECKOUT_EMAIL_BCC = String(process.env.CHECKOUT_EMAIL_BCC || '').trim();
const CHECKOUT_EMAIL_BRAND_NAME = String(process.env.CHECKOUT_EMAIL_BRAND_NAME || 'Combo Salva Universitario').trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const CHECKOUT_EMAIL_ASSET_BASE_URL = String(process.env.CHECKOUT_EMAIL_ASSET_BASE_URL || publicAppUrl || '').trim().replace(/\/$/, '');
function getOptionalAssetUrl(envKey, fallbackUrl) {
  if (Object.prototype.hasOwnProperty.call(process.env, envKey)) {
    return String(process.env[envKey] || '').trim();
  }
  return String(fallbackUrl || '').trim();
}

const CHECKOUT_EMAIL_LOGO_URL = getOptionalAssetUrl(
  'CHECKOUT_EMAIL_LOGO_URL',
  CHECKOUT_EMAIL_ASSET_BASE_URL ? `${CHECKOUT_EMAIL_ASSET_BASE_URL}/email-assets/logo-salva-universitario.png` : ''
);
const CHECKOUT_EMAIL_HERO_URL = getOptionalAssetUrl(
  'CHECKOUT_EMAIL_HERO_URL',
  CHECKOUT_EMAIL_ASSET_BASE_URL ? `${CHECKOUT_EMAIL_ASSET_BASE_URL}/email-assets/hero-salva-universitario.jpg` : ''
);
const CHECKOUT_EMAIL_BADGE_URL = getOptionalAssetUrl(
  'CHECKOUT_EMAIL_BADGE_URL',
  CHECKOUT_EMAIL_ASSET_BASE_URL ? `${CHECKOUT_EMAIL_ASSET_BASE_URL}/email-assets/garantia-30-dias.png` : ''
);
const CHECKOUT_EMAIL_TESTIMONIAL_URL = getOptionalAssetUrl(
  'CHECKOUT_EMAIL_TESTIMONIAL_URL',
  CHECKOUT_EMAIL_ASSET_BASE_URL ? `${CHECKOUT_EMAIL_ASSET_BASE_URL}/email-assets/depoimento-bel.webp` : ''
);
const CHECKOUT_EMAIL_PRIMARY_CTA_URL = String(process.env.CHECKOUT_EMAIL_PRIMARY_CTA_URL || publicAppUrl || '').trim();
const CHECKOUT_EMAIL_SUPPORT_URL = String(process.env.CHECKOUT_EMAIL_SUPPORT_URL || '').trim();
const LOCAL_PREVIEW_EMAIL_ASSETS = new Map([
  ['/email-assets/logo-salva-universitario.png', {
    filePath: fileURLToPath(new URL('../public/email-assets/logo-salva-universitario.png', import.meta.url)),
    contentType: 'image/png',
  }],
  ['/email-assets/logo-pvpmbwn.png', {
    filePath: fileURLToPath(new URL('../public/email-assets/logo-pvpmbwn.png', import.meta.url)),
    contentType: 'image/png',
  }],
  ['/email-assets/hero-salva-universitario.jpg', {
    filePath: fileURLToPath(new URL('../public/email-assets/hero-salva-universitario.jpg', import.meta.url)),
    contentType: 'image/jpeg',
  }],
  ['/email-assets/garantia-30-dias.png', {
    filePath: fileURLToPath(new URL('../public/email-assets/garantia-30-dias.png', import.meta.url)),
    contentType: 'image/png',
  }],
  ['/email-assets/depoimento-bel.webp', {
    filePath: fileURLToPath(new URL('../public/email-assets/depoimento-bel.webp', import.meta.url)),
    contentType: 'image/webp',
  }],
  ['/email-assets/bimi-logo.svg', {
    filePath: fileURLToPath(new URL('../public/email-assets/bimi-logo.svg', import.meta.url)),
    contentType: 'image/svg+xml',
  }],
]);

// ── Payment gateway selection (mutable — toggled via admin API) ──
let activeGateway = String(process.env.PAYMENT_GATEWAY || 'babylon').trim().toLowerCase();
const AMPLOPAY_BASE_URL = 'https://app.amplopay.com/api/v1';
const AMPLOPAY_PUBLIC_KEY = String(process.env.AMPLOPAY_PUBLIC_KEY || '').trim();
const AMPLOPAY_SECRET_KEY = String(process.env.AMPLOPAY_SECRET_KEY || '').trim();
const AMPLOPAY_WEBHOOK_TOKEN = String(process.env.AMPLOPAY_WEBHOOK_TOKEN || '').trim();
let isAmploPay = activeGateway === 'amplopay';

// ── Enki Bank ──
const ENKIBANK_BASE_URL = 'https://api.enki-bank.com/v1';
const ENKIBANK_PUBLIC_KEY = String(process.env.ENKIBANK_PUBLIC_KEY || '').trim();
const ENKIBANK_SECRET_KEY = String(process.env.ENKIBANK_SECRET_KEY || '').trim();
const ENKIBANK_WITHDRAW_KEY = String(process.env.ENKIBANK_WITHDRAW_KEY || '').trim();
const ENKIBANK_WEBHOOK_TOKEN = String(process.env.ENKIBANK_WEBHOOK_TOKEN || '').trim();
let isEnkiBank = activeGateway === 'enkibank';

// ── Sync Payments ──
const SYNCPAY_BASE_URL = 'https://api.syncpayments.com.br';
const SYNCPAY_CLIENT_ID = String(process.env.SYNCPAY_CLIENT_ID || '').trim();
const SYNCPAY_CLIENT_SECRET = String(process.env.SYNCPAY_CLIENT_SECRET || '').trim();
let isSyncPay = activeGateway === 'syncpay';

// Sync Payments token cache (auto-refreshed)
let syncPayTokenCache = { accessToken: null, expiresAt: 0 };

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

const enkiBankWebhookCallbackUrl = (() => {
  const directUrl = String(process.env.ENKIBANK_WEBHOOK_CALLBACK_URL || '').trim();
  if (directUrl) return directUrl;
  if (!publicAppUrl) return null;
  const apiBase = publicAppUrl.replace(/^https?:\/\/(?:www\.|app\.)?/, 'https://api.');
  return `${apiBase}/webhooks/enkibank`;
})();

const syncPayWebhookCallbackUrl = (() => {
  const directUrl = String(process.env.SYNCPAY_WEBHOOK_CALLBACK_URL || '').trim();
  if (directUrl) return directUrl;
  if (!publicAppUrl) return null;
  const apiBase = publicAppUrl.replace(/^https?:\/\/(?:www\.|app\.)?/, 'https://api.');
  return `${apiBase}/webhooks/syncpay`;
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
const META_PIXEL_ID = String(process.env.META_PIXEL_ID || '1665717361520339').trim();
const META_CAPI_ACCESS_TOKEN = String(process.env.META_CAPI_ACCESS_TOKEN || '').trim();
const META_CAPI_ENDPOINT = `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`;

// ── WhatsApp via Baileys (direto, gratuito, sem serviço externo) ──
const WHATSAPP_ENABLED = String(process.env.WHATSAPP_ENABLED || 'false').trim().toLowerCase() === 'true';
const WHATSAPP_PAIRING_PHONE_NUMBER = String(process.env.WHATSAPP_PAIRING_PHONE_NUMBER || '').trim();
const WHATSAPP_AUDIO_URL = String(process.env.WHATSAPP_AUDIO_URL || '').trim();

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
const RATE_LIMIT_MAX_REQUESTS = isProduction ? 20 : 300; // Reduzido para 20 req/min em produção
const FIRST_OFFER_CHECKOUT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHECKOUT_EMAIL_SHORT_TTL_MS = 6 * 60 * 60 * 1000;
const CHECKOUT_EMAIL_LONG_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PIX_READY_EMAIL_DELAY_MS = 5 * 60 * 1000; // 5 min — só envia pix_ready se não pagou nesse intervalo
const rateLimitMap = new Map();
const firstOfferCheckoutRegistry = new Map();
const checkoutEmailStateMap = new Map();
const checkoutWhatsAppStateMap = new Map();
const pendingPixReadyTimers = new Map();

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
  const now = Date.now();
  for (const [key, entry] of firstOfferCheckoutRegistry) {
    if (!entry?.expiresAt || entry.expiresAt <= now) firstOfferCheckoutRegistry.delete(key);
  }
  for (const [key, entry] of checkoutEmailStateMap) {
    if (!entry?.expiresAt || entry.expiresAt <= now) checkoutEmailStateMap.delete(key);
  }
  for (const [key, entry] of checkoutWhatsAppStateMap) {
    if (!entry?.expiresAt || entry.expiresAt <= now) checkoutWhatsAppStateMap.delete(key);
  }
  // Limpa timers de pix_ready órfãos (segurança — normalmente removidos pelo callback ou cancelamento)
  const timerCutoff = now - PIX_READY_EMAIL_DELAY_MS * 3;
  for (const [key, entry] of pendingPixReadyTimers) {
    if (entry.createdAt < timerCutoff) {
      clearTimeout(entry.timerId);
      pendingPixReadyTimers.delete(key);
    }
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

async function requireAdminApiRequest(req, res) {
  const authResult = await authenticateRequestUser(req);
  if (authResult.error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(authResult.status || 401);
    res.end(JSON.stringify({ error: authResult.error }));
    return null;
  }

  const adminResult = await assertAdminUser(authResult.user.id);
  if (!adminResult.ok) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(adminResult.status || 403);
    res.end(JSON.stringify({ error: adminResult.error || 'Forbidden' }));
    return null;
  }

  return authResult.user;
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

// ── Enki Bank helpers ──
function enkiBankHeaders() {
  const credentials = Buffer.from(`${ENKIBANK_PUBLIC_KEY}:${ENKIBANK_SECRET_KEY}`).toString('base64');
  return {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
    'User-Agent': 'ConcursaFlix-Backend/1.0',
  };
}

function isEnkiBankConfigured() {
  return Boolean(ENKIBANK_PUBLIC_KEY && ENKIBANK_SECRET_KEY);
}

function normalizeEnkiBankStatus(status) {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'PAID' || s === 'COMPLETED' || s === 'OK' || s === 'APPROVED') return 'approved';
  if (s === 'WAITING_PAYMENT' || s === 'PENDING' || s === 'WAITING') return 'pending';
  if (s === 'REFUNDED') return 'refunded';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'CANCELED' || s === 'CANCELLED' || s === 'EXPIRED' || s === 'REFUSED') return 'failed';
  return s.toLowerCase() || 'pending';
}

async function createEnkiBankPix({ identifier, amountCents, customer, items, metadata }) {
  const body = {
    amount: amountCents,
    payment_method: 'PIX',
    ...(identifier ? { external_ref: identifier } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    items: (items && items.length > 0 ? items : [{
      title: identifier || 'Pedido',
      quantity: 1,
      unitPriceCents: amountCents,
    }]).map((item, idx) => ({
      title: item.name || item.title || 'Produto',
      quantity: Math.max(1, Number(item.quantity || 1)),
      unit_price: Math.max(0, Math.round(Number((item.price ?? item.unitPrice ?? item.unitPriceCents ?? amountCents) || 0))),
      tangible: false,
    })),
    customer: {
      name: customer.name || 'Cliente',
      email: customer.email,
      ...(customer.phone ? { phone: customer.phone } : {}),
      ...(customer.document ? {
        document: {
          type: 'CPF',
          number: customer.document,
        },
      } : {}),
    },
  };

  console.log(`[enkibank] POST ${ENKIBANK_BASE_URL}/transactions payload:`, JSON.stringify(body).slice(0, 500));

  const response = await fetch(`${ENKIBANK_BASE_URL}/transactions`, {
    method: 'POST',
    headers: enkiBankHeaders(),
    body: JSON.stringify(body),
  });

  const text = await response.text();
  console.log(`[enkibank] Response ${response.status}: ${text.slice(0, 500)}`);
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  // Normalize: if response wraps in `transaction`, unwrap it
  if (data?.transaction && typeof data.transaction === 'object') {
    data = { ...data.transaction, _raw: data };
  }
  return { ok: response.ok, status: response.status, data };
}

async function fetchEnkiBankTransaction(transactionId) {
  const url = `${ENKIBANK_BASE_URL}/transactions/${encodeURIComponent(transactionId)}`;
  const response = await fetch(url, { method: 'GET', headers: enkiBankHeaders() });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  // Normalize: if response wraps in `transaction`, unwrap it
  if (data?.transaction && typeof data.transaction === 'object') {
    data = { ...data.transaction, _raw: data };
  }
  return { ok: response.ok, status: response.status, data };
}

// ── Sync Payments helpers ──
function isSyncPayConfigured() {
  return Boolean(SYNCPAY_CLIENT_ID && SYNCPAY_CLIENT_SECRET);
}

async function getSyncPayToken() {
  // Return cached token if still valid (with 60s margin)
  if (syncPayTokenCache.accessToken && Date.now() < syncPayTokenCache.expiresAt - 60_000) {
    return syncPayTokenCache.accessToken;
  }

  const response = await fetch(`${SYNCPAY_BASE_URL}/api/partner/v1/auth-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SYNCPAY_CLIENT_ID,
      client_secret: SYNCPAY_CLIENT_SECRET,
    }),
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  if (!response.ok || !data?.access_token) {
    console.error(`[syncpay] Auth failed ${response.status}: ${text.slice(0, 300)}`);
    throw new Error('Falha na autenticação com Sync Payments');
  }

  syncPayTokenCache = {
    accessToken: data.access_token,
    expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : (Date.now() + (data.expires_in || 3600) * 1000),
  };

  return syncPayTokenCache.accessToken;
}

function normalizeSyncPayStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'completed') return 'approved';
  if (s === 'pending') return 'pending';
  if (s === 'failed') return 'failed';
  if (s === 'refunded' || s === 'med') return 'refunded';
  return s || 'pending';
}

async function createSyncPayPix({ amount, description, customer, webhookUrl }) {
  const token = await getSyncPayToken();

  const body = {
    amount: Math.round(amount * 100) / 100, // SyncPay expects BRL (double)
    ...(description ? { description } : {}),
    ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    ...(customer ? {
      client: {
        name: customer.name || 'Cliente',
        cpf: (customer.document || customer.cpf || '').replace(/\D/g, '').slice(0, 11),
        email: customer.email,
        phone: (customer.phone || '').replace(/\D/g, '').slice(0, 11),
      },
    } : {}),
  };

  console.log(`[syncpay] POST ${SYNCPAY_BASE_URL}/api/partner/v1/cash-in payload:`, JSON.stringify(body).slice(0, 500));

  const response = await fetch(`${SYNCPAY_BASE_URL}/api/partner/v1/cash-in`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  console.log(`[syncpay] Response ${response.status}: ${text.slice(0, 500)}`);
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function fetchSyncPayTransaction(identifier) {
  const token = await getSyncPayToken();
  const url = `${SYNCPAY_BASE_URL}/api/partner/v1/transaction/${encodeURIComponent(identifier)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
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
    if (isEnkiBank) {
      if (!isEnkiBankConfigured()) {
        issues.push('Defina ENKIBANK_PUBLIC_KEY e ENKIBANK_SECRET_KEY para uso do gateway Enki Bank.');
      }
    } else if (isSyncPay) {
      if (!isSyncPayConfigured()) {
        issues.push('Defina SYNCPAY_CLIENT_ID e SYNCPAY_CLIENT_SECRET para uso do gateway Sync Payments.');
      }
    } else if (isAmploPay) {
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

function getCheckoutEmailSiteUrl() {
  return publicAppUrl || 'https://combosalvauniversitario.com';
}

function isCheckoutEmailConfigured() {
  if (!CHECKOUT_EMAILS_ENABLED) {
    return false;
  }

  if (CHECKOUT_EMAIL_PROVIDER !== 'resend') {
    return false;
  }

  return Boolean(RESEND_API_KEY && CHECKOUT_EMAIL_FROM);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAmountBrlFromCents(value) {
  const amountCents = resolveAmountCents(value);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amountCents / 100);
}

function extractFirstName(name, email) {
  const normalizedName = String(name || '').trim().replace(/[._-]+/g, ' ');
  const fallbackName = String(email || '').trim().split('@')[0].replace(/[._-]+/g, ' ').trim();
  const source = normalizedName || fallbackName || 'Cliente';
  return source.split(/\s+/)[0].slice(0, 40) || 'Cliente';
}

function normalizeCheckoutItems(items, fallbackOfferName, fallbackAmountCents) {
  if (!Array.isArray(items) || items.length === 0) {
    return fallbackOfferName
      ? [{
        title: sanitizeOfferLabel(fallbackOfferName),
        quantity: 1,
        unitPriceCents: resolveAmountCents(fallbackAmountCents),
      }]
      : [];
  }

  return items
    .map((item) => ({
      title: sanitizeOfferLabel(item?.title || item?.name || 'Item'),
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unitPriceCents: resolveAmountCents(
        item?.unitPriceCents
        ?? item?.unit_price
        ?? item?.unitPrice
        ?? item?.price
        ?? item?.amountCents
        ?? item?.amount
        ?? 0
      ),
    }))
    .filter((item) => item.title && item.unitPriceCents >= 0);
}

function buildFirstOfferCheckoutRecord({
  checkoutOrderId,
  providerOrderId,
  customerName,
  customerEmail,
  customerPhone,
  offerName,
  amountCents,
  items,
  paymentMethod = 'pix',
}) {
  const normalizedOfferName = sanitizeOfferLabel(offerName || 'Oferta especial');
  const normalizedAmountCents = resolveAmountCents(amountCents);

  return {
    checkoutOrderId: String(checkoutOrderId || '').trim() || null,
    providerOrderId: String(providerOrderId || '').trim() || null,
    customerName: String(customerName || '').trim() || 'Cliente',
    customerEmail: normalizeEmail(customerEmail || ''),
    customerPhone: normalizeDigits(customerPhone || '') || null,
    offerName: normalizedOfferName,
    amountCents: normalizedAmountCents,
    items: normalizeCheckoutItems(items, normalizedOfferName, normalizedAmountCents),
    paymentMethod: String(paymentMethod || 'pix').trim().toLowerCase() || 'pix',
  };
}

function rememberFirstOfferCheckout(record) {
  if (!record || (!record.checkoutOrderId && !record.providerOrderId && !record.customerEmail)) {
    return;
  }

  const storedRecord = {
    ...record,
    items: normalizeCheckoutItems(record.items, record.offerName, record.amountCents),
  };
  const entry = {
    record: storedRecord,
    expiresAt: Date.now() + FIRST_OFFER_CHECKOUT_TTL_MS,
  };

  if (storedRecord.checkoutOrderId) {
    firstOfferCheckoutRegistry.set(`order:${storedRecord.checkoutOrderId}`, entry);
  }
  if (storedRecord.providerOrderId) {
    firstOfferCheckoutRegistry.set(`provider:${storedRecord.providerOrderId}`, entry);
  }
  if (storedRecord.customerEmail) {
    firstOfferCheckoutRegistry.set(`email:${storedRecord.customerEmail}`, entry);
  }
}

function getRememberedFirstOfferCheckout({ checkoutOrderId, providerOrderId, customerEmail }) {
  const keys = [
    providerOrderId ? `provider:${providerOrderId}` : null,
    checkoutOrderId ? `order:${checkoutOrderId}` : null,
    customerEmail ? `email:${customerEmail}` : null,
  ].filter(Boolean);
  const now = Date.now();

  for (const key of keys) {
    const entry = firstOfferCheckoutRegistry.get(key);
    if (!entry) {
      continue;
    }
    if (!entry.expiresAt || entry.expiresAt <= now) {
      firstOfferCheckoutRegistry.delete(key);
      continue;
    }
    return { ...entry.record };
  }

  return null;
}

function extractFirstOfferMetadata(payload) {
  const metadata = payload?.transaction?.metadata
    || payload?.metadata
    || payload?.data?.metadata
    || payload?._raw?.transaction?.metadata
    || {};

  return metadata && typeof metadata === 'object' ? metadata : {};
}

function resolveFirstOfferCheckoutContext({
  payload,
  checkoutOrderId,
  providerOrderId,
  customerEmail,
  customerName,
  customerPhone,
  amountCents,
  offerName,
  items,
  paymentMethod = 'pix',
}) {
  const metadata = extractFirstOfferMetadata(payload);
  const normalizedEmail = normalizeEmail(
    customerEmail
    || metadata.customer_email
    || payload?.customer?.email
    || payload?.data?.customer?.email
    || payload?.client?.email
    || payload?.data?.client?.email
    || payload?.transaction?.customer?.email
    || payload?.transaction?.client?.email
    || ''
  );
  const resolvedCheckoutOrderId = String(
    checkoutOrderId
    || metadata.checkout_order_id
    || payload?.external_id
    || payload?.data?.external_id
    || payload?.transaction?.external_ref
    || payload?.transaction?.externalRef
    || ''
  ).trim() || null;
  const resolvedProviderOrderId = String(
    providerOrderId
    || payload?.provider_order_id
    || payload?.order_id
    || payload?.transaction_id
    || payload?.data?.id
    || payload?.id
    || payload?.transaction?.id
    || ''
  ).trim() || null;

  const remembered = getRememberedFirstOfferCheckout({
    checkoutOrderId: resolvedCheckoutOrderId,
    providerOrderId: resolvedProviderOrderId,
    customerEmail: normalizedEmail,
  });

  const record = buildFirstOfferCheckoutRecord({
    checkoutOrderId: resolvedCheckoutOrderId || remembered?.checkoutOrderId,
    providerOrderId: resolvedProviderOrderId || remembered?.providerOrderId,
    customerName: customerName
      || remembered?.customerName
      || metadata.customer_name
      || payload?.customer?.name
      || payload?.data?.customer?.name
      || payload?.client?.name
      || payload?.data?.client?.name
      || payload?.transaction?.customer?.name
      || payload?.transaction?.client?.name
      || 'Cliente',
    customerEmail: normalizedEmail || remembered?.customerEmail,
    customerPhone: customerPhone
      || remembered?.customerPhone
      || metadata.customer_phone
      || payload?.customer?.phone
      || payload?.data?.customer?.phone
      || payload?.client?.phone
      || payload?.data?.client?.phone
      || payload?.transaction?.customer?.phone
      || payload?.transaction?.client?.phone
      || '',
    offerName: offerName
      || remembered?.offerName
      || metadata.offer_name
      || payload?.description
      || payload?.transaction?.description
      || 'Oferta especial',
    amountCents: amountCents
      || remembered?.amountCents
      || metadata.total_amount_cents
      || payload?.amount_cents
      || payload?.data?.amount_cents
      || payload?.amount
      || payload?.data?.amount
      || payload?.transaction?.amount
      || 0,
    items: items
      || remembered?.items
      || metadata.items_breakdown
      || payload?.items
      || payload?.transaction?.items
      || [],
    paymentMethod: paymentMethod || remembered?.paymentMethod || metadata.payment_method || 'pix',
  });

  rememberFirstOfferCheckout(record);
  return record;
}

function getCheckoutEmailAssetUrls(overrides = {}) {
  return {
    logoUrl: overrides.logoUrl || CHECKOUT_EMAIL_LOGO_URL || '',
    heroUrl: overrides.heroUrl || CHECKOUT_EMAIL_HERO_URL || '',
    badgeUrl: overrides.badgeUrl || CHECKOUT_EMAIL_BADGE_URL || '',
    testimonialUrl: overrides.testimonialUrl || CHECKOUT_EMAIL_TESTIMONIAL_URL || '',
    primaryCtaUrl: overrides.primaryCtaUrl || CHECKOUT_EMAIL_PRIMARY_CTA_URL || getCheckoutEmailSiteUrl(),
    supportUrl: overrides.supportUrl || CHECKOUT_EMAIL_SUPPORT_URL || '',
  };
}

function buildCheckoutItemsText(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  return items
    .map((item) => `- ${item?.title || 'Item'} x${Math.max(1, Number(item?.quantity || 1))} (${formatAmountBrlFromCents(item?.unitPriceCents || 0)})`)
    .join('\n');
}

function buildEmailButtonHtml({ url, label, style }) {
  if (!url || !label) return '';
  if (style === 'pill') {
    return `<table role="presentation" align="center" class="button-wrap" style="margin:24px auto 0;border-collapse:separate;"><tr><td style="padding:0;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 40px;border-radius:999px;background:${checkoutEmailTheme.buttonBg};border:2px solid ${checkoutEmailTheme.buttonBorder};color:${checkoutEmailTheme.buttonText};text-decoration:none;font-size:16px;font-weight:500;font-family:Arial,Helvetica,sans-serif;line-height:1.4;text-align:center;">${escapeHtml(label)}</a></td></tr></table>`;
  }
  return `<table role="presentation" align="center" class="button-wrap" style="margin:24px auto 0;border-collapse:separate;"><tr><td style="padding:0;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:16px 44px;border-radius:999px;background:${checkoutEmailTheme.ctaOrangeBg};color:${checkoutEmailTheme.ctaOrangeText};text-decoration:none;font-size:16px;font-weight:700;font-family:Arial,Helvetica,sans-serif;line-height:1.4;text-align:center;">${escapeHtml(label)}</a></td></tr></table>`;
}

function buildLightPanelHtml() { return ''; }
function buildCheckoutSummaryHtml() { return ''; }
function buildCheckoutItemsHtml() { return ''; }
function buildCalloutPanelHtml({ buttonHtml }) { return buttonHtml || ''; }
function buildTrustSectionHtml() { return ''; }
function buildTestimonialSectionHtml() { return ''; }

function buildHeroImageHtml({ url, alt }) {
  if (!url) return '';
  return `<tr><td style="padding:0;"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt || CHECKOUT_EMAIL_BRAND_NAME)}" width="600" style="display:block;width:100%;height:auto;max-width:100%;border:0;outline:none;text-decoration:none;"></td></tr>`;
}

function buildSplitPanelHtml({
  leftHtml,
  rightHtml,
  leftWidth = '50%',
  rightWidth = '50%',
  gapPx = 16,
  backgroundColor = '',
  border = '',
  leftCellStyle = '',
  rightCellStyle = '',
}) {
  const outerStyle = [
    'width:100%',
    'border-collapse:separate',
    'border-spacing:0',
    'table-layout:fixed',
    'margin:0',
    backgroundColor ? `background-color:${backgroundColor}` : '',
    border ? `border:${border}` : '',
  ].filter(Boolean).join(';');
  const leftStyle = [
    `width:${leftWidth}`,
    'box-sizing:border-box',
    'vertical-align:top',
    leftCellStyle,
  ].filter(Boolean).join(';');
  const rightStyle = [
    `width:${rightWidth}`,
    'box-sizing:border-box',
    'vertical-align:top',
    rightCellStyle,
  ].filter(Boolean).join(';');
  const gapStyle = gapPx
    ? `width:${gapPx}px;font-size:0;line-height:0;`
    : 'width:0;font-size:0;line-height:0;';

  return `<table role="presentation" width="100%" style="${outerStyle}"><tr><td class="stack-col" style="${leftStyle}">${leftHtml || ''}</td><td class="split-gap" style="${gapStyle}">&nbsp;</td><td class="stack-col" style="${rightStyle}">${rightHtml || ''}</td></tr></table>`;
}

function buildLinkStripHtml(links) {
  const safeLinks = Array.isArray(links)
    ? links.filter((link) => link?.url && link?.label)
    : [];

  if (safeLinks.length === 0) {
    return '';
  }

  const linksHtml = safeLinks.map(({ label, url }) =>
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:${checkoutEmailTheme.bodyText};text-decoration:underline;font-size:12px;font-family:Arial,Helvetica,sans-serif;letter-spacing:0.105em;">${escapeHtml(String(label).toUpperCase())}</a>`
  ).join(`<span style="padding:0 8px;color:${checkoutEmailTheme.footerText};">|</span>`);

  return `<table role="presentation" width="100%" style="margin-top:18px;border-collapse:collapse;"><tr><td class="footer-links" style="padding:0 0 6px;text-align:center;font-size:12px;line-height:2.2;color:${checkoutEmailTheme.footerText};font-family:Arial,Helvetica,sans-serif;letter-spacing:0.105em;">${linksHtml}</td></tr></table>`;
}

function buildSupportSectionHtml({ title, text }) {
  if (!text) return '';

  const titleHtml = title
    ? `<tr><td style="text-align:center;font-size:11px;line-height:1.2;letter-spacing:0.12em;color:${checkoutEmailTheme.bodyTextLight};font-family:Arial,Helvetica,sans-serif;padding-bottom:8px;">${escapeHtml(String(title).toUpperCase())}</td></tr>`
    : '';

  return `<table role="presentation" width="100%" style="margin-top:18px;border-collapse:collapse;">${titleHtml}<tr><td style="text-align:center;font-size:13px;line-height:1.6;color:${checkoutEmailTheme.bodyTextLight};font-family:Arial,Helvetica,sans-serif;">${escapeHtml(text)}</td></tr></table>`;
}

function buildLeadStripeHtml({ color, backgroundColor, stripeHeight = 6, gapHeight = 14 }) {
  const stripePx = Math.max(1, Number(stripeHeight) || 6);
  const gapPx = Math.max(0, Number(gapHeight) || 0);

  return `<table role="presentation" width="100%" style="border-collapse:collapse;"><tr><td height="${stripePx}" style="height:${stripePx}px;line-height:${stripePx}px;font-size:0;background-color:${color};">&nbsp;</td></tr>${gapPx ? `<tr><td height="${gapPx}" style="height:${gapPx}px;line-height:${gapPx}px;font-size:0;background-color:${backgroundColor};">&nbsp;</td></tr>` : ''}</table>`;
}

function renderCheckoutEmailShell({ brandName, brandLogoUrl, title, subtitle, heroHtml, leadHtml, bodyHtml, calloutHtml, supportHtml, linkStripHtml, footerHtml, preheaderText, showIntroSection = true }) {
  const t = checkoutEmailTheme;
  const footerBrandName = escapeHtml(brandName || CHECKOUT_EMAIL_BRAND_NAME);
  const brandBarContent = brandLogoUrl
    ? `<img src="${escapeHtml(brandLogoUrl)}" alt="${footerBrandName}" width="320" style="display:block;width:100%;max-width:320px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;">`
    : `<span style="color:${t.brandBarText};font-family:Arial,Helvetica,sans-serif;font-size:16px;letter-spacing:-0.02em;line-height:1.14;">Combo Salva <strong>Universitario</strong></span>`;
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<!--[if mso]><style>td,th,div,p,a,h1,h2,h3{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
<style>@media (max-width:480px){.card-pad{padding:20px 16px!important;}.title-text{font-size:26px!important;}.orange-pad{padding:20px!important;}.stack-col{display:block!important;width:100%!important;}.split-gap{display:block!important;width:100%!important;height:16px!important;line-height:16px!important;font-size:0!important;}.summary-side{padding:18px!important;}.hero-copy{padding:22px 18px!important;}.button-wrap{margin-top:18px!important;}.footer-links{line-height:1.8!important;letter-spacing:0.08em!important;}}</style>
</head>
<body style="width:100%;margin:0;padding:0;background-color:${t.pageBackground};-webkit-text-size-adjust:100%;text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheaderText || subtitle || title)}</div>
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${t.pageBackground}" style="background-color:${t.pageBackground};">
<tr><td align="center" style="padding:0;">
<!--[if mso]><table align="center" border="0" cellpadding="0" cellspacing="0" width="600"><tr><td><![endif]-->
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:0 auto;background-color:${t.shellBackground};">
<!-- BRAND BAR -->
<tr><td style="background-color:${t.brandBarBg};padding:20px 20px;text-align:center;">
${brandBarContent}
</td></tr>
${heroHtml || ''}
<!-- TITLE SECTION -->
${showIntroSection ? `<tr><td style="padding:10px 0 10px 0;vertical-align:top;">
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="font-family:Arial,Helvetica,sans-serif;">
<tr><td style="font-size:0;height:16px;" height="16">&nbsp;</td></tr>
<tr><td class="card-pad" style="text-align:center;padding:0 20px;">
<span class="title-text" style="font-size:32px;font-weight:700;letter-spacing:-0.03em;font-family:Georgia,serif;color:${t.titleColor};">${escapeHtml(title)}</span>
</td></tr>
<tr><td style="font-size:0;height:16px;" height="16">&nbsp;</td></tr>
<tr><td style="padding:0 20px;"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td align="center"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:420px;"><tr><td height="2" style="height:2px;border-radius:999px;line-height:2px;font-size:0;background-color:${t.separator};">&nbsp;</td></tr></table></td></tr></table></td></tr>
<tr><td style="font-size:0;height:16px;" height="16">&nbsp;</td></tr>
<tr><td style="text-align:center;padding:0 20px;font-size:16px;line-height:1.5;color:${t.bodyText};font-family:Arial,Helvetica,sans-serif;">${escapeHtml(subtitle)}</td></tr>
<tr><td style="font-size:0;height:16px;" height="16">&nbsp;</td></tr>
</table>
</td></tr>` : ''}
${leadHtml ? `<tr><td style="padding:0;">${leadHtml}</td></tr>` : ''}
<!-- BODY CONTENT -->
<tr><td class="card-pad" style="padding:0 20px 10px 20px;">
${bodyHtml}
</td></tr>
<!-- CTA -->
${calloutHtml ? `<tr><td style="padding:0 20px 10px 20px;text-align:center;">${calloutHtml}</td></tr>` : ''}
<!-- SUPPORT + FOOTER -->
<tr><td style="padding:10px 20px 20px 20px;">
${supportHtml}
${linkStripHtml || ''}
${footerHtml ? `<table role="presentation" width="100%" style="margin-top:12px;border-collapse:collapse;"><tr><td style="text-align:center;font-size:12px;line-height:1.5;color:${t.footerText};">${escapeHtml(footerHtml)}</td></tr></table>` : ''}
</td></tr>
</table>
<!-- FOOTER BAR -->
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:0 auto;background-color:${t.footerBg};">
<tr><td style="text-align:center;padding:17px 20px;">
<span style="font-size:13px;color:${t.footerText};font-family:Arial,Helvetica,sans-serif;line-height:1.3;">${footerBrandName}</span>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

function buildFirstOfferEmailMessage({ eventType, record, providerOrderId, pixCopyPasteCode, pixQrUrl, assetUrlsOverride = null }) {
  const offerName = sanitizeOfferLabel(record.offerName || 'sua oferta');
  const siteUrl = getCheckoutEmailSiteUrl();
  const assetUrls = getCheckoutEmailAssetUrls(assetUrlsOverride || {});
  const emailCopy = getCheckoutEmailCopy({
    eventType,
    brandName: CHECKOUT_EMAIL_BRAND_NAME,
    offerName,
    customerEmail: record.customerEmail,
  });
  const t = checkoutEmailTheme;
  const heroHtml = buildHeroImageHtml({
    url: assetUrls.heroUrl,
    alt: eventType === 'payment_approved' ? 'Acesso ao app liberado' : 'Finalize seu pagamento para liberar o acesso',
  });

  const paragraphsHtml = (emailCopy.bodyParagraphs || []).map((p) =>
    `<tr><td style="font-size:16px;line-height:1.5;color:${t.bodyText};font-family:Arial,Helvetica,sans-serif;text-align:center;">${escapeHtml(p)}</td></tr><tr><td style="font-size:0;height:16px;" height="16">&nbsp;</td></tr>`
  ).join('');

  const detailRows = [
    { label: 'Oferta', value: offerName },
    { label: 'Total', value: formatAmountBrlFromCents(record.amountCents) },
    { label: 'E-mail', value: record.customerEmail || '' },
  ].filter(Boolean);

  const detailRowsHtml = detailRows.map(({ label, value }, index) =>
    `<tr><td style="color:#ffffff;font-size:11px;letter-spacing:0.08em;padding:8px 0;border-bottom:${index < detailRows.length - 1 ? '1px solid rgba(255,255,255,0.22)' : 'none'};">${escapeHtml(String(label).toUpperCase())}</td><td style="color:#ffffff;font-size:15px;font-weight:700;padding:8px 0;text-align:right;border-bottom:${index < detailRows.length - 1 ? '1px solid rgba(255,255,255,0.22)' : 'none'};">${escapeHtml(value)}</td></tr>`
  ).join('');

  const detailRowsHtmlDark = detailRows.map(({ label, value }, index) =>
    `<tr><td style="color:#7b5437;font-size:11px;letter-spacing:0.08em;padding:8px 0;border-bottom:${index < detailRows.length - 1 ? '1px solid rgba(76,42,25,0.14)' : 'none'};">${escapeHtml(String(label).toUpperCase())}</td><td style="color:#2c190f;font-size:15px;font-weight:700;padding:8px 0;text-align:right;border-bottom:${index < detailRows.length - 1 ? '1px solid rgba(76,42,25,0.14)' : 'none'};">${escapeHtml(value)}</td></tr>`
  ).join('');

  const pixPalette = {
    dark: '#24100b',
    darkBorder: '#5e2110',
    orange: '#ff5400',
    orangeSoft: '#ffefe6',
    orangeLine: '#ffc4a6',
    orangeText: '#9a5128',
    paper: '#fff8f3',
    cream: '#fff0e6',
    textDark: '#25120c',
    textMuted: '#73412b',
    lightText: '#fff4ed',
    lightMuted: '#ffd7c2',
  };

  const detailRowsHtmlPix = detailRows.map(({ label, value }, index) =>
    `<tr><td style="color:${pixPalette.orangeText};font-size:11px;letter-spacing:0.08em;padding:8px 0;border-bottom:${index < detailRows.length - 1 ? '1px solid rgba(88,48,24,0.12)' : 'none'};">${escapeHtml(String(label).toUpperCase())}</td><td style="color:${pixPalette.textDark};font-size:15px;font-weight:700;padding:8px 0;text-align:right;border-bottom:${index < detailRows.length - 1 ? '1px solid rgba(88,48,24,0.12)' : 'none'};">${escapeHtml(value)}</td></tr>`
  ).join('');

  const summaryIntroHtml = `<table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;"><tr><td style="font-size:11px;letter-spacing:0.12em;line-height:1.2;color:${pixPalette.lightMuted};padding-bottom:12px;">PIX GERADO</td></tr><tr><td style="font-size:36px;font-weight:700;letter-spacing:-0.04em;line-height:0.96;color:${pixPalette.lightText};font-family:Georgia,serif;padding-bottom:12px;">Agora e so confirmar no banco</td></tr><tr><td style="font-size:15px;line-height:1.6;color:${pixPalette.lightText};">Use o copia e cola ou abra o QR do PIX para concluir o pagamento e liberar o acesso automaticamente.</td></tr></table>`;

  const summarySideHtml = `<table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid ${pixPalette.orangeLine};background-color:${pixPalette.paper};font-family:Arial,Helvetica,sans-serif;"><tr><td class="summary-side" style="padding:18px 18px 12px 18px;"><table role="presentation" width="100%" style="border-collapse:collapse;"><tr><td style="font-size:11px;letter-spacing:0.12em;line-height:1.2;color:${pixPalette.orangeText};padding-bottom:12px;">DADOS DO PEDIDO</td></tr>${detailRowsHtmlPix}</table></td></tr></table>`;

  const summaryPanelHtml = buildSplitPanelHtml({
    leftHtml: summaryIntroHtml,
    rightHtml: summarySideHtml,
    leftWidth: '44%',
    rightWidth: '56%',
    gapPx: 0,
    backgroundColor: pixPalette.orange,
    leftCellStyle: 'padding:28px 24px;',
    rightCellStyle: 'padding:24px 24px 24px 0;',
  });

  const guaranteeBadgeHtml = assetUrls.badgeUrl
    ? `<img src="${escapeHtml(assetUrls.badgeUrl)}" alt="Garantia de 30 dias" width="96" style="display:block;width:96px;height:auto;max-width:100%;margin:0 auto;border:0;">`
    : `<span style="display:inline-block;font-size:26px;font-weight:700;line-height:1;color:${t.titleColor};font-family:Georgia,serif;">30 dias</span>`;

  const protectionPanelHtml = buildSplitPanelHtml({
    leftHtml: `<table role="presentation" width="100%" style="border-collapse:collapse;"><tr><td style="text-align:center;">${guaranteeBadgeHtml}</td></tr></table>`,
    rightHtml: `<table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;"><tr><td style="font-size:11px;letter-spacing:0.12em;line-height:1.2;color:${pixPalette.orangeText};padding-bottom:10px;">COMPRA PROTEGIDA</td></tr><tr><td style="font-size:30px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:${t.titleColor};font-family:Georgia,serif;padding-bottom:10px;">Garantia de 30 dias</td></tr><tr><td style="font-size:15px;line-height:1.6;color:${pixPalette.textMuted};">Depois da confirmacao, entre no app com o mesmo e-mail da compra. Ate la, seu pedido continua protegido por 30 dias.</td></tr></table>`,
    leftWidth: '30%',
    rightWidth: '70%',
    gapPx: 0,
    backgroundColor: pixPalette.paper,
    border: `1px solid ${pixPalette.orangeLine}`,
    leftCellStyle: `padding:18px 16px;text-align:center;background-color:${pixPalette.cream};`,
    rightCellStyle: 'padding:22px 24px;',
  });

  if (eventType === 'payment_approved') {
    const approvedPalette = {
      dark: '#24100b',
      darkBorder: '#5e2110',
      orange: '#ff5400',
      orangeSoft: '#ffefe6',
      orangeLine: '#ffc4a6',
      orangeText: '#8e4520',
      paper: '#fff7f2',
      cream: '#fff2e7',
      textDark: '#23110c',
      textMuted: '#72412a',
      lightText: '#fff4ee',
      lightMuted: '#ffd7c2',
    };

    const approvedStepsText = [
      `1. Abra o app pelo botao abaixo.`,
      `2. Entre ou cadastre a conta com ${record.customerEmail || 'o e-mail da compra'}.`,
      `3. Seus beneficios aparecem liberados logo depois do login.`,
    ];

    const approvedStepsCardsHtml = approvedStepsText.map((stepText, index) =>
      `<table role="presentation" width="100%" style="margin-top:${index === 0 ? '0' : '12px'};border-collapse:collapse;background-color:#ffffff;border:1px solid ${approvedPalette.orangeLine};"><tr><td width="54" valign="top" style="padding:14px 0 14px 14px;"><span style="display:inline-block;width:34px;height:34px;line-height:34px;border-radius:999px;background:${approvedPalette.orange};color:#ffffff;font-size:18px;font-weight:700;font-family:Arial,Helvetica,sans-serif;text-align:center;">${index + 1}</span></td><td style="padding:14px 16px 14px 0;font-size:16px;line-height:1.6;color:${approvedPalette.textDark};font-family:Arial,Helvetica,sans-serif;">${escapeHtml(stepText.replace(/^\d+\.\s*/, ''))}</td></tr></table>`
    ).join('');

    const spotlightStripeHtml = buildLeadStripeHtml({
      color: approvedPalette.orange,
      backgroundColor: t.shellBackground,
    });

    const spotlightPanelHtml = `<table role="presentation" width="100%" style="border-collapse:collapse;background-color:${approvedPalette.dark};border-left:1px solid ${approvedPalette.darkBorder};border-right:1px solid ${approvedPalette.darkBorder};border-bottom:1px solid ${approvedPalette.darkBorder};"><tr><td style="padding:30px 24px 24px 24px;"><table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;"><tr><td style="font-size:11px;letter-spacing:0.14em;line-height:1.2;color:${approvedPalette.lightMuted};padding-bottom:14px;">ACESSO EXCLUSIVO</td></tr><tr><td style="font-size:44px;font-weight:700;letter-spacing:-0.05em;line-height:0.92;color:${approvedPalette.lightText};font-family:Georgia,serif;padding-bottom:14px;">A porta abriu para voce.</td></tr><tr><td style="font-size:16px;line-height:1.7;color:${approvedPalette.lightMuted};padding-bottom:20px;">Pagamento confirmado. Agora a parte boa comeca: seu combo ja pode ser ativado dentro do app.</td></tr><tr><td><table role="presentation" width="100%" style="border-collapse:collapse;background-color:${approvedPalette.orangeSoft};border-left:4px solid ${approvedPalette.orange};"><tr><td style="padding:14px 18px 8px 18px;font-size:11px;letter-spacing:0.12em;line-height:1.2;color:${approvedPalette.orangeText};font-family:Arial,Helvetica,sans-serif;">E-MAIL QUE LIBERA O ACESSO</td></tr><tr><td style="padding:0 18px 18px 18px;font-size:24px;font-weight:700;line-height:1.35;color:${approvedPalette.textDark};font-family:Arial,Helvetica,sans-serif;word-break:break-word;">${escapeHtml(record.customerEmail || 'Use o e-mail da compra')}</td></tr></table></td></tr></table></td></tr></table>`;

    const passportPanelHtml = `<table role="presentation" width="100%" style="margin-top:16px;border-collapse:collapse;background-color:${approvedPalette.orange};"><tr><td style="padding:24px;"><table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;"><tr><td style="font-size:11px;letter-spacing:0.12em;line-height:1.2;color:#ffd8c7;padding-bottom:8px;">PASSE CONFIRMADO</td></tr><tr><td style="font-size:36px;font-weight:700;letter-spacing:-0.04em;line-height:0.96;color:#ffffff;font-family:Georgia,serif;padding-bottom:12px;">Tudo certo com seu acesso</td></tr><tr><td style="font-size:15px;line-height:1.65;color:#fff1ea;padding-bottom:18px;">Seu pedido ja foi validado. Agora e so entrar no app com o mesmo e-mail da compra.</td></tr><tr><td><table role="presentation" width="100%" style="border-collapse:collapse;background-color:${approvedPalette.paper};border:1px solid #ffb48c;"><tr><td style="padding:18px 18px 10px 18px;"><table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;"><tr><td style="font-size:11px;letter-spacing:0.12em;line-height:1.2;color:${approvedPalette.orangeText};padding-bottom:10px;">SEU PASSE DE ENTRADA</td></tr>${detailRowsHtmlDark}</table></td></tr></table></td></tr></table></td></tr></table>`;

    const activationPanelHtml = `<table role="presentation" width="100%" style="margin-top:16px;border-collapse:collapse;background-color:${approvedPalette.paper};border:1px solid ${approvedPalette.orangeLine};"><tr><td style="padding:24px;"><table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;"><tr><td style="font-size:11px;letter-spacing:0.12em;line-height:1.2;color:${approvedPalette.orangeText};padding-bottom:12px;">ATIVACAO EXPRESSA</td></tr><tr><td style="font-size:38px;font-weight:700;letter-spacing:-0.04em;line-height:0.97;color:${approvedPalette.textDark};font-family:Georgia,serif;padding-bottom:12px;">Entre e veja tudo liberado</td></tr><tr><td style="font-size:15px;line-height:1.65;color:${approvedPalette.textMuted};padding-bottom:18px;">Criamos um caminho direto para ativar seu combo sem enrolacao. Siga a sequencia abaixo e pronto.</td></tr><tr><td>${approvedStepsCardsHtml}</td></tr></table></td></tr></table>`;

    const ctaHtml = buildEmailButtonHtml({
      url: assetUrls.primaryCtaUrl || siteUrl,
      label: emailCopy.calloutButtonLabel || 'Entrar no app agora',
    });

    const footerLinksHtml = buildLinkStripHtml([
      { label: 'Abrir app', url: assetUrls.primaryCtaUrl || siteUrl },
    ]);

    const bodyHtml = '';

    const supportHtml = '';

    const html = renderCheckoutEmailShell({
      brandName: CHECKOUT_EMAIL_BRAND_NAME,
      brandLogoUrl: assetUrls.logoUrl,
      title: emailCopy.title,
      subtitle: emailCopy.subtitle,
      heroHtml,
      leadHtml: spotlightStripeHtml,
      bodyHtml: bodyHtml + spotlightPanelHtml + passportPanelHtml + activationPanelHtml,
      calloutHtml: ctaHtml,
      supportHtml,
      linkStripHtml: footerLinksHtml,
      footerHtml: emailCopy.footerText,
      preheaderText: emailCopy.textIntro,
      showIntroSection: false,
    });

    const textItems = buildCheckoutItemsText(record.items);
    const text = [
      'Ola,', '', emailCopy.textIntro,
      `Total: ${formatAmountBrlFromCents(record.amountCents)}`,
      '', textItems ? `Itens do pedido:\n${textItems}` : null,
      '', 'Ative em 3 passos:',
      '1. Abra o app.',
      `2. Entre ou cadastre com ${record.customerEmail || 'o e-mail da compra'}.`,
      '3. Os beneficios aparecem liberados logo depois do login.',
      '',
      `${emailCopy.textOutro} ${assetUrls.primaryCtaUrl || siteUrl}`.trim(),
    ].filter(Boolean).join('\n');

    return { subject: emailCopy.subject, html, text };
  }

  const pixStripeHtml = buildLeadStripeHtml({
    color: pixPalette.orange,
    backgroundColor: t.shellBackground,
  });

  const pixBoxHtml = `<table border="0" cellpadding="0" cellspacing="0" align="center" style="width:100%;border-collapse:separate;margin:16px 0 0;">
<tr><td style="padding:20px 22px;background-color:${pixPalette.paper};border:1px solid ${pixPalette.orangeLine};border-left:4px solid ${pixPalette.orange};text-align:left;">
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:${pixPalette.orangeText};padding-bottom:10px;">${escapeHtml(String(emailCopy.pixPanelTitle || 'PIX copia e cola').toUpperCase())}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:${pixPalette.textMuted};padding-bottom:${pixCopyPasteCode ? '12px' : '0'};">Cole este codigo no app do seu banco para concluir o pagamento.</td></tr>
${pixCopyPasteCode ? `<tr><td style="font-family:'Courier New',monospace;font-size:13px;line-height:1.8;color:${pixPalette.textDark};word-break:break-all;">${escapeHtml(pixCopyPasteCode)}</td></tr>` : ''}
</table>
</td></tr></table>`;

  const pixCtaHtml = pixQrUrl
    ? buildEmailButtonHtml({ url: pixQrUrl, label: emailCopy.pixLinkLabel || 'Abrir QR do PIX' })
    : '';

  const pixSupportUrl = assetUrls.supportUrl || 'https://api.whatsapp.com/send/?phone=5516998859608&text=Oi%2C%20estou%20com%20dificuldade%20para%20pagar%20o%20PIX%20do%20combo.';

  const pixWhatsappButtonHtml = `<table role="presentation" class="button-wrap" style="margin:0;border-collapse:separate;"><tr><td style="padding:0;"><a href="${escapeHtml(pixSupportUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#25d366;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;font-family:Arial,Helvetica,sans-serif;line-height:1.4;text-align:center;">Chamar no WhatsApp</a></td></tr></table>`;

  const pixGuidancePanelHtml = `<table role="presentation" width="100%" style="margin-top:16px;border-collapse:collapse;background-color:${pixPalette.paper};border:1px solid ${pixPalette.orangeLine};"><tr><td style="padding:24px 22px 22px 22px;"><table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;"><tr><td style="padding-bottom:12px;"><span style="display:inline-block;padding:7px 12px;border-radius:999px;background-color:#e9fff2;color:#17864a;font-size:11px;font-weight:700;letter-spacing:0.12em;line-height:1.2;font-family:Arial,Helvetica,sans-serif;">SUPORTE NO WHATSAPP</span></td></tr><tr><td style="font-size:34px;font-weight:700;letter-spacing:-0.04em;line-height:0.96;color:${t.titleColor};font-family:Georgia,serif;padding-bottom:12px;">Problema na hora de pagar?</td></tr><tr><td style="font-size:15px;line-height:1.68;color:${pixPalette.textMuted};padding-bottom:16px;">Se o QR nao abrir, o banco recusar ou o PIX nao concluir, fale com a equipe no WhatsApp e receba ajuda na hora.</td></tr><tr><td style="padding-bottom:12px;">${pixWhatsappButtonHtml}</td></tr><tr><td style="font-size:12px;line-height:1.65;color:${pixPalette.orangeText};">Atendimento direto para resolver dificuldade no pagamento.</td></tr></table></td></tr></table>`;

  const footerLinksHtml = buildLinkStripHtml([
    pixQrUrl ? { label: 'Abrir PIX', url: pixQrUrl } : null,
    { label: 'WhatsApp', url: pixSupportUrl },
  ]);

  const bodyHtml = '';

  const supportHtml = '';

  const html = renderCheckoutEmailShell({
    brandName: CHECKOUT_EMAIL_BRAND_NAME,
    brandLogoUrl: assetUrls.logoUrl,
    title: emailCopy.title,
    subtitle: emailCopy.subtitle,
    heroHtml,
    leadHtml: pixStripeHtml,
    bodyHtml: bodyHtml + summaryPanelHtml + pixBoxHtml + pixGuidancePanelHtml + protectionPanelHtml,
    calloutHtml: pixCtaHtml,
    supportHtml,
    linkStripHtml: footerLinksHtml,
    footerHtml: emailCopy.footerText,
    preheaderText: emailCopy.textIntro,
    showIntroSection: false,
  });

  const textItems = buildCheckoutItemsText(record.items);
  const text = [
    'Ola,', '', emailCopy.textIntro,
    `Total: ${formatAmountBrlFromCents(record.amountCents)}`,
    '', textItems ? `Itens do pedido:\n${textItems}` : null,
    pixCopyPasteCode ? `\nPIX copia e cola:\n${pixCopyPasteCode}` : null,
    pixQrUrl ? `\nQR Code: ${pixQrUrl}` : null,
    '', emailCopy.textOutro,
    '', `Se tiver qualquer problema para pagar, chame no WhatsApp: ${pixSupportUrl}`,
  ].filter(Boolean).join('\n');

  return { subject: emailCopy.subject, html, text };
}

function getCheckoutEmailTtlMs(eventType) {
  return eventType === 'payment_approved' ? CHECKOUT_EMAIL_LONG_TTL_MS : CHECKOUT_EMAIL_SHORT_TTL_MS;
}

function buildCheckoutEmailDeliveryKey(eventType, record, providerOrderId, checkoutOrderId) {
  const stableId = String(
    checkoutOrderId
    || record?.checkoutOrderId
    || providerOrderId
    || record?.providerOrderId
    || record?.customerEmail
    || ''
  ).trim();

  if (!stableId) {
    return null;
  }

  return `${eventType}:${stableId}`;
}

function reserveCheckoutEmailDelivery(key, ttlMs) {
  if (!key) {
    return false;
  }

  const now = Date.now();
  const existing = checkoutEmailStateMap.get(key);
  if (existing && existing.expiresAt > now) {
    return false;
  }

  checkoutEmailStateMap.set(key, {
    status: 'sending',
    expiresAt: now + ttlMs,
  });
  return true;
}

function markCheckoutEmailSent(key, ttlMs, meta = {}) {
  checkoutEmailStateMap.set(key, {
    status: 'sent',
    expiresAt: Date.now() + ttlMs,
    ...meta,
  });
}

function clearCheckoutEmailDelivery(key) {
  checkoutEmailStateMap.delete(key);
}

function getCheckoutStableId(record, providerOrderId, checkoutOrderId) {
  return String(
    checkoutOrderId || record?.checkoutOrderId || providerOrderId || record?.providerOrderId || record?.customerEmail || ''
  ).trim() || null;
}

function cancelPendingPixReadyEmail(stableId) {
  if (!stableId) return false;
  const pending = pendingPixReadyTimers.get(stableId);
  if (pending) {
    clearTimeout(pending.timerId);
    pendingPixReadyTimers.delete(stableId);
    if (pending.deliveryKey) {
      clearCheckoutEmailDelivery(pending.deliveryKey);
    }
    console.log(`[checkout-email] Cancelled pending pix_ready (payment arrived before 5 min delay) | stableId=${stableId}`);
    return true;
  }
  return false;
}

async function sendResendCheckoutEmail({ to, subject, html, text }) {
  const body = {
    from: CHECKOUT_EMAIL_FROM,
    to: [to],
    subject,
    html,
    text,
  };

  if (CHECKOUT_EMAIL_REPLY_TO) {
    body.reply_to = CHECKOUT_EMAIL_REPLY_TO;
  }

  const bccList = CHECKOUT_EMAIL_BCC
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (bccList.length > 0) {
    body.bcc = bccList;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let responseData;
  try {
    responseData = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseData = { raw: responseText };
  }

  if (!response.ok) {
    throw new Error(`Resend HTTP ${response.status}: ${JSON.stringify(responseData).slice(0, 280)}`);
  }

  return responseData;
}

async function sendFirstOfferCheckoutEmail({
  eventType,
  record,
  providerOrderId,
  checkoutOrderId,
  pixCopyPasteCode,
  pixQrUrl,
}) {
  if (!isCheckoutEmailConfigured()) {
    return { skipped: true, reason: 'disabled_or_not_configured' };
  }

  if (!record?.customerEmail) {
    return { skipped: true, reason: 'missing_email' };
  }

  if (eventType === 'pix_ready' && !pixCopyPasteCode && !pixQrUrl) {
    return { skipped: true, reason: 'missing_pix_artifacts' };
  }

  const stableId = getCheckoutStableId(record, providerOrderId, checkoutOrderId);

  // ── payment_approved: cancela pix_ready pendente e envia imediatamente ──
  if (eventType === 'payment_approved') {
    cancelPendingPixReadyEmail(stableId);

    const ttlMs = getCheckoutEmailTtlMs(eventType);
    const deliveryKey = buildCheckoutEmailDeliveryKey(eventType, record, providerOrderId, checkoutOrderId);
    if (!reserveCheckoutEmailDelivery(deliveryKey, ttlMs)) {
      return { skipped: true, reason: 'duplicate' };
    }

    try {
      const message = buildFirstOfferEmailMessage({ eventType, record, providerOrderId, pixCopyPasteCode, pixQrUrl });
      const response = await sendResendCheckoutEmail({ to: record.customerEmail, subject: message.subject, html: message.html, text: message.text });
      markCheckoutEmailSent(deliveryKey, ttlMs, {
        providerOrderId: providerOrderId || record.providerOrderId || null,
        checkoutOrderId: checkoutOrderId || record.checkoutOrderId || null,
        messageId: response?.id || null,
      });
      console.log(`[checkout-email] Sent ${eventType} to ${record.customerEmail} | key=${deliveryKey}`);
      return { ok: true, id: response?.id || null };
    } catch (error) {
      clearCheckoutEmailDelivery(deliveryKey);
      console.warn(`[checkout-email] Failed ${eventType} for ${record.customerEmail}: ${error?.message}`);
      return { ok: false, error: error?.message || 'unknown_error' };
    }
  }

  // ── pix_ready: agenda envio com delay de 5 min; só envia se não pagou ──
  const ttlMs = getCheckoutEmailTtlMs(eventType);
  const deliveryKey = buildCheckoutEmailDeliveryKey(eventType, record, providerOrderId, checkoutOrderId);
  if (!reserveCheckoutEmailDelivery(deliveryKey, ttlMs)) {
    return { skipped: true, reason: 'duplicate' };
  }

  const delayMs = PIX_READY_EMAIL_DELAY_MS;
  const timerId = setTimeout(async () => {
    pendingPixReadyTimers.delete(stableId);

    // Se payment_approved já foi enviado nesse intervalo, não envia o pix_ready
    const approvedKey = buildCheckoutEmailDeliveryKey('payment_approved', record, providerOrderId, checkoutOrderId);
    const approvedEntry = checkoutEmailStateMap.get(approvedKey);
    if (approvedEntry && approvedEntry.status === 'sent') {
      clearCheckoutEmailDelivery(deliveryKey);
      console.log(`[checkout-email] Skipped pix_ready for ${record.customerEmail} — payment_approved already sent | key=${deliveryKey}`);
      return;
    }

    try {
      const message = buildFirstOfferEmailMessage({ eventType: 'pix_ready', record, providerOrderId, pixCopyPasteCode, pixQrUrl });
      const response = await sendResendCheckoutEmail({ to: record.customerEmail, subject: message.subject, html: message.html, text: message.text });
      markCheckoutEmailSent(deliveryKey, ttlMs, {
        providerOrderId: providerOrderId || record.providerOrderId || null,
        checkoutOrderId: checkoutOrderId || record.checkoutOrderId || null,
        messageId: response?.id || null,
      });
      console.log(`[checkout-email] Sent pix_ready (after ${delayMs / 1000}s delay) to ${record.customerEmail} | key=${deliveryKey}`);
    } catch (error) {
      clearCheckoutEmailDelivery(deliveryKey);
      console.warn(`[checkout-email] Failed pix_ready (delayed) for ${record.customerEmail}: ${error?.message}`);
    }
  }, delayMs);

  if (stableId) {
    pendingPixReadyTimers.set(stableId, { timerId, deliveryKey, createdAt: Date.now() });
  }

  console.log(`[checkout-email] Scheduled pix_ready for ${record.customerEmail} in ${delayMs / 1000}s | key=${deliveryKey}`);
  return { ok: true, scheduled: true, delayMs };
}

// ════════════════════════════════════════════════════════════════════════════
// ██  WhatsApp via Baileys — texto + áudio automático (conexão direta, gratuita)
// ════════════════════════════════════════════════════════════════════════════

function isWhatsAppConfigured() {
  return WHATSAPP_ENABLED && waBaileys.isConnected();
}

function formatPhoneForWhatsApp(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

async function sendWhatsAppTextMessage({ to, text }) {
  return waBaileys.sendText(to, text);
}

async function sendWhatsAppAudioMessage({ to, audioUrl }) {
  return waBaileys.sendAudio(to, audioUrl);
}

function buildWhatsAppDeliveryKey(eventType, record, providerOrderId, checkoutOrderId) {
  const stableId = String(
    checkoutOrderId
    || record?.checkoutOrderId
    || providerOrderId
    || record?.providerOrderId
    || record?.customerPhone
    || ''
  ).trim();
  if (!stableId) return null;
  return `wa:${eventType}:${stableId}`;
}

function reserveWhatsAppDelivery(key, ttlMs) {
  if (!key) return false;
  const now = Date.now();
  const existing = checkoutWhatsAppStateMap.get(key);
  if (existing && existing.expiresAt > now) return false;
  checkoutWhatsAppStateMap.set(key, { status: 'sending', expiresAt: now + ttlMs });
  return true;
}

function markWhatsAppSent(key, ttlMs, meta = {}) {
  checkoutWhatsAppStateMap.set(key, { status: 'sent', expiresAt: Date.now() + ttlMs, ...meta });
}

function clearWhatsAppDelivery(key) {
  checkoutWhatsAppStateMap.delete(key);
}

function formatAmountBrl(cents) {
  const val = Number(cents) || 0;
  return `R$ ${(val / 100).toFixed(2).replace('.', ',')}`;
}

async function resolveCustomerDisplayName(email, phone, fallbackName) {
  const fallback = String(fallbackName || 'Cliente');

  // 1) Primeiro tenta nome do cadastro no app (Supabase profiles)
  if (supabaseAdmin && email) {
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('email', normalizeEmail(email))
        .maybeSingle();
      const profileName = (profile?.full_name || '').trim();
      if (profileName && profileName.toLowerCase() !== 'cliente') return profileName;
    } catch (err) {
      console.warn('[checkout-whatsapp] Falha ao buscar nome do perfil:', err?.message);
    }
  }

  // 2) Se não tem cadastro, tenta o nome do WhatsApp (push name)
  if (phone) {
    try {
      const waName = waBaileys.getContactName(phone);
      if (waName && waName.trim()) return waName.trim();
    } catch { /* ignore */ }
  }

  // 3) Se o fallback parece ser um prefixo de e-mail (sem espaço, tudo minúsculo), usa 'Cliente'
  if (fallback && !fallback.includes(' ') && fallback === fallback.toLowerCase() && fallback !== 'Cliente') {
    return 'Cliente';
  }
  return fallback;
}

async function sendFirstOfferCheckoutWhatsApp({
  eventType,
  record,
  providerOrderId,
  checkoutOrderId,
}) {
  if (!isWhatsAppConfigured()) {
    return { skipped: true, reason: 'disabled_or_not_configured' };
  }

  if (eventType !== 'payment_approved') {
    return { skipped: true, reason: 'event_not_handled' };
  }

  const phone = formatPhoneForWhatsApp(record?.customerPhone);
  if (!phone) {
    return { skipped: true, reason: 'missing_or_invalid_phone' };
  }

  const ttlMs = CHECKOUT_EMAIL_LONG_TTL_MS; // reutiliza o mesmo TTL do email
  const deliveryKey = buildWhatsAppDeliveryKey(eventType, record, providerOrderId, checkoutOrderId);
  if (!reserveWhatsAppDelivery(deliveryKey, ttlMs)) {
    return { skipped: true, reason: 'duplicate' };
  }

  const customerName = await resolveCustomerDisplayName(record?.customerEmail, phone, record?.customerName);
  const offerName = String(record?.offerName || 'Combo Salva Universitário');
  const amount = formatAmountBrl(record?.amountCents);
  const email = String(record?.customerEmail || '');

  const planKey = findPlanKeyByOfferName(offerName);

  // Verifica se WhatsApp está desabilitado para este plano
  if (planKey) {
    const planConfig = loadWaTemplateConfig().plans[planKey];
    if (planConfig && !planConfig.whatsappEnabled) {
      clearWhatsAppDelivery(deliveryKey);
      return { skipped: true, reason: 'plan_whatsapp_disabled' };
    }
  }

  // Resolve steps do fluxo (novo modelo: array de text + audio)
  let resolvedSteps = [];
  if (planKey) {
    resolvedSteps = resolveStepsForPlan(planKey, eventType, { customerName, offerName, amount, email });
  }

  // Fallback para formato legado se não tem steps
  if (!resolvedSteps.length) {
    const textMessage = paymentApprovedMessage({ customerName, offerName, amount, email });
    resolvedSteps = [{ type: 'text', text: textMessage, delayBefore: 0 }];
    // Adiciona áudio global se existir
    if (WHATSAPP_AUDIO_URL) {
      resolvedSteps.push({ type: 'audio', audioUrl: WHATSAPP_AUDIO_URL, delayBefore: 3 });
    }
  }

  try {
    const sentIds = [];
    for (let i = 0; i < resolvedSteps.length; i++) {
      const step = resolvedSteps[i];
      // Aplica delay (pula no primeiro step)
      if (i > 0 && step.delayBefore > 0) {
        await new Promise(r => setTimeout(r, step.delayBefore * 1000));
      }
      try {
        if (step.type === 'text' && step.text) {
          const result = await sendWhatsAppTextMessage({ to: phone, text: step.text });
          sentIds.push({ type: 'text', messageId: result?.key?.id || null });
          console.log(`[checkout-whatsapp] Sent text step ${i + 1}/${resolvedSteps.length} to ${phone}`);
        } else if (step.type === 'audio') {
          const audioUrl = (step.audioUrl || '').trim() || WHATSAPP_AUDIO_URL;
          if (audioUrl) {
            const result = await sendWhatsAppAudioMessage({ to: phone, audioUrl });
            sentIds.push({ type: 'audio', messageId: result?.key?.id || null });
            console.log(`[checkout-whatsapp] Sent audio step ${i + 1}/${resolvedSteps.length} to ${phone}`);
          }
        }
      } catch (stepErr) {
        console.warn(`[checkout-whatsapp] Step ${i + 1} failed for ${phone}: ${stepErr?.message}`);
      }
    }

    markWhatsAppSent(deliveryKey, ttlMs, {
      providerOrderId: providerOrderId || record?.providerOrderId || null,
      checkoutOrderId: checkoutOrderId || record?.checkoutOrderId || null,
      sentIds,
    });

    return { ok: true, stepsSent: sentIds.length, sentIds };
  } catch (error) {
    clearWhatsAppDelivery(deliveryKey);
    console.warn(`[checkout-whatsapp] Failed ${eventType} for ${phone}: ${error?.message}`);
    return { ok: false, error: error?.message || 'unknown_error' };
  }
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

/** Minimal multipart/form-data parser (binary safe) */
function parseMultipart(body, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;
  while (true) {
    const idx = body.indexOf(sep, start);
    if (idx < 0) break;
    if (start > 0) {
      // slice between previous sep and this sep (remove leading \r\n and trailing \r\n)
      let chunk = body.slice(start, idx);
      if (chunk[0] === 0x0d && chunk[1] === 0x0a) chunk = chunk.slice(2);
      if (chunk[chunk.length - 2] === 0x0d && chunk[chunk.length - 1] === 0x0a) chunk = chunk.slice(0, -2);
      const headerEnd = chunk.indexOf('\r\n\r\n');
      if (headerEnd >= 0) {
        const headerStr = chunk.slice(0, headerEnd).toString('utf8');
        const data = chunk.slice(headerEnd + 4);
        const nameMatch = headerStr.match(/name="([^"]+)"/);
        const fileMatch = headerStr.match(/filename="([^"]*)"/);
        parts.push({
          name: nameMatch?.[1] || '',
          filename: fileMatch?.[1] || null,
          headers: headerStr,
          data,
        });
      }
    }
    start = idx + sep.length;
    // check for closing --
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
  }
  return parts;
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
      const healthy = (isSyncPay ? isSyncPayConfigured() : isEnkiBank ? isEnkiBankConfigured() : isAmploPay ? isAmploPayConfigured() : configured) && supabaseConfigured;
      res.end(JSON.stringify({ ok: true, status: healthy ? 'healthy' : 'degraded' }));
    } else {
      const webhookTokenConfigured = Boolean(process.env.BABYLON_WEBHOOK_TOKEN);
      const amploPayConfigured = isAmploPayConfigured();
      const enkiBankConfigured = isEnkiBankConfigured();
      const syncPayConfigured = isSyncPayConfigured();
      res.end(JSON.stringify({
        ok: true,
        activeGateway,
        configured: isSyncPay ? syncPayConfigured : isEnkiBank ? enkiBankConfigured : isAmploPay ? amploPayConfigured : configured,
        supabaseConfigured,
        webhookTokenConfigured: isEnkiBank ? Boolean(ENKIBANK_WEBHOOK_TOKEN) : isAmploPay ? Boolean(AMPLOPAY_WEBHOOK_TOKEN) : webhookTokenConfigured,
        babylonConfigured: configured,
        amploPayConfigured,
        enkiBankConfigured,
        syncPayConfigured,
        status: (isSyncPay ? syncPayConfigured : isEnkiBank ? enkiBankConfigured : isAmploPay ? amploPayConfigured : configured) && supabaseConfigured ? 'healthy' : 'degraded',
      }));
    }
    return;
  }

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && LOCAL_PREVIEW_EMAIL_ASSETS.has(pathname)) {
    const asset = LOCAL_PREVIEW_EMAIL_ASSETS.get(pathname);

    try {
      const assetBuffer = readFileSync(asset.filePath);
      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.writeHead(200);
      res.end(assetBuffer);
    } catch (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Asset not found' }));
    }
    return;
  }

  if (pathname === '/api/dev/checkout-email-preview' && req.method === 'GET') {
    if (isProduction) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const previewType = String(requestUrl.searchParams.get('type') || 'pix_ready').trim().toLowerCase() === 'payment_approved'
      ? 'payment_approved'
      : 'pix_ready';
    const previewRecord = buildFirstOfferCheckoutRecord({
      checkoutOrderId: 'preview-order-001',
      providerOrderId: 'preview-provider-001',
      customerName: String(requestUrl.searchParams.get('name') || 'Maria Clara').trim(),
      customerEmail: String(requestUrl.searchParams.get('email') || 'maria@example.com').trim(),
      customerPhone: '11999999999',
      offerName: String(requestUrl.searchParams.get('offer') || 'Combo trimestral').trim(),
      amountCents: Number(requestUrl.searchParams.get('amountCents') || 9490),
      items: [
        { title: String(requestUrl.searchParams.get('offer') || 'Combo trimestral').trim(), quantity: 1, unitPriceCents: Number(requestUrl.searchParams.get('amountCents') || 9490) },
      ],
      paymentMethod: 'pix',
    });
    const previewAssetBaseUrl = `http://127.0.0.1:${port}`;
    const previewMessage = buildFirstOfferEmailMessage({
      eventType: previewType,
      record: previewRecord,
      providerOrderId: previewRecord.providerOrderId,
      pixCopyPasteCode: previewType === 'pix_ready' ? '00020101021226850014br.gov.bcb.pix2563pix.example.com/qr/v2/123456789012345678905204000053039865802BR5924SALVA UNIVERSITARIO6009SAO PAULO62070503***6304ABCD' : null,
      pixQrUrl: null,
      assetUrlsOverride: {
        logoUrl: `${previewAssetBaseUrl}/email-assets/logo-pvpmbwn.png`,
        badgeUrl: `${previewAssetBaseUrl}/email-assets/garantia-30-dias.png`,
        testimonialUrl: `${previewAssetBaseUrl}/email-assets/depoimento-bel.webp`,
      },
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(previewMessage.html);
    return;
  }

  if (pathname === '/api/dev/checkout-email-send' && req.method === 'POST') {
    if (isProduction) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    if (!isCheckoutEmailConfigured()) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Checkout email is not configured' }));
      return;
    }

    let payload;
    try {
      const rawBody = await readRequestBody(req);
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const previewType = String(payload?.type || 'pix_ready').trim().toLowerCase() === 'payment_approved'
      ? 'payment_approved'
      : 'pix_ready';
    const recipientEmail = normalizeEmail(payload?.to || payload?.email || '');

    if (!recipientEmail) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Recipient email is required' }));
      return;
    }

    const customerEmail = normalizeEmail(payload?.customerEmail || recipientEmail) || recipientEmail;
    const offerName = String(payload?.offer || 'Combo trimestral').trim() || 'Combo trimestral';
    const amountCents = Number(payload?.amountCents || 9490);
    const providerOrderId = String(payload?.providerOrderId || 'preview-send-provider-001').trim() || 'preview-send-provider-001';
    const pixCopyPasteCode = previewType === 'pix_ready'
      ? String(payload?.pixCode || '00020101021226850014br.gov.bcb.pix2563pix.example.com/qr/v2/123456789012345678905204000053039865802BR5924SALVA UNIVERSITARIO6009SAO PAULO62070503***6304ABCD').trim()
      : null;
    const pixQrUrl = previewType === 'pix_ready' && payload?.pixQrUrl
      ? String(payload.pixQrUrl).trim()
      : null;

    const previewRecord = buildFirstOfferCheckoutRecord({
      checkoutOrderId: String(payload?.checkoutOrderId || `preview-send-${Date.now()}`).trim(),
      providerOrderId,
      customerName: String(payload?.name || 'Teste Checkout').trim(),
      customerEmail,
      customerPhone: String(payload?.customerPhone || '11999999999').trim(),
      offerName,
      amountCents,
      items: [
        {
          title: offerName,
          quantity: 1,
          unitPriceCents: amountCents,
        },
      ],
      paymentMethod: 'pix',
    });

    try {
      const message = buildFirstOfferEmailMessage({
        eventType: previewType,
        record: previewRecord,
        providerOrderId,
        pixCopyPasteCode,
        pixQrUrl,
      });

      const response = await sendResendCheckoutEmail({
        to: recipientEmail,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        id: response?.id || null,
        to: recipientEmail,
        type: previewType,
        subject: message.subject,
      }));
    } catch (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(502);
      res.end(JSON.stringify({
        ok: false,
        error: error?.message || 'send_failed',
      }));
    }
    return;
  }

  // ── Admin: WhatsApp status, config, templates & test (produção inclusa) ──
  if (pathname === '/api/admin/whatsapp-status' && req.method === 'GET') {
    if (!(await requireAdminApiRequest(req, res))) return;

    const state = waBaileys.getConnectionState();
    const qr = waBaileys.getQrCode();
    const pCode = waBaileys.getPairingCode();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({
      enabled: WHATSAPP_ENABLED,
      state,
      connected: state === 'open',
      qrCode: qr || null,
      pairingCode: pCode || null,
      pairingPhoneNumber: WHATSAPP_PAIRING_PHONE_NUMBER || null,
      audioUrl: WHATSAPP_AUDIO_URL || null,
    }));
    return;
  }

  if (pathname === '/api/admin/whatsapp-templates' && req.method === 'GET') {
    if (!(await requireAdminApiRequest(req, res))) return;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({ templates: listWhatsAppTemplates() }));
    return;
  }

  // Config completa por plano (GET = ler, PUT = salvar)
  if (pathname === '/api/admin/whatsapp-config' && req.method === 'GET') {
    if (!(await requireAdminApiRequest(req, res))) return;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify(getWaAdminConfigData()));
    return;
  }

  if (pathname === '/api/admin/whatsapp-config' && req.method === 'PUT') {
    if (!(await requireAdminApiRequest(req, res))) return;

    let payload;
    try {
      const rawBody = await readRequestBody(req);
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'JSON inválido' }));
      return;
    }
    if (!payload.plans || typeof payload.plans !== 'object') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Payload deve conter "plans".' }));
      return;
    }
    const currentConfig = getWaTemplateConfig();
    // Merge only recognized plan keys
    for (const [key, updates] of Object.entries(payload.plans)) {
      if (!currentConfig.plans[key]) continue;
      if (typeof updates.whatsappEnabled === 'boolean') currentConfig.plans[key].whatsappEnabled = updates.whatsappEnabled;
      if (typeof updates.audioEnabled === 'boolean') currentConfig.plans[key].audioEnabled = updates.audioEnabled;
      if (typeof updates.audioUrl === 'string') currentConfig.plans[key].audioUrl = updates.audioUrl.trim();
      if (typeof updates.audioDelaySeconds === 'number') currentConfig.plans[key].audioDelaySeconds = Math.max(0, Math.min(120, Math.round(updates.audioDelaySeconds)));
      if (updates.templates && typeof updates.templates === 'object') {
        for (const tplKey of ['payment_approved', 'pix_ready']) {
          if (typeof updates.templates[tplKey] === 'string') {
            currentConfig.plans[key].templates[tplKey] = updates.templates[tplKey];
          }
        }
      }
      // ── Steps (novo modelo de fluxo) ──
      if (updates.steps && typeof updates.steps === 'object') {
        if (!currentConfig.plans[key].steps) currentConfig.plans[key].steps = {};
        for (const eventKey of ['payment_approved', 'pix_ready']) {
          if (Array.isArray(updates.steps[eventKey])) {
            currentConfig.plans[key].steps[eventKey] = updates.steps[eventKey]
              .filter(s => s && (s.type === 'text' || s.type === 'audio'))
              .slice(0, 10)
              .map(s => {
                const step = { type: s.type, delayBefore: Math.max(0, Math.min(120, Math.round(Number(s.delayBefore) || 0))) };
                if (s.type === 'text') step.content = String(s.content || '');
                if (s.type === 'audio') step.audioUrl = String(s.audioUrl || '').trim();
                return step;
              });
            // Sync legacy templates field with first text step
            const firstText = currentConfig.plans[key].steps[eventKey].find(s => s.type === 'text');
            if (firstText) {
              if (!currentConfig.plans[key].templates) currentConfig.plans[key].templates = {};
              currentConfig.plans[key].templates[eventKey] = firstText.content;
            }
          }
        }
      }
    }
    const ok = saveWaTemplateConfig(currentConfig);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(ok ? 200 : 500);
    res.end(JSON.stringify(ok ? { ok: true, config: getWaAdminConfigData() } : { error: 'Falha ao salvar.' }));
    return;
  }

  // Reconectar WhatsApp
  if (pathname === '/api/admin/whatsapp-reconnect' && req.method === 'POST') {
    if (!(await requireAdminApiRequest(req, res))) return;

    try {
      await waBaileys.startWhatsApp();
      const state = waBaileys.getConnectionState();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, state }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(502);
      res.end(JSON.stringify({ ok: false, error: err?.message || 'reconnect_failed' }));
    }
    return;
  }

  if (pathname === '/api/admin/whatsapp-send-test' && req.method === 'POST') {
    if (!(await requireAdminApiRequest(req, res))) return;

    if (!isWhatsAppConfigured()) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'WhatsApp desconectado ou desabilitado.' }));
      return;
    }
    let payload;
    try {
      const rawBody = await readRequestBody(req);
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'JSON inválido' }));
      return;
    }
    const phone = formatPhoneForWhatsApp(payload?.phone || '');
    if (!phone) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Número de telefone inválido.' }));
      return;
    }
    const planKey = String(payload?.planKey || '');
    const templateId = String(payload?.templateId || 'payment_approved');
    const vars = {
      customerName: String(payload?.customerName || 'Teste'),
      offerName: String(payload?.offerName || 'Combo Trimestral'),
      amount: String(payload?.amount || 'R$ 94,90'),
      email: String(payload?.email || ''),
      pixCode: String(payload?.pixCode || '00020126580014br.gov.bcb.pix0136exemplo-pix-code'),
    };
    // Se tem planKey, usa os steps configurados desse plano
    let resolvedSteps = [];
    if (planKey) {
      resolvedSteps = resolveStepsForPlan(planKey, templateId, vars);
    }
    if (!resolvedSteps.length) {
      const text = templateId === 'pix_ready'
        ? pixReadyMessage(vars)
        : paymentApprovedMessage(vars);
      resolvedSteps = [{ type: 'text', text, delayBefore: 0 }];
    }
    try {
      const sentIds = [];
      for (let i = 0; i < resolvedSteps.length; i++) {
        const step = resolvedSteps[i];
        if (i > 0 && step.delayBefore > 0) {
          await new Promise(r => setTimeout(r, step.delayBefore * 1000));
        }
        if (step.type === 'text' && step.text) {
          const result = await sendWhatsAppTextMessage({ to: phone, text: step.text });
          sentIds.push({ type: 'text', messageId: result?.messageId || null });
        } else if (step.type === 'audio' && step.audioUrl) {
          const result = await sendWhatsAppAudioMessage({ to: phone, audioUrl: step.audioUrl });
          sentIds.push({ type: 'audio', messageId: result?.messageId || null });
        }
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, stepsSent: sentIds.length, sentIds, to: phone, templateId, planKey }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(502);
      res.end(JSON.stringify({ ok: false, error: err?.message || 'send_failed' }));
    }
    return;
  }

  // ── Upload de áudio (converte para OGG Opus PTT) ──
  if (pathname === '/api/admin/whatsapp-upload-audio' && req.method === 'POST') {
    if (!(await requireAdminApiRequest(req, res))) return;

    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_SIZE) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(413);
      res.end(JSON.stringify({ error: 'Arquivo muito grande (máx 10 MB).' }));
      return;
    }
    try {
      const rawBody = await readRequestBody(req);
      // Parse multipart boundary
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
      if (!boundaryMatch) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Content-Type multipart/form-data com boundary é obrigatório.' }));
        return;
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const parts = parseMultipart(rawBody, boundary);
      const filePart = parts.find(p => p.name === 'audio');
      const planKey = (parts.find(p => p.name === 'planKey')?.data?.toString('utf8') || '').trim();
      if (!filePart || !filePart.data || filePart.data.length < 100) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Nenhum arquivo de áudio enviado.' }));
        return;
      }
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const audioDir = join(__dirname, '..', 'public', 'audio');
      mkdirSync(audioDir, { recursive: true });
      const id = randomUUID().slice(0, 8);
      const safePlan = (planKey || 'audio').replace(/[^a-z0-9_-]/gi, '');
      const tmpInput = join(audioDir, `tmp_${id}_input`);
      const outputName = `${safePlan}_${id}.ogg`;
      const outputPath = join(audioDir, outputName);

      writeFileSync(tmpInput, filePart.data);
      try {
        execFileSync('ffmpeg', [
          '-y', '-i', tmpInput,
          '-ac', '1',           // mono
          '-ar', '48000',       // 48kHz (Opus padrão)
          '-b:a', '64k',        // bitrate baixo = voz natural
          '-c:a', 'libopus',    // codec Opus
          '-application', 'voip', // otimizado pra voz
          outputPath,
        ], { timeout: 30000, stdio: 'pipe' });
      } finally {
        try { unlinkSync(tmpInput); } catch {}
      }

      const audioUrl = `https://api.combosalvauniversitario.site/audio/${outputName}`;

      // Se planKey informado, salva automaticamente na config do plano
      if (planKey) {
        const cfg = getWaTemplateConfig();
        if (cfg.plans?.[planKey]) {
          cfg.plans[planKey].audioUrl = audioUrl;
          saveWaTemplateConfig(cfg);
        }
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, audioUrl, fileName: outputName, planKey: planKey || null }));
    } catch (err) {
      console.error('[whatsapp-upload-audio] erro:', err);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: err?.message || 'upload_failed' }));
    }
    return;
  }

  // ── Admin: Auto-respostas por palavra-chave ──
  if (pathname === '/api/admin/whatsapp-autoreplies' && req.method === 'GET') {
    if (!(await requireAdminApiRequest(req, res))) return;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({ rules: waAutoReply.getRules() }));
    return;
  }

  if (pathname === '/api/admin/whatsapp-autoreplies' && req.method === 'POST') {
    if (!(await requireAdminApiRequest(req, res))) return;
    let payload;
    try {
      const rawBody = await readRequestBody(req);
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'JSON inválido' }));
      return;
    }
    const rule = waAutoReply.createRule({
      keywords: payload.keywords,
      response: payload.response,
      matchMode: payload.matchMode,
      enabled: payload.enabled,
    });
    if (!rule) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'keywords (array) e response (string) são obrigatórios.' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(201);
    res.end(JSON.stringify({ ok: true, rule }));
    return;
  }

  if (pathname.startsWith('/api/admin/whatsapp-autoreplies/') && req.method === 'PUT') {
    if (!(await requireAdminApiRequest(req, res))) return;
    const ruleId = pathname.split('/').pop();
    let payload;
    try {
      const rawBody = await readRequestBody(req);
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'JSON inválido' }));
      return;
    }
    const updated = waAutoReply.updateRule(ruleId, payload);
    if (!updated) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Regra não encontrada.' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, rule: updated }));
    return;
  }

  if (pathname.startsWith('/api/admin/whatsapp-autoreplies/') && req.method === 'DELETE') {
    if (!(await requireAdminApiRequest(req, res))) return;
    const ruleId = pathname.split('/').pop();
    const deleted = waAutoReply.deleteRule(ruleId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(deleted ? 200 : 404);
    res.end(JSON.stringify(deleted ? { ok: true } : { error: 'Regra não encontrada.' }));
    return;
  }

  // ── Dev: status do WhatsApp / QR code / pairing code ──
  if (pathname === '/api/dev/whatsapp-status' && req.method === 'GET') {
    if (isProduction) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const state = waBaileys.getConnectionState();
    const qr = waBaileys.getQrCode();
    const pairingCode = waBaileys.getPairingCode();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(200);
    res.end(JSON.stringify({
      enabled: WHATSAPP_ENABLED,
      state,
      connected: state === 'open',
      qrCode: qr || null,
      pairingCode: pairingCode || null,
      pairingPhoneNumber: WHATSAPP_PAIRING_PHONE_NUMBER || null,
      pairingEnabled: Boolean(WHATSAPP_PAIRING_PHONE_NUMBER),
      hint: pairingCode
        ? 'On the phone, use Linked Devices > Link with phone number instead and enter the pairing code'
        : qr
          ? 'Scan the QR code with WhatsApp > Settings > Linked Devices > Link a Device'
        : state === 'open'
          ? 'WhatsApp connected and ready!'
          : 'Waiting for connection...',
    }));
    return;
  }

  // ── Dev: enviar WhatsApp de teste ──
  if (pathname === '/api/dev/checkout-whatsapp-send' && req.method === 'POST') {
    if (isProduction) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    if (!isWhatsAppConfigured()) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({
        error: 'WhatsApp is not configured or not connected.',
        enabled: WHATSAPP_ENABLED,
        connected: waBaileys.isConnected(),
        state: waBaileys.getConnectionState(),
        hint: WHATSAPP_ENABLED && !waBaileys.isConnected()
          ? (WHATSAPP_PAIRING_PHONE_NUMBER
            ? 'WhatsApp enabled but not connected. Use the pairing code shown in logs or /tmp/wa_pairing_code.txt.'
            : 'WhatsApp enabled but not connected. Scan the QR code at GET /api/dev/whatsapp-status')
          : 'Set WHATSAPP_ENABLED=true in .env and restart.',
      }));
      return;
    }

    let payload;
    try {
      const rawBody = await readRequestBody(req);
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const phone = formatPhoneForWhatsApp(payload?.phone || payload?.to || '');
    if (!phone) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Valid phone number is required (10-11 digits or with country code 55)' }));
      return;
    }

    const customerName = String(payload?.name || 'Teste Checkout').trim();
    const offerName = String(payload?.offer || 'Combo trimestral').trim();
    const amountCents = Number(payload?.amountCents || 9490);
    const amount = formatAmountBrl(amountCents);

    const textMessage = paymentApprovedMessage({ customerName, offerName, amount, email: '' });

    try {
      const textResult = await sendWhatsAppTextMessage({ to: phone, text: textMessage });
      const messageId = textResult?.key?.id || null;

      let audioMessageId = null;
      if (WHATSAPP_AUDIO_URL && String(payload?.sendAudio || 'true').toLowerCase() !== 'false') {
        try {
          await new Promise((r) => setTimeout(r, 2000));
          const audioResult = await sendWhatsAppAudioMessage({ to: phone, audioUrl: WHATSAPP_AUDIO_URL });
          audioMessageId = audioResult?.key?.id || null;
        } catch (audioErr) {
          console.warn(`[dev:whatsapp] Audio send failed: ${audioErr?.message}`);
        }
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        messageId,
        audioMessageId,
        to: phone,
        via: 'baileys',
      }));
    } catch (error) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(502);
      res.end(JSON.stringify({
        ok: false,
        error: error?.message || 'whatsapp_send_failed',
      }));
    }
    return;
  }

  const needsSupabase = pathname === '/webhooks/babylon'
    || pathname === '/webhooks/amplopay'
    || pathname === '/webhooks/enkibank'
    || pathname === '/webhooks/syncpay'
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
  const needsWebhookToken = (pathname === '/webhooks/amplopay' && (isProduction || Boolean(AMPLOPAY_WEBHOOK_TOKEN)));
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

          if (!error) {
            const checkoutEmailRecord = resolveFirstOfferCheckoutContext({
              payload,
              checkoutOrderId: checkoutOrderId || checkoutOrderIdRaw || null,
              providerOrderId: providerOrderId || null,
              customerEmail: buyerEmail,
              customerPhone: buyerPhone,
              amountCents,
            });
            void sendFirstOfferCheckoutEmail({
              eventType: 'payment_approved',
              record: checkoutEmailRecord,
              providerOrderId: providerOrderId || null,
              checkoutOrderId: checkoutOrderId || checkoutOrderIdRaw || null,
            });
            void sendFirstOfferCheckoutWhatsApp({
              eventType: 'payment_approved',
              record: checkoutEmailRecord,
              providerOrderId: providerOrderId || null,
              checkoutOrderId: checkoutOrderId || checkoutOrderIdRaw || null,
            });
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

              const checkoutEmailRecord = resolveFirstOfferCheckoutContext({
                payload,
                checkoutOrderId: checkoutOrderId || null,
                providerOrderId: providerOrderId || null,
                customerEmail: fallbackEmail,
                customerPhone: fallbackPhone,
                amountCents: fallbackAmountCents,
              });
              void sendFirstOfferCheckoutEmail({
                eventType: 'payment_approved',
                record: checkoutEmailRecord,
                providerOrderId: providerOrderId || null,
                checkoutOrderId: checkoutOrderId || null,
              });
              void sendFirstOfferCheckoutWhatsApp({
                eventType: 'payment_approved',
                record: checkoutEmailRecord,
                providerOrderId: providerOrderId || null,
                checkoutOrderId: checkoutOrderId || null,
              });

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

          if (!error) {
            const checkoutEmailRecord = resolveFirstOfferCheckoutContext({
              payload,
              checkoutOrderId: checkoutOrderId || transactionIdentifier || null,
              providerOrderId: transactionId || null,
              customerEmail: clientEmail,
              customerPhone: clientPhone,
              amountCents,
            });
            void sendFirstOfferCheckoutEmail({
              eventType: 'payment_approved',
              record: checkoutEmailRecord,
              providerOrderId: transactionId || null,
              checkoutOrderId: checkoutOrderId || transactionIdentifier || null,
            });
            void sendFirstOfferCheckoutWhatsApp({
              eventType: 'payment_approved',
              record: checkoutEmailRecord,
              providerOrderId: transactionId || null,
              checkoutOrderId: checkoutOrderId || transactionIdentifier || null,
            });
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

  // ── Enki Bank webhook ──
  if (pathname === '/webhooks/enkibank' && req.method === 'POST') {
    try {
      const rawBody = await readRequestBody(req);
      const textBody = rawBody.toString('utf8') || '{}';
      const payload = textBody ? JSON.parse(textBody) : {};

      console.log(`[webhook:enkibank] Received event: ${payload?.event || 'unknown'} | tx: ${payload?.transaction?.id || 'n/a'} | IP: ${req.socket?.remoteAddress || 'unknown'}`);

      // Validate webhook token if configured (strongly recommended in production)
      if (ENKIBANK_WEBHOOK_TOKEN) {
        const receivedToken = String(
          payload?.token
          || req.headers['x-webhook-token']
          || req.headers['x-enkibank-token']
          || ''
        ).trim();
        if (!receivedToken || receivedToken !== ENKIBANK_WEBHOOK_TOKEN) {
          console.error(`[webhook:enkibank] TOKEN MISMATCH — received: "${String(receivedToken || '').slice(0, 12)}..." | IP: ${req.socket?.remoteAddress || 'unknown'}`);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Unauthorized webhook token' }));
          return;
        }
      }

      if (!payload?.event || !payload?.transaction?.id) {
        console.error('[webhook:enkibank] Invalid webhook payload — missing event or transaction.id');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid webhook payload' }));
        return;
      }

      const event = String(payload.event).trim();
      const providerName = 'enkibank';
      const transactionId = String(payload.transaction.id).trim();
      const transactionExternalRef = String(payload?.transaction?.external_ref || payload?.transaction?.externalRef || payload?.transaction?.metadata?.checkout_order_id || '').trim();
      const clientEmail = normalizeEmail(payload?.transaction?.customer?.email || '');
      const clientPhone = String(payload?.transaction?.customer?.phone || '').trim();
      const amountCents = Number(payload?.transaction?.amount || 0);

      const checkoutOrderIdRaw = transactionExternalRef;
      let checkoutOrderId = UUID_REGEX.test(checkoutOrderIdRaw) ? checkoutOrderIdRaw : null;

      const fallbackEventHash = createHash('sha256').update(textBody).digest('hex');
      const eventId = transactionId || `enkibank_${fallbackEventHash}`;

      // Enki Bank events: transaction.paid, transaction.waiting_payment, transaction.refunded
      const isApproved = event === 'transaction.paid';
      const isFailed = event === 'transaction.refunded';

      // ── Reverse Verification: confirm payment status directly with Enki Bank API ──
      // Even if an attacker forges a webhook payload, we verify with Enki Bank before processing.
      if (isApproved && transactionId && isEnkiBankConfigured()) {
        try {
          const verifyResult = await fetchEnkiBankTransaction(transactionId);
          if (verifyResult.ok && verifyResult.data) {
            const confirmedStatus = normalizeEnkiBankStatus(String(verifyResult.data?.status || ''));
            if (confirmedStatus !== 'approved') {
              console.warn(`[webhook:enkibank] Reverse-verification REJECTED: tx ${transactionId} status="${confirmedStatus}" (expected approved) — ignoring webhook`);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.writeHead(200);
              res.end(JSON.stringify({ ok: true, result: { status: 'ignored_unverified', verified_status: confirmedStatus } }));
              return;
            }
            console.log(`[webhook:enkibank] Reverse-verified tx ${transactionId}: status="${confirmedStatus}"`);
          } else {
            console.warn(`[webhook:enkibank] Reverse verification failed for ${transactionId}: HTTP ${verifyResult.status} — rejecting webhook`);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'Reverse verification failed' }));
            return;
          }
        } catch (verifyErr) {
          console.warn(`[webhook:enkibank] Reverse verification error for ${transactionId}: ${verifyErr?.message} — rejecting webhook`);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'Reverse verification unavailable' }));
          return;
        }
      }

      let eventType;
      if (isApproved) {
        eventType = 'payment.approved';
      } else if (isFailed) {
        eventType = 'refunded';
      } else {
        eventType = event || 'unknown';
      }

      const checkoutSource = (() => {
        const metaSource = String(payload?.transaction?.metadata?.source || '').trim().toLowerCase();
        if (metaSource) return metaSource;
        return '';
      })();

      let resolvedSource = checkoutSource;
      if ((!resolvedSource || !checkoutOrderId) && transactionId) {
        const { data: orderDataByProvider } = await supabaseAdmin
          .from('checkout_orders')
          .select('id, metadata')
          .eq('provider_order_id', transactionId)
          .limit(1)
          .maybeSingle();

        if (orderDataByProvider?.id && !checkoutOrderId) {
          checkoutOrderId = orderDataByProvider.id;
        }

        if (!resolvedSource) {
          resolvedSource = String(orderDataByProvider?.metadata?.source || '').trim().toLowerCase();
        }
      }

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
      } else if (resolvedSource === 'first_offer_public_checkout') {
        if (!isApproved) {
          data = { status: 'ignored_event_type', event_type: event };
          error = null;
        } else {
          const creditAmount = resolveCreditAmountFromCents(amountCents);
          const result = await supabaseAdmin.rpc('register_pending_checkout_benefit', {
            p_provider_name: providerName,
            p_provider_event_id: eventId,
            p_provider_order_id: transactionId || null,
            p_checkout_order_id: checkoutOrderId || null,
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

          if (!error) {
            const checkoutEmailRecord = resolveFirstOfferCheckoutContext({
              payload,
              checkoutOrderId: checkoutOrderId || null,
              providerOrderId: transactionId || null,
              customerEmail: clientEmail,
              customerPhone: clientPhone,
              amountCents,
            });
            void sendFirstOfferCheckoutEmail({
              eventType: 'payment_approved',
              record: checkoutEmailRecord,
              providerOrderId: transactionId || null,
              checkoutOrderId: checkoutOrderId || null,
            });
            void sendFirstOfferCheckoutWhatsApp({
              eventType: 'payment_approved',
              record: checkoutEmailRecord,
              providerOrderId: transactionId || null,
              checkoutOrderId: checkoutOrderId || null,
            });
          }

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
        console.error(`[webhook:enkibank] RPC error: ${error.message}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao aplicar webhook Enki Bank' }));
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

  // ── Sync Payments webhook ──
  if (pathname === '/webhooks/syncpay' && req.method === 'POST') {
    try {
      const rawBody = await readRequestBody(req);
      const textBody = rawBody.toString('utf8') || '{}';
      const payload = textBody ? JSON.parse(textBody) : {};

      const eventHeader = String(req.headers['event'] || '').trim();
      console.log(`[webhook:syncpay] Received event: ${eventHeader || 'unknown'} | id: ${payload?.data?.id || 'n/a'} | IP: ${req.socket?.remoteAddress || 'unknown'}`);

      if (!payload?.data?.id) {
        console.error('[webhook:syncpay] Invalid webhook payload — missing data.id');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid webhook payload' }));
        return;
      }

      const providerName = 'syncpay';
      const transactionId = String(payload.data.id).trim();
      const rawStatus = String(payload.data.status || '').trim().toLowerCase();
      const clientEmail = normalizeEmail(payload?.data?.client?.email || '');
      const clientPhone = String(payload?.data?.client?.phone || payload?.data?.client?.document || '').trim();
      const amountBrl = Number(payload?.data?.amount || 0);
      const amountCents = Math.round(amountBrl * 100);

      // SyncPay events: cashin.create (pending), cashin.update (completed/failed)
      const isApproved = rawStatus === 'completed';
      const isFailed = rawStatus === 'failed' || rawStatus === 'refunded' || rawStatus === 'med';

      // ── Reverse Verification: confirm payment status directly with SyncPay API ──
      if (isApproved && transactionId && isSyncPayConfigured()) {
        try {
          const verifyResult = await fetchSyncPayTransaction(transactionId);
          if (verifyResult.ok && verifyResult.data) {
            const confirmedStatus = normalizeSyncPayStatus(String(verifyResult.data?.status || verifyResult.data?.data?.status || ''));
            if (confirmedStatus !== 'approved') {
              console.warn(`[webhook:syncpay] Reverse-verification REJECTED: tx ${transactionId} status="${confirmedStatus}" (expected approved) — ignoring webhook`);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.writeHead(200);
              res.end(JSON.stringify({ ok: true, result: { status: 'ignored_unverified', verified_status: confirmedStatus } }));
              return;
            }
            console.log(`[webhook:syncpay] Reverse-verified tx ${transactionId}: status="${confirmedStatus}"`);
          } else {
            console.warn(`[webhook:syncpay] Reverse verification failed for ${transactionId}: HTTP ${verifyResult.status} — rejecting webhook`);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'Reverse verification failed' }));
            return;
          }
        } catch (verifyErr) {
          console.warn(`[webhook:syncpay] Reverse verification error for ${transactionId}: ${verifyErr?.message} — rejecting webhook`);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'Reverse verification unavailable' }));
          return;
        }
      }

      let eventType;
      if (isApproved) {
        eventType = 'payment.approved';
      } else if (isFailed) {
        eventType = rawStatus === 'refunded' || rawStatus === 'med' ? 'refunded' : 'failed';
      } else {
        eventType = eventHeader || 'unknown';
      }

      // Try to find checkout_order_id from the order database
      let checkoutOrderId = null;
      if (transactionId) {
        const { data: orderDataByProvider } = await supabaseAdmin
          .from('checkout_orders')
          .select('id, metadata')
          .eq('provider_order_id', transactionId)
          .limit(1)
          .maybeSingle();

        if (orderDataByProvider?.id) {
          checkoutOrderId = orderDataByProvider.id;
        }
      }

      const resolvedSource = (() => {
        if (checkoutOrderId) {
          return 'first_offer_public_checkout';
        }
        return '';
      })();

      if (!checkoutOrderId && transactionId) {
        // Try email lookup
        if (clientEmail) {
          const { data: orderByEmail } = await supabaseAdmin
            .from('checkout_orders')
            .select('id, metadata')
            .eq('status', 'pending')
            .ilike('metadata->>customer_email', clientEmail)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (orderByEmail?.id) {
            checkoutOrderId = orderByEmail.id;
          }
        }
      }

      const fallbackEventHash = createHash('sha256').update(textBody).digest('hex');
      const eventId = transactionId || `syncpay_${fallbackEventHash}`;

      let data;
      let error;

      if (resolvedSource === 'first_offer_public_checkout' || checkoutOrderId) {
        if (!isApproved) {
          data = { status: 'ignored_event_type', event_type: eventHeader || rawStatus };
          error = null;
        } else {
          const creditAmount = resolveCreditAmountFromCents(amountCents);
          const result = await supabaseAdmin.rpc('register_pending_checkout_benefit', {
            p_provider_name: providerName,
            p_provider_event_id: eventId,
            p_provider_order_id: transactionId || null,
            p_checkout_order_id: checkoutOrderId || null,
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

          if (!error) {
            const checkoutEmailRecord = resolveFirstOfferCheckoutContext({
              payload,
              checkoutOrderId: checkoutOrderId || null,
              providerOrderId: transactionId || null,
              customerEmail: clientEmail,
              customerPhone: clientPhone,
              amountCents,
            });
            void sendFirstOfferCheckoutEmail({
              eventType: 'payment_approved',
              record: checkoutEmailRecord,
              providerOrderId: transactionId || null,
              checkoutOrderId: checkoutOrderId || null,
            });
            void sendFirstOfferCheckoutWhatsApp({
              eventType: 'payment_approved',
              record: checkoutEmailRecord,
              providerOrderId: transactionId || null,
              checkoutOrderId: checkoutOrderId || null,
            });
          }

          if (!error) {
            sendMetaConversionEvent({
              eventName: 'Purchase',
              eventId: `purchase_${transactionId || checkoutOrderId || eventId}`,
              email: clientEmail,
              phone: clientPhone,
              value: amountBrl > 0 ? amountBrl : (amountCents > 0 ? (amountCents / 100) : null),
              currency: 'BRL',
              transactionId: transactionId,
              sourceUrl: publicAppUrl || 'https://combosalvauniversitario.com',
            });
          }
        }
      } else {
        const result = await supabaseAdmin.rpc('apply_checkout_paid_event', {
          p_provider_name: providerName,
          p_provider_event_id: eventId,
          p_provider_order_id: transactionId || null,
          p_event_type: eventType,
          p_payload: payload,
        });
        data = result.data;
        error = result.error;
      }

      if (error) {
        console.error(`[webhook:syncpay] RPC error: ${error.message}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao aplicar webhook Sync Payments' }));
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, result: data }));
    } catch (err) {
      console.error(`[webhook:syncpay] Error: ${err?.message}`);
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

        if (providerName === 'syncpay') {
          const syncResult = await fetchSyncPayTransaction(providerOrderId);
          if (syncResult.ok && syncResult.data?.data) {
            gatewayStatus = normalizeSyncPayStatus(String(syncResult.data.data.status || ''));
            approved = gatewayStatus === 'approved' || gatewayStatus === 'paid';
            failed = isFailurePaymentStatus(gatewayStatus);
          }
        } else if (providerName === 'enkibank') {
          const enkiResult = await fetchEnkiBankTransaction(providerOrderId);
          if (enkiResult.ok && enkiResult.data) {
            gatewayStatus = normalizeEnkiBankStatus(String(enkiResult.data?.status || ''));
            approved = gatewayStatus === 'approved' || gatewayStatus === 'paid';
            failed = isFailurePaymentStatus(gatewayStatus);
          }
        } else if (providerName === 'amplopay') {
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

        if (isSyncPay) {
          // ── Sync Payments status poll ──
          const syncResult = await fetchSyncPayTransaction(providerOrderId);
          upstreamOk = syncResult.ok;
          upstreamData = syncResult.data?.data || syncResult.data;
          if (upstreamOk && upstreamData) {
            gatewayStatus = normalizeSyncPayStatus(String(upstreamData?.status || ''));
            const approved = gatewayStatus === 'approved' || gatewayStatus === 'paid';
            if (approved) {
              const buyerEmail = normalizeEmail(payerEmailParam || '');
              const amountBrl = Number(upstreamData?.amount || 0);
              const amountCents = Math.round(amountBrl * 100);
              const creditAmount = resolveCreditAmountFromCents(amountCents);

              const resolvedCheckoutOrderIdRaw = String(checkoutOrderId || '').trim();
              const resolvedCheckoutOrderId = UUID_REGEX.test(resolvedCheckoutOrderIdRaw) ? resolvedCheckoutOrderIdRaw : null;

              const fallbackEventHash = createHash('sha256').update(JSON.stringify(upstreamData || {})).digest('hex').slice(0, 24);
              const fallbackEventId = `status_poll_${providerOrderId}_${fallbackEventHash}`;

              const { data: fallbackData, error: fallbackError } = await supabaseAdmin.rpc('register_pending_checkout_benefit', {
                p_provider_name: 'syncpay',
                p_provider_event_id: fallbackEventId,
                p_provider_order_id: providerOrderId,
                p_checkout_order_id: resolvedCheckoutOrderId || null,
                p_payer_email: buyerEmail,
                p_payer_phone: null,
                p_amount_cents: amountCents,
                p_credit_amount: creditAmount,
                p_activate_store: true,
                p_metadata: { source: 'checkout_status_poll_fallback', gateway_status: gatewayStatus, transaction: upstreamData },
              });

              if (fallbackError) {
                console.error(`[checkout-status] SyncPay fallback RPC error: ${fallbackError.message}`);
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

                const checkoutEmailRecord = resolveFirstOfferCheckoutContext({
                  payload: upstreamData,
                  checkoutOrderId: resolvedCheckoutOrderId || null,
                  providerOrderId,
                  customerEmail: buyerEmail,
                  amountCents,
                });
                void sendFirstOfferCheckoutEmail({
                  eventType: 'payment_approved',
                  record: checkoutEmailRecord,
                  providerOrderId,
                  checkoutOrderId: resolvedCheckoutOrderId || null,
                });
                void sendFirstOfferCheckoutWhatsApp({
                  eventType: 'payment_approved',
                  record: checkoutEmailRecord,
                  providerOrderId,
                  checkoutOrderId: resolvedCheckoutOrderId || null,
                });

                sendMetaConversionEvent({
                  eventName: 'Purchase',
                  eventId: `purchase_poll_syncpay_${providerOrderId}`,
                  email: buyerEmail,
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
            } else if (gatewayStatus && isFailurePaymentStatus(gatewayStatus)) {
              status = 'failed';
              matchedBy = 'provider_status_poll';
            }
          }
        } else if (isAmploPay) {
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

                const checkoutEmailRecord = resolveFirstOfferCheckoutContext({
                  payload: upstreamData,
                  checkoutOrderId: resolvedCheckoutOrderId || resolvedCheckoutOrderIdRaw || null,
                  providerOrderId,
                  customerEmail: buyerEmail,
                  customerPhone: buyerPhone,
                  amountCents,
                });
                void sendFirstOfferCheckoutEmail({
                  eventType: 'payment_approved',
                  record: checkoutEmailRecord,
                  providerOrderId,
                  checkoutOrderId: resolvedCheckoutOrderId || resolvedCheckoutOrderIdRaw || null,
                });
                void sendFirstOfferCheckoutWhatsApp({
                  eventType: 'payment_approved',
                  record: checkoutEmailRecord,
                  providerOrderId,
                  checkoutOrderId: resolvedCheckoutOrderId || resolvedCheckoutOrderIdRaw || null,
                });

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

                const checkoutEmailRecord = resolveFirstOfferCheckoutContext({
                  payload: upstreamData,
                  checkoutOrderId: resolvedCheckoutOrderId || resolvedCheckoutOrderIdRaw || null,
                  providerOrderId,
                  customerEmail: buyerEmail,
                  customerPhone: buyerPhone,
                  amountCents,
                });
                void sendFirstOfferCheckoutEmail({
                  eventType: 'payment_approved',
                  record: checkoutEmailRecord,
                  providerOrderId,
                  checkoutOrderId: resolvedCheckoutOrderId || resolvedCheckoutOrderIdRaw || null,
                });
                void sendFirstOfferCheckoutWhatsApp({
                  eventType: 'payment_approved',
                  record: checkoutEmailRecord,
                  providerOrderId,
                  checkoutOrderId: resolvedCheckoutOrderId || resolvedCheckoutOrderIdRaw || null,
                });

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
      const customerPhone = phoneDigits.length >= 10 ? phoneDigits.slice(0, 11) : '';
      const checkoutMetadata = {
        checkout_order_id: checkoutOrderId,
        source: 'first_offer_public_checkout',
        customer_name: name,
        customer_email: email,
        customer_phone: customerPhone || null,
        offer_name: offerName,
        payment_method: 'pix',
        idempotency_key: idempotencyKey,
        total_items: totalItems,
        total_amount_cents: Math.round(amountCents),
        items_breakdown: validatedItems,
      };

      let upstreamData;
      let upstreamOk;
      let upstreamStatus;

      if (isSyncPay) {
        // ── Sync Payments PIX ──
        const cpf = normalizeDigits(payload?.customer?.cpf || payload?.customer?.document || '').slice(0, 11);
        const phone = customerPhone;

        if (!cpf || cpf.length !== 11) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'CPF obrigatório para pagamentos via Sync Payments' }));
          return;
        }

        const amountBrl = Math.round(amountCents) / 100;
        const description = validatedItems.map((item) => item.title).join(' + ');

        const result = await createSyncPayPix({
          amount: amountBrl,
          description,
          customer: { name, email, document: cpf, phone },
          webhookUrl: syncPayWebhookCallbackUrl || undefined,
        });

        upstreamOk = result.ok;
        upstreamStatus = result.status;
        upstreamData = result.data;

        // SyncPay returns { message, pix_code, identifier } — normalize for artifact extraction
        if (upstreamOk && upstreamData?.pix_code) {
          upstreamData.pixCopyPasteCode = upstreamData.pix_code;
        }
      } else if (isEnkiBank) {
        // ── Enki Bank PIX ──
        const cpf = normalizeDigits(payload?.customer?.cpf || payload?.customer?.document || '').slice(0, 11);
        const phone = customerPhone;

        if (!cpf || cpf.length !== 11) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'CPF obrigatorio para pagamentos via Enki Bank' }));
          return;
        }

        const enkiPayload = {
          identifier: checkoutOrderId,
          amountCents: Math.round(amountCents),
          customer: {
            name,
            email,
            ...(phone ? { phone } : {}),
            ...(cpf ? { document: cpf } : {}),
          },
          items: validatedItems.map((item, idx) => ({
            id: `offer_item_${idx + 1}`,
            title: item.title,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
          })),
          metadata: {
            ...checkoutMetadata,
          },
        };

        const result = await createEnkiBankPix(enkiPayload);
        upstreamOk = result.ok;
        upstreamStatus = result.status;
        upstreamData = result.data;
      } else if (isAmploPay) {
        // ── AmploPay PIX ──
        const amountBrl = Math.round(amountCents) / 100;
        const cpf = normalizeDigits(payload?.customer?.cpf || payload?.customer?.document || '').slice(0, 11);
        const phone = customerPhone;

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
            ...checkoutMetadata,
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
            phone: customerPhone || '11999999999',
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
            ...checkoutMetadata,
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
          error: `Falha ao criar transação no gateway (${isSyncPay ? 'Sync Payments' : isEnkiBank ? 'Enki Bank' : isAmploPay ? 'AmploPay' : 'Babylon'})`,
          detail: upstreamData,
        }));
        return;
      }

      const providerOrderId = isSyncPay
        ? (upstreamData?.identifier || upstreamData?.id || null)
        : (isAmploPay || isEnkiBank)
        ? (upstreamData?.transactionId || upstreamData?.id || null)
        : (upstreamData?.provider_order_id || upstreamData?.order_id || upstreamData?.transaction_id || upstreamData?.id || upstreamData?.data?.id || null);

      const gatewayStatus = isSyncPay
        ? normalizeSyncPayStatus(String(upstreamData?.status || 'pending'))
        : isEnkiBank
        ? normalizeEnkiBankStatus(String(upstreamData?.status || 'PENDING'))
        : isAmploPay
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
      const checkoutEmailRecord = buildFirstOfferCheckoutRecord({
        checkoutOrderId,
        providerOrderId,
        customerName: name,
        customerEmail: email,
        customerPhone,
        offerName,
        amountCents,
        items: validatedItems,
        paymentMethod: 'pix',
      });

      rememberFirstOfferCheckout(checkoutEmailRecord);
      if (artifacts.pixCopyPasteCode || artifacts.pixQrUrl) {
        void sendFirstOfferCheckoutEmail({
          eventType: 'pix_ready',
          record: checkoutEmailRecord,
          providerOrderId,
          checkoutOrderId,
          pixCopyPasteCode: artifacts.pixCopyPasteCode,
          pixQrUrl: artifacts.pixQrUrl,
        });
      }

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
      enkiBankConfigured: isEnkiBankConfigured(),
      syncPayConfigured: isSyncPayConfigured(),
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
      if (gateway !== 'babylon' && gateway !== 'amplopay' && gateway !== 'enkibank' && gateway !== 'syncpay') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Gateway inválido. Use "babylon", "amplopay", "enkibank" ou "syncpay".' }));
        return;
      }
      activeGateway = gateway;
      isAmploPay = gateway === 'amplopay';
      isEnkiBank = gateway === 'enkibank';
      isSyncPay = gateway === 'syncpay';
      console.log(`[ADMIN] Payment gateway switched to: ${activeGateway} by user ${authResult.user.id}`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        activeGateway,
        babylonConfigured: Boolean(getAuthHeader()),
        amploPayConfigured: isAmploPayConfigured(),
        enkiBankConfigured: isEnkiBankConfigured(),
        syncPayConfigured: isSyncPayConfigured(),
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

      // ── Sync Payments routing for wallet top-up / generic transactions ──
      if (isSyncPay && isSyncPayConfigured() && payload) {
        const resolvedAmountCents = Math.round(Number(payload?.amount || 0));
        const amountBrl = Math.round(resolvedAmountCents) / 100;
        const customerName = payload?.customer?.name || payload?.customer?.full_name || 'Cliente';
        const customerEmail = payload?.customer?.email || '';
        const customerPhone = normalizeDigits(payload?.customer?.phone || '').slice(0, 11);
        const customerDoc = normalizeDigits(payload?.customer?.cpf || payload?.customer?.document?.number || payload?.customer?.document || '').slice(0, 11);

        if (!customerDoc || customerDoc.length !== 11) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'CPF obrigatório para pagamentos via Sync Payments' }));
          return;
        }

        const topupCredits = Number(payload?.metadata?.topup_credits || 0);
        const description = topupCredits > 0 ? `Recarga de ${topupCredits} creditos` : (payload?.description || 'Pagamento via Sync Payments');

        const result = await createSyncPayPix({
          amount: amountBrl,
          description,
          customer: { name: customerName, email: customerEmail, document: customerDoc, phone: customerPhone },
          webhookUrl: syncPayWebhookCallbackUrl || undefined,
        });

        if (!result.ok) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(result.status || 502);
          res.end(JSON.stringify({
            error: 'Falha ao criar transação no Sync Payments',
            detail: result.data,
          }));
          return;
        }

        const providerOrderId = result.data?.identifier || result.data?.id || null;
        const gatewayStatus = normalizeSyncPayStatus(String(result.data?.status || 'pending'));
        const pixCode = result.data?.pix_code || result.data?.pixCopyPasteCode || '';

        await supabaseAdmin
          .from('checkout_orders')
          .update({
            status: isFailurePaymentStatus(gatewayStatus) ? 'failed' : 'pending',
            provider_name: 'syncpay',
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
            code: pixCode,
            qrCode: pixCode,
          },
          pixCopyPasteCode: pixCode,
        }));
        return;
      }

      // ── Enki Bank routing for wallet top-up / generic transactions ──
      if (isEnkiBank && isEnkiBankConfigured() && payload) {
        const topupCredits = Number(payload?.metadata?.topup_credits || 0);
        const resolvedAmountCents = Math.round(Number(payload?.amount || 0));
        const customerName = payload?.customer?.name || payload?.customer?.full_name || 'Cliente';
        const customerEmail = payload?.customer?.email || '';
        const customerPhone = normalizeDigits(payload?.customer?.phone || '').slice(0, 11);
        const customerDoc = normalizeDigits(payload?.customer?.cpf || payload?.customer?.document?.number || payload?.customer?.document || '').slice(0, 11);

        if (!customerDoc || customerDoc.length !== 11) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'CPF obrigatorio para pagamentos via Enki Bank' }));
          return;
        }

        const enkiPayload = {
          identifier: checkoutOrderId,
          amountCents: resolvedAmountCents,
          customer: {
            name: customerName,
            email: customerEmail,
            ...(customerPhone ? { phone: customerPhone } : {}),
            ...(customerDoc ? { document: customerDoc } : {}),
          },
          items: [{
            id: 'wallet_topup',
            title: topupCredits > 0 ? `Recarga de ${topupCredits} creditos` : 'Recarga de creditos',
            quantity: 1,
            unitPriceCents: resolvedAmountCents,
          }],
          metadata: {
            checkout_order_id: checkoutOrderId,
            source: payload?.metadata?.source || 'wallet_topup',
          },
        };

        const result = await createEnkiBankPix(enkiPayload);

        if (!result.ok) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.writeHead(result.status || 502);
          res.end(JSON.stringify({
            error: 'Falha ao criar transação no Enki Bank',
            detail: result.data,
          }));
          return;
        }

        const providerOrderId = result.data?.transactionId || result.data?.id || null;
        const gatewayStatus = normalizeEnkiBankStatus(String(result.data?.status || 'PENDING'));
        const artifacts = collectCheckoutArtifacts(result.data);

        await supabaseAdmin
          .from('checkout_orders')
          .update({
            status: isFailurePaymentStatus(gatewayStatus) ? 'failed' : 'pending',
            provider_name: 'enkibank',
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

server.listen(port, '127.0.0.1', () => {
  console.log(`[babylon-proxy] running on http://127.0.0.1:${port}`);
  console.log(`[babylon-proxy] active gateway: ${activeGateway}`);
  if (babylonWebhookCallbackUrl) {
    console.log(`[babylon-proxy] webhook callback URL: ${babylonWebhookCallbackUrl}`);
  } else {
    console.log('[babylon-proxy] WARNING: no webhook callback URL configured (set PUBLIC_APP_URL or BABYLON_WEBHOOK_CALLBACK_URL)');
  }
  if (enkiBankWebhookCallbackUrl) {
    console.log(`[babylon-proxy] Enki Bank webhook callback URL: ${enkiBankWebhookCallbackUrl}`);
  }
  if (syncPayWebhookCallbackUrl) {
    console.log(`[babylon-proxy] Sync Payments webhook callback URL: ${syncPayWebhookCallbackUrl}`);
  }

  // ── WhatsApp Baileys: inicia conexão se habilitado ──
  if (WHATSAPP_ENABLED) {
    console.log('[wa-baileys] WhatsApp habilitado. Iniciando conexão...');

    // Registrar handler de auto-resposta por palavra-chave
    waBaileys.setOnIncomingMessage(({ jid, text }) => {
      const rule = waAutoReply.findMatchingRule(text);
      if (!rule) return;
      if (!waAutoReply.checkCooldown(jid, rule.id)) return;
      const phone = jid.replace(/@.*$/, '');
      waBaileys.sendText(phone, rule.response).then(() => {
        console.log(`[wa-autoreply] Respondeu "${rule.keywords[0]}" para ${phone}`);
      }).catch(err => {
        console.warn(`[wa-autoreply] Falha ao responder ${phone}:`, err?.message);
      });
    });

    waBaileys.startWhatsApp({ pairingPhoneNumber: WHATSAPP_PAIRING_PHONE_NUMBER }).catch((err) => {
      console.error('[wa-baileys] Falha ao iniciar:', err?.message);
    });
  } else {
    console.log('[wa-baileys] WhatsApp desabilitado (WHATSAPP_ENABLED=false)');
  }
});
