/**
 * What the admin typed for a WhatsApp contact: a phone number becomes a
 * https://wa.me/<number> link (a local Cameroon number of 9 digits, like
 * 677272261, gets the +237 in front), a link missing its https:// gets it,
 * anything else is kept as typed, and a blank means "none" (null).
 */
export function normalizeWhatsappLink(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (/^\+?[\d\s().-]{7,}$/.test(v)) {
    let digits = v.replace(/\D/g, '');
    if (v.startsWith('00')) digits = digits.slice(2);
    else if (!v.startsWith('+') && digits.length === 9) digits = `237${digits}`;
    return `https://wa.me/${digits}`;
  }
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
