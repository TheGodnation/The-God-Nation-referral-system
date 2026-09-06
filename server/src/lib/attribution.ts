import { prisma } from './prisma';
import { ATTRIBUTION_WINDOW_MS } from './env';

/**
 * Selects the single ReferralVisit that determines both Leader attribution
 * AND registration marketing fields, per spec section 11/14 as corrected:
 *
 * STEP 1 — primary (referral-qualified) selection:
 *   The latest visit carrying an active referral code, within the 30-day
 *   attribution window. If one exists, it alone determines BOTH the Leader
 *   attribution and the marketing fields — there is no fallback to another
 *   visit once a referral-qualified visit has been selected, so a later
 *   non-referral (organic/campaign) visit can never overwrite it.
 *
 * STEP 2 — conditional fallback (organic/non-referral):
 *   Only when STEP 1 finds no referral-qualified visit at all does this
 *   look for the latest visit of ANY kind (including referralCodeId IS
 *   NULL) within the same window, so a purely organic registration still
 *   retains its own UTM/landing-page marketing fields. This path never
 *   implies Leader attribution — callers must only attribute a Leader when
 *   the returned visit's referralCodeId is present.
 *
 * Returns null if there is no visit at all within the window (registration
 * proceeds with no Leader attribution and no marketing fields — this is
 * not an error).
 */
export async function selectApplicableReferralVisit(visitorId: string) {
  const since = new Date(Date.now() - ATTRIBUTION_WINDOW_MS);

  const primaryReferralVisit = await prisma.referralVisit.findFirst({
    where: {
      visitorId,
      timestamp: { gte: since },
      referralCodeId: { not: null },
    },
    orderBy: { timestamp: 'desc' },
    include: { referralCode: true },
  });

  if (primaryReferralVisit) {
    return primaryReferralVisit;
  }

  // No referral-qualified visit exists in the window at all, so this can
  // only surface an organic (referralCodeId IS NULL) visit — never one
  // that STEP 1 would have already selected.
  const fallbackVisit = await prisma.referralVisit.findFirst({
    where: {
      visitorId,
      timestamp: { gte: since },
    },
    orderBy: { timestamp: 'desc' },
    include: { referralCode: true },
  });

  return fallbackVisit;
}
