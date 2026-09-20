import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';

const phoneUtil = PhoneNumberUtil.getInstance();

/**
 * Normalize a raw WhatsApp number input to E.164 format.
 * Accepts numbers with a leading '+' (parsed with no default region) or
 * local-format numbers (parsed against a default region so Cameroonian
 * numbers entered without a country code still work).
 *
 * Returns null if the number cannot be parsed as a valid phone number.
 */
export function normalizeToE164(raw: string, defaultRegion = 'CM'): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const region = trimmed.startsWith('+') ? undefined : defaultRegion;
    const parsed = phoneUtil.parse(trimmed, region);
    if (!phoneUtil.isValidNumber(parsed)) return null;
    return phoneUtil.format(parsed, PhoneNumberFormat.E164);
  } catch {
    return null;
  }
}
