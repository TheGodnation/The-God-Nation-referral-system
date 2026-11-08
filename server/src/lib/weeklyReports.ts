import { prisma } from './prisma';
import { listLeaders } from './leaderInstructions';
import { notifyWeeklyReport } from './notifications';
import { representedGeneration } from './representatives';

// Weekly reports from leaders to the central admin. A week runs Monday to Sunday (Cameroon time, UTC+1, no daylight
// saving). A report is ON TIME if sent by Monday 23:59 after the week ends. The report that is "due" at any moment
// is the one for the last week that ended; its colour is shown on the "My leaders" screen:
//   GREEN  sent on time        YELLOW  not sent yet but the deadline has not passed, or sent late
//   RED    deadline passed and still not sent        NEW  the leader's first report is not due yet

export const FIRST_WEEK = new Date('2026-11-09T00:00:00Z'); // the first Monday reports count
const TZ_MS = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export class ReportError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** The Monday (a date at UTC midnight) of the week that contains this instant, in Cameroon time. */
export function weekStartOf(instant: Date): Date {
  const local = new Date(instant.getTime() + TZ_MS);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  return new Date(dayStart - sinceMonday * DAY);
}

/** Monday 23:59 (Cameroon time) after the week ends, as an instant. */
export function deadlineOf(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 7 * DAY + (23 * 60 + 59) * 60 * 1000 - TZ_MS);
}

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);

export type Colour = 'GREEN' | 'YELLOW' | 'RED' | 'NEW';

/** The first week this leader's reports count from (never before the first reporting week). */
function firstCountedWeek(leaderSince: Date): Date {
  const w = weekStartOf(leaderSince);
  return w.getTime() > FIRST_WEEK.getTime() ? w : FIRST_WEEK;
}

export function statusFor(now: Date, leaderSince: Date, reports: { weekStart: Date; late: boolean }[]) {
  const current = weekStartOf(now);
  const due = addDays(current, -7);
  const first = firstCountedWeek(leaderSince);
  const deadline = deadlineOf(due);
  if (due.getTime() < first.getTime()) return { colour: 'NEW' as Colour, dueWeek: due, deadline, missedOfLast4: 0 };
  const forDue = reports.find((r) => r.weekStart.getTime() === due.getTime());
  const colour: Colour = forDue ? (forDue.late ? 'YELLOW' : 'GREEN') : now.getTime() > deadline.getTime() ? 'RED' : 'YELLOW';
  let missedOfLast4 = 0;
  for (let k = 1; k <= 4; k++) {
    const w = addDays(current, -7 * k);
    if (w.getTime() < first.getTime()) break;
    if (now.getTime() > deadlineOf(w).getTime() && !reports.some((r) => r.weekStart.getTime() === w.getTime())) missedOfLast4++;
  }
  return { colour, dueWeek: due, deadline, missedOfLast4 };
}

/** The weeks a leader may report for right now: this week, and last week (if it counts for them). */
function allowedWeeks(now: Date, leaderSince: Date): Date[] {
  const current = weekStartOf(now);
  const due = addDays(current, -7);
  return due.getTime() >= firstCountedWeek(leaderSince).getTime() ? [due, current] : [current];
}

async function leaderSinceMap(personIds: string[]): Promise<Map<string, Date>> {
  const rows = await prisma.roleAssignment.groupBy({ by: ['personId'], where: { personId: { in: personIds }, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, _min: { assignedAt: true } });
  return new Map(rows.map((r) => [r.personId, r._min.assignedAt ?? new Date()]));
}

async function requireLeader(personId: string) {
  const leaders = await listLeaders();
  const me = leaders.find((l) => l.personId === personId);
  if (!me) throw new ReportError('Only leaders send weekly reports.', 403);
  const since = (await leaderSinceMap([personId])).get(personId) ?? new Date();
  return { me, since };
}

// ---- The leader's own report ----------------------------------------------------------------------

export interface ReportInput { contacted: number; needHelp: number; prayerNeeds: string | null; note: string | null }

async function followedUpThisWeek(personId: string, weekStart: Date): Promise<number> {
  const rows = await prisma.followUpContact.findMany({
    where: { followUpAssignment: { followerId: personId }, contactedAt: { gte: new Date(weekStart.getTime() - TZ_MS), lt: new Date(weekStart.getTime() + 7 * DAY - TZ_MS) } },
    select: { followUpAssignment: { select: { followedPersonId: true } } },
  });
  return new Set(rows.map((r) => r.followUpAssignment.followedPersonId)).size;
}

const shape = (r: { weekStart: Date; contacted: number; needHelp: number; prayerNeeds: string | null; note: string | null; late: boolean; submittedAt: Date }) => ({
  weekStart: dayKey(r.weekStart), contacted: r.contacted, needHelp: r.needHelp, prayerNeeds: r.prayerNeeds, note: r.note, late: r.late, submittedAt: r.submittedAt,
});

/** What the leader sees: the week being reported, its deadline, what they already sent, and a hint from the app. */
export async function currentFor(personId: string, now = new Date()) {
  const { since } = await requireLeader(personId);
  const weeks = allowedWeeks(now, since);
  const reports = await prisma.leaderWeeklyReport.findMany({ where: { personId, weekStart: { in: weeks } } });
  const have = (w: Date) => reports.find((r) => r.weekStart.getTime() === w.getTime());
  // Report for last week while it is missing (even late); otherwise the current week.
  const target = weeks.length === 2 && !have(weeks[0]) ? weeks[0] : weeks[weeks.length - 1];
  const existing = have(target) ?? null;
  const deadline = deadlineOf(target);
  const all = await prisma.leaderWeeklyReport.findMany({ where: { personId }, select: { weekStart: true, late: true } });
  const status = statusFor(now, since, all);
  return {
    weekStart: dayKey(target),
    weekEnd: dayKey(addDays(target, 6)),
    deadline,
    isLate: now.getTime() > deadline.getTime(),
    canEdit: !existing || now.getTime() <= deadline.getTime(),
    report: existing ? shape(existing) : null,
    hint: { followedUp: await followedUpThisWeek(personId, target) },
    colour: status.colour,
    otherWeek: weeks.length === 2 ? dayKey(weeks.find((w) => w.getTime() !== target.getTime())!) : null,
  };
}

export async function submitReport(personId: string, input: ReportInput, weekStartRaw: string | undefined, now = new Date()) {
  const { since } = await requireLeader(personId);
  const weeks = allowedWeeks(now, since);
  const requested = weekStartRaw ? parseDay(weekStartRaw) : null;
  if (weekStartRaw && !requested) throw new ReportError('That week is not valid.');
  const target = requested ?? (await (async () => {
    const c = await currentFor(personId, now);
    return parseDay(c.weekStart)!;
  })());
  if (!weeks.some((w) => w.getTime() === target.getTime())) throw new ReportError('You can only report for this week or last week.');
  const deadline = deadlineOf(target);
  const existing = await prisma.leaderWeeklyReport.findUnique({ where: { personId_weekStart: { personId, weekStart: target } } });
  if (existing && now.getTime() > deadline.getTime()) throw new ReportError('This report can no longer be changed.', 403);
  const data = { contacted: input.contacted, needHelp: input.needHelp, prayerNeeds: input.prayerNeeds, note: input.note };
  const saved = existing
    ? await prisma.leaderWeeklyReport.update({ where: { id: existing.id }, data })
    : await prisma.leaderWeeklyReport.create({ data: { personId, weekStart: target, late: now.getTime() > deadline.getTime(), ...data } });
  return shape(saved);
}

export async function historyFor(personId: string) {
  const rows = await prisma.leaderWeeklyReport.findMany({ where: { personId }, orderBy: { weekStart: 'desc' }, take: 12 });
  return rows.map(shape);
}

// ---- The central admin's (and a representative's) view ----------------------------------------------

/** Every leader with their colour for the report now due. A representative passes their generation to see only theirs. */
export async function leadersOverview(opts: { generation?: number | null } = {}, now = new Date()) {
  const all = await listLeaders();
  const leaders = opts.generation === undefined || opts.generation === null ? all : all.filter((l) => l.generations.includes(opts.generation!));
  const ids = leaders.map((l) => l.personId);
  const [since, reports] = await Promise.all([
    leaderSinceMap(ids),
    prisma.leaderWeeklyReport.findMany({ where: { personId: { in: ids } }, select: { personId: true, weekStart: true, late: true, submittedAt: true }, orderBy: { weekStart: 'desc' } }),
  ]);
  const byPerson = new Map<string, typeof reports>();
  for (const r of reports) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r]);
  const rows = leaders.map((l) => {
    const mine = byPerson.get(l.personId) ?? [];
    const st = statusFor(now, since.get(l.personId) ?? now, mine);
    return {
      personId: l.personId,
      name: l.name,
      generations: l.generations,
      assemblies: l.assemblies,
      colour: st.colour,
      missedOfLast4: st.missedOfLast4,
      lastReportWeek: mine[0] ? dayKey(mine[0].weekStart) : null,
      lastReportLate: mine[0]?.late ?? false,
    };
  });
  const order: Record<Colour, number> = { RED: 0, YELLOW: 1, NEW: 2, GREEN: 3 };
  rows.sort((a, b) => order[a.colour] - order[b.colour] || a.name.localeCompare(b.name));
  const dueWeek = addDays(weekStartOf(now), -7);
  return {
    dueWeek: dayKey(dueWeek),
    deadline: deadlineOf(dueWeek),
    counts: { GREEN: rows.filter((r) => r.colour === 'GREEN').length, YELLOW: rows.filter((r) => r.colour === 'YELLOW').length, RED: rows.filter((r) => r.colour === 'RED').length, NEW: rows.filter((r) => r.colour === 'NEW').length },
    leaders: rows,
  };
}

/** One leader's reports, for the screens that may look at them. A representative may only look at leaders of their generation. */
export async function leaderHistory(personId: string, opts: { generation?: number | null } = {}) {
  const leaders = await listLeaders();
  const leader = leaders.find((l) => l.personId === personId);
  if (!leader) throw new ReportError('Leader not found.', 404);
  if (opts.generation !== undefined && opts.generation !== null && !leader.generations.includes(opts.generation)) throw new ReportError('Leader not found.', 404);
  return { name: leader.name, assemblies: leader.assemblies, reports: await historyFor(personId) };
}

/** A manual reminder: to chosen leaders, or to every leader who is late (RED). Only people who still owe a report get one. */
export async function remind(opts: { personIds?: string[]; allLate?: boolean; generation?: number | null }, now = new Date()) {
  const overview = await leadersOverview({ generation: opts.generation }, now);
  const wanted = opts.allLate ? overview.leaders.filter((l) => l.colour === 'RED') : overview.leaders.filter((l) => (opts.personIds ?? []).includes(l.personId));
  const dueWeek = parseDay(overview.dueWeek)!;
  const current = weekStartOf(now);
  let reminded = 0;
  for (const l of wanted) {
    if (l.colour === 'GREEN') continue;
    const owesDue = l.colour === 'RED' || l.colour === 'YELLOW';
    const lateKind = now.getTime() > deadlineOf(dueWeek).getTime();
    const hasDue = owesDue ? Boolean(await prisma.leaderWeeklyReport.findUnique({ where: { personId_weekStart: { personId: l.personId, weekStart: dueWeek } } })) : false;
    if (owesDue && !hasDue) {
      await notifyWeeklyReport(l.personId, lateKind ? 'REPORT_LATE' : 'REPORT_REMINDER', dueWeek);
      reminded++;
    } else if (l.colour === 'NEW') {
      const has = await prisma.leaderWeeklyReport.findUnique({ where: { personId_weekStart: { personId: l.personId, weekStart: current } } });
      if (!has) {
        await notifyWeeklyReport(l.personId, 'REPORT_REMINDER', current);
        reminded++;
      }
    }
  }
  return { reminded };
}

// ---- Representatives' summaries --------------------------------------------------------------------

/** The week a representative's summary is for right now: last week until it is written, then this week. */
export async function summaryFor(personId: string, now = new Date()) {
  const generation = await representedGeneration(personId);
  if (generation === null) throw new ReportError('Only the representative of a generation can use this.', 403);
  const current = weekStartOf(now);
  const due = addDays(current, -7);
  const weeks = due.getTime() >= FIRST_WEEK.getTime() ? [due, current] : [current];
  const rows = await prisma.representativeWeeklySummary.findMany({ where: { generation, weekStart: { in: weeks } } });
  const target = weeks.length === 2 && !rows.some((r) => r.weekStart.getTime() === due.getTime()) ? due : current;
  const existing = rows.find((r) => r.weekStart.getTime() === target.getTime());
  return { generation, weekStart: dayKey(target), weekEnd: dayKey(addDays(target, 6)), summary: existing?.summary ?? '' , sent: Boolean(existing) };
}

export async function saveSummary(personId: string, text: string, now = new Date()) {
  const cleaned = text.trim();
  if (cleaned.length < 3) throw new ReportError('Please write a few words.');
  if (cleaned.length > 3000) throw new ReportError('The summary is too long (3000 characters at most).');
  const target = await summaryFor(personId, now);
  const weekStart = parseDay(target.weekStart)!;
  await prisma.representativeWeeklySummary.upsert({
    where: { generation_weekStart: { generation: target.generation, weekStart } },
    create: { generation: target.generation, weekStart, personId, summary: cleaned },
    update: { summary: cleaned, personId },
  });
  return { ...target, summary: cleaned, sent: true };
}

export async function recentSummaries() {
  const rows = await prisma.representativeWeeklySummary.findMany({ orderBy: [{ weekStart: 'desc' }, { generation: 'asc' }], take: 30 });
  const people = await prisma.person.findMany({ where: { id: { in: rows.map((r) => r.personId) } }, select: { id: true, name: true } });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({ generation: r.generation, weekStart: dayKey(r.weekStart), summary: r.summary, representativeName: names.get(r.personId) ?? '', submittedAt: r.submittedAt }));
}

// ---- Automatic reminders ---------------------------------------------------------------------------

async function sendOnce(personId: string, weekStart: Date, kind: 'SUNDAY' | 'LATE'): Promise<boolean> {
  try {
    await prisma.weeklyReportReminder.create({ data: { personId, weekStart, kind } });
  } catch {
    return false; // already sent
  }
  await notifyWeeklyReport(personId, kind === 'LATE' ? 'REPORT_LATE' : 'REPORT_REMINDER', weekStart).catch(() => {});
  return true;
}

/**
 * Sunday from 18:00: leaders who have not reported this week get a reminder (once). Tuesday from 08:00: those who
 * missed Monday's deadline get a "late" notice (once). Safe to run as often as you like.
 */
export async function sendScheduledReminders(now = new Date()): Promise<{ sunday: number; late: number }> {
  const local = new Date(now.getTime() + TZ_MS);
  const dow = local.getUTCDay();
  const hour = local.getUTCHours();
  const out = { sunday: 0, late: 0 };
  const leaders = await listLeaders();
  const since = await leaderSinceMap(leaders.map((l) => l.personId));
  const current = weekStartOf(now);
  if (dow === 0 && hour >= 18) {
    for (const l of leaders) {
      if (firstCountedWeek(since.get(l.personId) ?? now).getTime() > current.getTime()) continue;
      if (await prisma.leaderWeeklyReport.findUnique({ where: { personId_weekStart: { personId: l.personId, weekStart: current } } })) continue;
      if (await sendOnce(l.personId, current, 'SUNDAY')) out.sunday++;
    }
  }
  if (dow === 2 && hour >= 8) {
    const due = addDays(current, -7);
    for (const l of leaders) {
      if (firstCountedWeek(since.get(l.personId) ?? now).getTime() > due.getTime()) continue;
      if (await prisma.leaderWeeklyReport.findUnique({ where: { personId_weekStart: { personId: l.personId, weekStart: due } } })) continue;
      if (await sendOnce(l.personId, due, 'LATE')) out.late++;
    }
  }
  return out;
}

export function startWeeklyReportLoop(): void {
  const run = () => sendScheduledReminders().catch((err) => console.error('[weekly-reports] reminders failed', { error: err instanceof Error ? err.message : String(err) }));
  setTimeout(run, 4 * 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
