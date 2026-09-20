import crypto from 'crypto';
import { prisma } from './prisma';

// Excludes visually ambiguous characters (0/O, 1/I) since a leader may need
// to read this code aloud or retype it from memory.
const SUFFIX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSuffix(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SUFFIX_CHARS[bytes[i] % SUFFIX_CHARS.length];
  }
  return out;
}

// Generates a referral code in the same style Admins already type by hand
// today (e.g. MARY7X2 — a name fragment plus a short random tail),
// guaranteed unique against ReferralCode.code. Used for Leader self-signup
// (section: single-link onboarding), where nobody types the code in by
// hand — it has to be produced automatically.
export async function generateUniqueReferralCode(name: string): Promise<string> {
  const base = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'LEADER';

  for (let attempt = 0; attempt < 8; attempt++) {
    // Widen the search space if we keep colliding, rather than looping forever.
    const suffixLength = attempt < 5 ? 3 : 5;
    const candidate = `${base}${randomSuffix(suffixLength)}`;
    const existing = await prisma.referralCode.findUnique({ where: { code: candidate } });
    if (!existing) return candidate;
  }

  return `LDR${randomSuffix(8)}`;
}
