import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// King's Token — spending Earned tokens toward a book (Phase 5c).
//
// Off until the central admin announces it (Settings.tokenSpendEnabled). A
// member can pay up to 30% of a book's price with Earned tokens; the central
// admin sets how many francs one token takes off (1 by default). The rest of
// the price is paid as before. The tokens move in three steps, all written in
// the permanent ledger:
//   HOLD     when the member says "I have paid": the tokens leave their balance
//   SETTLE   when the payment is confirmed: half go to the foundation treasury,
//            half are burned for good
//   RELEASE  when the payment is rejected or ends: the tokens go back
// ---------------------------------------------------------------------------

export class TokenSpendError extends Error {
  constructor(public code: 'INSUFFICIENT' | 'UNAVAILABLE', message: string) {
    super(message);
  }
}

export interface SpendSettings {
  enabled: boolean;
  /** Francs one token takes off a price. */
  valueFcfa: number;
  /** The most of a price tokens can pay, in percent. */
  maxPercent: number;
}

export async function spendSettings(): Promise<SpendSettings> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { tokenSpendEnabled: true, tokenValueFcfa: true, tokenSpendMaxPercent: true } });
  return { enabled: s?.tokenSpendEnabled ?? false, valueFcfa: s ? s.tokenValueFcfa.toNumber() : 1, maxPercent: s?.tokenSpendMaxPercent ?? 30 };
}

/** Whole tokens that can pay toward one book of this price. */
export function perBookCap(price: number, settings: Pick<SpendSettings, 'valueFcfa' | 'maxPercent'>): number {
  if (settings.valueFcfa <= 0) return 0;
  return Math.floor((price * settings.maxPercent) / 100 / settings.valueFcfa);
}

/** Francs that `tokens` take off a price (whole francs, never more than the tokens are worth). */
export function francsFor(tokens: number, valueFcfa: number): number {
  return Math.floor(tokens * valueFcfa);
}

/** Splits `total` tokens over `count` books, filling each up to `cap`. */
export function allocateTokens(total: number, count: number, cap: number): number[] {
  const split: number[] = [];
  let left = total;
  for (let i = 0; i < count; i += 1) {
    const t = Math.max(0, Math.min(cap, left));
    split.push(t);
    left -= t;
  }
  return split;
}

export interface SpendQuote extends SpendSettings {
  price: number;
  count: number;
  /** Whole Earned tokens the member holds. */
  balance: number;
  perBookCap: number;
  /** The most they can use on this payment. */
  maxTokens: number;
  maxFrancs: number;
  split: number[];
}

async function earnedBalance(personId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  const sum = await db.tokenEntry.aggregate({ where: { personId, kind: 'EARNED' }, _sum: { amount: true } });
  return sum._sum.amount ? sum._sum.amount.toNumber() : 0;
}

/** What a member could use toward `count` books of `price` each, right now. */
export async function spendQuote(personId: string, price: number, count: number): Promise<SpendQuote> {
  await reconcileHolds(personId);
  const settings = await spendSettings();
  const balance = Math.floor(await earnedBalance(personId));
  const cap = settings.enabled ? perBookCap(price, settings) : 0;
  const maxTokens = settings.enabled ? Math.min(balance, cap * count) : 0;
  const split = allocateTokens(maxTokens, count, cap);
  return { ...settings, price, count, balance, perBookCap: cap, maxTokens, maxFrancs: split.reduce((n, t) => n + francsFor(t, settings.valueFcfa), 0), split };
}

/** Takes the tokens out of the member's balance, in the same transaction as the payment claim. */
export async function holdTokens(tx: Prisma.TransactionClient, personId: string, bookPaymentId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  // One spender at a time per member, so two claims cannot spend the same tokens.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${personId}))`;
  if ((await earnedBalance(personId, tx)) < tokens) throw new TokenSpendError('INSUFFICIENT', 'You no longer have enough tokens for this.');
  await tx.tokenEntry.create({ data: { personId, kind: 'EARNED', reason: 'SPEND_HOLD', amount: new Prisma.Decimal(-tokens), bookPaymentId } });
}

async function findHold(bookPaymentId: string) {
  return prisma.tokenEntry.findUnique({ where: { bookPaymentId_reason: { bookPaymentId, reason: 'SPEND_HOLD' } } });
}

/** The payment was confirmed: half the tokens go to the foundation treasury, half are burned. Safe to repeat. */
export async function settleHold(bookPaymentId: string): Promise<void> {
  const hold = await findHold(bookPaymentId);
  if (!hold) return;
  const tokens = hold.amount.neg();
  const half = tokens.div(2);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookPaymentId}))`;
    const done = await tx.tokenEntry.count({ where: { bookPaymentId, reason: { in: ['TREASURY_SHARE', 'SPEND_RELEASE'] } } });
    if (done > 0) return;
    await tx.tokenEntry.create({ data: { personId: null, kind: 'EARNED', reason: 'TREASURY_SHARE', amount: half, bookPaymentId } });
    await tx.tokenEntry.create({ data: { personId: null, kind: 'BURNED', reason: 'SPEND_BURN', amount: half, bookPaymentId } });
  });
}

/** The payment was rejected or ended: the tokens go back to the member. Safe to repeat. */
export async function releaseHold(bookPaymentId: string): Promise<void> {
  const hold = await findHold(bookPaymentId);
  if (!hold || !hold.personId) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookPaymentId}))`;
    const done = await tx.tokenEntry.count({ where: { bookPaymentId, reason: { in: ['TREASURY_SHARE', 'SPEND_RELEASE'] } } });
    if (done > 0) return;
    await tx.tokenEntry.create({ data: { personId: hold.personId, kind: 'EARNED', reason: 'SPEND_RELEASE', amount: hold.amount.neg(), bookPaymentId } });
  });
}

/**
 * Safety net: any hold of this member that was never settled or released is
 * settled when its payment was confirmed, and released when the payment was
 * rejected, failed, or no longer exists.
 */
export async function reconcileHolds(personId: string): Promise<void> {
  const holds = await prisma.tokenEntry.findMany({ where: { personId, reason: 'SPEND_HOLD' }, select: { bookPaymentId: true } });
  const ids = holds.map((h) => h.bookPaymentId).filter((x): x is string => Boolean(x));
  if (ids.length === 0) return;
  const finished = await prisma.tokenEntry.findMany({ where: { bookPaymentId: { in: ids }, reason: { in: ['TREASURY_SHARE', 'SPEND_RELEASE'] } }, select: { bookPaymentId: true } });
  const done = new Set(finished.map((f) => f.bookPaymentId));
  const open = ids.filter((id) => !done.has(id));
  if (open.length === 0) return;
  const payments = await prisma.bookPayment.findMany({ where: { id: { in: open } }, select: { id: true, status: true } });
  const status = new Map(payments.map((p) => [p.id, p.status]));
  for (const id of open) {
    const s = status.get(id);
    if (s === 'CONFIRMED') await settleHold(id);
    else if (!s || s === 'REJECTED' || s === 'FAILED') await releaseHold(id);
  }
}
