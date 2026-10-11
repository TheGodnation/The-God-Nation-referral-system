import { readCookie } from './cookies';

// In dev, Vite proxies /api to the server. In production, both are served
// from the same origin (or CLIENT set to talk to the API's own origin).
const API_BASE = '';

export class ApiError extends Error {
  status: number;
  // Machine-readable error identifier (when the server sends one) so the
  // client can render its own localized message instead of the server's
  // English-only `error` text — the server doesn't know the visitor's
  // chosen UI language.
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The request never reached the server (no network, or it dropped). */
export class NetworkError extends Error {
  constructor() {
    super('Network unavailable');
    this.name = 'NetworkError';
  }
}

// Tells the app whether the server can be reached, so it can show a small
// "Connecting…" bar on weak networks (see ConnectionBar).
let lastReachable = true;
function reportReachable(ok: boolean) {
  if (ok === lastReachable) return;
  lastReachable = ok;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('api-reachable', { detail: ok }));
}

export function isServerReachable() {
  return lastReachable;
}

let lastRequestAt = 0;
/** When the app last talked to the server (ms). */
export function lastServerContact() {
  return lastRequestAt;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (MUTATING.has(method)) {
    const csrf = readCookie('csrf_token');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: payload,
      credentials: 'include',
    });
  } catch {
    reportReachable(false);
    throw new NetworkError();
  }
  reportReachable(true);
  lastRequestAt = Date.now();

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => ({})) : undefined;

  if (!res.ok) {
    const message = (data && (data as any).error) || `Request failed (${res.status})`;
    const code = data && (data as any).code;
    throw new ApiError(res.status, message, code);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Ensures the CSRF cookie exists by pinging a cheap GET endpoint. */
export async function ensureCsrfReady() {
  if (!readCookie('csrf_token')) {
    await api.get('/api/auth/me').catch(() => {});
  }
}
