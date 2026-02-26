import { supabase } from './supabase';

const DEFAULT_PRODUCTION_PROXY_URL = 'https://api.combosalvauniversitario.site';

function resolveProxyBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_BABYLON_PROXY_URL || '').trim().replace(/\/$/, '');
  if (configuredBaseUrl) return configuredBaseUrl;

  if (typeof window !== 'undefined') {
    const host = String(window.location?.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    if (!isLocalHost) return DEFAULT_PRODUCTION_PROXY_URL;
  }

  return '';
}

async function proxyRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    prefix = '/api/babylon',
  } = options;

  const configuredBaseUrl = resolveProxyBaseUrl();
  const endpointPath = `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
  const endpointUrl = configuredBaseUrl ? `${configuredBaseUrl}${endpointPath}` : endpointPath;

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token || null;

  let response;
  try {
    response = await fetch(endpointUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor da API. Inicie "npm run dev:babylon" ou configure VITE_BABYLON_PROXY_URL.');
  }

  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let data = text;
  if (isJson && text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const unauthorizedInvalidToken = response.status === 401
      && typeof data === 'object'
      && String(data?.error || '').toLowerCase().includes('invalid bearer token');

    if (unauthorizedInvalidToken) {
      throw new Error('Sessão inválida ou expirada. Faça login novamente.');
    }

    const message = resolveBabylonErrorMessage(data, response.status);
    throw new Error(message);
  }

  return data;
}

export async function babylonRequest(path, options = {}) {
  return proxyRequest(path, { ...options, prefix: '/api/babylon' });
}

function resolveBabylonErrorMessage(data, statusCode = 0) {
  if (typeof data === 'string' && data.trim()) return data;

  if (!data || typeof data !== 'object') {
    return statusCode ? `Erro na API Banco Babylon (HTTP ${statusCode})` : 'Erro na API Banco Babylon';
  }

  const candidates = [
    data.message,
    data.error,
    data.detail,
    data.description,
    data.reason,
    data?.refusedReason?.description,
    data?.refusedReason?.message,
    data?.data?.message,
    data?.data?.error,
    data?.data?.detail,
    Array.isArray(data?.errors) ? data.errors[0]?.message : null,
    Array.isArray(data?.errors) ? data.errors[0]?.detail : null,
  ];

  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  if (found) return found;

  try {
    return JSON.stringify(data);
  } catch {
    return statusCode ? `Erro na API Banco Babylon (HTTP ${statusCode})` : 'Erro na API Banco Babylon';
  }
}

export function createBabylonTransaction(payload) {
  return babylonRequest('/transactions', {
    method: 'POST',
    body: payload,
  });
}

export function claimPendingCheckoutBenefits() {
  return babylonRequest('/claim-pending-benefits', {
    method: 'POST',
  });
}

export function listAdminInviteLinks() {
  return proxyRequest('/invite-links', {
    method: 'GET',
    prefix: '/api/admin',
  });
}

export function createAdminInviteLink(payload) {
  return proxyRequest('/invite-links', {
    method: 'POST',
    body: payload,
    prefix: '/api/admin',
  });
}

export function revokeAdminInviteLink(inviteId) {
  return proxyRequest('/invite-links/revoke', {
    method: 'POST',
    body: { inviteId },
    prefix: '/api/admin',
  });
}

export function claimAdminInviteLink(token) {
  return proxyRequest('/invite-links/claim', {
    method: 'POST',
    body: { token },
    prefix: '/api/admin',
  });
}

export function deleteAdminUser(userId) {
  return proxyRequest(`/users/${userId}`, {
    method: 'DELETE',
    prefix: '/api/admin',
  });
}

export function setAdminUserWalletBalance(userId, balance) {
  return proxyRequest(`/users/${userId}/wallet`, {
    method: 'PATCH',
    body: { balance },
    prefix: '/api/admin',
  });
}
