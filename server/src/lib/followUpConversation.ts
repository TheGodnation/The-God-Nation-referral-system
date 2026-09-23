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
 * is accessed — `upsert` makes this race-safe under the same unique
 * constraint, so concurrent callers can never create two.
 */
export async function getOrCreateFollowUpConversation(followUpAssignmentId: string) {
  return prisma.followUpConversation.upsert({
    where: { followUpAssignmentId },
    create: { followUpAssignmentId },
    update: {},
  });
}
