import crypto from 'crypto';

// "Continue with Google": the phone gives the app a signed ID token (a JWT) from Google; the server checks that Google really
// signed it, that it was made for this app, that it has not run out, and that the email in it is confirmed. Only the app's public
// Client ID is needed (GOOGLE_CLIENT_ID); there is no secret to keep. Nothing is stored from Google except what is read here.

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export const googleClientId = (): string | null => process.env.GOOGLE_CLIENT_ID?.trim() || null;

type Jwk = crypto.JsonWebKey & { kid?: string };
let cache: { keys: Jwk[]; expires: number } | null = null;

/** Google's public signing keys, kept for as long as Google says (at least a minute). */
async function signingKeys(force = false): Promise<Jwk[]> {
  if (!force && cache && cache.expires > Date.now()) return cache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Google keys not available (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cache = { keys: body.keys ?? [], expires: Date.now() + Math.max(60, maxAge) * 1000 };
  return cache.keys;
}

export function resetGoogleKeysForTests() {
  cache = null;
}

const b64 = (s: string) => Buffer.from(s, 'base64url');

export interface GoogleIdentity {
  email: string;
  name: string | null;
  sub: string;
}

/** The identity inside a Google ID token, or null when the token is not good for any reason. */
export async function verifyGoogleIdToken(idToken: string, now = Date.now()): Promise<GoogleIdentity | null> {
  const clientId = googleClientId();
  if (!clientId) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64(parts[0]).toString('utf8')) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;
    let key = (await signingKeys()).find((k) => k.kid === header.kid);
    if (!key) key = (await signingKeys(true)).find((k) => k.kid === header.kid); // Google may have rotated its keys
    if (!key) return null;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key, format: 'jwk' }), b64(parts[2]));
    if (!ok) return null;
    const p = JSON.parse(b64(parts[1]).toString('utf8')) as { iss?: string; aud?: string; exp?: number; sub?: string; email?: string; email_verified?: boolean | string; name?: string };
    if (!p.iss || !ISSUERS.has(p.iss)) return null;
    if (p.aud !== clientId) return null;
    if (typeof p.exp !== 'number' || p.exp * 1000 <= now) return null;
    if (!p.sub || !p.email || (p.email_verified !== true && p.email_verified !== 'true')) return null;
    return { email: p.email.toLowerCase(), name: p.name ?? null, sub: p.sub };
  } catch {
    return null;
  }
}
