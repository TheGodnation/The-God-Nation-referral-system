import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { recordAudit } from '../lib/audit';
import { notifyReferralPayout } from '../lib/notifications';
import { commissionSettings, reverseReferralEarning } from '../lib/referralEarnings';

// Central admin: referral payouts and earnings (see lib/referralEarnings.ts).
// The admin sends the money by Mobile Money and records it here; rejecting a
// request puts the earnings back in the person's balance.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get('/payouts', asyncHandler(async (req, res) => {
  const status = z.enum(['REQUESTED', 'PAID', 'REJECTED', 'CANCELLED']).safeParse(req.query.status);
  const items = await prisma.referralPayout.findMany({
    where: { status: status.success ? status.data : 'REQUESTED' },
    orderBy: { requestedAt: status.success && status.data !== 'REQUESTED' ? 'desc' : 'asc' },
    take: 100,
    include: { person: { select: { id: true, name: true, whatsappNumber: true } }, _count: { select: { earnings: true } } },
  });
  res.json({ items });
}));

const decisionSchema = z.object({ reference: z.string().trim().max(80).optional(), note: z.string().trim().max(300).optional() });

router.patch('/payouts/:id/paid', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const changed = await prisma.referralPayout.updateMany({
    where: { id: req.params.id, status: 'REQUESTED' },
    data: { status: 'PAID', decidedAt: new Date(), decidedByUserId: req.user!.id, reference: parsed.data.reference || null, note: parsed.data.note || null },
  });
  if (changed.count === 0) return res.status(409).json({ error: 'This request was already decided, or does not exist.' });
  const payout = await prisma.referralPayout.findUniqueOrThrow({ where: { id: req.params.id } });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'REFERRAL_PAYOUT_PAID', targetType: 'ReferralPayout', targetId: payout.id, metadata: { personId: payout.personId, amount: payout.amount, reference: payout.reference } });
  await notifyReferralPayout(payout, true).catch(() => {});
  res.json(payout);
}));

router.patch('/payouts/:id/reject', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const payout = await prisma.$transaction(async (tx) => {
    const changed = await tx.referralPayout.updateMany({
      where: { id: req.params.id, status: 'REQUESTED' },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: req.user!.id, note: parsed.data.note || null },
    });
    if (changed.count === 0) return null;
    await tx.referralEarning.updateMany({ where: { payoutId: req.params.id }, data: { payoutId: null } });
    return tx.referralPayout.findUniqueOrThrow({ where: { id: req.params.id } });
  });
  if (!payout) return res.status(409).json({ error: 'This request was already decided, or does not exist.' });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'REFERRAL_PAYOUT_REJECTED', targetType: 'ReferralPayout', targetId: payout.id, metadata: { personId: payout.personId, amount: payout.amount } });
  await notifyReferralPayout(payout, false).catch(() => {});
  res.json(payout);
}));

// Money owed to referrers and the latest earnings.
router.get('/referral-earnings', asyncHandler(async (_req, res) => {
  const now = new Date();
  const [rows, latest] = await Promise.all([
    prisma.referralEarning.findMany({ where: { status: 'ACTIVE' }, select: { amount: true, availableAt: true, payout: { select: { status: true } } } }),
    prisma.referralEarning.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { referrer: { select: { id: true, name: true } }, buyer: { select: { id: true, name: true } }, payout: { select: { status: true } } },
    }),
  ]);
  const totals = { waiting: 0, available: 0, inRequest: 0, paidOut: 0 };
  for (const r of rows) {
    if (r.payout?.status === 'PAID') totals.paidOut += r.amount;
    else if (r.payout?.status === 'REQUESTED') totals.inRequest += r.amount;
    else if (r.availableAt > now) totals.waiting += r.amount;
    else totals.available += r.amount;
  }
  res.json({ totals, items: latest });
}));

router.post('/referral-earnings/:id/reverse', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const result = await reverseReferralEarning(req.params.id);
  if (result === 'NOT_FOUND') return res.status(404).json({ error: 'Not found.' });
  if (result === 'PAID_OUT') return res.status(409).json({ error: 'This earning is already in a payout request or paid out. Reject the request first.', code: 'PAID_OUT' });
  if (result === 'ALREADY') return res.status(409).json({ error: 'Already taken back.' });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'REFERRAL_EARNING_REVERSED', targetType: 'ReferralEarning', targetId: req.params.id });
  res.json({ ok: true });
}));

const settingsSchema = z.object({
  referralCommission: z.number().int().min(0).max(100000),
  commissionHoldDays: z.number().int().min(0).max(60),
  payoutMinimum: z.number().int().min(100).max(1000000),
});

router.get('/referral-earnings/settings', asyncHandler(async (_req, res) => {
  const s = await commissionSettings();
  res.json({ referralCommission: s.commission, commissionHoldDays: s.holdDays, payoutMinimum: s.minimum });
}));

router.patch('/referral-earnings/settings', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the amounts: whole numbers only.' });
  await prisma.settings.upsert({ where: { id: 'singleton' }, update: parsed.data, create: { id: 'singleton', ...parsed.data } });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'REFERRAL_SETTINGS_UPDATED', targetType: 'Settings', targetId: 'singleton', metadata: parsed.data });
  res.json(parsed.data);
}));

export default router;
