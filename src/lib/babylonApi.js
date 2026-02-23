import { supabase } from './supabase';

export async function babylonRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
  } = options;

  const configuredBaseUrl = (import.meta.env.VITE_BABYLON_PROXY_URL || '').trim().replace(/\/$/, '');
  const endpointPath = `/api/babylon${path.startsWith('/') ? path : `/${path}`}`;
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
    throw new Error('Não foi possível conectar ao servidor de checkout. Inicie "npm run dev:babylon" ou configure VITE_BABYLON_PROXY_URL.');
  }

  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson && text ? JSON.parse(text) : text;

  if (!response.ok) {
    const message = resolveBabylonErrorMessage(data);
    throw new Error(message);
  }

  return data;
}

function resolveBabylonErrorMessage(data) {
  if (typeof data === 'string' && data.trim()) return data;

  if (!data || typeof data !== 'object') {
    return 'Erro na API Banco Babylon';
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
    return 'Erro na API Banco Babylon';
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
