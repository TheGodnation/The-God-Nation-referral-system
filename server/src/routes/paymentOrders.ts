import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { attachmentDownloadLimiter, attachmentUploadAuthorizeLimiter, messageSendLimiter, socialMutationLimiter } from '../lib/rateLimit';
import { recordAudit } from '../lib/audit';
import { isOnline } from '../lib/presence';
import { profilePhotoPath } from '../lib/profilePhoto';
import { createDownloadUrl, createUploadUrl, headObject, isStorageConfigured } from '../lib/storage';
import {
  generatePaymentProofStorageKey,
  isPaymentProofKeyForOrder,
  isValidOriginalFilename,
  MAX_PROOF_BYTES,
  PROOF_MIME_TYPES,
} from '../lib/attachmentPolicy';
import { createClaimBatch, decideBookPayment, openUnpaidBook, payableBooks } from '../lib/bookPayments';
import { notifyPaymentOrderMessage, notifyPaymentOrderNew } from '../lib/notifications';
import { MAX_COMMENT_CHARS } from '../lib/textLimits';
import { agentConfirmedToday, orderThread, STALE_ORDER_MS } from '../lib/paymentOrders';

// /api/member/pay — paying for a book through a payment agent, like a P2P
// trade: the member picks an agent who is online, they chat in a "payment
// order" (the agent says how to pay), the member pays, sends the transaction
// ID and a screenshot, and the agent confirms that the money arrived in the
// ministry's account. Confirming opens the book and credits the inviter
// (lib/bookPayments.ts). The agent is the ministry's staff: the money is the
// ministry's, never the agent's.
const router = Router();

const photoOf = (p: { id: string; photoStorageKey: string | null; photoUpdatedAt: Date | null }) => profilePhotoPath(p);
const personSelect = { id: true, name: true, lastSeenAt: true, photoStorageKey: true, photoUpdatedAt: true } as const;

/** Orders nobody finished within a day end quietly. */
async function expireStale() {
  await prisma.paymentOrder.updateMany({
    where: { status: 'OPEN', updatedAt: { lt: new Date(Date.now() - STALE_ORDER_MS) } },
    data: { status: 'EXPIRED' },
  });
}

router.get('/pay/me', requireMember, asyncHandler(async (req, res) => {
  const agent = await prisma.paymentAgent.findUnique({ where: { personId: req.member!.personId }, select: { id: true, active: true } });
  if (!agent || !agent.active) return res.json({ isAgent: false, waiting: 0 });
  await expireStale();
  const waiting = await prisma.paymentOrder.count({ where: { agentId: agent.id, status: { in: ['OPEN', 'CLAIMED'] } } });
  res.json({ isAgent: true, waiting });
}));

// The agents a member can pay through: online ones first.
router.get('/pay/agents', requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  await expireStale();
  const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : null;
  const agents = await prisma.paymentAgent.findMany({
    where: { active: true, personId: { not: personId } },
    include: { person: { select: personSelect } },
  });
  const now = Date.now();
  const items = await Promise.all(
    agents.map(async (a) => ({
      id: a.id,
      name: a.person.name,
      label: a.label,
      photoUrl: photoOf(a.person),
      online: isOnline(a.person.lastSeenAt, now),
      lastSeenAt: a.person.lastSeenAt,
      busy: (await agentConfirmedToday(a.id)) >= a.dailyLimit,
    })),
  );
  items.sort((x, y) => Number(y.online && !y.busy) - Number(x.online && !x.busy) || Number(x.busy) - Number(y.busy) || x.name.localeCompare(y.name));
  const active = await prisma.paymentOrder.findFirst({
    where: { buyerPersonId: personId, ...(bookId ? { bookId } : {}), status: { in: ['OPEN', 'CLAIMED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, agentId: true },
  });
  res.json({ items, activeOrder: active });
}));

// bookId: pay for that one book; count (no bookId, or more than one): pay for
// the next `count` unpaid books in order, including ones not open yet.
const startSchema = z.object({ agentId: z.string().min(1), bookId: z.string().min(1).optional(), count: z.number().int().min(1).max(100).optional() });

router.post('/pay/orders', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose an agent and how many books.' });
  const personId = req.member!.personId;
  const count = parsed.data.count ?? 1;
  const agent = await prisma.paymentAgent.findUnique({ where: { id: parsed.data.agentId }, include: { person: { select: { id: true, name: true } } } });
  if (!agent || !agent.active || agent.personId === personId) return res.status(404).json({ error: 'This agent is not available.' });
  if ((await agentConfirmedToday(agent.id)) >= agent.dailyLimit) return res.status(409).json({ error: 'This agent is busy for today. Please choose another one.', code: 'BUSY' });

  // One thing to pay at a time: a claim waiting to be confirmed comes first.
  const claimed = await prisma.paymentOrder.findFirst({ where: { buyerPersonId: personId, status: 'CLAIMED' } });
  if (claimed) return res.status(409).json({ error: 'Your payment is waiting to be confirmed.', code: 'WAITING', orderId: claimed.id });

  let first: { id: string; trainingOrder: number };
  if (count === 1 && parsed.data.bookId) {
    const found = await openUnpaidBook(personId, parsed.data.bookId);
    if (found.error === 404) return res.status(404).json({ error: 'Book not found.' });
    if (found.error) return res.status(409).json({ error: 'This book is already paid or waiting for confirmation.', code: found.error });
    first = { id: found.book.id, trainingOrder: found.book.trainingOrder };
  } else {
    const payable = await payableBooks(personId);
    if (payable.length === 0) return res.status(409).json({ error: 'There is no book to pay for.', code: 'NOTHING_TO_PAY' });
    if (count > payable.length) return res.status(409).json({ error: `You can pay for at most ${payable.length} more book${payable.length === 1 ? '' : 's'}.`, code: 'TOO_MANY' });
    first = payable[0];
  }

  const same = await prisma.paymentOrder.findFirst({ where: { buyerPersonId: personId, bookId: first.id, bookCount: count, agentId: agent.id, status: 'OPEN' } });
  if (same) return res.json({ id: same.id });
  await prisma.paymentOrder.updateMany({ where: { buyerPersonId: personId, status: 'OPEN' }, data: { status: 'CANCELLED', decidedAt: new Date() } });

  const settings = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { trainingBookPrice: true, trainingPaymentInstructionsEn: true, trainingPaymentInstructionsFr: true },
  });
  const buyer = await prisma.person.findUnique({ where: { id: personId }, select: { name: true } });
  const instructions =
    agent.instructions?.trim() ||
    (req.member!.preferredLanguage === 'fr' ? settings?.trainingPaymentInstructionsFr || settings?.trainingPaymentInstructionsEn : settings?.trainingPaymentInstructionsEn || settings?.trainingPaymentInstructionsFr)?.trim() ||
    null;
  const order = await prisma.paymentOrder.create({
    data: {
      buyerPersonId: personId,
      agentId: agent.id,
      bookId: first.id,
      bookNumber: first.trainingOrder,
      bookCount: count,
      amount: (settings?.trainingBookPrice ?? 1200) * count,
      // The agent's first message is the payment instructions, so the member can pay at once.
      messages: instructions ? { create: { senderPersonId: agent.personId, body: instructions, auto: true } } : undefined,
    },
    select: { id: true, bookNumber: true },
  });
  await recordAudit({ action: 'PAYMENT_ORDER_OPENED', targetType: 'PaymentOrder', targetId: order.id, metadata: { personId, agentId: agent.id, count } });
  await notifyPaymentOrderNew(order, agent.personId, buyer?.name ?? 'A member', count).catch(() => {});
  res.status(201).json({ id: order.id });
}));

/** The order, if this member is its buyer or its agent. */
async function loadOrder(req: Request, res: Response) {
  const personId = req.member!.personId;
  const order = await prisma.paymentOrder.findUnique({
    where: { id: req.params.id },
    include: { agent: { include: { person: { select: personSelect } } }, buyer: { select: personSelect }, book: { select: { titleEn: true, titleFr: true } } },
  });
  const role = !order ? null : order.buyerPersonId === personId ? ('BUYER' as const) : order.agent.personId === personId ? ('AGENT' as const) : null;
  if (!order || !role) {
    res.status(404).json({ error: 'Order not found.' });
    return null;
  }
  return { order, role, personId };
}

const isLive = (status: string) => status === 'OPEN' || status === 'CLAIMED';

router.get('/pay/orders/:id', requireMember, asyncHandler(async (req, res) => {
  const loaded = await loadOrder(req, res);
  if (!loaded) return;
  const { order, role, personId } = loaded;
  const other = role === 'BUYER' ? order.agent.person : order.buyer;
  const [messages, latest] = await Promise.all([
    orderThread(order.id, personId),
    prisma.bookPayment.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' }, select: { status: true, reference: true, payerPhone: true, note: true } }),
  ]);
  res.json({
    id: order.id,
    role,
    status: order.status,
    amount: order.amount,
    bookNumber: order.bookNumber,
    bookCount: order.bookCount,
    bookTitleEn: order.book?.titleEn ?? null,
    bookTitleFr: order.book?.titleFr ?? null,
    createdAt: order.createdAt,
    counterpart: { name: other.name, photoUrl: photoOf(other), online: isOnline(other.lastSeenAt), lastSeenAt: other.lastSeenAt, label: role === 'BUYER' ? order.agent.label : null },
    // What the agent is checking, or why the last claim was sent back.
    payment: latest && (order.status === 'CLAIMED' || latest.status === 'REJECTED') ? latest : null,
    canClaim: role === 'BUYER' && order.status === 'OPEN',
    canCancel: role === 'BUYER' && order.status === 'OPEN',
    canDecide: role === 'AGENT' && order.status === 'CLAIMED',
    messages,
  });
}));

const messageSchema = z.object({
  body: z.string().trim().max(MAX_COMMENT_CHARS).optional(),
  proof: z.object({ storageKey: z.string().min(1), mimeType: z.string(), byteSize: z.number().int().positive(), originalFilename: z.string().optional() }).optional(),
}).refine((d) => Boolean(d.body) || Boolean(d.proof), { message: 'Write a message or add a screenshot.' });

router.post('/pay/orders/:id/messages', messageSendLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const loaded = await loadOrder(req, res);
  if (!loaded) return;
  const { order, role, personId } = loaded;
  if (!isLive(order.status)) return res.status(409).json({ error: 'This order is closed.', code: 'CLOSED' });
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
  const proof = parsed.data.proof;
  if (proof) {
    if (!(PROOF_MIME_TYPES as readonly string[]).includes(proof.mimeType) || proof.byteSize > MAX_PROOF_BYTES || !isPaymentProofKeyForOrder(proof.storageKey, order.id)) {
      return res.status(400).json({ error: 'Invalid screenshot.' });
    }
    if (!isStorageConfigured()) return res.status(503).json({ error: 'Screenshots are not available right now.' });
    const head = await headObject({ storageKey: proof.storageKey });
    if (!head || head.contentLength !== proof.byteSize || (head.contentType && head.contentType !== proof.mimeType)) {
      return res.status(400).json({ error: 'The screenshot upload could not be verified.' });
    }
  }
  const message = await prisma.paymentOrderMessage.create({
    data: {
      orderId: order.id,
      senderPersonId: personId,
      body: parsed.data.body ?? '',
      proofStorageKey: proof?.storageKey ?? null,
      proofMimeType: proof?.mimeType ?? null,
      proofByteSize: proof?.byteSize ?? null,
    },
    select: { id: true },
  });
  await prisma.paymentOrder.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
  const me = role === 'BUYER' ? order.buyer : order.agent.person;
  await notifyPaymentOrderMessage(order, role === 'BUYER' ? order.agent.personId : order.buyerPersonId, me.name).catch(() => {});
  res.status(201).json({ id: message.id });
}));

const authorizeSchema = z.object({ mimeType: z.string().min(1), byteSize: z.number().int().positive(), originalFilename: z.string().optional() });

router.post('/pay/orders/:id/proof/authorize', attachmentUploadAuthorizeLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const loaded = await loadOrder(req, res);
  if (!loaded) return;
  if (!isLive(loaded.order.status)) return res.status(409).json({ error: 'This order is closed.', code: 'CLOSED' });
  const parsed = authorizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid screenshot.' });
  const { mimeType, byteSize, originalFilename } = parsed.data;
  if (!(PROOF_MIME_TYPES as readonly string[]).includes(mimeType)) return res.status(400).json({ error: 'Please send a photo (JPG, PNG or WebP).' });
  if (byteSize > MAX_PROOF_BYTES) return res.status(400).json({ error: 'This photo is too large.' });
  if (originalFilename && !isValidOriginalFilename(originalFilename)) return res.status(400).json({ error: 'Invalid filename.' });
  if (!isStorageConfigured()) return res.status(503).json({ error: 'Screenshots are not available right now.' });
  const storageKey = generatePaymentProofStorageKey(loaded.order.id);
  const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType });
  res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes: MAX_PROOF_BYTES });
}));

router.get('/pay/orders/:id/messages/:messageId/proof-url', attachmentDownloadLimiter, requireMember, asyncHandler(async (req, res) => {
  const loaded = await loadOrder(req, res);
  if (!loaded) return;
  const message = await prisma.paymentOrderMessage.findFirst({ where: { id: req.params.messageId, orderId: loaded.order.id }, select: { proofStorageKey: true } });
  if (!message?.proofStorageKey) return res.status(404).json({ error: 'Not found.' });
  res.json(await createDownloadUrl({ storageKey: message.proofStorageKey }));
}));

const paidSchema = z.object({ reference: z.string().trim().min(3).max(60), payerPhone: z.string().trim().max(30).optional() });

// "I have paid": the transaction ID goes to the agent (and shows in the
// admin's payments list like any manual payment).
router.post('/pay/orders/:id/paid', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const loaded = await loadOrder(req, res);
  if (!loaded) return;
  const { order, role, personId } = loaded;
  if (role !== 'BUYER') return res.status(403).json({ error: 'Only the person paying can send this.' });
  if (order.status !== 'OPEN') return res.status(409).json({ error: 'This order is not open.', code: 'CLOSED' });
  const parsed = paidSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please type the Mobile Money transaction ID.', code: 'INVALID' });
  if (!order.bookId) return res.status(409).json({ error: 'Book not found.' });
  const reused = await prisma.bookPayment.findFirst({
    where: { reference: { equals: parsed.data.reference, mode: 'insensitive' }, status: { in: ['CLAIMED', 'PENDING', 'CONFIRMED'] } },
    select: { id: true },
  });
  if (reused) return res.status(409).json({ error: 'This transaction ID has already been used for a payment. Please check it and type the ID from your own payment message.', code: 'DUPLICATE_REFERENCE' });

  const priceEach = Math.round(order.amount / order.bookCount);
  let paymentId: string;
  if (order.bookCount === 1) {
    const found = await openUnpaidBook(personId, order.bookId);
    if (found.error === 404) return res.status(404).json({ error: 'Book not found.' });
    if (found.error) return res.status(409).json({ error: 'This book is already paid or waiting for confirmation.', code: found.error });
    const payment = await prisma.bookPayment.create({
      data: { personId, bookId: order.bookId, bookNumber: order.bookNumber, amount: order.amount, method: 'MANUAL', status: 'CLAIMED', reference: parsed.data.reference, payerPhone: parsed.data.payerPhone || null, orderId: order.id },
      select: { id: true },
    });
    paymentId = payment.id;
  } else {
    const batch = await createClaimBatch({ personId, count: order.bookCount, amountEach: priceEach, reference: parsed.data.reference, payerPhone: parsed.data.payerPhone, orderId: order.id });
    if (!batch) return res.status(409).json({ error: 'Some of these books are already paid. Please cancel and start a new order.', code: 'TOO_MANY' });
    paymentId = batch.rows[0].id;
  }
  const payment = { id: paymentId };
  await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: 'CLAIMED' } });
  await prisma.paymentOrderMessage.create({
    data: { orderId: order.id, senderPersonId: personId, body: `✅ I have paid. Transaction ID: ${parsed.data.reference}`, auto: true },
  });
  await recordAudit({ action: 'BOOK_PAYMENT_CLAIMED', targetType: 'BookPayment', targetId: payment.id, metadata: { personId, bookNumber: order.bookNumber, count: order.bookCount, orderId: order.id } });
  await notifyPaymentOrderMessage(order, order.agent.personId, order.buyer.name).catch(() => {});
  res.status(201).json({ id: payment.id, status: 'CLAIMED' });
}));

router.post('/pay/orders/:id/cancel', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const loaded = await loadOrder(req, res);
  if (!loaded) return;
  if (loaded.role !== 'BUYER') return res.status(403).json({ error: 'Only the person paying can cancel.' });
  const changed = await prisma.paymentOrder.updateMany({ where: { id: loaded.order.id, status: 'OPEN' }, data: { status: 'CANCELLED', decidedAt: new Date() } });
  if (changed.count === 0) return res.status(409).json({ error: 'This order can no longer be cancelled.', code: 'CLOSED' });
  res.json({ status: 'CANCELLED' });
}));

const decideSchema = z.object({ decision: z.enum(['CONFIRM', 'REJECT']), note: z.string().trim().max(300).optional() });

// The agent confirms the money reached the ministry's account — or says it
// did not (the member can then correct the ID and send it again).
router.post('/pay/orders/:id/decide', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const loaded = await loadOrder(req, res);
  if (!loaded) return;
  const { order, role, personId } = loaded;
  if (role !== 'AGENT' || !order.agent.active) return res.status(403).json({ error: 'Only the payment agent can decide this.' });
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose confirm or reject.' });
  if (order.status !== 'CLAIMED') return res.status(409).json({ error: 'There is no payment waiting here.', code: 'CLOSED' });
  const confirm = parsed.data.decision === 'CONFIRM';
  if (confirm && (await agentConfirmedToday(order.agent.id)) >= order.agent.dailyLimit) {
    return res.status(409).json({ error: 'You have reached today’s limit. The central admin can confirm this one.', code: 'LIMIT' });
  }
  const waiting = await prisma.bookPayment.findFirst({ where: { orderId: order.id, status: 'CLAIMED' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (!waiting) return res.status(409).json({ error: 'There is no payment waiting here.', code: 'CLOSED' });

  const result = await decideBookPayment({ paymentId: waiting.id, decision: parsed.data.decision, note: parsed.data.note, byPersonId: personId });
  if (!result.ok) {
    if (result.error === 'ALREADY_PAID') return res.status(409).json({ error: 'This book is already paid.', code: 'ALREADY_PAID' });
    return res.status(409).json({ error: 'This payment was already decided.', code: 'CLOSED' });
  }
  await recordAudit({
    action: confirm ? 'BOOK_PAYMENT_CONFIRMED' : 'BOOK_PAYMENT_REJECTED',
    targetType: 'BookPayment',
    targetId: result.payment.id,
    metadata: { personId: result.payment.personId, bookNumber: result.payment.bookNumber, agentPersonId: personId, orderId: order.id },
  });
  await prisma.paymentOrderMessage.create({
    data: {
      orderId: order.id,
      senderPersonId: personId,
      auto: true,
      body: confirm ? '✅ Payment received and confirmed. Your book is open. Thank you!' : `❌ I could not find this payment.${parsed.data.note ? ` ${parsed.data.note}` : ''} Please check the transaction ID and send it again.`,
    },
  });
  res.json({ status: result.status });
}));

// The agent's desk: orders waiting, then the latest finished ones.
router.get('/pay/desk', requireMember, asyncHandler(async (req, res) => {
  const agent = await prisma.paymentAgent.findUnique({ where: { personId: req.member!.personId } });
  if (!agent || !agent.active) return res.status(403).json({ error: 'You are not a payment agent.' });
  await expireStale();
  const rows = await prisma.paymentOrder.findMany({
    where: { agentId: agent.id },
    orderBy: { updatedAt: 'desc' },
    take: 60,
    include: { buyer: { select: personSelect }, _count: { select: { messages: true } } },
  });
  const confirmedToday = await agentConfirmedToday(agent.id);
  const toItem = (o: (typeof rows)[number]) => ({
    id: o.id,
    status: o.status,
    amount: o.amount,
    bookNumber: o.bookNumber,
    bookCount: o.bookCount,
    buyerName: o.buyer.name,
    buyerPhotoUrl: photoOf(o.buyer),
    buyerOnline: isOnline(o.buyer.lastSeenAt),
    updatedAt: o.updatedAt,
  });
  res.json({
    dailyLimit: agent.dailyLimit,
    confirmedToday,
    waiting: rows.filter((o) => isLive(o.status)).map(toItem),
    recent: rows.filter((o) => !isLive(o.status)).slice(0, 20).map(toItem),
  });
}));

export default router;
