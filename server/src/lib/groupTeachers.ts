import { prisma } from './prisma';
import { isCentralAdminPerson } from './centralAdmin';
import { isFrench, sendPrivateNoticeId } from './privateNotice';
import { CLIENT_URL } from './env';

// Teachers who teach with the central admin, in the groups the central admin allows (for example the Headquarters assembly). They
// teach the central admin's way: voice teachings in English and/or French, sent now or kept for later (Send later), with the written
// text checked in their own language. There is no topic, no weekly slot and no rating. Each one has teaching days in a group: every
// week on a weekday, or on one date. Members see who teaches today; the teacher is reminded the day before, and again on the day
// when nothing is recorded yet. All times are Cameroon time (GMT+1, no summer time).

export class TeacherError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const CM_OFFSET = HOUR;

/** The Cameroon date (YYYY-MM-DD), weekday (1 Monday to 7 Sunday) and minutes after midnight of an exact moment. */
export function cameroonParts(d: Date): { dateKey: string; weekday: number; minute: number } {
  const shifted = new Date(d.getTime() + CM_OFFSET);
  const dow = shifted.getUTCDay();
  return { dateKey: shifted.toISOString().slice(0, 10), weekday: dow === 0 ? 7 : dow, minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}
const addDaysKey = (dateKey: string, n: number) => new Date(new Date(`${dateKey}T00:00:00Z`).getTime() + n * 24 * HOUR).toISOString().slice(0, 10);
/** The exact moment of a time on a Cameroon date. */
export const startsAtOf = (dateKey: string, startMinute: number) => new Date(new Date(`${dateKey}T00:00:00Z`).getTime() + startMinute * MIN - CM_OFFSET);
const weekdayOf = (dateKey: string) => {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
};
const timeText = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

type Day = { id: string; dayOfWeek: number | null; date: string | null; startMinute: number };
const occursOn = (d: Day, dateKey: string) => (d.date ? d.date === dateKey : d.dayOfWeek === weekdayOf(dateKey));

/** Whether the person is a teacher in any group (the central admin always can). */
export async function teachesAnywhere(personId: string | null | undefined): Promise<boolean> {
  if (!personId) return false;
  if (await isCentralAdminPerson(personId)) return true;
  return (await prisma.groupTeacher.count({ where: { personId } })) > 0;
}

/** Whether the person may teach in this group: the central admin, or a teacher allowed in this group. */
export async function canTeachIn(personId: string | null | undefined, communityId: string): Promise<boolean> {
  if (!personId) return false;
  if (await isCentralAdminPerson(personId)) return true;
  return (await prisma.groupTeacher.count({ where: { personId, communityId } })) > 0;
}

// ---- The central admin's list -----------------------------------------------------------------------------------

export interface TeacherRow {
  id: string;
  personId: string;
  name: string;
  language: 'en' | 'fr';
  communityId: string;
  communityName: string;
  days: { id: string; dayOfWeek: number | null; date: string | null; time: string }[];
}

export async function listGroupTeachers(): Promise<TeacherRow[]> {
  const rows = await prisma.groupTeacher.findMany({ include: { days: { orderBy: [{ date: 'asc' }, { dayOfWeek: 'asc' }, { startMinute: 'asc' }] } }, orderBy: { createdAt: 'asc' }, take: 500 });
  const [people, communities] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.personId))] } }, select: { id: true, name: true, preferredLanguage: true } }),
    prisma.community.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.communityId))] } }, select: { id: true, name: true } }),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));
  const community = new Map(communities.map((c) => [c.id, c.name]));
  return rows
    .map((r) => ({
      id: r.id,
      personId: r.personId,
      name: person.get(r.personId)?.name ?? '',
      language: isFrench(person.get(r.personId)?.preferredLanguage) ? ('fr' as const) : ('en' as const),
      communityId: r.communityId,
      communityName: community.get(r.communityId) ?? '',
      days: r.days.map((d) => ({ id: d.id, dayOfWeek: d.dayOfWeek, date: d.date, time: timeText(d.startMinute) })),
    }))
    .sort((a, b) => a.communityName.localeCompare(b.communityName) || a.name.localeCompare(b.name));
}

/** Allows a member to teach in a group (idempotent). They need an app account, and cannot be the central admin (who always can). */
export async function addGroupTeacher(personId: string, communityId: string): Promise<{ id: string }> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, erasedAt: true, memberAccount: { select: { id: true } } } });
  if (!person || person.erasedAt) throw new TeacherError('That member was not found.', 404, 'NO_PERSON');
  if (!person.memberAccount) throw new TeacherError('This person has no app account yet, so they cannot teach in the app.', 409, 'NO_ACCOUNT');
  if (await isCentralAdminPerson(personId)) throw new TeacherError('You can already teach in every group.', 409, 'IS_ADMIN');
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true, active: true } });
  if (!community || !community.active) throw new TeacherError('That group was not found.', 404, 'NO_GROUP');
  const row = await prisma.groupTeacher.upsert({ where: { personId_communityId: { personId, communityId } }, create: { personId, communityId }, update: {}, select: { id: true } });
  return row;
}

export async function removeGroupTeacher(id: string): Promise<void> {
  const row = await prisma.groupTeacher.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw new TeacherError('Not found.', 404, 'NOT_FOUND');
  await prisma.groupTeacher.delete({ where: { id } });
}

/** Adds a teaching day: every week on a weekday (1 Monday to 7 Sunday), or on one date (not in the past). */
export async function addTeachingDay(groupTeacherId: string, input: { dayOfWeek?: number; date?: string; time: string }, now = new Date()): Promise<void> {
  const teacher = await prisma.groupTeacher.findUnique({ where: { id: groupTeacherId }, select: { id: true } });
  if (!teacher) throw new TeacherError('Not found.', 404, 'NOT_FOUND');
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input.time);
  if (!m) throw new TeacherError('Choose a time such as 07:00.', 400, 'BAD_TIME');
  const startMinute = Number(m[1]) * 60 + Number(m[2]);
  const weekly = input.dayOfWeek !== undefined;
  const oneOff = input.date !== undefined;
  if (weekly === oneOff) throw new TeacherError('Choose a weekday that repeats, or one date.', 400, 'BAD_DAY');
  if (weekly && !(Number.isInteger(input.dayOfWeek) && input.dayOfWeek! >= 1 && input.dayOfWeek! <= 7)) throw new TeacherError('Choose a day of the week.', 400, 'BAD_DAY');
  if (oneOff) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date!) || Number.isNaN(new Date(`${input.date}T00:00:00Z`).getTime())) throw new TeacherError('Choose a date.', 400, 'BAD_DATE');
    if (input.date! < cameroonParts(now).dateKey) throw new TeacherError('That date has passed.', 400, 'PAST');
  }
  const same = await prisma.teachingDay.findFirst({ where: { groupTeacherId, startMinute, ...(weekly ? { dayOfWeek: input.dayOfWeek } : { date: input.date }) }, select: { id: true } });
  if (same) return;
  await prisma.teachingDay.create({ data: { groupTeacherId, startMinute, dayOfWeek: weekly ? input.dayOfWeek! : null, date: oneOff ? input.date! : null } });
}

export async function removeTeachingDay(dayId: string): Promise<void> {
  const day = await prisma.teachingDay.findUnique({ where: { id: dayId }, select: { id: true } });
  if (!day) throw new TeacherError('Not found.', 404, 'NOT_FOUND');
  await prisma.teachingDay.delete({ where: { id: dayId } });
}

// ---- What members see ---------------------------------------------------------------------------------------------

/** Who teaches in this group today (Cameroon date), with the exact start time, earliest first. */
export async function teachingToday(communityId: string, now = new Date()): Promise<{ name: string; startsAt: string; passed: boolean }[]> {
  const { dateKey } = cameroonParts(now);
  const rows = await prisma.groupTeacher.findMany({ where: { communityId }, include: { days: true } });
  const out: { personId: string; startsAt: Date }[] = [];
  for (const r of rows) for (const d of r.days) if (occursOn(d, dateKey)) out.push({ personId: r.personId, startsAt: startsAtOf(dateKey, d.startMinute) });
  if (out.length === 0) return [];
  const people = await prisma.person.findMany({ where: { id: { in: out.map((o) => o.personId) } }, select: { id: true, name: true } });
  const name = new Map(people.map((p) => [p.id, p.name]));
  return out
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((o) => ({ name: name.get(o.personId) ?? '', startsAt: o.startsAt.toISOString(), passed: o.startsAt.getTime() + 2 * HOUR < now.getTime() }));
}

// ---- Reminders to the teacher --------------------------------------------------------------------------------------

async function claim(key: string): Promise<boolean> {
  const r = await prisma.teachingReminderLog.createMany({ data: [{ key }], skipDuplicates: true });
  return r.count === 1;
}
async function centralAdminPersonId(): Promise<string | null> {
  const user = await prisma.user.findFirst({ where: { role: 'ADMIN', active: true, personId: { not: null } }, orderBy: { createdAt: 'asc' }, select: { personId: true } });
  return user?.personId ?? null;
}

export function dayBeforeMessage(french: boolean, d: { group: string; time: string }): string {
  const link = `${CLIENT_URL}/member/me?tab=scheduled`;
  return french
    ? `🎓 Demain, vous enseignez dans « ${d.group} » à ${d.time} (heure du Cameroun).\nVous pouvez l'enregistrer à l'avance : dans le groupe, touchez le bouton 🌐, enregistrez, puis choisissez « Envoyer plus tard ».\nVos enseignements programmés : ${link}`
    : `🎓 Tomorrow you teach in “${d.group}” at ${d.time} (Cameroon time).\nYou can record it ahead: in the group, tap the 🌐 button, record, then choose “Send later”.\nYour scheduled teachings: ${link}`;
}
export function nothingRecordedMessage(french: boolean, d: { group: string; time: string }): string {
  const link = `${CLIENT_URL}/member/me?tab=scheduled`;
  return french
    ? `🎓 Aujourd'hui, vous enseignez dans « ${d.group} » à ${d.time} (heure du Cameroun), et rien n'est encore enregistré.\nVous pouvez encore enregistrer et programmer maintenant (bouton 🌐 dans le groupe, « Envoyer plus tard »), ou enseigner en direct.\n${link}`
    : `🎓 Today you teach in “${d.group}” at ${d.time} (Cameroon time), and nothing is recorded yet.\nYou can still record and schedule it now (the 🌐 button in the group, “Send later”), or teach live.\n${link}`;
}

/**
 * The evening before (from 17:00) a teacher is told they teach tomorrow; and on the day, three hours before, one who has nothing
 * recorded for that day is told so. Each goes out once, as a private message from the central admin.
 */
export async function sendTeachingDayReminders(now = new Date()): Promise<{ dayBefore: number; nothingRecorded: number }> {
  const result = { dayBefore: 0, nothingRecorded: 0 };
  const rows = await prisma.groupTeacher.findMany({ where: { days: { some: {} } }, include: { days: true } });
  if (rows.length === 0) return result;
  const from = await centralAdminPersonId();
  if (!from) return result;
  const { dateKey, minute } = cameroonParts(now);
  const tomorrow = addDaysKey(dateKey, 1);
  for (const r of rows) {
    const community = await prisma.community.findUnique({ where: { id: r.communityId }, select: { name: true } });
    const person = await prisma.person.findUnique({ where: { id: r.personId }, select: { preferredLanguage: true, erasedAt: true } });
    if (!community || !person || person.erasedAt) continue;
    const french = isFrench(person.preferredLanguage);
    for (const d of r.days) {
      if (minute >= 17 * 60 && occursOn(d, tomorrow) && (await claim(`gday:A:${d.id}:${tomorrow}`))) {
        if (await sendPrivateNoticeId(from, r.personId, dayBeforeMessage(french, { group: community.name, time: timeText(d.startMinute) }))) result.dayBefore++;
      }
      if (occursOn(d, dateKey)) {
        const startsAt = startsAtOf(dateKey, d.startMinute).getTime();
        if (now.getTime() >= startsAt - 3 * HOUR && now.getTime() < startsAt && (await claim(`gday:B:${d.id}:${dateKey}`))) {
          const dayStart = startsAtOf(dateKey, 0);
          const recorded = await prisma.scheduledTeaching.count({ where: { authorPersonId: r.personId, communityId: r.communityId, postAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 24 * HOUR) } } });
          if (recorded === 0 && (await sendPrivateNoticeId(from, r.personId, nothingRecordedMessage(french, { group: community.name, time: timeText(d.startMinute) })))) result.nothingRecorded++;
        }
      }
    }
  }
  return result;
}
