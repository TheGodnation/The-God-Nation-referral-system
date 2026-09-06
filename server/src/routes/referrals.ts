import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { referralVisitLimiter } from '../lib/rateLimit';
import { requireCsrf } from '../lib/csrf';

const router = Router();

const visitSchema = z.object({
  ref: z.string().trim().min(1).max(64).optional(),
  lang: z.enum(['en', 'fr']).optional().default('en'),
  utmSource: z.string().trim().max(255).optional(),
  utmMedium: z.string().trim().max(255).optional(),
  utmCampaign: z.string().trim().max(255).optional(),
  landingPage: z.string().trim().max(2048).optional(),
});

// POST /api/referrals/visit
// Records a new ReferralVisit for the current opaque visitor_id. Every valid
// pre-registration referral click creates a NEW row — history is never
// mutated. An invalid/unknown/inactive code still records a visit, just
// without attribution (referralCodeId = null), rather than erroring.
router.post('/visit', referralVisitLimiter, requireCsrf, async (req, res) => {
  const parsed = visitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  const { ref, lang, utmSource, utmMedium, utmCampaign, landingPage } = parsed.data;
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
});

export default router;
