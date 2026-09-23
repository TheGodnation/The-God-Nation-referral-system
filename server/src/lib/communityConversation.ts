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
