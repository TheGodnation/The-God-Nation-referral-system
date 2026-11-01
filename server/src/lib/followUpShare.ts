import { prisma } from './prisma';
import { notifyFollowUpAssigned } from './notifications';
import { isCentralAdminPerson } from './centralAdmin';

// ---------------------------------------------------------------------------
// Sharing the people of an assembly among its leaders, evenly by headcount,
// and handing people (with their records) from one leader to another. There
// is no limit on how many leaders an assembly has, and one person may be
// followed by more than one leader ("shared"). A leader who is away is
// skipped when new people are given out.
// ---------------------------------------------------------------------------

export interface LeaderLoad {
  personId: string;
  name: string;
  away: boolean;
  headcount: number;
}

export const isAway = (awayUntil: Date | null | undefined, now = new Date()) => Boolean(awayUntil && awayUntil > now);

/** The active leaders of one assembly with how many people each follows there. */
export async function leaderLoads(communityId: string, now = new Date()): Promise<LeaderLoad[]> {
  const roles = await prisma.roleAssignment.findMany({
    where: { communityId, status: 'ACTIVE' },
    select: { person: { select: { id: true, name: true, awayUntil: true } } },
  });
  const counts = await prisma.followUpAssignment.groupBy({
    by: ['followerId'],
    where: { contextType: 'COMMUNITY', contextId: communityId, status: 'ACTIVE' },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [c.followerId, c._count._all]));
  return roles
    .map((r) => ({ personId: r.person.id, name: r.person.name, away: isAway(r.person.awayUntil, now), headcount: countOf.get(r.person.id) ?? 0 }))
    .sort((a, b) => a.headcount - b.headcount || a.name.localeCompare(b.name));
}

/** The leader with the fewest people, preferring leaders who are not away. */
function lightest(loads: LeaderLoad[]): LeaderLoad | null {
  const present = loads.filter((l) => !l.away);
  const pool = present.length ? present : loads;
  return pool.length ? [...pool].sort((a, b) => a.headcount - b.headcount || a.name.localeCompare(b.name))[0] : null;
}

/** Members of an assembly nobody follows yet (never leaders, never the central admin). */
export async function unassignedMembers(communityId: string): Promise<{ id: string; name: string }[]> {
  const [members, followed, leaders] = await Promise.all([
    prisma.communityMembership.findMany({
      where: { communityId, status: 'ACTIVE' },
      select: { person: { select: { id: true, name: true } } },
    }),
    prisma.followUpAssignment.findMany({ where: { contextType: 'COMMUNITY', contextId: communityId, status: 'ACTIVE' }, select: { followedPersonId: true } }),
    prisma.roleAssignment.findMany({ where: { communityId, status: 'ACTIVE' }, select: { personId: true } }),
  ]);
  const skip = new Set([...followed.map((f) => f.followedPersonId), ...leaders.map((l) => l.personId)]);
  const out: { id: string; name: string }[] = [];
  for (const m of members) {
    if (skip.has(m.person.id)) continue;
    if (await isCentralAdminPerson(m.person.id)) continue;
    out.push(m.person);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Give every member nobody follows to the lightest leader, one at a time, so loads end up even. */
export async function shareUnassigned(communityId: string, actorUserId: string) {
  const loads = await leaderLoads(communityId);
  if (loads.length === 0) return { assigned: 0, noLeaders: true, perLeader: [] as { personId: string; name: string; added: number }[] };
  const people = await unassignedMembers(communityId);
  const added = new Map<string, number>();
  for (const person of people) {
    const target = lightest(loads)!;
    const created = await prisma.followUpAssignment.create({
      data: { followerId: target.personId, followedPersonId: person.id, contextType: 'COMMUNITY', contextId: communityId, assignedByUserId: actorUserId },
    });
    target.headcount += 1;
    added.set(target.personId, (added.get(target.personId) ?? 0) + 1);
    await notifyFollowUpAssigned(created);
  }
  return {
    assigned: people.length,
    noLeaders: false,
    perLeader: loads.map((l) => ({ personId: l.personId, name: l.name, added: added.get(l.personId) ?? 0 })),
  };
}

/** Move the private chat (its whole history) to the new leader, when they have none with this person yet. */
async function moveChat(personId: string, fromLeaderId: string, toLeaderId: string) {
  const mine = await prisma.privateConversation.findUnique({ where: { memberPersonId_initiatorPersonId: { memberPersonId: personId, initiatorPersonId: fromLeaderId } }, select: { id: true } });
  if (!mine) return;
  const theirs = await prisma.privateConversation.findUnique({ where: { memberPersonId_initiatorPersonId: { memberPersonId: personId, initiatorPersonId: toLeaderId } }, select: { id: true } });
  if (theirs) return;
  await prisma.privateConversation.update({ where: { id: mine.id }, data: { initiatorPersonId: toLeaderId } });
}

/**
 * Hand people from one leader to another, records and chat history with them.
 * `toLeaderId` given: everyone goes to that leader; otherwise each person goes to the
 * lightest other leader of the assembly. `onlyPersonId` hands over a single person.
 */
export async function handOverPeople(opts: {
  fromLeaderId: string;
  communityId: string;
  toLeaderId?: string;
  onlyPersonId?: string;
  actorUserId: string;
}) {
  const { fromLeaderId, communityId, toLeaderId, onlyPersonId } = opts;
  const mine = await prisma.followUpAssignment.findMany({
    where: { followerId: fromLeaderId, contextType: 'COMMUNITY', contextId: communityId, status: 'ACTIVE', ...(onlyPersonId ? { followedPersonId: onlyPersonId } : {}) },
  });
  if (mine.length === 0) return { moved: 0, skipped: 0 };

  const loads = (await leaderLoads(communityId)).filter((l) => l.personId !== fromLeaderId && (!toLeaderId || l.personId === toLeaderId));
  let moved = 0;
  let skipped = 0;
  for (const a of mine) {
    const target = lightest(loads);
    if (!target) {
      skipped += 1;
      continue;
    }
    const already = await prisma.followUpAssignment.findFirst({
      where: { followerId: target.personId, followedPersonId: a.followedPersonId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (already) {
      // The new leader already follows them: just stop mine.
      await prisma.followUpAssignment.update({ where: { id: a.id }, data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: opts.actorUserId, closeReason: 'Handed over' } });
    } else {
      const updated = await prisma.followUpAssignment.update({ where: { id: a.id }, data: { followerId: target.personId } });
      await moveChat(a.followedPersonId, fromLeaderId, target.personId);
      await notifyFollowUpAssigned(updated);
    }
    target.headcount += 1;
    moved += 1;
  }
  return { moved, skipped };
}

/** Let a second leader follow a person too (the first keeps them): "shared". */
export async function shareWithLeader(opts: { personId: string; toLeaderId: string; communityId: string; actorUserId: string }) {
  const existing = await prisma.followUpAssignment.findFirst({
    where: { followerId: opts.toLeaderId, followedPersonId: opts.personId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (existing) return { created: false };
  const created = await prisma.followUpAssignment.create({
    data: { followerId: opts.toLeaderId, followedPersonId: opts.personId, contextType: 'COMMUNITY', contextId: opts.communityId, assignedByUserId: opts.actorUserId },
  });
  await notifyFollowUpAssigned(created);
  return { created: true };
}
