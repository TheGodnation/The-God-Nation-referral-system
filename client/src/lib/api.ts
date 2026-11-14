import { readCookie } from './cookies';
import { keepRead, readCacheOwner, savedRead } from './readCache';
import i18n from '../i18n';

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
  // Present on some validation errors (e.g. the member sign-up/complete
  // -profile endpoints) to name which field was invalid.
  field?: string | null;
  constructor(status: number, message: string, code?: string, field?: string | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** The person stopped a request on purpose (for example, deleted a message that was still waiting to be sent). */
export class RequestCancelled extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'RequestCancelled';
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

// A phone can show "connected" while nothing really comes through (weak data, a Wi-Fi without
// internet). A read that gets no answer in this time counts as "no internet", so the pages that keep
// a saved copy (books, chats, the School) show it instead of waiting for ever.
export const GET_TIMEOUT_MS = 25000;

async function request<T>(method: string, path: string, body?: unknown, options?: { keepalive?: boolean; noSaved?: boolean; signal?: AbortSignal }): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  // The language the app is shown in right now, so posts and messages come
  // back translated into it (see server lib/appLanguage.ts).
  headers['X-App-Language'] = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  if (MUTATING.has(method)) {
    const csrf = readCookie('csrf_token');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const controller = method === 'GET' && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), GET_TIMEOUT_MS) : null;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: payload,
      credentials: 'include',
      // keepalive: still sent if the page is closing (e.g. the reader's bookmark).
      ...(options?.keepalive ? { keepalive: true } : {}),
      ...(controller ? { signal: controller.signal } : options?.signal ? { signal: options.signal } : {}),
    });
  } catch {
    if (timer) clearTimeout(timer);
    // Stopped by the person on purpose: not a network problem, and nothing to retry.
    if (options?.signal?.aborted) throw new RequestCancelled();
    reportReachable(false);
    // No internet: a signed-in member sees what this screen last showed (see lib/readCache.ts).
    const saved = options?.noSaved ? null : await offlineCopy<T>(method, path);
    if (saved !== null) return saved;
    throw new NetworkError();
  }
  reportReachable(true);
  lastRequestAt = Date.now();

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => ({})) : undefined;
  if (timer) clearTimeout(timer);

  if (!res.ok) {
    // The server is not answering properly (502-504): the saved copy, if there is one, rather than an error.
    if (res.status >= 502 && res.status <= 504 && !options?.noSaved) {
      const saved = await offlineCopy<T>(method, path);
      if (saved !== null) return saved;
    }
    const message = (data && (data as any).error) || `Request failed (${res.status})`;
    const code = data && (data as any).code;
    const field = data && (data as any).field;
    throw new ApiError(res.status, message, code, field);
  }

  // Keep the answer (a reading only) so this screen can open without internet next time.
  if (method === 'GET' && data !== undefined && !options?.noSaved && readCacheOwner()) void keepRead(path, appLanguage(), data);

  return data as T;
}

const appLanguage = () => (i18n.language?.startsWith('fr') ? 'fr' : 'en');

/** The saved answer for a reading when there is no internet, or null (then the usual error follows). */
async function offlineCopy<T>(method: string, path: string): Promise<T | null> {
  if (method !== 'GET' || !readCacheOwner()) return null;
  const saved = await savedRead<T>(path, appLanguage());
  if (saved !== null && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('api-served-saved', { detail: path }));
  return saved;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  // A reading that must fail when there is no internet (the caller keeps and shows its own saved copy, with a note).
  getLive: <T>(path: string) => request<T>('GET', path, undefined, { noSaved: true }),
  post: <T>(path: string, body?: unknown, options?: { signal?: AbortSignal }) => request<T>('POST', path, body ?? {}, options),
  put: <T>(path: string, body?: unknown, options?: { keepalive?: boolean }) => request<T>('PUT', path, body ?? {}, options),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

/** Ensures the CSRF cookie exists by pinging a cheap GET endpoint. */
export async function ensureCsrfReady() {
  if (!readCookie('csrf_token')) {
    await api.get('/api/auth/me').catch(() => {});
  }
}
