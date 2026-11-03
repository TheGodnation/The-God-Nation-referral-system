import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { socialMutationLimiter } from '../lib/rateLimit';
import { currentConsent, recordConsent } from '../lib/contactConsent';

// /api/member/contact-consent — the member's own choices about being contacted
// by WhatsApp and email (shown on their Me page, changeable at any time), and
// /api/member/group-link-click — noting that they tapped "Join our WhatsApp
// group", so the growth report can count who joined.
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

router.post('/group-link-click', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const registration = await prisma.registration.findFirst({ where: { personId }, select: { id: true, isTestData: true } });
  await prisma.event.create({
    data: { type: 'GROUP_LINK_CLICKED', registrationId: registration?.id ?? null, visitorId: req.visitorId ?? null, isTestData: registration?.isTestData ?? false },
  });
  res.json({ ok: true });
}));

export default router;
