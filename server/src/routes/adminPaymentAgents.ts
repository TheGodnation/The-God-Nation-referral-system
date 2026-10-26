import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { leadershipMutationLimiter, attachmentDownloadLimiter } from '../lib/rateLimit';
import { recordAudit } from '../lib/audit';
import { isOnline } from '../lib/presence';
import { createDownloadUrl } from '../lib/storage';
import { agentConfirmedToday, orderThread } from '../lib/paymentOrders';

// Central admin: payment agents (the ministry's staff who confirm book
// payments, see routes/paymentOrders.ts) and an overview of every payment
// order, with its messages and screenshots.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get('/payment-agents', asyncHandler(async (_req, res) => {
  const agents = await prisma.paymentAgent.findMany({
    orderBy: { createdAt: 'asc' },
    include: { person: { select: { id: true, name: true, whatsappNumber: true, lastSeenAt: true } } },
  });
  const items = await Promise.all(
    agents.map(async (a) => ({
      id: a.id,
      personId: a.personId,
      name: a.person.name,
      whatsappNumber: a.person.whatsappNumber,
      active: a.active,
      label: a.label,
      dailyLimit: a.dailyLimit,
      instructions: a.instructions,
      online: isOnline(a.person.lastSeenAt),
      lastSeenAt: a.person.lastSeenAt,
      confirmedToday: await agentConfirmedToday(a.id),
      confirmedTotal: await prisma.paymentOrder.count({ where: { agentId: a.id, status: 'CONFIRMED' } }),
      waiting: await prisma.paymentOrder.count({ where: { agentId: a.id, status: { in: ['OPEN', 'CLAIMED'] } } }),
    })),
  );
  res.json({ items });
}));

const createSchema = z.object({
  personId: z.string().min(1),
  label: z.string().trim().max(60).optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  instructions: z.string().trim().max(1000).optional(),
});

router.post('/payment-agents', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a person and check the details.' });
  const person = await prisma.person.findUnique({ where: { id: parsed.data.personId }, select: { id: true, erasedAt: true } });
  if (!person || person.erasedAt) return res.status(404).json({ error: 'Person not found.' });
  const agent = await prisma.paymentAgent.upsert({
    where: { personId: person.id },
    create: { personId: person.id, label: parsed.data.label || null, dailyLimit: parsed.data.dailyLimit ?? 20, instructions: parsed.data.instructions || null },
    update: { active: true, ...(parsed.data.label !== undefined ? { label: parsed.data.label || null } : {}), ...(parsed.data.dailyLimit ? { dailyLimit: parsed.data.dailyLimit } : {}) },
  });
  await recordAudit({ actorId: req.user!.id, action: 'PAYMENT_AGENT_ADDED', targetType: 'PaymentAgent', targetId: agent.id, metadata: { personId: person.id } });
  res.status(201).json({ id: agent.id });
}));

const updateSchema = z.object({
  active: z.boolean().optional(),
  label: z.string().trim().max(60).nullable().optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  instructions: z.string().trim().max(1000).nullable().optional(),
});

router.patch('/payment-agents/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the details.' });
  const d = parsed.data;
  const exists = await prisma.paymentAgent.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'Representative not found.' });
  await prisma.paymentAgent.update({
    where: { id: req.params.id },
    data: {
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(d.label !== undefined ? { label: d.label || null } : {}),
      ...(d.dailyLimit !== undefined ? { dailyLimit: d.dailyLimit } : {}),
      ...(d.instructions !== undefined ? { instructions: d.instructions || null } : {}),
    },
  });
  await recordAudit({ actorId: req.user!.id, action: d.active === false ? 'PAYMENT_AGENT_SWITCHED_OFF' : 'PAYMENT_AGENT_UPDATED', targetType: 'PaymentAgent', targetId: req.params.id });
  res.json({ ok: true });
}));

// Every order, newest first (optionally one agent's or one status).
router.get('/payment-orders', asyncHandler(async (req, res) => {
  const status = z.enum(['OPEN', 'CLAIMED', 'CONFIRMED', 'CANCELLED', 'EXPIRED']).safeParse(req.query.status);
  const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
  const rows = await prisma.paymentOrder.findMany({
    where: { ...(status.success ? { status: status.data } : {}), ...(agentId ? { agentId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      buyer: { select: { name: true } },
      agent: { include: { person: { select: { name: true } } } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { reference: true, status: true } },
      messages: { where: { proofStorageKey: { not: null } }, select: { id: true } },
    },
  });
  res.json({
    items: rows.map((o) => ({
      id: o.id,
      status: o.status,
      amount: o.amount,
      bookNumber: o.bookNumber,
      bookCount: o.bookCount,
      buyerName: o.buyer.name,
      agentName: o.agent.person.name,
      reference: o.payments[0]?.reference ?? null,
      proofs: o.messages.length,
      createdAt: o.createdAt,
      decidedAt: o.decidedAt,
    })),
  });
}));

router.get('/payment-orders/:id', asyncHandler(async (req, res) => {
  const order = await prisma.paymentOrder.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({ ...order, messages: await orderThread(order.id, null) });
}));

router.get('/payment-orders/:id/messages/:messageId/proof-url', attachmentDownloadLimiter, asyncHandler(async (req, res) => {
  const m = await prisma.paymentOrderMessage.findFirst({ where: { id: req.params.messageId, orderId: req.params.id }, select: { proofStorageKey: true } });
  if (!m?.proofStorageKey) return res.status(404).json({ error: 'Not found.' });
  res.json(await createDownloadUrl({ storageKey: m.proofStorageKey }));
}));

export default router;
