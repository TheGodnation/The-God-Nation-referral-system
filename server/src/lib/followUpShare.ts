import { prisma } from './prisma';
import { notifyFollowUpAssigned, notifyFollowUpBatch } from './notifications';
import { isCentralAdminPerson } from './centralAdmin';
import { followBlock, neverAssignedAmong } from './followRules';

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
  /** People of this assembly or group this leader follows (whatever place the follow-up was first recorded under). */
  headcount: number;
  /** Everyone this leader follows, everywhere. */
  total: number;
  /** For a group: set when this leader leads the assembly the group sits under, not the group itself. */
  viaParent?: string;
}

export const isAway = (awayUntil: Date | null | undefined, now = new Date()) => Boolean(awayUntil && awayUntil > now);

/** A group under an assembly: the assembly (its leaders follow up the group's members too). */
async function parentAssemblyOfGroup(communityId: string): Promise<{ id: string; name: string } | null> {
  const c = await prisma.community.findUnique({ where: { id: communityId }, select: { kind: true, parent: { select: { id: true, name: true, kind: true } } } });
  if (c?.kind !== 'GROUP' || !c.parent) return null;
  return { id: c.parent.id, name: c.parent.name };
}

/**
 * The leaders who can receive people of one community, with how many people each follows there: its own leaders
 * and, for a group under an assembly, the leaders of that assembly too.
 */
export async function leaderLoads(communityId: string, now = new Date()): Promise<LeaderLoad[]> {
  const parent = await parentAssemblyOfGroup(communityId);
  const roles = await prisma.roleAssignment.findMany({
    where: { communityId: { in: parent ? [communityId, parent.id] : [communityId] }, status: 'ACTIVE' },
    select: { communityId: true, person: { select: { id: true, name: true, awayUntil: true } } },
  });
  const leaderIds = [...new Set(roles.map((r) => r.person.id))];
  const [memberIds, follows] = await Promise.all([
    activeMemberIds(communityId),
    prisma.followUpAssignment.findMany({ where: { followerId: { in: leaderIds }, status: 'ACTIVE' }, select: { followerId: true, followedPersonId: true, contextId: true } }),
  ]);
  const total = new Map<string, number>();
  const here = new Map<string, number>();
  for (const f of follows) {
    total.set(f.followerId, (total.get(f.followerId) ?? 0) + 1);
    if (f.contextId === communityId || memberIds.has(f.followedPersonId)) here.set(f.followerId, (here.get(f.followerId) ?? 0) + 1);
  }
  const byPerson = new Map<string, LeaderLoad>();
  for (const r of roles) {
    const ownLeader = r.communityId === communityId;
    const existing = byPerson.get(r.person.id);
    if (existing) {
      if (ownLeader) delete existing.viaParent;
      continue;
    }
    byPerson.set(r.person.id, {
      personId: r.person.id,
      name: r.person.name,
      away: isAway(r.person.awayUntil, now),
      headcount: here.get(r.person.id) ?? 0,
      total: total.get(r.person.id) ?? 0,
      ...(ownLeader || !parent ? {} : { viaParent: parent.name }),
    });
  }
  return [...byPerson.values()].sort((a, b) => a.headcount - b.headcount || a.name.localeCompare(b.name));
}

async function activeMemberIds(communityId: string): Promise<Set<string>> {
  const rows = await prisma.communityMembership.findMany({ where: { communityId, status: 'ACTIVE' }, select: { personId: true } });
  return new Set(rows.map((r) => r.personId));
}

/** A leader's active follow-ups of the people of one assembly or group (or recorded under it). */
function hereWhere(leaderId: string, communityId: string, memberIds: Set<string>) {
  return {
    followerId: leaderId,
    status: 'ACTIVE' as const,
    OR: [{ contextType: 'COMMUNITY' as const, contextId: communityId }, { followedPersonId: { in: [...memberIds] } }],
  };
}

/** The leader with the fewest people, preferring leaders who are not away. */
function lightest(loads: LeaderLoad[]): LeaderLoad | null {
  const present = loads.filter((l) => !l.away);
  const pool = present.length ? present : loads;
  return pool.length ? [...pool].sort((a, b) => a.headcount - b.headcount || a.name.localeCompare(b.name))[0] : null;
}

/** Members of an assembly nobody follows yet (never the central admin, never anyone who leads an assembly or a group). */
export async function unassignedMembers(communityId: string): Promise<{ id: string; name: string }[]> {
  const [members, followed, leaders] = await Promise.all([
    prisma.communityMembership.findMany({
      where: { communityId, status: 'ACTIVE' },
      select: { person: { select: { id: true, name: true } } },
    }),
    // Someone already followed by a leader anywhere (in their assembly or in a group) already has a leader.
    prisma.followUpAssignment.findMany({ where: { status: 'ACTIVE' }, select: { followedPersonId: true } }),
    prisma.roleAssignment.findMany({ where: { communityId, status: 'ACTIVE' }, select: { personId: true } }),
  ]);
  const skip = new Set([...followed.map((f) => f.followedPersonId), ...leaders.map((l) => l.personId)]);
  // Never the central admin, and never anyone who leads an assembly or a group anywhere (leaders are followed up by
  // the central admin and the representatives).
  const never = await neverAssignedAmong(members.map((m) => m.person.id));
  const out: { id: string; name: string }[] = [];
  for (const m of members) {
    if (skip.has(m.person.id) || never.has(m.person.id)) continue;
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
  const memberIds = await activeMemberIds(opts.communityId);
  const closed = await prisma.followUpAssignment.updateMany({
    where: hereWhere(opts.fromLeaderId, opts.communityId, memberIds),
    data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: opts.actorUserId, closeReason: 'Taken back by the central admin' },
  });
  return { released: closed.count };
}

/**
 * Share the people of an assembly or group again from the start: everything its leaders follow here is taken back
 * (nothing is deleted: notes and chats stay), then everyone without a leader is shared evenly among the chosen
 * leaders. `dryRun` only says who would get how many.
 */
export async function redistributeEvenly(communityId: string, actorUserId: string, opts: { leaderPersonIds?: string[]; dryRun?: boolean } = {}): Promise<ShareResult & { takenBack: number }> {
  const all = await leaderLoads(communityId);
  const wanted = opts.leaderPersonIds && opts.leaderPersonIds.length > 0 ? new Set(opts.leaderPersonIds) : null;
  const chosen = all.filter((l) => !wanted || wanted.has(l.personId));
  if (chosen.length === 0) return { assigned: 0, noLeaders: true, remaining: 0, dryRun: Boolean(opts.dryRun), perLeader: [], takenBack: 0 };

  if (opts.dryRun) {
    const memberIds = await activeMemberIds(communityId);
    const followedHere = await prisma.followUpAssignment.findMany({
      where: { status: 'ACTIVE', followerId: { in: all.map((l) => l.personId) }, OR: [{ contextType: 'COMMUNITY', contextId: communityId }, { followedPersonId: { in: [...memberIds] } }] },
      select: { followedPersonId: true },
    });
    const freed = new Set(followedHere.map((f) => f.followedPersonId));
    const stillFollowedElsewhere = await prisma.followUpAssignment.findMany({
      where: { status: 'ACTIVE', followedPersonId: { in: [...freed] }, followerId: { notIn: all.map((l) => l.personId) } },
      select: { followedPersonId: true },
    });
    for (const f of stillFollowedElsewhere) freed.delete(f.followedPersonId);
    const never = await neverAssignedAmong([...freed]);
    for (const id of never) freed.delete(id);
    const unassigned = await unassignedMembers(communityId);
    for (const p of unassigned) freed.add(p.id);
    const total = freed.size;
    const present = chosen.filter((l) => !l.away);
    const pool = present.length ? present : chosen;
    const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name));
    const base = Math.floor(total / sorted.length);
    const extra = total % sorted.length;
    const share = new Map(sorted.map((l, i) => [l.personId, base + (i < extra ? 1 : 0)]));
    return {
      assigned: total,
      noLeaders: false,
      remaining: 0,
      dryRun: true,
      perLeader: chosen.map((l) => ({ personId: l.personId, name: l.name, added: share.get(l.personId) ?? 0 })),
      takenBack: followedHere.length,
    };
  }

  let takenBack = 0;
  for (const l of all) takenBack += (await releasePeople({ fromLeaderId: l.personId, communityId, actorUserId })).released;
  const result = await shareUnassigned(communityId, actorUserId, { leaderPersonIds: chosen.map((l) => l.personId) });
  return { ...result, takenBack };
}

/** Let a second leader follow a person too (the first keeps them): "shared". */
export async function shareWithLeader(opts: { personId: string; toLeaderId: string; communityId: string; actorUserId: string }) {
  // The central admin is never followed up by a leader, and leaders only by the central admin and the representatives.
  if (await followBlock(opts.toLeaderId, opts.personId)) return { created: false };
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
