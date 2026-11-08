import { prisma } from './prisma';
import { isCentralAdminPerson } from './centralAdmin';
import { getCommunityGeneration, getHeadquartersCommunityId } from './tree';

// Some people cannot be blocked: the central admin (and their member profile) by anyone in the whole app, a leader
// by the members of their own assembly or generation, the leader who looks after you, and a generation's
// representative by the members of that generation. Protecting them keeps the people who look after the community
// reachable by the people they look after. This is the only place that rule lives.

/** The generations of the assemblies this person belongs to, and the assemblies themselves. */
async function placesOf(personId: string): Promise<{ communityIds: Set<string>; generations: Set<number> }> {
  const rows = await prisma.communityMembership.findMany({ where: { personId, status: 'ACTIVE' }, select: { communityId: true } });
  const communityIds = new Set(rows.map((r) => r.communityId));
  const generations = new Set<number>();
  const hq = await getHeadquartersCommunityId();
  if (hq) {
    for (const id of communityIds) {
      const g = await getCommunityGeneration(id, hq);
      if (g !== null) generations.add(g);
    }
  }
  return { communityIds, generations };
}

/** Whether `targetId` is someone `blockerId` is not allowed to block. */
export async function isProtectedFromBlock(blockerId: string, targetId: string): Promise<boolean> {
  if (blockerId === targetId) return false;
  if (await isCentralAdminPerson(targetId)) return true;

  // The leader who looks after you.
  const looksAfter = await prisma.followUpAssignment.findFirst({ where: { followerId: targetId, followedPersonId: blockerId, status: 'ACTIVE' }, select: { id: true } });
  if (looksAfter) return true;

  const [leadRoles, represented] = await Promise.all([
    prisma.roleAssignment.findMany({ where: { personId: targetId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } }, select: { communityId: true } }),
    prisma.generationRepresentative.findFirst({ where: { personId: targetId, endedAt: null }, select: { generation: true } }),
  ]);
  if (leadRoles.length === 0 && !represented) return false;

  const mine = await placesOf(blockerId);
  const hq = await getHeadquartersCommunityId();
  for (const role of leadRoles) {
    if (mine.communityIds.has(role.communityId!)) return true; // leads an assembly I belong to
    if (hq) {
      const g = await getCommunityGeneration(role.communityId!, hq);
      if (g !== null && mine.generations.has(g)) return true; // leads in my generation
    }
  }
  if (represented && mine.generations.has(represented.generation)) return true;
  return false;
}
