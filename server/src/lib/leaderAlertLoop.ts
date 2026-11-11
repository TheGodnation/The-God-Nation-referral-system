import { prisma } from './prisma';
import { startAdaptiveLoop } from './activity';
import { leaderAlerts } from './coordinatorDesk';
import { notifyLeadersNotFollowingUp } from './notifications';

// Once a day, in the daytime (Cameroon time), the central admin is told how many leaders have people to look after but
// have not contacted anyone for a week: a notification and a phone alert. Nothing is sent when all is well, and never
// more than once in 23 hours, however often the app restarts or several servers run.

const DAY_PART_FROM = 7;
const DAY_PART_UNTIL = 20;
const MIN_GAP_MS = 23 * 60 * 60 * 1000;

/** Returns how many leaders the central admin was told about (0 when nothing was sent). */
export async function runLeaderAlertCheck(now = new Date()): Promise<number> {
  const hour = new Date(now.getTime() + 3600_000).getUTCHours(); // Cameroon is UTC+1 all year
  if (hour < DAY_PART_FROM || hour >= DAY_PART_UNTIL) return 0;
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', active: true, personId: { not: null } }, select: { personId: true } });
  if (admins.length === 0) return 0;
  const alerts = await leaderAlerts(now.getTime());
  if (alerts.length === 0) return 0;
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton' }, update: {} }).catch(() => {});
  const claimed = await prisma.settings.updateMany({
    where: { id: 'singleton', OR: [{ leaderAlertSentAt: null }, { leaderAlertSentAt: { lt: new Date(now.getTime() - MIN_GAP_MS) } }] },
    data: { leaderAlertSentAt: now },
  });
  if (claimed.count !== 1) return 0;
  for (const a of admins) await notifyLeadersNotFollowingUp(a.personId!, alerts.length).catch(() => {});
  return alerts.length;
}

export function startLeaderAlertLoop(): void {
  startAdaptiveLoop(() => runLeaderAlertCheck(), (err) => {
    console.error('[leaderAlerts] check failed', { error: err instanceof Error ? err.message : String(err) });
  });
}
