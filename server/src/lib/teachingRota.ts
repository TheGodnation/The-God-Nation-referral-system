import { z } from 'zod';
import { prisma } from './prisma';
import { searchPersonIds, fold } from './personSearch';
import { weekStartOf, addDays, dayKey } from './weeklyReports';
import { canReadBook } from './examWorld';
import { isFrench } from './privateNotice';
import { isCentralAdminPerson } from './centralAdmin';

// The weekly teaching rota. A group of leaders each teach 15 minutes once a week, in the same day-and-time slot every
// week, and the TOPIC moves on by one every week (so after as many weeks as there are topics, everyone has taught
// every topic). A teacher sees only their own assignment. The whole thing is invisible to teachers until the central
// admin switches it on.
//
// The names and the teaching texts are never in the code (the repository is public). The central admin loads them from
// a private "plan" file (see `planSchema` and `loadPlan`), and can load a new one later to add topics or people.

export const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;
export const TZ_MS = 60 * MIN; // Cameroon time, GMT+1, no daylight saving
export const TEACHING_MINUTES = 15;
export const DEFAULT_START = '2026-11-23';

export class RotaError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan file

const text = (max: number) => z.string().trim().min(1).max(max);
const topicTextSchema = z.object({
  topic: text(300),
  bookTitle: text(300),
  chapter: text(300),
  teachingOn: text(500),
  help: text(3000),
  meaning: text(6000),
  startLabel: text(200),
  start: text(4000),
  ifNotLabel: text(200),
  ifNot: text(3000),
  dominion: text(6000),
  verses: z.array(text(120)).max(20),
});
export const planSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  topics: z
    .array(
      z.object({
        number: z.number().int().min(1).max(500),
        kind: z.enum(['right', 'key']),
        bookWords: z.array(text(120)).max(6).optional(),
        en: topicTextSchema,
        fr: topicTextSchema.optional(),
      }),
    )
    .max(500),
  teachers: z
    .array(
      z.object({
        name: text(200),
        startTopic: z.number().int().min(1).max(500),
        dayOfWeek: z.number().int().min(1).max(7),
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      }),
    )
    .max(500)
    .optional(),
});
export type Plan = z.infer<typeof planSchema>;
type TopicText = z.infer<typeof topicTextSchema>;

const minuteOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const timeOf = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);
const isMonday = (d: Date) => d.getUTCDay() === 1;
const normName = (s: string) => fold(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

/**
 * Loads a plan file: topics are added or updated by number, the guide is replaced, and teachers are added by name
 * (a teacher already on the list is never changed or removed). Settings are created on the first load.
 */
export async function loadPlan(input: unknown) {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new RotaError(`The plan file is not right: ${first?.path.join('.') || 'file'} (${first?.message ?? 'unreadable'}).`, 400, 'BAD_PLAN');
  }
  const plan = parsed.data;
  const numbers = plan.topics.map((t) => t.number);
  if (new Set(numbers).size !== numbers.length) throw new RotaError('Two topics in the plan have the same number.', 400, 'BAD_PLAN');
  if (plan.startDate && !isMonday(parseDay(plan.startDate))) throw new RotaError('The start date must be a Monday.', 400, 'BAD_PLAN');

  const existing = await prisma.teachingSettings.findUnique({ where: { id: 'main' } });
  const known = new Set((await prisma.teachingTopic.findMany({ select: { number: true } })).map((t) => t.number));
  const allNumbers = new Set([...known, ...numbers]);
  for (const t of plan.teachers ?? []) if (!allNumbers.has(t.startTopic)) throw new RotaError(`${t.name}: topic number ${t.startTopic} is not in the list.`, 400, 'BAD_PLAN');

  let topicsAdded = 0;
  let topicsUpdated = 0;
  let teachersAdded = 0;
  let teachersKept = 0;
  await prisma.$transaction(async (tx) => {
    if (!existing) {
      await tx.teachingSettings.create({ data: { id: 'main', startDate: parseDay(plan.startDate ?? DEFAULT_START) } });
    }
    for (const t of plan.topics) {
      const data = { kind: t.kind, textEn: t.en as any, textFr: (t.fr ?? null) as any, bookWords: (t.bookWords ?? null) as any };
      if (known.has(t.number)) {
        await tx.teachingTopic.update({ where: { number: t.number }, data });
        topicsUpdated++;
      } else {
        await tx.teachingTopic.create({ data: { number: t.number, ...data } });
        topicsAdded++;
      }
    }
    // A new French text means the central admin has to read it again.
    if (existing && plan.topics.some((t) => t.fr)) await tx.teachingSettings.update({ where: { id: 'main' }, data: { frenchChecked: false } });
    const have = new Set((await tx.teachingTeacher.findMany({ select: { name: true } })).map((t) => normName(t.name)));
    for (const t of plan.teachers ?? []) {
      if (have.has(normName(t.name))) {
        teachersKept++;
        continue;
      }
      await tx.teachingTeacher.create({ data: { name: t.name, dayOfWeek: t.dayOfWeek, startMinute: minuteOf(t.startTime), startTopic: t.startTopic } });
      have.add(normName(t.name));
      teachersAdded++;
    }
  });
  await suggestRatersGroup().catch(() => {});
  return { topicsAdded, topicsUpdated, teachersAdded, teachersKept };
}

/** If no rating group is chosen yet and exactly one group is called "Leadership Development", use it (the admin can change it). */
async function suggestRatersGroup() {
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' }, select: { ratersCommunityId: true } });
  if (!settings || settings.ratersCommunityId) return;
  const found = await prisma.community.findMany({ where: { active: true, name: { contains: 'leadership development', mode: 'insensitive' } }, select: { id: true }, take: 2 });
  if (found.length === 1) await prisma.teachingSettings.update({ where: { id: 'main' }, data: { ratersCommunityId: found[0].id } });
}

// ---------------------------------------------------------------------------------------------------------------------
// The rotation

/** How many whole weeks after the start this Monday is (negative before the start). */
export function weekNumber(startDate: Date, weekStart: Date): number {
  return Math.round((weekStart.getTime() - startDate.getTime()) / (7 * DAY));
}

/** The topic number a teacher teaches in week `week` (0 = the first week): their start topic, moved on by one each week. */
export function topicNumberFor(startTopic: number, topicNumbers: number[], week: number): number {
  const list = [...topicNumbers].sort((a, b) => a - b);
  if (list.length === 0) return startTopic;
  const at = Math.max(0, list.indexOf(startTopic));
  const n = list.length;
  return list[(((at + week) % n) + n) % n];
}

/** The instant a teacher's slot starts in the week that begins on this Monday (a date at UTC midnight). */
export function slotStart(weekStart: Date, dayOfWeek: number, startMinute: number): Date {
  return new Date(weekStart.getTime() + (dayOfWeek - 1) * DAY + startMinute * MIN - TZ_MS);
}

export async function loadBase() {
  const [settings, topics] = await Promise.all([prisma.teachingSettings.findUnique({ where: { id: 'main' } }), prisma.teachingTopic.findMany({ orderBy: { number: 'asc' } })]);
  return { settings, topics };
}

export const pickText = (lang: 'en' | 'fr', topic: { textEn: unknown; textFr: unknown }): { text: TopicText; language: 'en' | 'fr' } => {
  if (lang === 'fr' && topic.textFr) return { text: topic.textFr as TopicText, language: 'fr' };
  return { text: topic.textEn as TopicText, language: 'en' };
};

// ---------------------------------------------------------------------------------------------------------------------
// A teacher's own view

/**
 * Finds the book on the site from the words saved with the topic: the first word must be in the English title, and each
 * other word (written "Volume 2|Volume II|Volume Two" for the ways a title may be spelled) must appear as a whole word, so
 * "Volume II" never matches "Volume III". Returns null when no book (or more than one) fits.
 */
export async function resolveBook(words: unknown, personId: string): Promise<{ id: string; canOpen: boolean } | null> {
  if (!Array.isArray(words) || words.length === 0 || typeof words[0] !== 'string') return null;
  const candidates = await prisma.libraryBook.findMany({ where: { titleEn: { contains: (words[0] as string).split('|')[0].trim(), mode: 'insensitive' } }, select: { id: true, titleEn: true } });
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWord = (title: string, alt: string) => new RegExp(`(^|[^A-Za-z0-9])${esc(alt.trim())}([^A-Za-z0-9]|$)`, 'i').test(title);
  const fits = candidates.filter((b) => (words as string[]).slice(1).every((w) => w.split('|').some((alt) => hasWord(b.titleEn, alt))));
  if (fits.length !== 1) return null;
  return { id: fits[0].id, canOpen: await canReadBook(personId, fits[0].id) };
}

export async function teacherView(personId: string, now = new Date()) {
  const { settings, topics } = await loadBase();
  if (!settings || !settings.enabled) return { enabled: false, isTeacher: false };
  const teacher = await prisma.teachingTeacher.findFirst({ where: { personId, active: true } });
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  const lang: 'en' | 'fr' = isFrench(person?.preferredLanguage) ? 'fr' : 'en';
  if (!teacher) return { enabled: true, isTeacher: false };

  const numbers = topics.map((t) => t.number);
  const thisMonday = weekStartOf(now);
  const startDate = settings.startDate;
  const first = thisMonday.getTime() < startDate.getTime() ? startDate : thisMonday;
  const mondays = [first, addDays(first, 7)];

  const weeks = [];
  for (const monday of mondays) {
    const number = topicNumberFor(teacher.startTopic, numbers, weekNumber(startDate, monday));
    const topic = topics.find((t) => t.number === number);
    if (!topic) continue;
    const startsAt = slotStart(monday, teacher.dayOfWeek, teacher.startMinute);
    const endsAt = new Date(startsAt.getTime() + TEACHING_MINUTES * MIN);
    const picked = pickText(lang, topic);
    weeks.push({
      weekStart: dayKey(monday),
      isCurrent: monday.getTime() === thisMonday.getTime(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status: now >= endsAt ? ('done' as const) : now >= startsAt ? ('now' as const) : ('upcoming' as const),
      kind: topic.kind as 'right' | 'key',
      text: picked.text,
      textLanguage: picked.language,
      book: await resolveBook(topic.bookWords, personId),
    });
  }
  return {
    enabled: true,
    isTeacher: true,
    language: lang,
    started: now.getTime() >= startDate.getTime(),
    startsOn: dayKey(startDate),
    minutes: TEACHING_MINUTES,
    weeks,
    results: await resultsForTeacher(teacher.id, teacher.startTopic, numbers, startDate, topics, lang, now),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The central admin's view

export async function adminOverview(now = new Date()) {
  const { settings, topics } = await loadBase();
  const teachers = await prisma.teachingTeacher.findMany({ orderBy: [{ active: 'desc' }, { dayOfWeek: 'asc' }, { startMinute: 'asc' }, { name: 'asc' }] });
  const people = await prisma.person.findMany({
    where: { id: { in: teachers.map((t) => t.personId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, name: true, preferredLanguage: true, memberAccount: { select: { id: true } } },
  });
  const personById = new Map(people.map((p) => [p.id, p]));
  const numbers = topics.map((t) => t.number);
  const titleOf = (n: number) => ((topics.find((t) => t.number === n)?.textEn as TopicText | undefined)?.topic ?? `#${n}`);
  const thisMonday = weekStartOf(now);
  const startDate = settings?.startDate ?? parseDay(DEFAULT_START);
  const baseMonday = thisMonday.getTime() < startDate.getTime() ? startDate : thisMonday;
  const weeks = [0, 1, 2, 3].map((k) => addDays(baseMonday, 7 * k));

  const summaries = await ratingSummaries();
  const rows = teachers.map((t) => {
    const p = t.personId ? personById.get(t.personId) : undefined;
    return {
      ratings: summaries.get(t.id) ?? { total: 0, average: null, counts: emptyCounts() },
      id: t.id,
      name: t.name,
      active: t.active,
      personId: t.personId,
      memberName: p?.name ?? null,
      hasAccount: Boolean(p?.memberAccount),
      language: p ? (isFrench(p.preferredLanguage) ? ('fr' as const) : ('en' as const)) : null,
      dayOfWeek: t.dayOfWeek,
      startTime: timeOf(t.startMinute),
      startTopic: t.startTopic,
      upcoming: weeks.map((w) => {
        const n = topicNumberFor(t.startTopic, numbers, weekNumber(startDate, w));
        return { weekStart: dayKey(w), number: n, title: titleOf(n) };
      }),
    };
  });

  const active = rows.filter((r) => r.active);
  const warnings: string[] = [];
  if (!settings || topics.length === 0) warnings.push('NO_PLAN');
  if (active.some((r) => !r.personId)) warnings.push('UNMATCHED');
  if (active.length > topics.length && topics.length > 0) warnings.push('MORE_TEACHERS_THAN_TOPICS');
  const slotCount = new Map<string, number>();
  for (const r of active) slotCount.set(`${r.dayOfWeek}-${r.startTime}`, (slotCount.get(`${r.dayOfWeek}-${r.startTime}`) ?? 0) + 1);
  if ([...slotCount.values()].some((n) => n > 1)) warnings.push('SAME_SLOT');
  const frenchNeeded = active.some((r) => r.language === 'fr');
  if (frenchNeeded && topics.some((t) => !t.textFr)) warnings.push('FRENCH_MISSING');
  if (!settings?.ratersCommunityId) warnings.push('NO_RATING_GROUP');

  return {
    settings: settings ? { enabled: settings.enabled, startDate: dayKey(settings.startDate), frenchChecked: settings.frenchChecked, started: now.getTime() >= settings.startDate.getTime() } : null,
    raters: await raterInfo(settings?.ratersCommunityId ?? null),
    weeks: weeks.map(dayKey),
    topics: topics.map((t) => ({ number: t.number, kind: t.kind, title: (t.textEn as TopicText).topic, hasFrench: Boolean(t.textFr) })),
    teachers: rows,
    warnings,
    frenchNeeded,
  };
}

export async function topicPreview(number: number) {
  const t = await prisma.teachingTopic.findUnique({ where: { number } });
  if (!t) throw new RotaError('Topic not found.', 404);
  return { number: t.number, kind: t.kind, en: t.textEn, fr: t.textFr };
}

// ---------------------------------------------------------------------------------------------------------------------
// Switching on, the roster

export async function updateSettings(input: { enabled?: boolean; frenchChecked?: boolean; startDate?: string; ratersCommunityId?: string | null }) {
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' } });
  if (!settings) throw new RotaError('Load the teaching plan first.', 409, 'NO_PLAN');
  const data: { enabled?: boolean; frenchChecked?: boolean; startDate?: Date; ratersCommunityId?: string | null } = {};
  if (input.ratersCommunityId !== undefined) {
    if (input.ratersCommunityId && !(await prisma.community.findUnique({ where: { id: input.ratersCommunityId }, select: { id: true } }))) throw new RotaError('That group was not found.', 404);
    data.ratersCommunityId = input.ratersCommunityId;
  }
  if (input.startDate !== undefined) {
    const d = parseDay(input.startDate);
    if (!isMonday(d)) throw new RotaError('The first week must start on a Monday.', 400, 'NOT_MONDAY');
    if (settings.enabled && settings.startDate.getTime() <= Date.now()) throw new RotaError('The rota has already started, so the start date cannot change.', 409, 'STARTED');
    data.startDate = d;
  }
  if (input.frenchChecked !== undefined) data.frenchChecked = input.frenchChecked;
  if (input.enabled === true && !settings.enabled) {
    const overview = await adminOverview();
    if (overview.topics.length === 0) throw new RotaError('Load the teaching plan first.', 409, 'NO_PLAN');
    const frenchChecked = data.frenchChecked ?? settings.frenchChecked;
    if (overview.frenchNeeded && !frenchChecked) throw new RotaError('A French-speaking teacher is on the list. Read the French and tick "French checked" first.', 409, 'FRENCH_NOT_CHECKED');
    if (overview.frenchNeeded && overview.warnings.includes('FRENCH_MISSING')) throw new RotaError('Some topics have no French text yet.', 409, 'FRENCH_MISSING');
    data.enabled = true;
  } else if (input.enabled !== undefined) {
    data.enabled = input.enabled;
  }
  await prisma.teachingSettings.update({ where: { id: 'main' }, data });
  return adminOverview();
}

export async function addTeacher(input: { name: string; personId?: string | null; dayOfWeek: number; startTime: string }) {
  const topics = await prisma.teachingTopic.findMany({ select: { number: true }, orderBy: { number: 'asc' } });
  if (topics.length === 0) throw new RotaError('Load the teaching plan first.', 409, 'NO_PLAN');
  const used = new Set((await prisma.teachingTeacher.findMany({ where: { active: true }, select: { startTopic: true } })).map((t) => t.startTopic));
  const startTopic = topics.find((t) => !used.has(t.number))?.number ?? topics[0].number;
  if (input.personId) await assertFreePerson(input.personId);
  const created = await prisma.teachingTeacher.create({
    data: { name: input.name.trim(), personId: input.personId ?? null, dayOfWeek: input.dayOfWeek, startMinute: minuteOf(input.startTime), startTopic },
  });
  return created;
}

async function assertFreePerson(personId: string, exceptTeacherId?: string) {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) throw new RotaError('That member was not found.', 404);
  const taken = await prisma.teachingTeacher.findUnique({ where: { personId }, select: { id: true, name: true } });
  if (taken && taken.id !== exceptTeacherId) throw new RotaError(`That member is already on the list as ${taken.name}.`, 409, 'PERSON_TAKEN');
}

export async function updateTeacher(id: string, input: { name?: string; personId?: string | null; dayOfWeek?: number; startTime?: string; active?: boolean }) {
  const teacher = await prisma.teachingTeacher.findUnique({ where: { id } });
  if (!teacher) throw new RotaError('Teacher not found.', 404);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.personId !== undefined) {
    if (input.personId) await assertFreePerson(input.personId, id);
    data.personId = input.personId;
  }
  if (input.dayOfWeek !== undefined) data.dayOfWeek = input.dayOfWeek;
  if (input.startTime !== undefined) data.startMinute = minuteOf(input.startTime);
  if (input.active !== undefined) data.active = input.active;
  return prisma.teachingTeacher.update({ where: { id }, data });
}

/** Members the central admin can attach to a name (by name or number), with the language each one reads. */
export async function searchMembers(search: string) {
  const q = search.trim();
  if (q.length < 2) return [];
  const ids = await searchPersonIds(q, { includeTestData: false, limit: 20 });
  if (ids.length === 0) return [];
  const rows = await prisma.person.findMany({
    where: { id: { in: ids }, memberAccount: { isNot: null } },
    select: { id: true, name: true, preferredLanguage: true },
    orderBy: { name: 'asc' },
  });
  const taken = new Map((await prisma.teachingTeacher.findMany({ where: { personId: { in: rows.map((r) => r.id) } }, select: { personId: true, name: true } })).map((t) => [t.personId!, t.name]));
  return rows.map((r) => ({ id: r.id, name: r.name, language: isFrench(r.preferredLanguage) ? ('fr' as const) : ('en' as const), takenBy: taken.get(r.id) ?? null }));
}

/**
 * Matches each unmatched name to the one member account with the same name (accents, capitals and word order do not
 * matter). A name with two accounts, or with none, is left for the central admin to choose by hand.
 */
export async function matchTeachers() {
  const pending = await prisma.teachingTeacher.findMany({ where: { personId: null, active: true } });
  const result = { matched: 0, ambiguous: [] as string[], notFound: [] as string[] };
  for (const t of pending) {
    const words = normName(t.name).split(' ');
    const ids = await searchPersonIds(words.join(' '), { includeTestData: false, limit: 50 });
    const candidates = ids.length
      ? await prisma.person.findMany({ where: { id: { in: ids }, erasedAt: null, memberAccount: { isNot: null } }, select: { id: true, name: true } })
      : [];
    const exact = candidates.filter((c) => normName(c.name) === normName(t.name));
    if (exact.length === 1) {
      const taken = await prisma.teachingTeacher.findUnique({ where: { personId: exact[0].id }, select: { id: true } });
      if (taken) result.ambiguous.push(t.name);
      else {
        await prisma.teachingTeacher.update({ where: { id: t.id }, data: { personId: exact[0].id } });
        result.matched++;
      }
    } else if (exact.length > 1) result.ambiguous.push(t.name);
    else result.notFound.push(t.name);
  }
  return result;
}


// ---------------------------------------------------------------------------------------------------------------------
// Ratings: after a teaching, the members of the Leadership group (and the central admin) rate it. Four levels. A
// teacher sees only the totals (never who gave which); the central admin sees everything.

export const LEVELS = ['EXCELLENT', 'VERY_GOOD', 'GOOD', 'KEEP_GROWING'] as const;
export type Level = (typeof LEVELS)[number];
const WEIGHT: Record<Level, number> = { EXCELLENT: 4, VERY_GOOD: 3, GOOD: 2, KEEP_GROWING: 1 };
export const emptyCounts = (): Record<Level, number> => ({ EXCELLENT: 0, VERY_GOOD: 0, GOOD: 0, KEEP_GROWING: 0 });

/** Whether this member may rate: a member of the chosen group (or, with no group chosen, a teacher), and the central admin. */
export async function isRater(personId: string): Promise<boolean> {
  if (await isCentralAdminPerson(personId)) return true;
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' }, select: { ratersCommunityId: true } });
  if (settings?.ratersCommunityId) {
    return Boolean(await prisma.communityMembership.findFirst({ where: { personId, communityId: settings.ratersCommunityId, status: 'ACTIVE' }, select: { id: true } }));
  }
  return Boolean(await prisma.teachingTeacher.findFirst({ where: { personId, active: true }, select: { id: true } }));
}

/** Everyone who may rate (for the reminders and the admin's count). */
export async function raterIds(): Promise<string[]> {
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' }, select: { ratersCommunityId: true } });
  const ids = new Set<string>();
  if (settings?.ratersCommunityId) {
    for (const m of await prisma.communityMembership.findMany({ where: { communityId: settings.ratersCommunityId, status: 'ACTIVE' }, select: { personId: true } })) ids.add(m.personId);
  } else {
    for (const t of await prisma.teachingTeacher.findMany({ where: { active: true, personId: { not: null } }, select: { personId: true } })) ids.add(t.personId!);
  }
  for (const a of await prisma.user.findMany({ where: { role: 'ADMIN', active: true, personId: { not: null } }, select: { personId: true } })) ids.add(a.personId!);
  return [...ids];
}

async function raterInfo(communityId: string | null) {
  const community = communityId ? await prisma.community.findUnique({ where: { id: communityId }, select: { id: true, name: true } }) : null;
  return { communityId: community?.id ?? null, communityName: community?.name ?? null, count: (await raterIds()).length };
}

export async function searchGroups(search: string) {
  const q = search.trim();
  if (q.length < 2) return [];
  const rows = await prisma.community.findMany({ where: { active: true, name: { contains: q, mode: 'insensitive' } }, select: { id: true, name: true, kind: true }, orderBy: { name: 'asc' }, take: 20 });
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
}

type Summary = { total: number; average: number | null; counts: Record<Level, number> };
const summarize = (counts: Record<Level, number>): Summary => {
  const total = LEVELS.reduce((n, l) => n + counts[l], 0);
  const sum = LEVELS.reduce((n, l) => n + counts[l] * WEIGHT[l], 0);
  return { total, average: total ? Math.round((sum / total) * 10) / 10 : null, counts };
};

/** Totals per teacher over every week (for the admin list). */
export async function ratingSummaries(): Promise<Map<string, Summary>> {
  const rows = await prisma.teachingRating.groupBy({ by: ['teacherId', 'level'], _count: { _all: true } });
  const byTeacher = new Map<string, Record<Level, number>>();
  for (const r of rows) {
    const c = byTeacher.get(r.teacherId) ?? emptyCounts();
    if ((LEVELS as readonly string[]).includes(r.level)) c[r.level as Level] += r._count._all;
    byTeacher.set(r.teacherId, c);
  }
  return new Map([...byTeacher].map(([id, c]) => [id, summarize(c)]));
}

/** For the teacher: how the last weeks were rated, as totals only (nobody's name). */
export async function resultsForTeacher(teacherId: string, startTopic: number, numbers: number[], startDate: Date, topics: { number: number; textEn: unknown; textFr: unknown }[], lang: 'en' | 'fr', now: Date) {
  const since = addDays(weekStartOf(now), -28);
  const rows = await prisma.teachingRating.findMany({ where: { teacherId, weekStart: { gte: since } } });
  const byWeek = new Map<string, Record<Level, number>>();
  for (const r of rows) {
    const key = dayKey(r.weekStart);
    const c = byWeek.get(key) ?? emptyCounts();
    if ((LEVELS as readonly string[]).includes(r.level)) c[r.level as Level]++;
    byWeek.set(key, c);
  }
  return [...byWeek]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([weekStart, counts]) => {
      const topic = topics.find((t) => t.number === topicNumberFor(startTopic, numbers, weekNumber(startDate, parseDay(weekStart))));
      return { weekStart, topic: topic ? pickText(lang, topic).text.topic : '', ...summarize(counts) };
    });
}

/** For the central admin: every rating of one teacher, week by week, with who gave which. */
export async function ratingDetail(teacherId: string) {
  const teacher = await prisma.teachingTeacher.findUnique({ where: { id: teacherId } });
  if (!teacher) throw new RotaError('Teacher not found.', 404);
  const { settings, topics } = await loadBase();
  const numbers = topics.map((t) => t.number);
  const rows = await prisma.teachingRating.findMany({ where: { teacherId }, orderBy: { weekStart: 'desc' } });
  const people = await prisma.person.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.raterPersonId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const weeks = new Map<string, { counts: Record<Level, number>; raters: { name: string; level: string }[] }>();
  for (const r of rows) {
    const key = dayKey(r.weekStart);
    const w = weeks.get(key) ?? { counts: emptyCounts(), raters: [] };
    if ((LEVELS as readonly string[]).includes(r.level)) w.counts[r.level as Level]++;
    w.raters.push({ name: nameOf.get(r.raterPersonId) ?? '?', level: r.level });
    weeks.set(key, w);
  }
  return {
    name: teacher.name,
    weeks: [...weeks].map(([weekStart, w]) => {
      const topic = settings ? topics.find((t) => t.number === topicNumberFor(teacher.startTopic, numbers, weekNumber(settings.startDate, parseDay(weekStart)))) : undefined;
      return { weekStart, topic: topic ? (topic.textEn as TopicText).topic : '', ...summarize(w.counts), raters: w.raters };
    }),
  };
}
