export async function babylonRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
  } = options;

  const configuredBaseUrl = (import.meta.env.VITE_BABYLON_PROXY_URL || '').trim().replace(/\/$/, '');
  const endpointPath = `/api/babylon${path.startsWith('/') ? path : `/${path}`}`;
  const endpointUrl = configuredBaseUrl ? `${configuredBaseUrl}${endpointPath}` : endpointPath;

  const response = await fetch(endpointUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson && text ? JSON.parse(text) : text;

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data?.message || 'Erro na API Banco Babylon';
    throw new Error(message);
  }

  return data;
}

export function createBabylonTransaction(payload) {
  return babylonRequest('/transactions', {
    method: 'POST',
    body: payload,
  });
}
