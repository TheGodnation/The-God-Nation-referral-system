import { prisma } from './prisma';

/**
 * Book / Resource Access Grants — the ONE shared access-check helper this
 * schema expects to ever consult for "does this Person have access to this
 * Resource." Deliberately narrow: an explicit ACTIVE ResourceAccessGrant is
 * the only legitimate access source for this phase. Never infers access
 * from Community membership, Leader/RoleAssignment status, Geography,
 * PrivateConversation participation, or Announcement/HeadquartersPost
 * receipt — none of those are consulted here, on purpose, matching the
 * explicit "access grant, not a membership relationship" architecture.
 */
export async function hasResourceAccess(personId: string, resourceId: string): Promise<boolean> {
  const grant = await prisma.resourceAccessGrant.findUnique({
    where: { personId_resourceId: { personId, resourceId } },
    select: { status: true },
  });
  return grant?.status === 'ACTIVE';
}

/**
 * Grants (or re-grants after a prior revocation) resourceId to personId.
 * Reactivates the SAME row on re-grant — mirrors CommunityMembership's own
 * reactivate-via-status precedent, never a new historical row per grant
 * cycle (see ResourceAccessGrant's own schema comment for why this phase
 * deliberately avoids RoleAssignment's alternative, multiple-historical
 * -rows pattern).
 *
 * `wasNewlyActivated` distinguishes a genuinely new grant (or a
 * reactivation after revocation) from a redundant re-call against an
 * already-ACTIVE grant — this upsert is otherwise silently idempotent, so
 * the caller uses this flag to avoid creating a duplicate Notification for
 * the same underlying grant on a retried request (see
 * lib/notifications.ts's notifyResourceGranted).
 */
export async function grantResourceAccess(personId: string, resourceId: string, grantedByUserId: string) {
  const existing = await prisma.resourceAccessGrant.findUnique({
    where: { personId_resourceId: { personId, resourceId } },
    select: { status: true },
  });
  const grant = await prisma.resourceAccessGrant.upsert({
    where: { personId_resourceId: { personId, resourceId } },
    create: { personId, resourceId, grantedByUserId },
    update: { status: 'ACTIVE', grantedAt: new Date(), grantedByUserId, revokedAt: null, revokedByUserId: null },
  });
  const wasNewlyActivated = !existing || existing.status !== 'ACTIVE';
  return { grant, wasNewlyActivated };
}
