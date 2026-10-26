import { prisma } from './prisma';
import { getTrainingBooksFor } from './examWorld';
import { notifyBookPaymentDecision } from './notifications';
import { creditReferralEarning } from './referralEarnings';

export type BookPaymentDecision =
  | { ok: true; payment: NonNullable<Awaited<ReturnType<typeof prisma.bookPayment.findUnique>>>; status: 'CONFIRMED' | 'REJECTED' }
  | { ok: false; error: 'NOT_FOUND' | 'ALREADY_PAID' | 'ALREADY_DECIDED'; status?: string };

/**
 * Confirms or rejects a waiting book payment — the one place this happens,
 * whether the central admin decides it or a payment agent does. Confirming
 * opens the book (and the next ones in line), notifies the member and credits
 * the person who invited them (once). If the payment came through a payment
 * order, the order follows: confirmed, or back to "open" so the member can
 * correct the transaction ID.
 */
export async function decideBookPayment(opts: {
  paymentId: string;
  decision: 'CONFIRM' | 'REJECT';
  note?: string;
  byUserId?: string;
  byPersonId?: string;
}): Promise<BookPaymentDecision> {
  const confirmed = opts.decision === 'CONFIRM';
  const existing = await prisma.bookPayment.findUnique({ where: { id: opts.paymentId } });
  if (!existing) return { ok: false, error: 'NOT_FOUND' };
  if (confirmed && existing.personId && existing.bookId) {
    const already = await prisma.bookPayment.findFirst({ where: { personId: existing.personId, bookId: existing.bookId, status: 'CONFIRMED' } });
    if (already) return { ok: false, error: 'ALREADY_PAID' };
  }
  const changed = await prisma.bookPayment.updateMany({
    where: { id: existing.id, status: { in: ['CLAIMED', 'PENDING'] } },
    data: {
      status: confirmed ? 'CONFIRMED' : 'REJECTED',
      decidedAt: new Date(),
      decidedByUserId: opts.byUserId ?? null,
      decidedByPersonId: opts.byPersonId ?? null,
      note: opts.note || existing.note,
    },
  });
  if (changed.count === 0) return { ok: false, error: 'ALREADY_DECIDED', status: existing.status };

  await notifyBookPaymentDecision(existing, confirmed).catch(() => {});
  if (confirmed) await creditReferralEarning({ ...existing, status: 'CONFIRMED' });
  if (confirmed && existing.personId) {
    await getTrainingBooksFor(existing.personId); // records any book this opens
    await closeOrdersForBook(existing.personId, existing.bookId, existing.orderId);
  }
  if (existing.orderId) {
    await prisma.paymentOrder.updateMany({
      where: { id: existing.orderId, status: 'CLAIMED' },
      data: confirmed ? { status: 'CONFIRMED', decidedAt: new Date() } : { status: 'OPEN' },
    });
  }
  return { ok: true, payment: existing, status: confirmed ? 'CONFIRMED' : 'REJECTED' };
}

/** A book that is paid needs no other waiting orders: they end here (the settled order is marked CONFIRMED by its own decision). */
export async function closeOrdersForBook(personId: string, bookId: string | null, exceptOrderId?: string | null) {
  if (!bookId) return;
  await prisma.paymentOrder.updateMany({
    where: { buyerPersonId: personId, bookId, status: { in: ['OPEN', 'CLAIMED'] }, ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}) },
    data: { status: 'CANCELLED', decidedAt: new Date() },
  });
}

/** The member's training book, if it is open and still unpaid with no claim waiting. */
export async function openUnpaidBook(personId: string, bookId: string) {
  const books = await getTrainingBooksFor(personId);
  const book = books.find((b) => b.id === bookId);
  if (!book || !book.unlocked) return { error: 404 as const };
  if (book.payment === 'PAID') return { error: 'PAID' as const };
  if (book.payment === 'CLAIMED' || book.payment === 'PENDING') return { error: 'WAITING' as const };
  return { book };
}
