import crypto from 'crypto';
import { prisma } from './prisma';
import { getTrainingBooksFor } from './examWorld';
import { notifyBookPaymentDecision } from './notifications';
import { creditReferralEarning } from './referralEarnings';

export type BookPaymentDecision =
  | { ok: true; payment: NonNullable<Awaited<ReturnType<typeof prisma.bookPayment.findUnique>>>; status: 'CONFIRMED' | 'REJECTED'; count: number }
  | { ok: false; error: 'NOT_FOUND' | 'ALREADY_PAID' | 'ALREADY_DECIDED'; status?: string };

/**
 * Confirms or rejects a waiting book payment — the one place this happens,
 * whether the central admin decides it or a payment agent does. Confirming
 * opens the book (and the next ones in line), notifies the member and credits
 * the person who invited them (once per book). A payment for several books is
 * one batch: deciding any of its rows decides them all. If the payment came
 * through a payment order, the order follows: confirmed, or back to "open" so
 * the member can correct the transaction ID.
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
  if (existing.status !== 'CLAIMED' && existing.status !== 'PENDING') return { ok: false, error: 'ALREADY_DECIDED', status: existing.status };

  const waiting = existing.batchId
    ? await prisma.bookPayment.findMany({ where: { batchId: existing.batchId, status: { in: ['CLAIMED', 'PENDING'] } }, orderBy: { bookNumber: 'asc' } })
    : [existing];
  const single = waiting.length === 1;
  const decided: typeof waiting = [];
  for (const row of waiting) {
    // A book already paid another way is not paid twice: in a batch that row is simply dropped.
    const alreadyPaid =
      confirmed && row.personId && row.bookId
        ? await prisma.bookPayment.findFirst({ where: { personId: row.personId, bookId: row.bookId, status: 'CONFIRMED' } })
        : null;
    if (alreadyPaid) {
      if (single) return { ok: false, error: 'ALREADY_PAID' };
      await prisma.bookPayment.updateMany({
        where: { id: row.id, status: { in: ['CLAIMED', 'PENDING'] } },
        data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: opts.byUserId ?? null, decidedByPersonId: opts.byPersonId ?? null, note: 'This book was already paid.' },
      });
      continue;
    }
    const changed = await prisma.bookPayment.updateMany({
      where: { id: row.id, status: { in: ['CLAIMED', 'PENDING'] } },
      data: {
        status: confirmed ? 'CONFIRMED' : 'REJECTED',
        decidedAt: new Date(),
        decidedByUserId: opts.byUserId ?? null,
        decidedByPersonId: opts.byPersonId ?? null,
        note: opts.note || row.note,
      },
    });
    if (changed.count > 0) decided.push(row);
  }
  if (decided.length === 0) return { ok: false, error: single ? 'ALREADY_DECIDED' : 'ALREADY_PAID', status: existing.status };

  // One message to the member for the whole payment.
  await notifyBookPaymentDecision({ ...decided[0], amount: decided.reduce((sum, r) => sum + r.amount, 0) }, confirmed, decided.length).catch(() => {});
  if (confirmed) {
    for (const row of decided) await creditReferralEarning({ ...row, status: 'CONFIRMED' });
    if (existing.personId) {
      await getTrainingBooksFor(existing.personId); // records any book this opens
      await closeOrdersForBook(existing.personId, existing.bookId, existing.orderId);
    }
  }
  if (existing.orderId) {
    await prisma.paymentOrder.updateMany({
      where: { id: existing.orderId, status: 'CLAIMED' },
      data: confirmed ? { status: 'CONFIRMED', decidedAt: new Date() } : { status: 'OPEN' },
    });
  }
  return { ok: true, payment: existing, status: confirmed ? 'CONFIRMED' : 'REJECTED', count: decided.length };
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

/**
 * The training books this member could pay for now: every book not yet paid
 * and with no payment waiting, in book order — including books that are not
 * open yet (paying ahead). Nobody who has not begun the training can pay.
 */
export async function payableBooks(personId: string) {
  const enrollment = await prisma.trainingEnrollment.findUnique({ where: { personId }, select: { status: true } });
  if (enrollment?.status !== 'ACTIVE') return [];
  const books = await getTrainingBooksFor(personId);
  return books.filter((b) => b.payment === null).map((b) => ({ id: b.id, trainingOrder: b.trainingOrder, unlocked: b.unlocked }));
}

/** Claims payment for the next `count` payable books with one transaction ID: one row per book, sharing a batchId. */
export async function createClaimBatch(opts: {
  personId: string;
  count: number;
  amountEach: number;
  reference: string;
  payerPhone?: string | null;
  orderId?: string | null;
}) {
  const payable = await payableBooks(opts.personId);
  if (opts.count < 1 || payable.length < opts.count) return null;
  const chosen = payable.slice(0, opts.count);
  const batchId = opts.count > 1 ? crypto.randomUUID() : null;
  const rows = await prisma.$transaction(
    chosen.map((b) =>
      prisma.bookPayment.create({
        data: {
          personId: opts.personId,
          bookId: b.id,
          bookNumber: b.trainingOrder,
          amount: opts.amountEach,
          method: 'MANUAL',
          status: 'CLAIMED',
          reference: opts.reference,
          payerPhone: opts.payerPhone || null,
          orderId: opts.orderId ?? null,
          batchId,
        },
        select: { id: true, bookNumber: true },
      }),
    ),
  );
  return { rows, books: chosen };
}
