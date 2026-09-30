import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';
import type { FollowUpContextType } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      // Phase 3D: the acting Leader's linked Person id, set only by
      // requireLinkedPerson below — never derived from client input.
      leaderPersonId?: string;
    }
  }
}

/**
 * Requires the authenticated Leader's User to have a linked Person
 * (User.personId, set only via the explicit Admin link-person action).
 * Attaches req.leaderPersonId on success. Must run after requireRole('LEADER').
 */
export async function requireLinkedPerson(req: Request, res: Response, next: NextFunction) {
  const personId = await resolveActingPersonId(req.user!.id);
  if (!personId) {
    return res.status(403).json({ error: 'Your account is not yet linked to a Person. Ask an Admin to link it.' });
  }
  req.leaderPersonId = personId;
  next();
}

/**
 * Resolves the Person linked to an authenticated User, via the explicit
 * User.personId link established by PATCH /api/admin/leaders/:id/link-person
 * (Phase 3D). Returns null if the User has no linked Person — an Admin is
 * never expected to have one, and a Leader may not yet have been linked.
 * Never infers or creates a Person from any other signal.
 */
export async function resolveActingPersonId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { personId: true } });
  return user?.personId ?? null;
}

/**
 * Finds the Person's ACTIVE SCOPED_LEADER RoleAssignment matching the exact
 * given Community context. Scope is always exact — a parent scope never
 * authorizes a child, and vice versa. `contextType` is retained in the
 * signature (every current caller still passes 'COMMUNITY' explicitly) even
 * though FollowUpContextType now has only that one value — Geography
 * Retirement Step 5A removed the GEOGRAPHY branch that used to consult this,
 * and Step 5B removed RoleAssignment.geographyId itself: SCOPED_LEADER is
 * Community-scoped only now.
 */
export async function findActiveScopedRole(
  personId: string,
  contextType: FollowUpContextType,
  contextId: string,
) {
  void contextType;
  return prisma.roleAssignment.findFirst({
    where: {
      personId,
      roleType: 'SCOPED_LEADER',
      status: 'ACTIVE',
      communityId: contextId,
    },
  });
}

/**
 * Whether a Person currently belongs to the exact given Community scope — an
 * ACTIVE CommunityMembership for that exact Community. No ancestor or
 * descendant coverage; membership changes are read live here (this is
 * distinct from a FollowUpAssignment's frozen historical context). Geography
 * Retirement Step 5A removed the GeographicAssignment branch this used to
 * take for a GEOGRAPHY context — see findActiveScopedRole's own comment.
 */
export async function personBelongsToContext(
  personId: string,
  contextType: FollowUpContextType,
  contextId: string,
): Promise<boolean> {
  void contextType;
  const membership = await prisma.communityMembership.findUnique({
    where: { personId_communityId: { personId, communityId: contextId } },
  });
  return membership?.status === 'ACTIVE';
}

/**
 * Phase 3M.8A — whether personId is an active Community Administrator for
 * EXACTLY this Community: an ACTIVE SCOPED_LEADER RoleAssignment for that
 * exact communityId. Deliberately a thin, named wrapper around the existing
 * exact-match findActiveScopedRole — no new role, no new model, no
 * descendant/generation coverage (a role on a parent or child Community
 * never authorizes this one). Multiple Persons may each independently
 * satisfy this for the same Community, since RoleAssignment's own unique
 * constraint only prevents one Person from holding the role twice, never
 * multiple Persons from holding it simultaneously.
 */
export async function isCommunityAdministrator(personId: string, communityId: string): Promise<boolean> {
  return Boolean(await findActiveScopedRole(personId, 'COMMUNITY', communityId));
}

/**
 * Confirms the referenced Community actually exists. Geography Retirement
 * Step 5A removed the Geography branch this used to take — see
 * findActiveScopedRole's own comment for why `contextType` is still a
 * parameter.
 */
export async function contextTargetExists(contextType: FollowUpContextType, contextId: string): Promise<boolean> {
  void contextType;
  return Boolean(await prisma.community.findUnique({ where: { id: contextId }, select: { id: true } }));
}
