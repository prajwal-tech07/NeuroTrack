/**
 * Thin fetch wrapper with automatic access-token refresh.
 *
 * The access token lives in memory (short-lived); the refresh token is an
 * httpOnly cookie the browser sends automatically to /api/auth/refresh.
 */

const BASE = '/api';

let accessToken = null;
let onUnauthorized = () => {};
let refreshInFlight = null;

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details || null;
  }
}

async function refreshSession() {
  // Collapse concurrent 401s into a single refresh call.
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('refresh failed');
        const body = await res.json();
        accessToken = body.data.accessToken;
        return body.data;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request(path, { method = 'GET', body, headers = {}, raw = false, retry = true } = {}) {
  const init = {
    method,
    credentials: 'include',
    headers: {
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  };
  if (body !== undefined) init.body = body instanceof FormData ? body : JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, init);

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      await refreshSession();
      return request(path, { method, body, headers, raw, retry: false });
    } catch {
      accessToken = null;
      onUnauthorized();
      throw new ApiError('Your session expired. Please sign in again.', 401);
    }
  }

  if (raw) {
    if (!res.ok) throw new ApiError('Download failed', res.status);
    return res.blob();
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new ApiError(payload?.message || `Request failed (${res.status})`, res.status, payload?.details);
  }
  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  refreshSession,

  /** Downloads a PDF/JSON attachment and triggers a browser save. */
  async download(path, filename) {
    const blob = await request(path, { raw: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

export default api;
