import { prisma } from './prisma';
import { findActiveScopedRole, personBelongsToContext } from './leadership';

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
