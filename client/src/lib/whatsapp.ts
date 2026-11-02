/**
 * What the admin typed for a WhatsApp contact: a phone number becomes a
 * https://wa.me/<number> link, a link missing its https:// gets it, anything
 * else is kept as typed, and a blank means "none" (null).
 */
export function normalizeWhatsappLink(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (/^\+?[\d\s().-]{7,}$/.test(v)) return `https://wa.me/${v.replace(/\D/g, '')}`;
  if (/^(wa\.me|chat\.whatsapp\.com|api\.whatsapp\.com)\//i.test(v)) return `https://${v}`;
  return v;
}

/** A wa.me / api.whatsapp.com chat link with a first message already typed; group invite links are left as they are. */
export function withPrefilledMessage(url: string, text: string): string {
  try {
    const u = new URL(url);
    const isChat = u.hostname === 'wa.me' || u.hostname === 'api.whatsapp.com';
    if (!isChat || u.searchParams.has('text')) return url;
    u.searchParams.set('text', text);
    return u.toString();
  } catch {
    return url;
  }
}
