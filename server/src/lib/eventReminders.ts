import { prisma } from './prisma';
import { notifyEventSoon } from './notifications';

/** Members are told once, about an hour before an event starts. */
export const REMIND_BEFORE_MS = 60 * 60 * 1000;
const TICK_MS = 60 * 1000;

export async function processEventReminders(now = Date.now()): Promise<number> {
  const due = await prisma.assemblyEvent.findMany({
    where: { cancelledAt: null, reminderSentAt: null, startsAt: { gt: new Date(now), lte: new Date(now + REMIND_BEFORE_MS) } },
    include: { community: { select: { name: true } } },
  });
  for (const event of due) {
    // Mark first, so a slow send is never repeated by the next tick.
    await prisma.assemblyEvent.update({ where: { id: event.id }, data: { reminderSentAt: new Date(now) } });
    const members = await prisma.communityMembership.findMany({ where: { communityId: event.communityId, status: 'ACTIVE' }, select: { personId: true } });
    await notifyEventSoon({ id: event.id, title: event.title, startsAt: event.startsAt, communityName: event.community.name }, members.map((m) => m.personId)).catch(() => {});
  }
  return due.length;
}

/** Looks for events starting soon once a minute for the life of the process; never overlaps, never throws. */
export function startEventReminderLoop(): void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    processEventReminders()
      .catch((err) => console.error('[events] reminder tick failed', { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        running = false;
      });
  }, TICK_MS);
  timer.unref();
}
