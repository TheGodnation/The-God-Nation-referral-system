import crypto from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

type Db = PrismaClient | Prisma.TransactionClient;

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

// Returns this Person's own referral code, creating it if it doesn't exist
// yet. Every Person gets exactly one — this same code later also gains
// Leader attribution the day the Person becomes a Leader (ReferralCode.code
// itself never changes; see schema.prisma's ReferralCode comment). Called
// eagerly at Member signup (every new Person gets one immediately) and used
// here as a fallback for any Person created before that was eager.
export async function getOrCreatePersonReferralCode(db: Db, personId: string, name: string) {
  const existing = await db.referralCode.findUnique({ where: { personId } });
  if (existing) return existing;
  const code = await generateUniqueReferralCode(name);
  try {
    return await db.referralCode.create({ data: { code, personId } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    // Lost a race with a concurrent request for this same Person — the
    // other one won, so just return what it created.
    return db.referralCode.findUniqueOrThrow({ where: { personId } });
  }
}
