import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { socialMutationLimiter } from '../lib/rateLimit';
import { recordAudit } from '../lib/audit';
import { cancelPayout, commissionSettings, earningsSummary, requestPayout } from '../lib/referralEarnings';

// /api/member/earnings — what the signed-in member has earned from the books
// bought by people they invited, and asking to be paid out (see
// lib/referralEarnings.ts). A member only ever sees their own earnings, and
// only the first name of each buyer.
const router = Router();

router.get('/earnings', requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const now = new Date();
  const [settings, summary, earnings, payouts] = await Promise.all([
    commissionSettings(),
    earningsSummary(personId, now),
    prisma.referralEarning.findMany({
      where: { referrerPersonId: personId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { buyer: { select: { name: true } }, payout: { select: { status: true } } },
    }),
    prisma.referralPayout.findMany({ where: { personId }, orderBy: { requestedAt: 'desc' }, take: 20 }),
  ]);
  res.json({
    settings: { commission: settings.commission, holdDays: settings.holdDays, minimum: settings.minimum },
    summary,
    canRequestPayout: summary.available >= settings.minimum && !payouts.some((p) => p.status === 'REQUESTED'),
    items: earnings.map((e) => ({
      id: e.id,
      buyerFirstName: e.buyer?.name.split(/\s+/)[0] ?? null,
      bookNumber: e.bookNumber,
      amount: e.amount,
      createdAt: e.createdAt,
      availableAt: e.availableAt,
      // waiting → available → in a payout request → paid out (or taken back).
      state:
        e.status === 'REVERSED' ? 'REVERSED' : e.payout?.status === 'PAID' ? 'PAID' : e.payout?.status === 'REQUESTED' ? 'REQUESTED' : e.availableAt > now ? 'WAITING' : 'AVAILABLE',
    })),
    payouts: payouts.map((p) => ({ id: p.id, amount: p.amount, phone: p.phone, status: p.status, requestedAt: p.requestedAt, decidedAt: p.decidedAt, reference: p.reference })),
  });
}));

const payoutSchema = z.object({
  phone: z.string().trim().regex(/^\+?[0-9 ]{8,20}$/, 'Please enter a Mobile Money number.'),
  payeeName: z.string().trim().min(2, 'Please type the name on the account.').max(80),
});

router.post('/earnings/payout', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = payoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Check the details.', code: 'INVALID' });
  const personId = req.member!.personId;
  const result = await requestPayout(personId, parsed.data.phone.replace(/\s/g, ''), parsed.data.payeeName);
  if (!result.ok) {
    if (result.code === 'ALREADY_REQUESTED') return res.status(409).json({ error: 'You already have a payout request waiting.', code: result.code });
    if (result.code === 'BELOW_MINIMUM') return res.status(409).json({ error: `You can ask for a payout from ${result.minimum} FCFA.`, code: result.code, minimum: result.minimum, available: result.available });
    return res.status(409).json({ error: 'Something changed. Please try again.', code: result.code });
  }
  await recordAudit({ action: 'REFERRAL_PAYOUT_REQUESTED', targetType: 'ReferralPayout', targetId: result.payoutId, metadata: { personId, amount: result.amount } });
  res.status(201).json({ id: result.payoutId, amount: result.amount, status: 'REQUESTED' });
}));

router.delete('/earnings/payout/:id', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const ok = await cancelPayout(req.member!.personId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found.' });
  await recordAudit({ action: 'REFERRAL_PAYOUT_CANCELLED', targetType: 'ReferralPayout', targetId: req.params.id, metadata: { personId: req.member!.personId } });
  res.json({ ok: true });
}));

export default router;
