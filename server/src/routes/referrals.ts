import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { referralVisitLimiter } from '../lib/rateLimit';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

const visitSchema = z.object({
  ref: z.string().trim().min(1).max(64).optional(),
  lang: z.enum(['en', 'fr']).optional().default('en'),
  utmSource: z.string().trim().max(255).optional(),
  utmMedium: z.string().trim().max(255).optional(),
  utmCampaign: z.string().trim().max(255).optional(),
  utmContent: z.string().trim().max(255).optional(),
  // Click codes added by the ad platforms. Only plain code characters are kept.
  fbclid: z.string().trim().max(255).optional(),
  ttclid: z.string().trim().max(255).optional(),
  gclid: z.string().trim().max(255).optional(),
  // Where the visitor came from: only the website name is ever kept.
  referrer: z.string().trim().max(2048).optional(),
  landingPage: z.string().trim().max(2048).optional(),
});

const CLICK_ID = /^[A-Za-z0-9_.~\-]+$/;
const clean = (v: string | undefined) => (v && CLICK_ID.test(v) ? v : null);

/** The website name of the page the visitor came from, or null (own site, bad address, or none). */
export function referrerHostOf(referrer: string | undefined, ownHost: string | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return null;
    if (ownHost && host === ownHost.toLowerCase().replace(/^www\./, '').split(':')[0]) return null;
    return host.slice(0, 255);
  } catch {
    return null;
  }
}

// POST /api/referrals/visit
// Records a new ReferralVisit for the current opaque visitor_id. Every valid
// pre-registration referral click creates a NEW row — history is never
// mutated. An invalid/unknown/inactive code still records a visit, just
// without attribution (referralCodeId = null), rather than erroring.
router.post('/visit', referralVisitLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = visitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  const { ref, lang, utmSource, utmMedium, utmCampaign, utmContent, fbclid, ttclid, gclid, referrer, landingPage } = parsed.data;
  const visitorId = req.visitorId!;

  let referralCodeId: string | null = null;
  let isTestData = false;

  if (ref) {
    const code = await prisma.referralCode.findFirst({
      where: { code: ref, active: true },
    });
    if (code) {
      referralCodeId = code.id;
      isTestData = code.isTestData;
    }
  }

  const visit = await prisma.referralVisit.create({
    data: {
      visitorId,
      referralCodeId,
      language: lang,
      utmSource: utmSource || null,
      utmMedium: utmMedium || null,
      utmCampaign: utmCampaign || null,
      utmContent: utmContent || null,
      fbclid: clean(fbclid),
      ttclid: clean(ttclid),
      gclid: clean(gclid),
      referrerHost: referrerHostOf(referrer, req.hostname),
      landingPage: landingPage || null,
      isTestData,
    },
  });

  if (referralCodeId) {
    await prisma.event.create({
      data: { type: 'VISITED', visitorId, isTestData },
    });
  }

  res.status(201).json({ ok: true, attributed: Boolean(referralCodeId), visitId: visit.id });
}));

export default router;
