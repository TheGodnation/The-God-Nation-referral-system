import { prisma } from './prisma';
import { findActiveScopedRole } from './leadership';
import { getHeadquartersCommunityId, getCommunityGeneration } from './tree';

// Phase 2C — Organizational Leadership Recommendation. Deliberately its own
// module, exactly like lib/leaderPeers.ts (Phase 2A) and
// lib/leadershipCollaboration.ts (Phase 2B) — never touching
// isCommunityAdministrator, findActiveScopedRole itself, or
// hasConversationAccess. This module only ever READS RoleAssignment via the
// existing, unmodified findActiveScopedRole helper; it grants no new
// authority and does not participate in Community administration,
// conversation access, or peer/collaboration eligibility in any way.
//
// A Leader may create an organizational recommendation anchored to
// communityId if and only if they hold an ACTIVE SCOPED_LEADER
// RoleAssignment for EXACTLY that communityId — findActiveScopedRole is
// already exact-match only (no parent, no child, no descendant, no
// same-generation-peer coverage), which is exactly the "exact Community
// ownership/leadership" rule this phase requires. No inherited authority,
// no descendant authority, no sibling authority, no same-generation-peer
// authority (Leadership Collaboration eligibility is completely irrelevant
// here), and no Geography authority of any kind.
export async function isCommunityLeaderForRecommendation(personId: string, communityId: string): Promise<boolean> {
  return Boolean(await findActiveScopedRole(personId, 'COMMUNITY', communityId));
}

/**
 * Whether personId currently has an ACTIVE CommunityMembership in
 * communityId — the candidate-eligibility rule for who may be recommended.
 * Mirrors LeadershipProposal's own precedent (the candidate must already be
 * present within the recommendation's target scope), adapted from Geography
 * subtree membership to exact Community membership, since Phase 2C's own
 * Leader-authorization rule above is exact-match only, never subtree-based.
 * The candidate is deliberately NOT required to already hold any
 * RoleAssignment — "not yet a Leader" is exactly the point of this feature.
 */
export async function personIsActiveCommunityMember(personId: string, communityId: string): Promise<boolean> {
  const membership = await prisma.communityMembership.findUnique({
    where: { personId_communityId: { personId, communityId } },
  });
  return membership?.status === 'ACTIVE';
}

/**
 * The anchor Community's current Headquarters-relative generation, purely
 * derived (never persisted on the recommendation row itself — see the
 * model's own schema comment). Returns null when Headquarters isn't
 * configured, or when communityId has since left the Headquarters tree —
 * never a fabricated generation.
 */
export async function getRecommendationCommunityGeneration(communityId: string): Promise<number | null> {
  const headquartersId = await getHeadquartersCommunityId();
  if (!headquartersId) return null;
  return getCommunityGeneration(communityId, headquartersId);
}
