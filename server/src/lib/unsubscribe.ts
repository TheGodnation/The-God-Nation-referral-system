import crypto from 'crypto';
import { APP_URL } from './env';

// The "stop these emails" link in marketing-style emails. The address carries a
// signed token for the person, so it works from any mail app without signing
// in, and nobody can stop someone else's emails by guessing.

function key(): string {
  return process.env.UNSUBSCRIBE_SECRET || crypto.createHash('sha256').update(`unsubscribe:${process.env.DATABASE_URL ?? 'local'}`).digest('hex');
}

function sign(personId: string): string {
  return crypto.createHmac('sha256', key()).update(personId).digest('base64url');
}

export function makeUnsubscribeToken(personId: string): string {
  return `${Buffer.from(personId).toString('base64url')}.${sign(personId)}`;
}

/** The person a token belongs to, or null when it is not one we made. */
export function readUnsubscribeToken(token: string): string | null {
  const [idPart, sig] = token.split('.');
  if (!idPart || !sig) return null;
  let personId: string;
  try {
    personId = Buffer.from(idPart, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = sign(personId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? personId : null;
}

export function unsubscribeUrl(personId: string, lang: 'en' | 'fr'): string {
  return `${APP_URL.replace(/\/+$/, '')}/api/unsubscribe?t=${makeUnsubscribeToken(personId)}&lang=${lang}`;
}
