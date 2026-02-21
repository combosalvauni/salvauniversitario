import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const port = Number(process.env.BABYLON_PROXY_PORT || 8787);
const baseUrl = process.env.BABYLON_BASE_URL || 'https://api.bancobabylon.com/functions/v1';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-babylon-webhook-token');
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
    res.end(JSON.stringify({ ok: true, provider: 'banco-babylon', configured, supabaseConfigured }));
    return;
  }

  if (req.url === '/webhooks/babylon' && req.method === 'POST') {
    if (!supabaseAdmin) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(500);
      res.end(JSON.stringify({
        error: 'Configuração incompleta',
        message: 'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env local.',
      }));
      return;
    }

    const expectedToken = process.env.BABYLON_WEBHOOK_TOKEN;
    if (expectedToken) {
      const receivedToken = req.headers['x-babylon-webhook-token'];
      if (receivedToken !== expectedToken) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized webhook token' }));
        return;
      }
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

      const { data, error } = await supabaseAdmin.rpc('apply_checkout_paid_and_grant_access', {
        p_provider_name: providerName,
        p_provider_event_id: eventId,
        p_provider_order_id: providerOrderId || null,
        p_checkout_order_id: checkoutOrderId,
        p_event_type: eventType,
        p_payload: payload,
      });

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

  if (!req.url?.startsWith('/api/babylon')) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const authHeader = getAuthHeader();
  if (!authHeader) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(500);
    res.end(JSON.stringify({
      error: 'Configuração incompleta',
      message: 'Defina BABYLON_SECRET_KEY e BABYLON_COMPANY_ID no .env local.',
    }));
    return;
  }

  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const upstreamPath = requestUrl.pathname.replace('/api/babylon', '');
    const upstreamUrl = `${baseUrl}${upstreamPath}${requestUrl.search}`;

    const requestBody = await readRequestBody(req);
    const hasBody = requestBody.length > 0;

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
