import type { Request } from 'express';
import { prisma } from './prisma';
import { resolveActingPersonId, isCommunityAdministrator, findActiveScopedRole } from './leadership';
import type { PrivateConversation } from '@prisma/client';

/**
 * Private Communication / Messaging — a dedicated, minimal, strictly
 * two-sided private conversation between one Member and the ONE
 * organizational actor (Admin or Leader) who initiated it. Kept entirely
 * separate from lib/announcements.ts, lib/communityConversation.ts,
 * lib/followUpConversation.ts, lib/geographyConversation.ts, and
 * lib/headquartersPosts.ts — no existing conversation model or
 * authorization helper is modified or reused as an authority source here.
 *
 * See PrivateConversation's own schema comment for the fan-out and
 * initiator-identity-duality design rationale.
 */

// The authenticated actor for the shared participant surface
// (routes/privateMessages.ts) — EITHER a Person (Member, or a Leader acting
// via their own linked Person) OR a User (Admin, who is never required to
// have a linked Person anywhere in this codebase). This is a deliberate,
// narrow exception to the "Admin never participates in a conversation"
// precedent established by every prior conversation surface (Community,
// Geography, Follow-Up, Leadership Collaboration all exclude Admin) —
// Private Messaging is the one place Admin genuinely needs two-way
// participation, since Admin may be the actual initiating party.
export type PrivateMessagingActor = { type: 'PERSON'; personId: string } | { type: 'USER'; userId: string };

/**
 * Resolves the caller's own identity for Private Messaging purposes — a
 * Member (req.member), a Leader (req.user with role LEADER, resolved to
 * their own linked Person via resolveActingPersonId, exactly like every
 * other Leader-authored messaging surface), or an Admin (req.user with role
 * ADMIN, identified by their own User id — never a Person, since Admins
 * cannot be linked to one).
 */
export async function resolvePrivateMessagingActor(req: Request): Promise<PrivateMessagingActor | null> {
  if (req.member) return { type: 'PERSON', personId: req.member.personId };
  if (req.user?.role === 'LEADER') {
    const personId = await resolveActingPersonId(req.user.id);
    return personId ? { type: 'PERSON', personId } : null;
  }
  if (req.user?.role === 'ADMIN') return { type: 'USER', userId: req.user.id };
  return null;
}

export type PrivateConversationRole = 'MEMBER' | 'INITIATOR';

/**
 * Whether actor is a participant of this exact PrivateConversation, and in
 * which direction. Authoritative source is the conversation's own
 * memberPersonId/initiatorUserId/initiatorPersonId — never role, never
 * Community/Geography membership, never any other relationship. A
 * client-supplied conversation id can never bypass this: every route
 * re-derives actor server-side and re-checks this function on every call.
 */
export function resolvePrivateConversationRole(
  actor: PrivateMessagingActor,
  conversation: Pick<PrivateConversation, 'memberPersonId' | 'initiatorUserId' | 'initiatorPersonId'>,
): PrivateConversationRole | null {
  if (actor.type === 'PERSON') {
    if (conversation.memberPersonId === actor.personId) return 'MEMBER';
    if (conversation.initiatorPersonId === actor.personId) return 'INITIATOR';
  } else {
    if (conversation.initiatorUserId === actor.userId) return 'INITIATOR';
  }
  return null;
}

/**
 * Every eligible member — defined, for this phase, as any Person with at
 * least one ACTIVE CommunityMembership (the same "is an organizational
 * member" definition already used implicitly everywhere else in this
 * codebase — Announcement/HeadquartersPost Community targeting, Location
 * aggregation). Deliberately does NOT additionally require an existing
 * MemberAccount: a Person who later creates one will simply find the
 * conversation already waiting, exactly like a newly-eligible Announcement
 * recipient does today.
 */
export async function getAllEligibleMemberPersonIds(): Promise<string[]> {
  const rows = await prisma.communityMembership.findMany({
    where: { status: 'ACTIVE' },
    select: { personId: true },
    distinct: ['personId'],
  });
  return rows.map((r) => r.personId);
}

/** Every Person with an ACTIVE CommunityMembership in this EXACT Community. */
export async function getCommunityMemberPersonIds(communityId: string): Promise<string[]> {
  const rows = await prisma.communityMembership.findMany({
    where: { communityId, status: 'ACTIVE' },
    select: { personId: true },
    distinct: ['personId'],
  });
  return rows.map((r) => r.personId);
}

/**
 * Every Community this Leader currently holds an ACTIVE exact SCOPED_LEADER
 * RoleAssignment for (never a parent/child/descendant/Geography scope —
 * see isCommunityAdministrator/findActiveScopedRole in lib/leadership.ts,
 * both reused here, never re-implemented).
 */
export async function getLeaderExactCommunityIds(leaderPersonId: string): Promise<string[]> {
  const rows = await prisma.roleAssignment.findMany({
    where: { personId: leaderPersonId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } },
    select: { communityId: true },
  });
  return rows.map((r) => r.communityId!);
}

/**
 * Whether personId is an ACTIVE member of at least one of the given exact
 * Communities. Used to authorize a Leader's target selection — never an
 * inherited/descendant/ancestor check.
 */
export async function personBelongsToAnyCommunity(personId: string, communityIds: string[]): Promise<boolean> {
  if (communityIds.length === 0) return false;
  const membership = await prisma.communityMembership.findFirst({
    where: { personId, status: 'ACTIVE', communityId: { in: communityIds } },
    select: { id: true },
  });
  return Boolean(membership);
}

export { isCommunityAdministrator, findActiveScopedRole };

/**
 * Get-or-create the one PrivateConversation between memberPersonId and the
 * given organizational initiator — race-safe via upsert on the
 * (memberPersonId, initiatorUserId) or (memberPersonId, initiatorPersonId)
 * unique constraint, exactly mirroring getOrCreateConversation/
 * getOrCreateFollowUpConversation's own upsert pattern. Never creates a
 * second thread between the same two parties.
 */
export async function getOrCreatePrivateConversation(
  memberPersonId: string,
  initiator: { type: 'USER'; userId: string } | { type: 'PERSON'; personId: string },
): Promise<PrivateConversation> {
  if (initiator.type === 'USER') {
    return prisma.privateConversation.upsert({
      where: { memberPersonId_initiatorUserId: { memberPersonId, initiatorUserId: initiator.userId } },
      create: { memberPersonId, initiatorUserId: initiator.userId },
      update: {},
    });
  }
  return prisma.privateConversation.upsert({
    where: { memberPersonId_initiatorPersonId: { memberPersonId, initiatorPersonId: initiator.personId } },
    create: { memberPersonId, initiatorPersonId: initiator.personId },
    update: {},
  });
}

/**
 * Read-state helpers — the same last-read-cursor shape as
 * markCommunityConversationRead/markFollowUpConversationRead, generalized
 * for the Person/User reader duality. One participant can never alter
 * another's cursor: both functions always operate on actor's own resolved
 * identity, never a client-supplied one.
 */
export async function markPrivateConversationRead(
  actor: PrivateMessagingActor,
  conversationId: string,
  upTo: Date,
): Promise<void> {
  const where = actor.type === 'PERSON' ? { personId: actor.personId } : { userId: actor.userId };
  const advanced = await prisma.privateConversationRead.updateMany({
    where: { ...where, conversationId, lastReadAt: { lt: upTo } },
    data: { lastReadAt: upTo },
  });
  if (advanced.count > 0) return;
  if (actor.type === 'PERSON') {
    await prisma.privateConversationRead.upsert({
      where: { personId_conversationId: { personId: actor.personId, conversationId } },
      create: { personId: actor.personId, conversationId, lastReadAt: upTo },
      update: {},
    });
  } else {
    await prisma.privateConversationRead.upsert({
      where: { userId_conversationId: { userId: actor.userId, conversationId } },
      create: { userId: actor.userId, conversationId, lastReadAt: upTo },
      update: {},
    });
  }
}

/**
 * Number of messages in this conversation newer than actor's own read
 * cursor, excluding actor's own messages. No cursor row means everything
 * else is unread.
 *
 * Deliberately takes the conversation row (not just its id) and computes
 * the OTHER party's identity as a positive equality filter, rather than a
 * negative "not equal to my own id" filter on a nullable column: since
 * senderPersonId/senderUserId are each nullable (exactly one set per
 * message — see PrivateMessage's own CHECK constraint), a naive
 * `{ senderUserId: { not: actor.userId } }` would silently exclude every
 * Person-authored message from the count (SQL's `x <> y` is UNKNOWN, not
 * TRUE, whenever x IS NULL) — a real correctness bug this positive-filter
 * form avoids entirely.
 */
export async function getPrivateConversationUnreadCount(
  actor: PrivateMessagingActor,
  conversation: Pick<PrivateConversation, 'id' | 'memberPersonId' | 'initiatorUserId' | 'initiatorPersonId'>,
): Promise<number> {
  const read =
    actor.type === 'PERSON'
      ? await prisma.privateConversationRead.findUnique({ where: { personId_conversationId: { personId: actor.personId, conversationId: conversation.id } } })
      : await prisma.privateConversationRead.findUnique({ where: { userId_conversationId: { userId: actor.userId, conversationId: conversation.id } } });

  const isMember = actor.type === 'PERSON' && actor.personId === conversation.memberPersonId;
  const otherPartyFilter = isMember
    ? conversation.initiatorUserId
      ? { senderUserId: conversation.initiatorUserId }
      : { senderPersonId: conversation.initiatorPersonId }
    : { senderPersonId: conversation.memberPersonId };

  return prisma.privateMessage.count({
    where: {
      conversationId: conversation.id,
      ...otherPartyFilter,
      ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
    },
  });
}
