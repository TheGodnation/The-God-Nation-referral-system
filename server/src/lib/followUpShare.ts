import { prisma } from './prisma';
import { notifyFollowUpAssigned, notifyFollowUpBatch } from './notifications';
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

export interface ShareOptions {
  /** Only these leaders (default: every leader of the assembly). */
  leaderPersonIds?: string[];
  /** Each chosen leader gets up to this many new people (default: share evenly by headcount). */
  perLeader?: number;
  /** Work out who would get whom, and change nothing. */
  dryRun?: boolean;
}

export interface ShareResult {
  assigned: number;
  noLeaders: boolean;
  remaining: number;
  dryRun: boolean;
  perLeader: { personId: string; name: string; added: number }[];
}

/**
 * Give the members nobody follows to the leaders. By default every one goes to the lightest leader in turn, so loads
 * end up even. With `leaderPersonIds` only those leaders are used; with `perLeader` each of them takes up to that many
 * people (so 500 people and 20 leaders at 25 each is exactly 500). People left over stay unassigned and are counted.
 * With `dryRun` nothing is written: it is the preview.
 */
export async function shareUnassigned(communityId: string, actorUserId: string, opts: ShareOptions = {}): Promise<ShareResult> {
  let loads = await leaderLoads(communityId);
  if (opts.leaderPersonIds && opts.leaderPersonIds.length > 0) {
    const wanted = new Set(opts.leaderPersonIds);
    loads = loads.filter((l) => wanted.has(l.personId));
  }
  const dryRun = Boolean(opts.dryRun);
  if (loads.length === 0) return { assigned: 0, noLeaders: true, remaining: 0, dryRun, perLeader: [] };

  const people = await unassignedMembers(communityId);
  const plan: { leaderId: string; personId: string }[] = [];
  if (opts.perLeader && opts.perLeader > 0) {
    let next = 0;
    for (const leader of loads) {
      for (let k = 0; k < opts.perLeader && next < people.length; k += 1) {
        plan.push({ leaderId: leader.personId, personId: people[next].id });
        next += 1;
      }
    }
  } else {
    const working = loads.map((l) => ({ ...l }));
    for (const person of people) {
      const target = lightest(working)!;
      plan.push({ leaderId: target.personId, personId: person.id });
      target.headcount += 1;
    }
  }

  const added = new Map<string, number>();
  for (const step of plan) added.set(step.leaderId, (added.get(step.leaderId) ?? 0) + 1);

  if (!dryRun) {
    const created: { id: string; followerId: string; followedPersonId: string }[] = [];
    for (const step of plan) {
      created.push(
        await prisma.followUpAssignment.create({
          data: { followerId: step.leaderId, followedPersonId: step.personId, contextType: 'COMMUNITY', contextId: communityId, assignedByUserId: actorUserId },
          select: { id: true, followerId: true, followedPersonId: true },
        }),
      );
    }
    // A few people: tell the leader about each. Many at once: one message to the leader, not a flood.
    const BATCH = 3;
    const summarised = new Set<string>();
    for (const a of created) {
      if ((added.get(a.followerId) ?? 0) > BATCH) {
        if (!summarised.has(a.followerId)) {
          summarised.add(a.followerId);
          await notifyFollowUpBatch(a.followerId, added.get(a.followerId) ?? 0);
        }
      } else {
        await notifyFollowUpAssigned(a);
      }
    }
  }
  return {
    assigned: plan.length,
    noLeaders: false,
    remaining: people.length - plan.length,
    dryRun,
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
      const updated = await prisma.followUpAssignment.update({ where: { id: a.id }, data: { followerId: target.personId, introducedAt: null } });
      await moveChat(a.followedPersonId, fromLeaderId, target.personId);
      await notifyFollowUpAssigned(updated);
    }
    target.headcount += 1;
    moved += 1;
  }
  return { moved, skipped };
}

/**
 * Take back everyone a leader follows in one assembly: their follow-ups are closed (nothing is deleted; the history
 * and the chats stay) and the people are free to be assigned again. Used to undo a mistaken or test assignment.
 */
export async function releasePeople(opts: { fromLeaderId: string; communityId: string; actorUserId: string }): Promise<{ released: number }> {
  const closed = await prisma.followUpAssignment.updateMany({
    where: { followerId: opts.fromLeaderId, contextType: 'COMMUNITY', contextId: opts.communityId, status: 'ACTIVE' },
    data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: opts.actorUserId, closeReason: 'Taken back by the central admin' },
  });
  return { released: closed.count };
}

/** Let a second leader follow a person too (the first keeps them): "shared". */
export async function shareWithLeader(opts: { personId: string; toLeaderId: string; communityId: string; actorUserId: string }) {
  // The central admin is never followed up by a leader.
  if (await isCentralAdminPerson(opts.personId)) return { created: false };
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
