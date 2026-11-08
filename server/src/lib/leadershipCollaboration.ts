import { prisma } from './prisma';
import { getHeadquartersCommunityId, getCommunityGeneration } from './tree';
import { centralAdminAmong } from './centralAdmin';
import { representedGeneration } from './representatives';

// Phase 2B — Same-Generation Leader Collaboration. Deliberately its own
// module, exactly like lib/leaderPeers.ts (Phase 2A) — never touching
// isCommunityAdministrator, findActiveScopedRole, or hasConversationAccess.
// Collaboration eligibility is a completely separate concept from Community
// administration authority or Community Conversation access: nothing here
// grants, checks, or implies either one.
//
// A Leader is eligible for generation G's collaboration if and only if they
// hold at least one ACTIVE Community-scoped SCOPED_LEADER RoleAssignment
// whose Community's Headquarters-relative generation (lib/tree.ts's
// getCommunityGeneration) equals G. Geography-scoped roles,
// CommunityMembership, and GeographicAssignment never factor in anywhere in
// this module — matching Phase 2A's peer-discovery precedent exactly, for
// the same reason: this is an organizational-generation concept, not a
// geographic one.
//
// A Leader with active Community-scoped roles at multiple generations is
// eligible for each generation independently — this module never collapses
// them into one, and eligibility for one generation never implies or grants
// eligibility for any other.

/** The room for every leader of every generation. It is stored like a generation, with this number. */
export const ALL_LEADERS_ROOM = -1;

/** The rooms a leader can enter: the "All leaders" room first, then each generation they lead in. */
export async function getRoomsForLeader(personId: string): Promise<number[]> {
  const generations = await getEligibleLeadershipCollaborationGenerations(personId);
  return generations.length > 0 ? [ALL_LEADERS_ROOM, ...generations] : [];
}

/**
 * Every distinct generation for which requestingPersonId currently holds at
 * least one ACTIVE Community-scoped SCOPED_LEADER RoleAssignment. Returns an
 * empty array for a Leader with no active Community-scoped role at all
 * (including a Leader who only holds a Geography-scoped role), or when no
 * Headquarters is configured yet — never a fabricated generation.
 */
export async function getEligibleLeadershipCollaborationGenerations(requestingPersonId: string): Promise<number[]> {
  const headquartersId = await getHeadquartersCommunityId();
  if (!headquartersId) return [];

  const ownRoles = await prisma.roleAssignment.findMany({
    where: { personId: requestingPersonId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } },
    select: { communityId: true },
  });
  if (ownRoles.length === 0) return [];

  const generations = new Set<number>();
  // The representative of a generation is also in that generation's room.
  const represented = await representedGeneration(requestingPersonId);
  if (represented !== null) generations.add(represented);
  for (const role of ownRoles) {
    const generation = await getCommunityGeneration(role.communityId!, headquartersId);
    // null means this Community isn't actually part of the Headquarters
    // tree — never treated as a valid generation to grant collaboration
    // access to.
    if (generation !== null) generations.add(generation);
  }
  return Array.from(generations).sort((a, b) => a - b);
}

/**
 * Whether requestingPersonId is currently eligible for generation G's
 * collaboration — true iff G appears in their own set of eligible
 * generations (see above). The server is always the sole source of truth
 * for both the acting Person (req.leaderPersonId, via requireLinkedPerson)
 * and the generation being checked (parsed from the URL as an integer,
 * never trusted merely because the client supplied it) — a client can never
 * expand its own access by asserting a different generation, Community id,
 * or Person id.
 */
export async function canAccessLeadershipCollaboration(requestingPersonId: string, generation: number): Promise<boolean> {
  const eligible = await getEligibleLeadershipCollaborationGenerations(requestingPersonId);
  // The "All leaders" room (generation -1) is open to every leader who leads in at least one generation.
  if (generation === ALL_LEADERS_ROOM) return eligible.length > 0;
  return eligible.includes(generation);
}

/**
 * Every generation has at most one LeadershipCollaborationConversation
 * (LeadershipCollaborationConversation.generation is unique). Created
 * lazily, on first access — most generations may never actually need one.
 * `upsert` makes this race-safe under the same unique constraint, so
 * concurrent callers can never create two.
 */
export async function getOrCreateLeadershipCollaborationConversation(generation: number) {
  return prisma.leadershipCollaborationConversation.upsert({
    where: { generation },
    create: { generation },
    update: {},
  });
}

/**
 * Read-state helpers, same last-read-cursor shape as
 * lib/communityConversation.ts's. Never consulted by
 * canAccessLeadershipCollaboration — a read row is state about what a
 * Person has seen, never proof of what they may see.
 */

export async function markLeadershipCollaborationConversationRead(
  personId: string,
  conversationId: string,
  upTo: Date,
): Promise<void> {
  const advanced = await prisma.leadershipCollaborationConversationRead.updateMany({
    where: { personId, conversationId, lastReadAt: { lt: upTo } },
    data: { lastReadAt: upTo },
  });
  if (advanced.count > 0) return;
  await prisma.leadershipCollaborationConversationRead.upsert({
    where: { personId_conversationId: { personId, conversationId } },
    create: { personId, conversationId, lastReadAt: upTo },
    update: {},
  });
}

export async function getLeadershipCollaborationUnreadCount(personId: string, conversationId: string): Promise<number> {
  const read = await prisma.leadershipCollaborationConversationRead.findUnique({
    where: { personId_conversationId: { personId, conversationId } },
  });
  return prisma.leadershipCollaborationMessage.count({
    where: {
      conversationId,
      senderPersonId: { not: personId },
      ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
    },
  });
}


// ---------------------------------------------------------------------------
// Reading and writing a room. Used by the leaders' own routes and by the National Coordinator's (the central admin's)
// routes, so the two always behave the same. Who may enter a room is decided by the caller, never here.
// ---------------------------------------------------------------------------
const DEFAULT_PAGE = 30;
const MAX_PAGE = 50;

/** "National Coordinator" next to the central admin's name; "Representing the central team" next to a representative's. */
export async function roomSenderBadges(personIds: string[]): Promise<Map<string, 'NATIONAL_COORDINATOR' | 'REPRESENTATIVE'>> {
  const admins = await centralAdminAmong(personIds);
  const reps = await prisma.generationRepresentative.findMany({ where: { personId: { in: personIds }, endedAt: null }, select: { personId: true } });
  const badges = new Map<string, 'NATIONAL_COORDINATOR' | 'REPRESENTATIVE'>(reps.map((r) => [r.personId, 'REPRESENTATIVE' as const]));
  for (const id of admins) badges.set(id, 'NATIONAL_COORDINATOR');
  return badges;
}

export async function listRoomMessages(generation: number, personId: string, opts: { before?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? DEFAULT_PAGE, MAX_PAGE);
  const conversation = await getOrCreateLeadershipCollaborationConversation(generation);
  let cursor: { createdAt: Date; id: string } | null = null;
  if (opts.before) {
    const cursorMessage = await prisma.leadershipCollaborationMessage.findUnique({ where: { id: opts.before } });
    if (!cursorMessage || cursorMessage.conversationId !== conversation.id) return { error: 'Invalid pagination cursor.' as const };
    cursor = { createdAt: cursorMessage.createdAt, id: cursorMessage.id };
  }
  const rows = await prisma.leadershipCollaborationMessage.findMany({
    where: {
      conversationId: conversation.id,
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    include: { sender: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const badges = await roomSenderBadges(page.map((m) => m.senderPersonId));
  const unreadCount = await getLeadershipCollaborationUnreadCount(personId, conversation.id);
  return {
    items: page.map((m) => ({ id: m.id, senderName: m.sender.name, senderBadge: badges.get(m.senderPersonId) ?? null, body: m.body, createdAt: m.createdAt })),
    hasMore,
    unreadCount,
  };
}

export async function postRoomMessage(generation: number, senderPersonId: string, body: string) {
  const conversation = await getOrCreateLeadershipCollaborationConversation(generation);
  return prisma.leadershipCollaborationMessage.create({ data: { conversationId: conversation.id, senderPersonId, body } });
}

export async function markRoomRead(generation: number, personId: string, messageId: string) {
  const conversation = await getOrCreateLeadershipCollaborationConversation(generation);
  const message = await prisma.leadershipCollaborationMessage.findUnique({ where: { id: messageId } });
  if (!message || message.conversationId !== conversation.id) return null;
  await markLeadershipCollaborationConversationRead(personId, conversation.id, message.createdAt);
  return { unreadCount: await getLeadershipCollaborationUnreadCount(personId, conversation.id) };
}
