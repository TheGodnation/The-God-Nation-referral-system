import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { normalizeToE164 } from '../lib/phone';
import { selectApplicableReferralVisit } from '../lib/attribution';
import { registrationLimiter, whatsappRedirectLimiter } from '../lib/rateLimit';
import { requireCsrf } from '../lib/csrf';

const router = Router();

const DUPLICATE_MESSAGE = 'A registration with this WhatsApp number already exists.';

const registrationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  whatsapp: z.string().trim().min(1).max(32),
  language: z.enum(['en', 'fr']),
});

// POST /api/registrations
router.post('/', registrationLimiter, requireCsrf, async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please check your name and WhatsApp number.' });
  }
  const { name, whatsapp, language } = parsed.data;
  const visitorId = req.visitorId!;

  const normalizedWhatsApp = normalizeToE164(whatsapp);
  if (!normalizedWhatsApp) {
    return res.status(400).json({ error: 'Please enter a valid WhatsApp number, including country code.' });
  }

  // Determine referral attribution + marketing fields from the single
  // latest applicable ReferralVisit. No separate/older fallback.
  const selectedVisit = await selectApplicableReferralVisit(visitorId);

  try {
    const registration = await prisma.$transaction(async (tx) => {
      const created = await tx.registration.create({
        data: {
          visitorId,
          normalizedWhatsApp,
          name,
          language,
          utmSource: selectedVisit?.utmSource ?? null,
          utmMedium: selectedVisit?.utmMedium ?? null,
          utmCampaign: selectedVisit?.utmCampaign ?? null,
          landingPage: selectedVisit?.landingPage ?? null,
          isTestData: selectedVisit?.isTestData ?? false,
        },
      });

      if (selectedVisit?.referralCodeId) {
        await tx.referralRelationship.create({
          data: {
            leaderId: selectedVisit.referralCode!.leaderId,
            registrationId: created.id,
            referralCodeId: selectedVisit.referralCodeId,
          },
        });
      }

      await tx.event.create({
        data: {
          type: 'REGISTERED',
          registrationId: created.id,
          visitorId,
          isTestData: created.isTestData,
        },
      });

      return created;
    });

    return res.status(201).json({
      registrationId: registration.id,
      language: registration.language,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Unique constraint on normalizedWhatsApp — the database is the final
      // authority here. Exactly one concurrent request can ever win; the
      // loser lands here and gets the standard duplicate response, never a 500.
      console.warn('[registrations] duplicate WhatsApp registration attempt', {
        visitorId,
      });
      return res.status(409).json({ error: DUPLICATE_MESSAGE });
    }
    throw err;
  }
});

// GET /api/registrations/:id/whatsapp
// Server-controlled, secure WhatsApp redirect. See spec section 20.
router.get('/:id/whatsapp', whatsappRedirectLimiter, async (req, res) => {
  const { id } = req.params;
  const cookieVisitorId = req.visitorId;

  const registration = await prisma.registration.findUnique({ where: { id } });
  if (!registration) {
    return res.status(404).send('Registration not found.');
  }

  // A valid Registration ID is NEVER sufficient authorization by itself.
  if (!cookieVisitorId) {
    return res.status(403).send('Unauthorized: missing visitor session.');
  }
  if (registration.visitorId !== cookieVisitorId) {
    return res.status(403).send('Unauthorized: visitor session does not match this registration.');
  }

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  const url = registration.language === 'fr' ? settings?.whatsappUrlFr : settings?.whatsappUrlEn;

  if (!url) {
    return res.status(500).send('WhatsApp destination is not configured yet. Please contact an administrator.');
  }

  // Record the click BEFORE redirecting.
  await prisma.event.create({
    data: {
      type: 'WHATSAPP_CLICKED',
      registrationId: registration.id,
      visitorId: cookieVisitorId,
      isTestData: registration.isTestData,
    },
  });

  return res.redirect(302, url);
});

export default router;
