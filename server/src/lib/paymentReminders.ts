import { prisma } from './prisma';
import { startAdaptiveLoop } from './activity';
import { notifyPaymentOrderReminder } from './notifications';

/** How long a member waits for a reply before the representative is reminded. */
export const REPLY_REMINDER_MS = 5 * 60 * 1000;

/**
 * Reminds a payment representative, once per unanswered streak, when the
 * member's last message (or "I have paid") has had no reply for 5 minutes.
 */
export async function processPaymentReminders(now = Date.now()): Promise<number> {
  const orders = await prisma.paymentOrder.findMany({
    where: { status: { in: ['OPEN', 'CLAIMED'] }, agent: { active: true } },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderPersonId: true, createdAt: true } },
      agent: { select: { personId: true } },
      buyer: { select: { name: true } },
    },
  });
  let reminded = 0;
  for (const order of orders) {
    const last = order.messages[0];
    if (!last || last.senderPersonId !== order.buyerPersonId) continue;
    if (now - last.createdAt.getTime() < REPLY_REMINDER_MS) continue;
    if (order.reminderSentAt && order.reminderSentAt >= last.createdAt) continue;
    await prisma.paymentOrder.update({ where: { id: order.id }, data: { reminderSentAt: new Date(now) } });
    await notifyPaymentOrderReminder(order, order.agent.personId, order.buyer.name).catch(() => {});
    reminded += 1;
  }
  return reminded;
}

/** Looks for waiting members (every minute while the app is in use, every 30 minutes when quiet); never overlaps, never throws. */
export function startPaymentReminderLoop(): void {
  startAdaptiveLoop(processPaymentReminders, (err) => console.error('[payments] reminder tick failed', { error: err instanceof Error ? err.message : String(err) }));
}
