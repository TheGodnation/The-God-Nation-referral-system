import { prisma } from './prisma';
import { findActiveScopedRole, personBelongsToContext, isCommunityAdministrator } from './leadership';

/**
 * Phase 3M.1: a person has access to a Community's conversation if EITHER
 * relationship holds — an ACTIVE CommunityMembership for that exact
 * Community, OR an ACTIVE SCOPED_LEADER RoleAssignment for that exact
 * Community. These two relationships are never merged into one check or
 * one stored record: a Community Leader who ends their role but remains an
 * active member keeps access purely because personBelongsToContext still
 * holds, and a member who becomes inactive but is also an active leader
 * keeps access purely because findActiveScopedRole still holds. Both
 * checks are re-evaluated on every call — never cached.
 */
export async function hasConversationAccess(personId: string, communityId: string): Promise<boolean> {
  const [isMember, leaderRole] = await Promise.all([
    personBelongsToContext(personId, 'COMMUNITY', communityId),
    findActiveScopedRole(personId, 'COMMUNITY', communityId),
  ]);
  return isMember || Boolean(leaderRole);
}

/**
 * Community Posting Policy — whether personId may CREATE a new message in
 * communityId's conversation right now, given that Community's current
 * postingPolicy. This is the ONLY place postingPolicy is ever consulted —
 * read access (hasConversationAccess above), unread counts, "delete for
 * me", and moderation are all completely untouched by this value.
 *
 * EVERYONE: identical to the pre-existing hasConversationAccess check — an
 * active member or an active exact-Community SCOPED_LEADER. LEADERS_ONLY:
 * narrows this to isCommunityAdministrator alone (an ACTIVE SCOPED_LEADER
 * RoleAssignment for this EXACT Community — the same exact-match check
 * already used for message moderation, never inherited from a parent/child
 * Community and never satisfied by a role held in a different Community).
 * Returns false for a nonexistent Community — callers are expected to have
 * already confirmed existence via contextTargetExists.
 */
export async function canPostCommunityMessage(personId: string, communityId: string): Promise<boolean> {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { postingPolicy: true } });
  if (!community) return false;
  if (community.postingPolicy === 'LEADERS_ONLY') {
    return isCommunityAdministrator(personId, communityId);
  }
  return hasConversationAccess(personId, communityId);
}

/**
 * Every Community has exactly one Conversation (Conversation.communityId is
 * unique). A new Community gets one eagerly, in the same transaction as its
 * creation (see adminCommunities.ts). This lazily creates one for any
 * Community that predates Phase 3M.1, the first time its conversation is
 * accessed — `upsert` makes this race-safe under the same unique
 * constraint, so concurrent callers can never create two.
 */
export async function getOrCreateConversation(communityId: string) {
  return prisma.conversation.upsert({
    where: { communityId },
    create: { communityId },
    update: {},
  });
}

/**
 * Phase 3M.7 — read-state helpers. A LAST-READ CURSOR (lastReadAt), not a
 * per-message flag like AnnouncementRead: a Conversation is a continuous
 * stream, so tracking "has this Person read THIS message" per message
 * would grow without bound. Never consulted by hasConversationAccess — a
 * read row is state about what a Person has seen, never proof of what they
 * may see.
 */

/**
 * Advances personId's read cursor for this conversation to `upTo`, but
 * never moves it backwards — a stale/out-of-order client request can never
 * regress an already-later cursor. Idempotent: repeating the same `upTo`
 * (or an older one) is a safe no-op once the cursor already covers it.
 */
export async function markCommunityConversationRead(personId: string, conversationId: string, upTo: Date): Promise<void> {
  const advanced = await prisma.communityConversationRead.updateMany({
    where: { personId, conversationId, lastReadAt: { lt: upTo } },
    data: { lastReadAt: upTo },
  });
  if (advanced.count > 0) return;
  // Either no row exists yet (first-ever read), or one exists whose cursor
  // is already >= upTo (a stale request) — upsert's `create` only fires in
  // the former case; its `update: {}` is a deliberate no-op in the latter,
  // so the existing (later) cursor is never overwritten.
  await prisma.communityConversationRead.upsert({
    where: { personId_conversationId: { personId, conversationId } },
    create: { personId, conversationId, lastReadAt: upTo },
    update: {},
  });
}

/**
 * Number of messages in this conversation newer than personId's read
 * cursor, excluding personId's own messages (a Person's own newly sent
 * message is never counted as "unread" for themselves). No cursor row at
 * all means everything (other than the Person's own messages) is unread.
 */
export async function getCommunityConversationUnreadCount(personId: string, conversationId: string): Promise<number> {
  const read = await prisma.communityConversationRead.findUnique({
    where: { personId_conversationId: { personId, conversationId } },
  });
  return prisma.message.count({
    where: {
      conversationId,
      senderPersonId: { not: personId },
      ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
    },
  });
}

/**
 * Phase 3M.8C — a Person's own "delete for me" visibility preference,
 * restricted to their OWN messages only (senderPersonId === personId is
 * checked by the caller, e.g. communityConversations.ts, before this is
 * ever invoked — this function itself does not re-check ownership, so it
 * must never be called for a message the caller doesn't already know
 * belongs to that Person). Upsert makes repeating the action a safe no-op
 * (the unique (messageId, personId) constraint is what actually enforces
 * idempotency). Never touches Message.deletedAt/deletedByPersonId, and
 * never recorded as a moderation audit event — this is a personal
 * preference, not a deletion of the shared Message.
 */
export async function hideMessageForPerson(personId: string, messageId: string): Promise<void> {
  await prisma.messageHiddenForPerson.upsert({
    where: { messageId_personId: { messageId, personId } },
    create: { messageId, personId },
    update: {},
  });
}
