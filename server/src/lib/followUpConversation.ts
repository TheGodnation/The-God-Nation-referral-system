import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import type { FollowUpAssignment } from '@prisma/client';

export type FollowUpConversationRole = 'FOLLOWER' | 'FOLLOWED';

/**
 * Phase 3M.2 — whether personId is a participant of this exact
 * FollowUpAssignment, and in which direction. Authoritative source is the
 * assignment's own followerId/followedPersonId — never geography,
 * Community, roster visibility, or any other relationship. Reassignment
 * closes the old assignment and creates a new one (leaderFollowUps.ts /
 * adminLeadership.ts) without ever mutating followerId/followedPersonId on
 * the old row, so this check naturally keeps working for a closed
 * assignment's original participants and never extends to a new follower.
 */
export function resolveFollowUpConversationRole(
  personId: string,
  assignment: Pick<FollowUpAssignment, 'followerId' | 'followedPersonId'>,
): FollowUpConversationRole | null {
  if (assignment.followerId === personId) return 'FOLLOWER';
  if (assignment.followedPersonId === personId) return 'FOLLOWED';
  return null;
}

/**
 * Every FollowUpAssignment has exactly one FollowUpConversation
 * (FollowUpConversation.followUpAssignmentId is unique). A new assignment
 * gets one eagerly, in the same create/transaction as the assignment itself
 * (see leaderFollowUps.ts / adminLeadership.ts). This lazily creates one for
 * any assignment that predates Phase 3M.2, the first time its conversation
 * is accessed.
 *
 * `upsert`'s own find-then-write is not atomic against another concurrent
 * upsert for the same followUpAssignmentId (observed in practice — two
 * near-simultaneous requests, e.g. React StrictMode's doubled mount effect
 * in dev), so the losing call can still hit this unique constraint. Caught
 * and recovered the same way every other unique-constraint race in this
 * codebase is handled (see leaderFollowUps.ts's P2002 catches): the loser
 * simply re-reads the row the winner just created, rather than surfacing
 * the conflict as a request failure. Any other error is rethrown as-is.
 */
export async function getOrCreateFollowUpConversation(followUpAssignmentId: string) {
  try {
    return await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId },
      create: { followUpAssignmentId },
      update: {},
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return await prisma.followUpConversation.findUniqueOrThrow({ where: { followUpAssignmentId } });
    }
    throw err;
  }
}

/**
 * Phase 3M.7 — read-state helpers, same last-read-cursor shape as
 * lib/communityConversation.ts's. Deliberately independent of assignment
 * status: reading/marking-read is allowed for a CLOSED assignment's
 * original participants exactly as GET already allows (see
 * followUpConversations.ts) — only sending requires ACTIVE. Marking read
 * never reopens or reactivates a closed assignment; it only ever writes to
 * this Person's own read cursor. Reassignment always creates a brand-new
 * FollowUpConversation (see that model's own comment), so a new follower's
 * conversation naturally starts with zero read rows — the old follower's
 * cursor stays permanently tied to the old conversation's id and can never
 * be confused with or transferred to the new one.
 */

/**
 * Advances personId's read cursor for this FollowUpConversation to `upTo`,
 * never backwards. Idempotent, mirroring markCommunityConversationRead.
 */
export async function markFollowUpConversationRead(personId: string, conversationId: string, upTo: Date): Promise<void> {
  const advanced = await prisma.followUpConversationRead.updateMany({
    where: { personId, conversationId, lastReadAt: { lt: upTo } },
    data: { lastReadAt: upTo },
  });
  if (advanced.count > 0) return;
  await prisma.followUpConversationRead.upsert({
    where: { personId_conversationId: { personId, conversationId } },
    create: { personId, conversationId, lastReadAt: upTo },
    update: {},
  });
}

/**
 * Number of messages newer than personId's read cursor, excluding
 * personId's own messages. No cursor row means everything else is unread.
 */
export async function getFollowUpConversationUnreadCount(personId: string, conversationId: string): Promise<number> {
  const read = await prisma.followUpConversationRead.findUnique({
    where: { personId_conversationId: { personId, conversationId } },
  });
  return prisma.followUpMessage.count({
    where: {
      conversationId,
      senderPersonId: { not: personId },
      ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
    },
  });
}
