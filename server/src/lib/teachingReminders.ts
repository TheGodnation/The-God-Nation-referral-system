import { prisma } from './prisma';
import { weekStartOf, addDays, dayKey } from './weeklyReports';
import { pushToPerson, type PushPayload } from './push';
import { isFrench, sendPrivateNoticeId } from './privateNotice';
import { DAY, MIN, TZ_MS, loadBase, pickText, slotStart, topicNumberFor, weekNumber } from './teachingRota';
import { postDueRatingCards } from './teachingCards';
import { postDueRecordings, retryPendingRecordings } from './teachingRecordings';
import { CLIENT_URL } from './env';
import { sendTeachingDayReminders } from './groupTeachers';

// Reminders for the weekly teaching rota, in the bell and as a phone alert, in each person's own language. Only while
// the rota is switched on, and each one goes out once (written in TeachingReminderLog):
//  - Sunday 18:00 before the week:  "Your teaching this week: topic, day, time" (to every teacher)
//  - the evening before (18:00):     "You teach tomorrow"  (not for Monday teachers: Sunday's message already says it)
//  - one hour before:                "Your teaching starts in 1 hour"
// All times are Cameroon time (GMT+1).

export type RotaKind = 'assignment' | 'tomorrow' | 'hour';

/** Claims a reminder: true the first time, false when it was already sent. */
async function claim(key: string): Promise<boolean> {
  const r = await prisma.teachingReminderLog.createMany({ data: [{ key }], skipDuplicates: true });
  return r.count === 1;
}

const whenText = (startsAt: Date, french: boolean, withDay: boolean) =>
  new Intl.DateTimeFormat(french ? 'fr-FR' : 'en-GB', { ...(withDay ? { weekday: 'long' as const } : {}), hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Douala' }).format(startsAt);

function pushFor(kind: RotaKind, french: boolean, d: { topic: string; startsAt: Date }): PushPayload {
  const url = '/member/my-teaching';
  switch (kind) {
    case 'assignment':
      return { title: french ? '📖 Votre enseignement cette semaine' : '📖 Your teaching this week', body: `${d.topic} · ${whenText(d.startsAt, french, true)}`, url, tag: 'rota-assignment' };
    case 'tomorrow':
      return { title: french ? '⏰ Vous enseignez demain' : '⏰ You teach tomorrow', body: `${d.topic} · ${whenText(d.startsAt, french, false)}`, url, tag: 'rota-reminder' };
    case 'hour':
      return { title: french ? '⏰ Votre enseignement commence dans 1 heure' : '⏰ Your teaching starts in 1 hour', body: d.topic, url, tag: 'rota-reminder', urgent: true };
  }
}

/** The central admin's own member profile: the sender of the assignment messages (null when there is none). */
async function centralAdminPersonId(): Promise<string | null> {
  const user = await prisma.user.findFirst({ where: { role: 'ADMIN', active: true, personId: { not: null } }, orderBy: { createdAt: 'asc' }, select: { personId: true } });
  return user?.personId ?? null;
}

/** The private message that carries an assignment, in the teacher's own language. They can answer it in the same chat. */
export function assignmentMessage(french: boolean, d: { topic: string; startsAt: Date; group?: string | null }): string {
  const link = `${CLIENT_URL}/member/my-teaching`;
  const when = `${whenText(d.startsAt, french, true)}`;
  const how = d.group
    ? french
      ? `\n\n🎙 Envoyez votre enseignement en note vocale dans le groupe « ${d.group} », puis touchez « J'ai terminé mon enseignement » juste au-dessus de la zone de message.`
      : `\n\n🎙 Send your teaching as a voice note in the group “${d.group}”, then tap “I have finished my teaching” just above the message box.`
    : '';
  return french
    ? `📖 Votre enseignement cette semaine : ${d.topic}\n🕒 ${when} (heure du Cameroun)\nOuvrez-le ici pour lire le texte et le livre :\n${link}${how}\n\nMerci de répondre ici pour me confirmer que vous l'avez bien reçu.`
    : `📖 Your teaching this week: ${d.topic}\n🕒 ${when} (Cameroon time)\nOpen it here to read the text and the book:\n${link}${how}\n\nPlease reply here to confirm that you received it.`;
}

/** The name of the group where the teachings are rated (and where the leaders send their voice notes), if one is chosen. */
async function teachingGroupName(): Promise<string | null> {
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' }, select: { ratersCommunityId: true } });
  if (!settings?.ratersCommunityId) return null;
  return (await prisma.community.findUnique({ where: { id: settings.ratersCommunityId }, select: { name: true } }))?.name ?? null;
}

/** The one-time "how it works" message, in the teacher's language. */
export function howToMessage(french: boolean, group: string | null): string {
  const where = group ? (french ? `dans le groupe « ${group} »` : `in the group “${group}”`) : french ? 'dans le groupe de l\'enseignement' : 'in the teaching group';
  return french
    ? `📣 Comment se passe votre enseignement de la semaine\n\n1. À l'heure de votre enseignement, enregistrez-le en note vocale et envoyez-la ${where}. N'enregistrez pas 15 minutes d'un coup : enregistrez environ 5 minutes, envoyez, puis recommencez (3 fois environ). C'est plus facile à écrire et à traduire.\n2. Ensuite, touchez le bouton « J'ai terminé mon enseignement », juste au-dessus de la zone de message. Une carte de notation apparaît pour que les membres l'écoutent et la notent.\n3. Si vous oubliez, la carte apparaît d'elle-même 25 minutes après le début de votre heure.\n\nLe guide simple est ici : ${CLIENT_URL}/member/my-teaching/guide\n\nMerci de répondre ici si quelque chose n'est pas clair.`
    : `📣 How your weekly teaching works\n\n1. At your teaching time, record your teaching as a voice note and send it ${where}. Do not record 15 minutes in one go: record about 5 minutes, send it, then do it again (about 3 times). It is easier to write down and translate.\n2. Then tap the button “I have finished my teaching”, just above the message box. A rating card appears so the members can listen and rate it.\n3. If you forget, the card appears by itself 25 minutes after your time starts.\n\nThe simple guide is here: ${CLIENT_URL}/member/my-teaching/guide\n\nPlease reply here if anything is unclear.`;
}

/** Returns the id of the private message when one was sent (only for an assignment). */
async function send(personId: string, kind: RotaKind, d: { topicEn: string; topicFr: string; startsAt: Date }): Promise<string | null> {
  await prisma.notification.create({
    data: { recipientPersonId: personId, type: 'TEACHING_ROTA', metadata: { kind, topicEn: d.topicEn, topicFr: d.topicFr, startsAt: d.startsAt.toISOString() } as any, targetType: 'TeachingRota' },
  });
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  const french = isFrench(person?.preferredLanguage);
  await pushToPerson(personId, pushFor(kind, french, { topic: french ? d.topicFr : d.topicEn, startsAt: d.startsAt })).catch(() => {});
  return kind === 'assignment' ? sendAssignmentMessage(personId, d) : null;
}

/** Only the private message of an assignment (no bell entry, no phone alert). Returns its id, or null when it could not be sent. */
async function sendAssignmentMessage(personId: string, d: { topicEn: string; topicFr: string; startsAt: Date }): Promise<string | null> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  const french = isFrench(person?.preferredLanguage);
  const from = await centralAdminPersonId();
  return from ? sendPrivateNoticeId(from, personId, assignmentMessage(french, { topic: french ? d.topicFr : d.topicEn, startsAt: d.startsAt, group: await teachingGroupName() })) : null;
}

/**
 * "Send the how-it-works message": every active teacher matched to a member gets one private message from the central admin
 * explaining the voice note and the "I have finished" button. Each teacher gets it once, ever.
 */
export async function sendHowToNow(): Promise<{ sent: number; alreadySent: number; sentTo: string[]; notMatched: string[] }> {
  const from = await centralAdminPersonId();
  const teachers = await prisma.teachingTeacher.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  const result = { sent: 0, alreadySent: 0, sentTo: [] as string[], notMatched: teachers.filter((t) => !t.personId).map((t) => t.name) };
  if (!from) return result;
  const group = await teachingGroupName();
  const matched = teachers.filter((t) => t.personId);
  const people = new Map((await prisma.person.findMany({ where: { id: { in: matched.map((t) => t.personId!) } }, select: { id: true, name: true, preferredLanguage: true } })).map((x) => [x.id, x]));
  for (const t of matched) {
    const who = people.get(t.personId!);
    const key = `howto:${t.id}`;
    if (!(await claim(key))) {
      result.alreadySent++;
      continue;
    }
    const messageId = await sendPrivateNoticeId(from, t.personId!, howToMessage(isFrench(who?.preferredLanguage), group));
    if (messageId) {
      await noteMessage(key, messageId);
      result.sent++;
      result.sentTo.push(who?.name ?? t.name);
    } else {
      // could not be sent: let the next press try again
      await prisma.teachingReminderLog.delete({ where: { key } }).catch(() => {});
      result.notMatched.push(who?.name ?? t.name);
    }
  }
  return result;
}

/** Remembers which private message carried an assignment. */
async function noteMessage(key: string, messageId: string | null) {
  if (messageId) await prisma.teachingReminderLog.update({ where: { key }, data: { messageId } }).catch(() => {});
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
  const out: Record<RotaKind, number> = { assignment: 0, tomorrow: 0, hour: 0 };
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
        await noteMessage(key('assignment'), await send(t.personId!, 'assignment', { ...names, startsAt }));
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

  return out;
}

/** The "Send this week's assignments now" button: everyone on the rota gets their assignment now (never twice). */
export async function sendAssignmentsNow(now = new Date()): Promise<{ sent: number; alreadySent: number; sentTo: string[]; passed: string[]; notMatched: string[] }> {
  const empty = { sent: 0, alreadySent: 0, sentTo: [] as string[], passed: [] as string[], notMatched: [] as string[] };
  const p = await plan(now);
  if (!p) return empty;
  const monday = p.thisMonday.getTime() < p.settings.startDate.getTime() ? p.settings.startDate : p.thisMonday;
  const result = { ...empty };
  // Names that cannot receive anything yet, so the central admin is told instead of left guessing.
  result.notMatched = (await prisma.teachingTeacher.findMany({ where: { active: true, personId: null }, select: { name: true }, orderBy: { name: 'asc' } })).map((t) => t.name);
  const named = new Map((await prisma.person.findMany({ where: { id: { in: p.teachers.map((t) => t.personId!) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  for (const t of p.teachers) {
    const names = topicsFor(p, t.startTopic, monday);
    if (!names) continue;
    const startsAt = slotStart(monday, t.dayOfWeek, t.startMinute);
    const who = named.get(t.personId!) ?? t.name;
    if (startsAt.getTime() <= now.getTime()) {
      result.passed.push(who); // this week's slot has already passed
      continue;
    }
    const key = `assignment:${t.id}:${dayKey(monday)}`;
    if (await claim(key)) {
      await noteMessage(key, await send(t.personId!, 'assignment', { ...names, startsAt }));
      result.sent++;
      result.sentTo.push(who);
    } else {
      // Already alerted before assignments travelled as private messages: this one time, add the private message (no second alert).
      const log = await prisma.teachingReminderLog.findUnique({ where: { key } });
      const messageId = log && !log.messageId ? await sendAssignmentMessage(t.personId!, { ...names, startsAt }) : null;
      if (messageId) {
        await noteMessage(key, messageId);
        result.sent++;
        result.sentTo.push(who);
      } else result.alreadySent++;
    }
  }
  return result;
}

export function startTeachingReminderLoop(): void {
  const run = () => Promise.all([sendRotaReminders(), postDueRecordings().then(() => retryPendingRecordings()), postDueRatingCards(), sendTeachingDayReminders()]).catch((err) => console.error('[teaching-rota] reminders failed', { error: err instanceof Error ? err.message : String(err) }));
  setTimeout(run, 3 * 60 * 1000).unref();
  setInterval(run, 5 * 60 * 1000).unref();
}

