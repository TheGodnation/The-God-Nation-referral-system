import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { leadLimiter } from '../lib/rateLimit';
import { normalizeToE164 } from '../lib/phone';
import { selectApplicableReferralVisit } from '../lib/attribution';
import { recordConsent } from '../lib/contactConsent';

// POST /api/leads — the "stay connected" box on the public pages: a name and a
// WhatsApp number from someone who is not ready to make an account, and their
// agreement to receive the ministry's updates on WhatsApp. Without that
// agreement nothing is kept. The reply is the same whether the number is new,
// already a lead, or already a member, so it never says who is known.
const router = Router();

const leadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  whatsapp: z.string().trim().min(1).max(32),
  language: z.enum(['en', 'fr']).default('en'),
  consentWhatsapp: z.boolean(),
});

router.post('/', leadLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please enter your name and a valid phone number.', code: 'INVALID_INPUT' });
  }
  const d = parsed.data;
  if (d.consentWhatsapp !== true) {
    return res.status(400).json({ error: 'Please tick the box to agree to receive updates on WhatsApp.', code: 'CONSENT_REQUIRED' });
  }
  const whatsappNumber = normalizeToE164(d.whatsapp);
  if (!whatsappNumber) {
    return res.status(400).json({ error: 'Please enter a valid phone number, including the country code.', code: 'INVALID_PHONE' });
  }

  const ok = { ok: true };
  // Already a member: nothing to add, and no hint about it.
  if (await prisma.person.findUnique({ where: { whatsappNumber }, select: { id: true } })) return res.json(ok);

  const existing = await prisma.lead.findUnique({ where: { whatsappNumber }, select: { id: true } });
  if (existing) {
    await recordConsent(prisma, { leadId: existing.id }, 'WHATSAPP', true, 'stay-connected', d.language);
    return res.json(ok);
  }

  const visitorId = req.visitorId!;
  const visit = await selectApplicableReferralVisit(visitorId);
  try {
    const lead = await prisma.lead.create({
      data: {
        name: d.name,
        whatsappNumber,
        language: d.language,
        visitorId,
        referralCodeId: visit?.referralCodeId ?? null,
        utmSource: visit?.utmSource ?? null,
        utmMedium: visit?.utmMedium ?? null,
        utmCampaign: visit?.utmCampaign ?? null,
        utmContent: visit?.utmContent ?? null,
        fbclid: visit?.fbclid ?? null,
        ttclid: visit?.ttclid ?? null,
        gclid: visit?.gclid ?? null,
        referrerHost: visit?.referrerHost ?? null,
        landingPage: visit?.landingPage ?? null,
        isTestData: visit?.isTestData ?? false,
      },
    });
    await recordConsent(prisma, { leadId: lead.id }, 'WHATSAPP', true, 'stay-connected', d.language);
  } catch (err) {
    // Two taps at once for the same number: the other one wins; same reply.
    if (!(typeof err === 'object' && err && (err as { code?: string }).code === 'P2002')) throw err;
  }
  res.json(ok);
}));

export default router;
