import { prisma } from './prisma';
import { weekStartOf, addDays, dayKey } from './weeklyReports';
import { pushToPerson, type PushPayload } from './push';
import { isFrench } from './privateNotice';
import { DAY, MIN, TZ_MS, TEACHING_MINUTES, finishedTeachings, loadBase, pickText, raterIds, slotStart, topicNumberFor, weekNumber } from './teachingRota';

// Reminders for the weekly teaching rota, in the bell and as a phone alert, in each person's own language. Only while
// the rota is switched on, and each one goes out once (written in TeachingReminderLog):
//  - Sunday 18:00 before the week:  "Your teaching this week: topic, day, time" (to every teacher)
//  - the evening before (18:00):     "You teach tomorrow"  (not for Monday teachers: Sunday's message already says it)
//  - one hour before:                "Your teaching starts in 1 hour"
//  - Sunday 18:00 of the week:       "N teachings waiting for your rating" (to raters who still have some)
// All times are Cameroon time (GMT+1).

export type RotaKind = 'assignment' | 'tomorrow' | 'hour' | 'rate';

/** Claims a reminder: true the first time, false when it was already sent. */
async function claim(key: string): Promise<boolean> {
  const r = await prisma.teachingReminderLog.createMany({ data: [{ key }], skipDuplicates: true });
  return r.count === 1;
}

const whenText = (startsAt: Date, french: boolean, withDay: boolean) =>
  new Intl.DateTimeFormat(french ? 'fr-FR' : 'en-GB', { ...(withDay ? { weekday: 'long' as const } : {}), hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Douala' }).format(startsAt);

function pushFor(kind: RotaKind, french: boolean, d: { topic: string; startsAt: Date; count?: number }): PushPayload {
  const url = '/member/my-teaching';
  switch (kind) {
    case 'assignment':
      return { title: french ? '📖 Votre enseignement cette semaine' : '📖 Your teaching this week', body: `${d.topic} · ${whenText(d.startsAt, french, true)}`, url, tag: 'rota-assignment' };
    case 'tomorrow':
      return { title: french ? '⏰ Vous enseignez demain' : '⏰ You teach tomorrow', body: `${d.topic} · ${whenText(d.startsAt, french, false)}`, url, tag: 'rota-reminder' };
    case 'hour':
      return { title: french ? '⏰ Votre enseignement commence dans 1 heure' : '⏰ Your teaching starts in 1 hour', body: d.topic, url, tag: 'rota-reminder', urgent: true };
    case 'rate':
      return { title: french ? '⭐ Enseignements à noter' : '⭐ Teachings to rate', body: french ? `${d.count} attendent votre note.` : `${d.count} waiting for your rating.`, url, tag: 'rota-rate' };
  }
}

async function send(personId: string, kind: RotaKind, d: { topicEn: string; topicFr: string; startsAt: Date; count?: number }) {
  await prisma.notification.create({
    data: { recipientPersonId: personId, type: 'TEACHING_ROTA', metadata: { kind, topicEn: d.topicEn, topicFr: d.topicFr, startsAt: d.startsAt.toISOString(), count: d.count ?? null } as any, targetType: 'TeachingRota' },
  });
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  const french = isFrench(person?.preferredLanguage);
  await pushToPerson(personId, pushFor(kind, french, { topic: french ? d.topicFr : d.topicEn, startsAt: d.startsAt, count: d.count })).catch(() => {});
}

async function plan(now: Date) {
  const { settings, topics } = await loadBase();
  if (!settings || !settings.enabled) return null;
  const teachers = await prisma.teachingTeacher.findMany({ where: { active: true, personId: { not: null } } });
  return { settings, topics, teachers, numbers: topics.map((t) => t.number), thisMonday: weekStartOf(now) };
}

function topicsFor(p: NonNullable<Awaited<ReturnType<typeof plan>>>, startTopic: number, monday: Date) {
  const topic = p.topics.find((t) => t.number === topicNumberFor(startTopic, p.numbers, weekNumber(p.settings.startDate, monday)));
  return topic ? { topicEn: pickText('en', topic).text.topic, topicFr: pickText('fr', topic).text.topic } : null;
}

/** Sends every reminder that is due and not yet sent. Safe to run often. */
export async function sendRotaReminders(now = new Date()): Promise<Record<RotaKind, number>> {
  const out: Record<RotaKind, number> = { assignment: 0, tomorrow: 0, hour: 0, rate: 0 };
  const p = await plan(now);
  if (!p) return out;
  const mondays = [p.thisMonday, addDays(p.thisMonday, 7)].filter((m) => m.getTime() >= p.settings.startDate.getTime());
  for (const monday of mondays) {
    for (const t of p.teachers) {
      const names = topicsFor(p, t.startTopic, monday);
      if (!names) continue;
      const startsAt = slotStart(monday, t.dayOfWeek, t.startMinute);
      const key = (kind: RotaKind) => `${kind}:${t.id}:${dayKey(monday)}`;
      const assignmentDue = monday.getTime() - 6 * 60 * MIN - TZ_MS; // Sunday 18:00 before the week
      if (now.getTime() >= assignmentDue && now.getTime() < startsAt.getTime() && (await claim(key('assignment')))) {
        await send(t.personId!, 'assignment', { ...names, startsAt });
        out.assignment++;
      }
      if (t.dayOfWeek >= 2) {
        const tomorrowDue = monday.getTime() + (t.dayOfWeek - 2) * DAY + 18 * 60 * MIN - TZ_MS; // the evening before, 18:00
        if (now.getTime() >= tomorrowDue && now.getTime() < startsAt.getTime() && (await claim(key('tomorrow')))) {
          await send(t.personId!, 'tomorrow', { ...names, startsAt });
          out.tomorrow++;
        }
      }
      const hourDue = startsAt.getTime() - 60 * MIN;
      if (now.getTime() >= hourDue && now.getTime() < startsAt.getTime() && (await claim(key('hour')))) {
        await send(t.personId!, 'hour', { ...names, startsAt });
        out.hour++;
      }
    }
  }

  // Raters: on Sunday evening, the teachings of this week (and the days before) they have not rated yet.
  const rateDue = p.thisMonday.getTime() + 6 * DAY + 18 * 60 * MIN - TZ_MS;
  if (now.getTime() >= rateDue && now.getTime() < p.thisMonday.getTime() + 8 * DAY - TZ_MS && p.thisMonday.getTime() >= p.settings.startDate.getTime()) {
    const finished = await finishedTeachings(now);
    if (finished.length > 0) {
      const given = await prisma.teachingRating.findMany({ where: { teacherId: { in: finished.map((f) => f.teacher.id) }, weekStart: { in: finished.map((f) => f.monday) } }, select: { raterPersonId: true, teacherId: true, weekStart: true } });
      const done = new Set(given.map((g) => `${g.raterPersonId}|${g.teacherId}|${dayKey(g.weekStart)}`));
      for (const personId of await raterIds()) {
        const waiting = finished.filter((f) => f.teacher.personId !== personId && !done.has(`${personId}|${f.teacher.id}|${dayKey(f.monday)}`)).length;
        if (waiting > 0 && (await claim(`rate:${personId}:${dayKey(p.thisMonday)}`))) {
          await send(personId, 'rate', { topicEn: '', topicFr: '', startsAt: now, count: waiting });
          out.rate++;
        }
      }
    }
  }
  return out;
}

/** The "Send this week's assignments now" button: everyone on the rota gets their assignment now (never twice). */
export async function sendAssignmentsNow(now = new Date()): Promise<{ sent: number; alreadySent: number }> {
  const p = await plan(now);
  if (!p) return { sent: 0, alreadySent: 0 };
  const monday = p.thisMonday.getTime() < p.settings.startDate.getTime() ? p.settings.startDate : p.thisMonday;
  const result = { sent: 0, alreadySent: 0 };
  for (const t of p.teachers) {
    const names = topicsFor(p, t.startTopic, monday);
    if (!names) continue;
    const startsAt = slotStart(monday, t.dayOfWeek, t.startMinute);
    if (startsAt.getTime() <= now.getTime()) continue; // this week's slot has already passed
    if (await claim(`assignment:${t.id}:${dayKey(monday)}`)) {
      await send(t.personId!, 'assignment', { ...names, startsAt });
      result.sent++;
    } else result.alreadySent++;
  }
  return result;
}

export function startTeachingReminderLoop(): void {
  const run = () => sendRotaReminders().catch((err) => console.error('[teaching-rota] reminders failed', { error: err instanceof Error ? err.message : String(err) }));
  setTimeout(run, 3 * 60 * 1000).unref();
  setInterval(run, 5 * 60 * 1000).unref();
}

export { TEACHING_MINUTES };
