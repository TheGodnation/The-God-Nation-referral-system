import { MAX_COMMENT_CHARS, MAX_POST_CHARS } from './textLimits';
import type { Request } from 'express';
import { prisma } from './prisma';
import { resolveActingPersonId, isCommunityAdministrator, personBelongsToContext } from './leadership';
import { getLeaderExactCommunityIds } from './privateMessaging';

// ---------------------------------------------------------------------------
// Phase 2 — Prayer requests. Mirrors lib/updates.ts's own viewer-resolution
// shape (a member session, a leader account acting as their linked Person,
// and an admin account can all view) but PrayerRequest's PRIVATE visibility
// needs an exact-Community check per request — isCommunityAdministrator,
// never the global "any ACTIVE leadership role" canModerate flag Updates
// uses, since a stranger Leader of a different Community must never see a
// PRIVATE request routed elsewhere.
// ---------------------------------------------------------------------------

export interface PrayerRequestViewer {
  /** The Person creating/commenting, when the viewer has one. */
  personId: string | null;
  /** The signed-in Admin/Leader account, when there is one. */
  userId: string | null;
  isAdmin: boolean;
}

export async function resolvePrayerRequestViewer(req: Request): Promise<PrayerRequestViewer | null> {
  if (!req.member && !req.user) return null;
  const isAdmin = req.user?.role === 'ADMIN';
  const leaderPersonId = req.user?.role === 'LEADER' ? await resolveActingPersonId(req.user.id) : null;
  const personId = req.member?.personId ?? leaderPersonId ?? null;
  return { personId, userId: req.user?.id ?? null, isAdmin };
}

type PrayerRequestRow = { authorPersonId: string; visibility: 'PUBLIC' | 'PRIVATE'; communityId: string | null };

/** Whether viewer may see this request: PUBLIC is open to any signed-in
 * viewer; PRIVATE is the author, Admin, or an ACTIVE SCOPED_LEADER of
 * EXACTLY its communityId. */
export async function canViewPrayerRequest(viewer: PrayerRequestViewer, request: PrayerRequestRow): Promise<boolean> {
  if (request.visibility === 'PUBLIC') return true;
  if (viewer.isAdmin) return true;
  if (viewer.personId === request.authorPersonId) return true;
  if (!viewer.personId || !request.communityId) return false;
  return isCommunityAdministrator(viewer.personId, request.communityId);
}

/** Whether viewer may delete this request (or a comment on it): the
 * author, Admin, or — PRIVATE requests only — an ACTIVE SCOPED_LEADER of
 * exactly its Community. A PUBLIC request's content is moderated by Admin
 * alone (there is no community to scope a Leader's moderation power to). */
export async function canModeratePrayerRequest(viewer: PrayerRequestViewer, request: PrayerRequestRow): Promise<boolean> {
  if (viewer.isAdmin) return true;
  if (request.visibility === 'PRIVATE' && viewer.personId && request.communityId) {
    return isCommunityAdministrator(viewer.personId, request.communityId);
  }
  return false;
}

/** The exact Communities whose PRIVATE requests this viewer may see as
 * leadership (empty for a plain Member/Admin — Admin's own PRIVATE access
 * is unconditional and handled separately, never through this list). */
export async function leaderCommunityIdsFor(viewer: PrayerRequestViewer): Promise<string[]> {
  if (!viewer.personId) return [];
  return getLeaderExactCommunityIds(viewer.personId);
}

/** Every Person holding an ACTIVE SCOPED_LEADER RoleAssignment for exactly
 * this Community — the fan-out recipients of a new PRIVATE prayer request. */
export async function getCommunityLeaderPersonIds(communityId: string): Promise<string[]> {
  const rows = await prisma.roleAssignment.findMany({
    where: { communityId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' },
    select: { personId: true },
  });
  return rows.map((r) => r.personId);
}

/** Whether personId currently has an ACTIVE CommunityMembership in
 * communityId — required of the author's chosen Community for a PRIVATE
 * request (never a Community they don't actually belong to). */
export async function authorBelongsToCommunity(personId: string, communityId: string): Promise<boolean> {
  return personBelongsToContext(personId, 'COMMUNITY', communityId);
}

export const MAX_PRAYER_REQUEST_BODY = MAX_POST_CHARS;
export const MAX_PRAYER_REQUEST_COMMENT_BODY = MAX_COMMENT_CHARS;
export const PRAYER_REQUESTS_PAGE_SIZE = 20;
