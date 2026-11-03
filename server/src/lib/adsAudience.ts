import { prisma } from './prisma';
import { hashEmail, hashPhoneDigits, hashPhoneE164 } from './adsEvents';

// Member lists for ad platforms' "customer list" tools (Meta custom audiences,
// TikTok customer files, Google Customer Match), used to show The God Nation's
// ads to people who joined and to people like them, or to win back quiet members.
//
// Only people whose LATEST choice is "yes" to the ads consent are included.
// Only scrambled (SHA-256 hashed) values are produced; the real email and phone
// number never leave in the file.

const DAY = 24 * 60 * 60 * 1000;

export type AudienceKind = 'members' | 'quiet';

export interface AudienceRow {
  personId: string;
  email: string | null;
  phone: string | null;
}

/** People whose most recent ADS consent row is a "yes", not deleted or test data. */
async function consentedPersonIds(): Promise<string[]> {
  const latest = await prisma.contactConsent.findMany({
    where: { channel: 'ADS', personId: { not: null } },
    orderBy: { createdAt: 'desc' },
    distinct: ['personId'],
    select: { personId: true, granted: true },
  });
  return latest.filter((r) => r.granted && r.personId).map((r) => r.personId!);
}

export async function audienceRows(kind: AudienceKind, quietDays: number, now = new Date()): Promise<AudienceRow[]> {
  const ids = await consentedPersonIds();
  if (ids.length === 0) return [];
  const quietBefore = new Date(now.getTime() - quietDays * DAY);
  const people = await prisma.person.findMany({
    where: {
      id: { in: ids },
      erasedAt: null,
      deletionRequestedAt: null,
      isTestData: false,
      ...(kind === 'quiet'
        ? { profileCompletedAt: { not: null }, OR: [{ lastSeenAt: { lt: quietBefore } }, { lastSeenAt: null, profileCompletedAt: { lt: quietBefore } }] }
        : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, whatsappNumber: true },
  });
  return people.map((p) => ({ personId: p.id, email: p.email, phone: p.whatsappNumber }));
}

export const AUDIENCE_HEADER = ['email_sha256', 'phone_sha256_digits_only', 'phone_sha256_with_plus'];

/** One row per person; a missing email or phone is left empty. Hex hashes cannot be read as formulas. */
export function audienceCsv(rows: AudienceRow[]): string {
  const lines = rows.map((r) => [r.email ? hashEmail(r.email) : '', r.phone ? hashPhoneDigits(r.phone) : '', r.phone ? hashPhoneE164(r.phone) : ''].join(','));
  return [AUDIENCE_HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}
