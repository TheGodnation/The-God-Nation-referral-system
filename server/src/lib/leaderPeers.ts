import { prisma } from './prisma';
import { getHeadquartersCommunityId, getCommunityGeneration, getCommunityIdsAtGeneration } from './tree';

export interface LeaderPeerRow {
  personId: string;
  name: string;
  communityId: string;
  communityName: string;
  generation: number;
}

// Phase 2A — Leader peer discovery. Deliberately its own module, kept
// separate from lib/leadership.ts (isCommunityAdministrator/
// findActiveScopedRole/hasConversationAccess remain completely unmodified
// and unused here beyond a plain RoleAssignment read) — matching the exact
// precedent lib/announcements.ts already set: two unrelated authorization
// concerns can both read RoleAssignment without one being built on top of
// the other. Peer visibility is a separate concept from Community
// administration authority; nothing here grants or checks administrative
// control over any Community.
//
// A "peer" is any OTHER Person holding an ACTIVE SCOPED_LEADER
// RoleAssignment for a Community whose Headquarters-relative generation
// (see lib/tree.ts's getCommunityGeneration) matches at least one of the
// requesting Leader's own ACTIVE Community-scoped RoleAssignments'
// generations. Geography-scoped roles, CommunityMembership, and
// GeographicAssignment never factor in anywhere in this function — only
// Community.parentId (via the two generation helpers) and RoleAssignment.
//
// requestingPersonId must already be server-resolved (e.g. via
// requireLinkedPerson) — this function never accepts or trusts a
// client-supplied identity.
export async function findLeaderPeers(requestingPersonId: string): Promise<LeaderPeerRow[]> {
  const headquartersId = await getHeadquartersCommunityId();
  if (!headquartersId) return [];

  const ownRoles = await prisma.roleAssignment.findMany({
    where: { personId: requestingPersonId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } },
    select: { communityId: true },
  });
  // No active Community-scoped role at all (including a Leader who only
  // holds a Geography-scoped role) — no organizational generation to be a
  // peer within, so no peers, by design (see the module comment above).
  if (ownRoles.length === 0) return [];

  const ownGenerations = new Set<number>();
  for (const role of ownRoles) {
    const generation = await getCommunityGeneration(role.communityId!, headquartersId);
    // null means this Community isn't actually part of the Headquarters
    // tree (e.g. an unrelated root, or unreachable data) — never treated as
    // a valid generation to match peers against.
    if (generation !== null) ownGenerations.add(generation);
  }
  if (ownGenerations.size === 0) return [];

  // Every Community id at each of the requester's own applicable
  // generations, together with the exact generation it belongs to — a
  // Community can only ever belong to one generation, so this mapping can
  // never disagree with itself even across multiple buckets.
  const generationByCommunityId = new Map<string, number>();
  for (const generation of ownGenerations) {
    const ids = await getCommunityIdsAtGeneration(headquartersId, generation);
    for (const id of ids) generationByCommunityId.set(id, generation);
  }
  if (generationByCommunityId.size === 0) return [];

  const peerRoles = await prisma.roleAssignment.findMany({
    where: {
      roleType: 'SCOPED_LEADER',
      status: 'ACTIVE',
      communityId: { in: Array.from(generationByCommunityId.keys()) },
      // Self-exclusion: covers every one of the requester's own roles in
      // one clause, regardless of how many generations they span — the
      // requester's own RoleAssignment rows can never appear in this
      // result no matter which generation bucket their Community falls in.
      personId: { not: requestingPersonId },
    },
    include: {
      person: { select: { id: true, name: true } },
      community: { select: { id: true, name: true } },
    },
    orderBy: [{ community: { name: 'asc' } }, { person: { name: 'asc' } }],
  });

  // De-duplicates on the (personId, communityId) pair. The database already
  // enforces at most one ACTIVE RoleAssignment per (personId, communityId)
  // (a partial unique index — see RoleAssignment_active_person_community_key
  // in prisma/migrations), so this is a defensive backstop rather than the
  // only thing preventing a duplicated row here.
  // A Person who is a Leader of more than one qualifying Community is
  // deliberately NOT collapsed into one row — each Community they
  // administer is its own peer entry (the simplest representation that
  // doesn't lose which Community(ies) actually qualify them, per this
  // phase's own guidance).
  const seenPairs = new Set<string>();
  const rows: LeaderPeerRow[] = [];
  for (const role of peerRoles) {
    if (!role.community) continue;
    const key = `${role.person.id}:${role.community.id}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    rows.push({
      personId: role.person.id,
      name: role.person.name,
      communityId: role.community.id,
      communityName: role.community.name,
      generation: generationByCommunityId.get(role.community.id)!,
    });
  }
  return rows;
}
