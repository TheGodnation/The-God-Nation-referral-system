import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { normalizeToE164 } from '../lib/phone';
import { selectApplicableReferralVisit } from '../lib/attribution';
import { registrationLimiter, whatsappRedirectLimiter } from '../lib/rateLimit';
import { requireCsrf } from '../lib/csrf';
import { EmailService } from '../lib/email';
import { APP_URL } from '../lib/env';
import { VISITOR_COOKIE_NAME } from '../lib/visitor';

const router = Router();

// Section 20: shown by the client only after an actual duplicate attempt —
// never pre-emptively. Never weakens the underlying DB uniqueness rule.
const DUPLICATE_MESSAGE =
  'This WhatsApp number may have already been used to register. If you entered the wrong number, please correct it and try again. If you have not yet been added to the WhatsApp group, please contact us so that we can assist you and add you manually.';

const registrationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  whatsapp: z.string().trim().min(1).max(32),
  language: z.enum(['en', 'fr']),
  pathway: z.enum(['TRAINING', 'DISCOVER_GROW']),
  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

// POST /api/registrations
router.post('/', registrationLimiter, requireCsrf, async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please check your name and WhatsApp number.' });
  }
  const { name, whatsapp, language, pathway, email } = parsed.data;
  const visitorId = req.visitorId!;

  const normalizedWhatsApp = normalizeToE164(whatsapp);
  if (!normalizedWhatsApp) {
    return res.status(400).json({ error: 'Please enter a valid WhatsApp number, including country code.' });
  }

  // Determine referral attribution + marketing fields from a single
  // selected ReferralVisit (see lib/attribution.ts for the two-step
  // primary-referral / conditional-organic-fallback selection). Whichever
  // visit is returned here supplies BOTH the Leader attribution (only if
  // referralCodeId is present) and the marketing fields — never a mix of
  // two different visits, and never an older fallback once a referral-
  // qualified visit has been selected.
  const selectedVisit = await selectApplicableReferralVisit(visitorId);

  try {
    const registration = await prisma.$transaction(async (tx) => {
      const created = await tx.registration.create({
        data: {
          visitorId,
          normalizedWhatsApp,
          name,
          email: email ?? null,
          language,
          pathway,
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

    // Section 36: optional confirmation email — fire after the registration
    // has already committed. A delivery failure must never roll back the
    // registration or be surfaced to the visitor as an error.
    let confirmationEmailSent = false;
    if (email) {
      try {
        const link = `${APP_URL}/api/registrations/${registration.id}/whatsapp`;
        const result = await EmailService.sendRegistrationConfirmation({ to: email, name, language, link });
        confirmationEmailSent = result.ok;
      } catch (emailErr) {
        console.error('[registrations] confirmation email failed', {
          registrationId: registration.id,
          error: emailErr instanceof Error ? emailErr.message : String(emailErr),
        });
      }
    }

    return res.status(201).json({
      registrationId: registration.id,
      language: registration.language,
      pathway: registration.pathway,
      confirmationEmailSent,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Unique constraint on normalizedWhatsApp — the database is the final
      // authority here. Exactly one concurrent request can ever win; the
      // loser lands here and gets the standard duplicate response, never a 500.
      console.warn('[registrations] duplicate WhatsApp registration attempt', {
        visitorId,
      });
      // `error` stays the English text for back-compat with anything reading
      // it directly (e.g. existing tests); `code` lets the client render its
      // own localized copy instead, since this message is user-facing and
      // the server doesn't know the visitor's chosen UI language.
      return res.status(409).json({ error: DUPLICATE_MESSAGE, code: 'DUPLICATE_WHATSAPP' });
    }
    throw err;
  }
});

// GET /api/registrations/:id/whatsapp
// Server-controlled, secure WhatsApp redirect. See spec section 20.
router.get('/:id/whatsapp', whatsappRedirectLimiter, async (req, res) => {
  const { id } = req.params;
  // ensureVisitorId always populates req.visitorId — minting a fresh one
  // when the request carried none — so it can't distinguish "no cookie"
  // from "a cookie that happens to mismatch". The raw incoming cookie can.
  const incomingCookie = req.cookies?.[VISITOR_COOKIE_NAME];

  const registration = await prisma.registration.findUnique({ where: { id } });
  if (!registration) {
    return res.status(404).send('Registration not found.');
  }

  // A visitor cookie that was actually sent, but doesn't match this
  // registration, is always rejected — browsing as a different visitor must
  // never trigger someone else's click event or redirect. No cookie at all
  // is allowed: this is also the link embedded in registration-confirmation
  // and WhatsApp-reminder emails, which may be opened from a different
  // device, browser, or app than the one used to register, none of which
  // will carry the original visitor cookie.
  if (incomingCookie && registration.visitorId !== req.visitorId) {
    return res.status(403).send('Unauthorized: visitor session does not match this registration.');
  }

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });

  // Section 18/21: four server-controlled destinations, chosen strictly
  // from Registration.pathway + Registration.language — never client input.
  const isFr = registration.language === 'fr';
  const url =
    registration.pathway === 'DISCOVER_GROW'
      ? isFr
        ? settings?.whatsappUrlDiscoverFr
        : settings?.whatsappUrlDiscoverEn
      : isFr
        ? settings?.whatsappUrlFr
        : settings?.whatsappUrlEn;

  if (!url) {
    return res.status(500).send('WhatsApp destination is not configured yet. Please contact an administrator.');
  }

  // Record the click BEFORE redirecting.
  await prisma.event.create({
    data: {
      type: 'WHATSAPP_CLICKED',
      registrationId: registration.id,
      visitorId: req.visitorId,
      isTestData: registration.isTestData,
    },
  });

  return res.redirect(302, url);
});

export default router;
