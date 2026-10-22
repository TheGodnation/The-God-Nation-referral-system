import type { Request } from 'express';
import type { Language } from '@prisma/client';

/**
 * The language the viewer is reading the app in right now (the app sends it
 * with every request as X-App-Language), falling back to their profile's
 * preferred language. Auto-translations follow this, so switching the app
 * to English shows French posts and messages in English, and back.
 */
export function appLanguage(req: Request, fallback: Language | null | undefined): Language | null {
  const sent = req.get('X-App-Language');
  if (sent === 'en' || sent === 'fr') return sent;
  return fallback ?? null;
}
