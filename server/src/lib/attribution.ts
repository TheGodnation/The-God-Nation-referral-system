import { prisma } from './prisma';
import { ATTRIBUTION_WINDOW_MS } from './env';

/**
 * Selects the single ReferralVisit that determines both permanent referral
 * attribution AND registration marketing fields, per spec section 11/14:
 *
 *   - Only visits carrying an active referral code are "applicable".
 *   - Only visits within the 30-day attribution window are considered.
 *   - The MOST RECENT applicable visit wins — no fallback to older visits.
 *
 * Returns null if there is no applicable visit (registration proceeds with
 * no Leader attribution and no marketing fields — this is not an error).
 */
export async function selectApplicableReferralVisit(visitorId: string) {
  const since = new Date(Date.now() - ATTRIBUTION_WINDOW_MS);

  const visit = await prisma.referralVisit.findFirst({
    where: {
      visitorId,
      timestamp: { gte: since },
      referralCodeId: { not: null },
    },
    orderBy: { timestamp: 'desc' },
    include: { referralCode: true },
  });

  return visit;
}
