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
 * given context (Community or Geography id). Geography/Community scope is
 * always exact — a parent scope never authorizes a child, and vice versa.
 */
export async function findActiveScopedRole(
  personId: string,
  contextType: FollowUpContextType,
  contextId: string,
) {
  return prisma.roleAssignment.findFirst({
    where: {
      personId,
      roleType: 'SCOPED_LEADER',
      status: 'ACTIVE',
      ...(contextType === 'COMMUNITY' ? { communityId: contextId } : { geographyId: contextId }),
    },
  });
}

/**
 * Whether a Person currently belongs to the exact given Community/Geography
 * scope — an ACTIVE CommunityMembership for that exact Community, or an
 * ACTIVE GeographicAssignment for that exact Geography. No ancestor or
 * descendant coverage; membership/assignment changes are read live here
 * (this is distinct from a FollowUpAssignment's frozen historical context).
 */
export async function personBelongsToContext(
  personId: string,
  contextType: FollowUpContextType,
  contextId: string,
): Promise<boolean> {
  if (contextType === 'COMMUNITY') {
    const membership = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId, communityId: contextId } },
    });
    return membership?.status === 'ACTIVE';
  }
  const assignment = await prisma.geographicAssignment.findUnique({ where: { personId } });
  return Boolean(assignment && assignment.status === 'ACTIVE' && assignment.geographyId === contextId);
}

/** Confirms the referenced Community or Geography actually exists. */
export async function contextTargetExists(contextType: FollowUpContextType, contextId: string): Promise<boolean> {
  if (contextType === 'COMMUNITY') {
    return Boolean(await prisma.community.findUnique({ where: { id: contextId }, select: { id: true } }));
  }
  return Boolean(await prisma.geography.findUnique({ where: { id: contextId }, select: { id: true } }));
}
