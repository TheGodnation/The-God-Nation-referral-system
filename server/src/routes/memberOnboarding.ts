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

// The app was seen running as an installed app (opened from the home screen, or the browser says it was just
// installed). Recorded once; later calls change nothing.
router.post('/onboarding/installed', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  await prisma.memberOnboarding.upsert({ where: { personId }, create: { personId }, update: {} });
  await prisma.memberOnboarding.updateMany({ where: { personId, installedAt: null }, data: { installedAt: new Date() } });
  res.json({ ok: true });
}));

// The member says they have joined the welcome community. We cannot see this ourselves (the links open other apps), so it
// is their own word, recorded once and shown as "says they joined", never as confirmed membership.
router.post('/onboarding/community-joined', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  await prisma.memberOnboarding.upsert({ where: { personId }, create: { personId }, update: {} });
  await prisma.memberOnboarding.updateMany({ where: { personId, communityConfirmedAt: null }, data: { communityConfirmedAt: new Date() } });
  res.json({ ok: true });
}));

export default router;
