import { prisma } from './prisma';
import { CONTACT_DAYS_PER_WEEK, followUpCardsFor } from './followUpCard';

// ---------------------------------------------------------------------------
// How each assembly is doing, as a colour, rolled up the tree: leader →
// assembly → the assembly above → the central admin. The same rules for every
// level. GREEN: leaders are in touch with their people twice a week, nobody
// is in an emergency, nothing is overdue. YELLOW: slipping. RED: an
// emergency, no leader, or hardly any contact. GREY: no members yet.
// ---------------------------------------------------------------------------

export type Health = 'GREEN' | 'YELLOW' | 'RED' | 'GREY';
const DAY = 24 * 60 * 60 * 1000;
const RANK: Record<Health, number> = { GREY: 0, GREEN: 1, YELLOW: 2, RED: 3 };
const worst = (a: Health, b: Health): Health => (RANK[a] >= RANK[b] ? a : b);

export interface HealthCounts {
  members: number;
  leaders: number;
  followed: number;
  unassigned: number;
  /** People followed for more than 3 days: the ones the weekly rule applies to. */
  eligible: number;
  contactedTwice: number;
  emergencies: number;
  overdue: number;
  openQuestions: number;
}

export interface HealthSummary extends HealthCounts {
  /** Share of eligible people the leaders were in touch with on 2+ days this week (null when nobody is eligible). */
  weeklyRate: number | null;
  color: Health;
}

export interface HealthRow {
  id: string;
  name: string;
  parentId: string | null;
  autoCreated: boolean;
  own: HealthSummary;
  /** This assembly and everything below it. */
  tree: HealthSummary;
}

const empty = (): HealthCounts => ({ members: 0, leaders: 0, followed: 0, unassigned: 0, eligible: 0, contactedTwice: 0, emergencies: 0, overdue: 0, openQuestions: 0 });
const add = (a: HealthCounts, b: HealthCounts): HealthCounts => ({
  members: a.members + b.members,
  leaders: a.leaders + b.leaders,
  followed: a.followed + b.followed,
  unassigned: a.unassigned + b.unassigned,
  eligible: a.eligible + b.eligible,
  contactedTwice: a.contactedTwice + b.contactedTwice,
  emergencies: a.emergencies + b.emergencies,
  overdue: a.overdue + b.overdue,
  openQuestions: a.openQuestions + b.openQuestions,
});

export function colourOf(c: HealthCounts): { weeklyRate: number | null; color: Health } {
  const weeklyRate = c.eligible > 0 ? c.contactedTwice / c.eligible : null;
  let color: Health;
  if (c.members === 0) color = 'GREY';
  else if (c.leaders === 0 || c.emergencies > 0 || (weeklyRate !== null && weeklyRate < 0.4)) color = 'RED';
  else if ((weeklyRate !== null && weeklyRate < 0.7) || c.overdue > 0 || c.openQuestions > 0 || c.unassigned > c.members * 0.2) color = 'YELLOW';
  else color = 'GREEN';
  return { weeklyRate, color };
}

const summary = (c: HealthCounts): HealthSummary => ({ ...c, ...colourOf(c) });

/** Every assembly's health, with its own numbers and the whole tree under it. */
export async function assemblyHealth(now = new Date()): Promise<HealthRow[]> {
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const settledBefore = new Date(now.getTime() - 3 * DAY);

  const [communities, memberships, roles, assignments, questions] = await Promise.all([
    prisma.community.findMany({ where: { active: true }, select: { id: true, name: true, parentId: true, autoCreated: true }, orderBy: { createdAt: 'asc' } }),
    prisma.communityMembership.findMany({ where: { status: 'ACTIVE' }, select: { personId: true, communityId: true } }),
    prisma.roleAssignment.findMany({ where: { status: 'ACTIVE', communityId: { not: null } }, select: { personId: true, communityId: true } }),
    prisma.followUpAssignment.findMany({ where: { status: 'ACTIVE' }, select: { id: true, followerId: true, followedPersonId: true, contextId: true, assignedAt: true } }),
    prisma.followUpEscalation.groupBy({ by: ['communityId'], where: { status: 'OPEN' }, _count: { _all: true } }),
  ]);
  const assignmentIds = assignments.map((a) => a.id);
  const [latest, weekContacts, leaderMessages, admins] = await Promise.all([
    assignmentIds.length
      ? prisma.followUpContact.findMany({
          where: { followUpAssignmentId: { in: assignmentIds } },
          orderBy: { contactedAt: 'desc' },
          distinct: ['followUpAssignmentId'],
          select: { followUpAssignmentId: true, wellbeingStatus: true, nextFollowUpDate: true },
        })
      : [],
    assignmentIds.length
      ? prisma.followUpContact.findMany({ where: { followUpAssignmentId: { in: assignmentIds }, contactedAt: { gte: weekAgo } }, select: { followUpAssignmentId: true, contactedAt: true } })
      : [],
    prisma.privateMessage.findMany({
      where: { createdAt: { gte: weekAgo }, deletedAt: null, conversation: { initiatorPersonId: { not: null } }, senderPersonId: { not: null } },
      select: { senderPersonId: true, createdAt: true, conversation: { select: { initiatorPersonId: true, memberPersonId: true } } },
    }),
    prisma.user.findMany({ where: { role: 'ADMIN', active: true, personId: { not: null } }, select: { personId: true } }),
  ]);

  const latestOf = new Map(latest.map((l) => [l.followUpAssignmentId, l]));
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const days = new Map<string, Set<string>>(); // assignmentId -> contact days
  const mark = (key: string, d: Date) => {
    const set = days.get(key) ?? new Set<string>();
    set.add(dayKey(d));
    days.set(key, set);
  };
  for (const c of weekContacts) mark(c.followUpAssignmentId, c.contactedAt);
  const assignmentOf = new Map(assignments.map((a) => [`${a.followerId}:${a.followedPersonId}`, a.id]));
  for (const m of leaderMessages) {
    // Only the leader's own messages to the person they follow.
    if (m.senderPersonId !== m.conversation.initiatorPersonId) continue;
    const id = assignmentOf.get(`${m.conversation.initiatorPersonId}:${m.conversation.memberPersonId}`);
    if (id) mark(id, m.createdAt);
  }

  const adminIds = new Set(admins.map((a) => a.personId as string));
  const own = new Map<string, HealthCounts>(communities.map((c) => [c.id, empty()]));
  const leaderKey = new Set(roles.map((r) => `${r.communityId}:${r.personId}`));
  const followedKey = new Set(assignments.map((a) => `${a.contextId}:${a.followedPersonId}`));
  for (const m of memberships) {
    const c = own.get(m.communityId);
    if (!c) continue;
    c.members += 1;
    const key = `${m.communityId}:${m.personId}`;
    if (!leaderKey.has(key) && !followedKey.has(key) && !adminIds.has(m.personId)) c.unassigned += 1;
  }
  for (const r of roles) {
    const c = own.get(r.communityId as string);
    if (c) c.leaders += 1;
  }
  for (const a of assignments) {
    const c = own.get(a.contextId);
    if (!c) continue;
    c.followed += 1;
    const l = latestOf.get(a.id);
    if (l?.wellbeingStatus === 'EMERGENCY') c.emergencies += 1;
    if (l?.nextFollowUpDate && l.nextFollowUpDate < now) c.overdue += 1;
    if (a.assignedAt < settledBefore) {
      c.eligible += 1;
      if ((days.get(a.id)?.size ?? 0) >= CONTACT_DAYS_PER_WEEK) c.contactedTwice += 1;
    }
  }
  for (const q of questions) {
    const c = own.get(q.communityId);
    if (c) c.openQuestions += q._count._all;
  }

  // Roll up: each assembly's tree = itself plus everything below.
  const children = new Map<string, string[]>();
  for (const c of communities) if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
  const treeCache = new Map<string, { counts: HealthCounts; color: Health }>();
  function tree(id: string, seen = new Set<string>()): { counts: HealthCounts; color: Health } {
    const cached = treeCache.get(id);
    if (cached) return cached;
    if (seen.has(id)) return { counts: empty(), color: 'GREY' };
    seen.add(id);
    let counts = own.get(id) ?? empty();
    let color = colourOf(counts).color;
    for (const child of children.get(id) ?? []) {
      const t = tree(child, seen);
      counts = add(counts, t.counts);
      color = worst(color, t.color);
    }
    const result = { counts, color };
    treeCache.set(id, result);
    return result;
  }

  return communities.map((c) => {
    const t = tree(c.id);
    const ownCounts = own.get(c.id)!;
    return {
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      autoCreated: c.autoCreated,
      own: summary(ownCounts),
      tree: { ...t.counts, weeklyRate: colourOf(t.counts).weeklyRate, color: t.color },
    };
  });
}

export interface LeaderHealthRow {
  personId: string;
  name: string;
  away: boolean;
  people: number;
  contactedTwice: number;
  needingAttention: number;
  emergencies: number;
}

/** One assembly's leaders, each with their people and how many of them need attention. */
export async function leadersHealthIn(communityId: string, now = new Date()): Promise<LeaderHealthRow[]> {
  const roles = await prisma.roleAssignment.findMany({
    where: { communityId, status: 'ACTIVE' },
    select: { person: { select: { id: true, name: true, awayUntil: true } } },
  });
  const rows: LeaderHealthRow[] = [];
  for (const r of roles) {
    const cards = (await followUpCardsFor(r.person.id, now)).filter(() => true);
    rows.push({
      personId: r.person.id,
      name: r.person.name,
      away: Boolean(r.person.awayUntil && r.person.awayUntil > now),
      people: cards.length,
      contactedTwice: cards.filter((c) => c.contactDaysThisWeek >= CONTACT_DAYS_PER_WEEK).length,
      needingAttention: cards.filter((c) => c.flags.length > 0).length,
      emergencies: cards.filter((c) => c.flags.includes('EMERGENCY')).length,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
