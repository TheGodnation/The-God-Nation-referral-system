import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { socialMutationLimiter } from '../lib/rateLimit';
import { currentConsent, recordConsent } from '../lib/contactConsent';
import { ALL_PLATFORMS } from '../lib/communityPlatforms';

// /api/member/contact-consent — the member's own choices about being contacted
// by WhatsApp and email (shown on their Me page, changeable at any time), and
// /api/member/group-link-click — noting which group, channel or page they
// tapped (WhatsApp, Telegram, Messenger...), so the growth report can count it.
const router = Router();
router.use(requireMember);

router.get('/contact-consent', asyncHandler(async (req, res) => {
  res.json(await currentConsent(prisma, req.member!.personId));
}));

const putSchema = z.object({ whatsapp: z.boolean().optional(), email: z.boolean().optional() });

router.put('/contact-consent', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const personId = req.member!.personId;
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  const lang = person?.preferredLanguage === 'fr' ? 'fr' : 'en';
  const now = await currentConsent(prisma, personId);
  if (parsed.data.whatsapp !== undefined && parsed.data.whatsapp !== now.whatsapp) {
    await recordConsent(prisma, { personId }, 'WHATSAPP', parsed.data.whatsapp, 'profile', lang);
  }
  if (parsed.data.email !== undefined && parsed.data.email !== now.email) {
    await recordConsent(prisma, { personId }, 'EMAIL', parsed.data.email, 'profile', lang);
  }
  res.json(await currentConsent(prisma, personId));
}));

const clickSchema = z.object({ platform: z.enum(ALL_PLATFORMS).optional() });

router.post('/group-link-click', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = clickSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Unknown place.' });
  const personId = req.member!.personId;
  const registration = await prisma.registration.findFirst({ where: { personId }, select: { id: true, isTestData: true } });
  await prisma.event.create({
    data: {
      type: 'GROUP_LINK_CLICKED',
      detail: parsed.data.platform ?? null,
      registrationId: registration?.id ?? null,
      visitorId: req.visitorId ?? null,
      isTestData: registration?.isTestData ?? false,
    },
  });
  res.json({ ok: true });
}));

export default router;
