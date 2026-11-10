import { prisma } from './prisma';
import { centralAdminAmong, isCentralAdminPerson } from './centralAdmin';
import { representedGeneration } from './representatives';

// Who may be followed up, and by whom. The central admin follows up the leaders and is followed up by nobody. Leaders
// are followed up only by the central admin and the generation representatives, never by other leaders; leaders'
// follow-ups are about the members they look after.

/** Whether this person currently leads an assembly or a group. */
export async function isLeaderPerson(personId: string): Promise<boolean> {
  return Boolean(await prisma.roleAssignment.findFirst({ where: { personId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, select: { id: true } }));
}

/** Of these people, the ones who currently lead an assembly or a group. */
export async function leadersAmong(personIds: string[]): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await prisma.roleAssignment.findMany({ where: { personId: { in: personIds }, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, select: { personId: true } });
  return new Set(rows.map((r) => r.personId));
}

/** Whether someone has the right to follow up leaders: the central admin or a generation representative. */
export async function mayFollowLeaders(personId: string): Promise<boolean> {
  return (await isCentralAdminPerson(personId)) || (await representedGeneration(personId)) !== null;
}

export type FollowBlock = 'CENTRAL_ADMIN' | 'LEADER' | null;

/** Why `followerId` may not follow up `followedPersonId` (null when it is allowed). */
export async function followBlock(followerId: string, followedPersonId: string): Promise<FollowBlock> {
  if (await isCentralAdminPerson(followedPersonId)) return 'CENTRAL_ADMIN';
  if ((await isLeaderPerson(followedPersonId)) && !(await mayFollowLeaders(followerId))) return 'LEADER';
  return null;
}

export const followBlockMessage = (block: Exclude<FollowBlock, null>): string =>
  block === 'CENTRAL_ADMIN'
    ? 'The central admin is not followed up by leaders: the central admin follows up the leaders.'
    : 'Leaders are followed up only by the central admin and the generation representatives, not by other leaders.';

/** People that automatic tools never assign to a leader: the central admin and every leader. */
export async function neverAssignedAmong(personIds: string[]): Promise<Set<string>> {
  const [admins, leaders] = await Promise.all([centralAdminAmong(personIds), leadersAmong(personIds)]);
  return new Set([...admins, ...leaders]);
}

/**
 * Someone has just become a leader: any follow-up of them by another leader ends (they are followed up by the central
 * admin and the representatives now). Nothing is deleted. Never throws.
 */
export async function closeFollowUpsOfNewLeader(personId: string): Promise<number> {
  try {
    const open = await prisma.followUpAssignment.findMany({ where: { followedPersonId: personId, status: 'ACTIVE' }, select: { id: true, followerId: true } });
    let closed = 0;
    for (const a of open) {
      if (await mayFollowLeaders(a.followerId)) continue;
      await prisma.followUpAssignment.update({ where: { id: a.id }, data: { status: 'CLOSED', closedAt: new Date(), closeReason: 'They became a leader: leaders are followed up by the central admin and the representatives' } });
      closed += 1;
    }
    return closed;
  } catch (err) {
    console.error('[followRules] could not close follow-ups of a new leader', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}
