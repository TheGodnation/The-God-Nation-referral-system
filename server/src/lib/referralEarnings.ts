import { Prisma, type BookPayment } from '@prisma/client';
import { prisma } from './prisma';
import { recordAudit } from './audit';
import { isCentralAdminPerson } from './centralAdmin';
import { notifyReferralEarning } from './notifications';

// ---------------------------------------------------------------------------
// Referral earnings. When someone pays for a leadership book, the person who
// invited them (the other side of their REFERRAL friendship) earns the
// "referral commission" (500 FCFA by default). The money waits a few days
// (a refund or a mistake can still be caught), then counts toward the
// person's balance; from the minimum balance (5,000 FCFA by default) they can
// ask to be paid out, and the central admin sends the money and records it.
// Amounts, the waiting days and the minimum are Settings the admin can change.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export async function commissionSettings() {
  const s = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { referralCommission: true, commissionHoldDays: true, payoutMinimum: true, defaultReferrerPersonId: true },
  });
  return {
    commission: s?.referralCommission ?? 500,
    holdDays: s?.commissionHoldDays ?? 3,
    minimum: s?.payoutMinimum ?? 5000,
    catchAllPersonId: s?.defaultReferrerPersonId ?? null,
  };
}

/** Who invited this person (the requester of their REFERRAL friendship), or null. */
export async function referrerOf(personId: string): Promise<string | null> {
  const row = await prisma.friendship.findFirst({
    where: { addresseePersonId: personId, origin: 'REFERRAL', status: 'ACCEPTED' },
    orderBy: { createdAt: 'asc' },
    select: { requesterPersonId: true },
  });
  return row?.requesterPersonId ?? null;
}

/**
 * Credits the referrer for a book payment that has just been confirmed.
 * Safe to call more than once for the same payment (it is credited once), and
 * never throws into the payment flow. Nothing is credited for: a payment that
 * is not confirmed, a buyer nobody invited, the buyer themselves, the
 * ministry's own catch-all referrer (people who join without a link), or the
 * central admin's own profile — the ministry does not pay itself.
 */
export async function creditReferralEarning(payment: Pick<BookPayment, 'id' | 'personId' | 'bookNumber' | 'amount' | 'status'>) {
  try {
    if (payment.status !== 'CONFIRMED' || !payment.personId) return null;
    const settings = await commissionSettings();
    if (settings.commission <= 0) return null;
    const referrerId = await referrerOf(payment.personId);
    if (!referrerId || referrerId === payment.personId || referrerId === settings.catchAllPersonId) return null;
    if (await isCentralAdminPerson(referrerId)) return null;

    const amount = Math.min(settings.commission, payment.amount);
    if (amount <= 0) return null;
    const earning = await prisma.referralEarning.create({
      data: {
        referrerPersonId: referrerId,
        buyerPersonId: payment.personId,
        bookPaymentId: payment.id,
        bookNumber: payment.bookNumber,
        amount,
        availableAt: new Date(Date.now() + settings.holdDays * DAY_MS),
      },
    });
    await recordAudit({ action: 'REFERRAL_EARNING_CREDITED', targetType: 'ReferralEarning', targetId: earning.id, metadata: { referrerId, buyerId: payment.personId, amount } });
    await notifyReferralEarning(earning).catch(() => {});
    return earning;
  } catch (err) {
    // Already credited for this payment, or a hiccup: the payment itself must not fail because of it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      console.error('[earnings] could not credit', { paymentId: payment.id, error: err instanceof Error ? err.message : String(err) });
    }
    return null;
  }
}

/** Takes back an earning (a refunded or mistaken payment) as long as it has not been paid out. */
export async function reverseReferralEarning(earningId: string): Promise<'REVERSED' | 'NOT_FOUND' | 'PAID_OUT' | 'ALREADY'> {
  const found = await prisma.referralEarning.findUnique({ where: { id: earningId }, include: { payout: { select: { status: true } } } });
  if (!found) return 'NOT_FOUND';
  if (found.status === 'REVERSED') return 'ALREADY';
  if (found.payout && (found.payout.status === 'PAID' || found.payout.status === 'REQUESTED')) return 'PAID_OUT';
  await prisma.referralEarning.update({ where: { id: found.id }, data: { status: 'REVERSED', reversedAt: new Date(), payoutId: null } });
  return 'REVERSED';
}

export interface EarningsSummary {
  waiting: number;
  available: number;
  paidOut: number;
  inRequest: number;
  total: number;
}

/** A person's balances, in FCFA. */
export async function earningsSummary(personId: string, now = new Date()): Promise<EarningsSummary> {
  const rows = await prisma.referralEarning.findMany({
    where: { referrerPersonId: personId, status: 'ACTIVE' },
    select: { amount: true, availableAt: true, payout: { select: { status: true } } },
  });
  const s: EarningsSummary = { waiting: 0, available: 0, paidOut: 0, inRequest: 0, total: 0 };
  for (const r of rows) {
    s.total += r.amount;
    if (r.payout?.status === 'PAID') s.paidOut += r.amount;
    else if (r.payout?.status === 'REQUESTED') s.inRequest += r.amount;
    else if (r.availableAt > now) s.waiting += r.amount;
    else s.available += r.amount;
  }
  return s;
}

export type PayoutRequestResult =
  | { ok: true; payoutId: string; amount: number }
  | { ok: false; code: 'BELOW_MINIMUM' | 'ALREADY_REQUESTED' | 'BUSY'; minimum?: number; available?: number };

/** Asks to be paid everything that is available (needs the minimum balance, one request at a time). */
export async function requestPayout(personId: string, phone: string, payeeName: string): Promise<PayoutRequestResult> {
  const { minimum } = await commissionSettings();
  try {
    return await prisma.$transaction(async (tx) => {
      const open = await tx.referralPayout.findFirst({ where: { personId, status: 'REQUESTED' }, select: { id: true } });
      if (open) return { ok: false as const, code: 'ALREADY_REQUESTED' as const };
      const ready = await tx.referralEarning.findMany({
        where: { referrerPersonId: personId, status: 'ACTIVE', payoutId: null, availableAt: { lte: new Date() } },
        select: { id: true, amount: true },
      });
      const amount = ready.reduce((sum, e) => sum + e.amount, 0);
      if (amount < minimum) return { ok: false as const, code: 'BELOW_MINIMUM' as const, minimum, available: amount };
      const payout = await tx.referralPayout.create({ data: { personId, amount, phone, payeeName } });
      const taken = await tx.referralEarning.updateMany({
        where: { id: { in: ready.map((e) => e.id) }, payoutId: null, status: 'ACTIVE' },
        data: { payoutId: payout.id },
      });
      // Something changed under us (two requests at once): undo and let them try again.
      if (taken.count !== ready.length) throw new Error('PAYOUT_RACE');
      return { ok: true as const, payoutId: payout.id, amount };
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYOUT_RACE') return { ok: false, code: 'BUSY' };
    throw err;
  }
}

/** The member withdraws their own request: the earnings go back to their balance. */
export async function cancelPayout(personId: string, payoutId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.referralPayout.updateMany({
      where: { id: payoutId, personId, status: 'REQUESTED' },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    if (changed.count === 0) return false;
    await tx.referralEarning.updateMany({ where: { payoutId }, data: { payoutId: null } });
    return true;
  });
}
