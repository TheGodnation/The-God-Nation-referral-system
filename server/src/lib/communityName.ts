import type { Request } from 'express';

// An assembly or group has an English name and, written by the admin next to it, a French one. A French speaker
// (the app sends X-App-Language) sees the French name where there is one, otherwise the English name.
export const wantsFrench = (req: Request): boolean => req.get('X-App-Language') === 'fr';

export function communityNameFor(c: { name: string; nameFr?: string | null }, french: boolean): string {
  const fr = c.nameFr?.trim();
  return french && fr ? fr : c.name;
}
