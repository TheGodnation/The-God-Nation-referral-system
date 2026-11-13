import { prisma } from './prisma';
import { startAdaptiveLoop } from './activity';
import { requiredLeadershipExamIds } from './cells';

// ---------------------------------------------------------------------------
// The weekly "Leadership Academy progress" post. Once a week, in each
// assembly's group chat, the central admin's profile congratulates the
// members who passed a Leadership Academy exam that week — names only for the
// people being celebrated. Those who are slow are never named: their leader
// sees a flag on their card and encourages them privately.
// ---------------------------------------------------------------------------

const WEEK = 7 * 24 * 60 * 60 * 1000;

interface Advancer {
  personId: string;
  name: string;
  books: number[];
}

/** Members who passed a school exam in the window, grouped by their assembly. */
export async function advancersByAssembly(since: Date, until: Date): Promise<Map<string, Advancer[]>> {
  const examIds = await requiredLeadershipExamIds();
  const result = new Map<string, Advancer[]>();
  if (examIds.length === 0) return result;

  const passes = await prisma.attempt.findMany({
    where: { assessmentId: { in: examIds }, status: 'SUBMITTED', passed: true, submittedAt: { gt: since, lte: until } },
    select: { personId: true, assessment: { select: { trainingBook: { select: { trainingOrder: true } } } }, person: { select: { name: true } } },
  });
  if (passes.length === 0) return result;

  const byPerson = new Map<string, Advancer>();
  for (const p of passes) {
    const entry = byPerson.get(p.personId) ?? { personId: p.personId, name: p.person.name, books: [] };
    const order = p.assessment.trainingBook?.trainingOrder;
    if (order && !entry.books.includes(order)) entry.books.push(order);
    byPerson.set(p.personId, entry);
  }
  const memberships = await prisma.communityMembership.findMany({
    where: { personId: { in: [...byPerson.keys()] }, status: 'ACTIVE' },
    select: { personId: true, communityId: true },
  });
  for (const m of memberships) {
    const list = result.get(m.communityId) ?? [];
    list.push(byPerson.get(m.personId)!);
    result.set(m.communityId, list);
  }
  for (const list of result.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export function weeklyPostText(advancers: Advancer[]): string {
  const names = advancers.map((a) => (a.books.length ? `${a.name} (${a.books.sort((x, y) => x - y).map((b) => `#${b}`).join(', ')})` : a.name));
  const list = names.join(', ');
  return [
    `Leadership Academy this week: congratulations to ${list}! Keep going, one book at a time.`,
    `Académie de leadership cette semaine : félicitations à ${list} ! Continuez, un livre après l'autre.`,
  ].join('\n\n');
}

/**
 * Posts this week's congratulations (once a week) in each assembly that had
 * someone advance. Returns how many assemblies were posted to. Posts as the
 * central admin's member profile; does nothing if there is none.
 */
export async function processSchoolProgressPost(now = new Date()): Promise<number> {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { lastSchoolProgressPostAt: true } });
  const last = settings?.lastSchoolProgressPostAt ?? null;
  if (last && now.getTime() - last.getTime() < WEEK) return 0;

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', active: true, personId: { not: null } }, select: { personId: true } });
  if (!admin?.personId) return 0;

  // Make sure the settings row exists, then claim the week first, so two servers never post twice.
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton' }, update: {} });
  const claimed = await prisma.settings.updateMany({
    where: { id: 'singleton', OR: [{ lastSchoolProgressPostAt: null }, { lastSchoolProgressPostAt: last ?? undefined }] },
    data: { lastSchoolProgressPostAt: now },
  });
  if (claimed.count === 0) return 0;

  const since = last ?? new Date(now.getTime() - WEEK);
  const groups = await advancersByAssembly(since, now);
  let posted = 0;
  for (const [communityId, advancers] of groups) {
    const conversation = await prisma.conversation.findUnique({ where: { communityId }, select: { id: true } });
    if (!conversation) continue;
    await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: admin.personId, body: weeklyPostText(advancers) } });
    posted += 1;
  }
  return posted;
}

export function startSchoolProgressLoop(): void {
  startAdaptiveLoop(processSchoolProgressPost, (err) => console.error('[school] weekly post failed', { error: err instanceof Error ? err.message : String(err) }));
}
