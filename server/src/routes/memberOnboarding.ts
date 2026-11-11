import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { socialMutationLimiter } from '../lib/rateLimit';
import { onboardingStatus } from '../lib/memberOnboarding';

// /api/member/onboarding — the "Get started" checklist: what the member has done so far, and closing the card.
const router = Router();
router.use(requireMember);

router.get('/onboarding', asyncHandler(async (req, res) => {
  res.json(await onboardingStatus(req.member!.personId));
}));

router.post('/onboarding/dismiss', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  await prisma.memberOnboarding.upsert({
    where: { personId },
    create: { personId, dismissedAt: new Date() },
    update: { dismissedAt: new Date() },
  });
  res.json({ ok: true });
}));

export default router;
