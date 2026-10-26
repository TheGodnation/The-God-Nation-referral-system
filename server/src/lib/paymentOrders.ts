import { prisma } from './prisma';

/** An order nobody continued for a day ends on its own. */
export const STALE_ORDER_MS = 24 * 60 * 60 * 1000;

/** Books this agent confirmed today (the day counted in Cameroon time, UTC+1). */
export async function agentConfirmedToday(agentId: string, now = new Date()): Promise<number> {
  const local = new Date(now.getTime() + 60 * 60 * 1000);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const since = new Date(startLocal - 60 * 60 * 1000);
  return prisma.paymentOrder.count({ where: { agentId, status: 'CONFIRMED', decidedAt: { gte: since } } });
}

/** One order's messages, oldest first, as the viewer sees them. */
export async function orderThread(orderId: string, viewerPersonId: string | null) {
  const rows = await prisma.paymentOrderMessage.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
    take: 300,
    include: { sender: { select: { name: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    mine: viewerPersonId !== null && m.senderPersonId === viewerPersonId,
    senderName: m.sender.name,
    body: m.body,
    auto: m.auto,
    hasProof: Boolean(m.proofStorageKey),
    createdAt: m.createdAt,
  }));
}
