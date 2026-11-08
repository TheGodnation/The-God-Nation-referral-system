import { prisma } from './prisma';
import { recordAudit } from './audit';
import { isCentralAdminPerson } from './centralAdmin';
import { notifyRoleAssigned } from './notifications';
import { actingUserFor, representedCommunityIds } from './representatives';
import { getCommunityGeneration, getHeadquartersCommunityId } from './tree';

// Groups (women, youth, prayer, leadership team…) belong to an assembly. A leader can be assigned to lead one by the
// central admin, or by the representative of that assembly's generation. The person must belong to the group or to
// its assembly. Removing a leader stays with the central admin (leadership tools in the admin dashboard).

export class GroupLeaderError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** The assembly a group belongs to: the nearest assembly above it. */
async function owningAssembly(groupId: string): Promise<{ id: string; name: string } | null> {
  let cur: string | null = (await prisma.community.findUnique({ where: { id: groupId }, select: { parentId: true } }))?.parentId ?? null;
  for (let i = 0; i < 50 && cur; i++) {
    const node: { id: string; name: string; kind: 'ASSEMBLY' | 'GROUP'; parentId: string | null } | null = await prisma.community.findUnique({ where: { id: cur }, select: { id: true, name: true, kind: true, parentId: true } });
    if (!node) return null;
    if (node.kind === 'ASSEMBLY') return { id: node.id, name: node.name };
    cur = node.parentId;
  }
  return null;
}

export type Authority = { kind: 'ADMIN' } | { kind: 'REP'; communityIds: Set<string> };

export async function authorityOf(personId: string): Promise<Authority | null> {
  if (await isCentralAdminPerson(personId)) return { kind: 'ADMIN' };
  const ids = await representedCommunityIds(personId);
  return ids.length > 0 ? { kind: 'REP', communityIds: new Set(ids) } : null;
}

const allowed = (a: Authority, communityId: string) => a.kind === 'ADMIN' || a.communityIds.has(communityId);

/** The groups this person may look after, with their leaders. */
export async function groupsFor(authority: Authority) {
  const hq = await getHeadquartersCommunityId();
  const groups = await prisma.community.findMany({
    where: { kind: 'GROUP', active: true, ...(authority.kind === 'REP' ? { id: { in: [...authority.communityIds] } } : {}) },
    select: { id: true, name: true, parentId: true },
    orderBy: { name: 'asc' },
  });
  const roles = await prisma.roleAssignment.findMany({
    where: { communityId: { in: groups.map((g) => g.id) }, roleType: 'SCOPED_LEADER', status: 'ACTIVE' },
    select: { communityId: true, person: { select: { id: true, name: true } } },
  });
  const out = [];
  for (const g of groups) {
    const owner = await owningAssembly(g.id);
    out.push({
      id: g.id,
      name: g.name,
      assemblyName: owner?.name ?? null,
      generation: hq ? await getCommunityGeneration(g.id, hq) : null,
      leaders: roles.filter((r) => r.communityId === g.id).map((r) => r.person),
    });
  }
  return out;
}

/** People who could lead this group: its members and those of its assembly, found by name. */
export async function candidatesFor(authority: Authority, groupId: string, search: string) {
  const group = await prisma.community.findUnique({ where: { id: groupId }, select: { id: true, kind: true } });
  if (!group || group.kind !== 'GROUP') throw new GroupLeaderError('Group not found.', 404);
  if (!allowed(authority, groupId)) throw new GroupLeaderError('This group is not in your generation.', 403);
  const owner = await owningAssembly(groupId);
  const q = search.trim();
  const rows = await prisma.communityMembership.findMany({
    where: {
      status: 'ACTIVE',
      communityId: { in: [groupId, ...(owner ? [owner.id] : [])] },
      ...(q ? { person: { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { whatsappNumber: { contains: q } }] } } : {}),
    },
    select: { person: { select: { id: true, name: true, whatsappNumber: true } } },
    distinct: ['personId'],
    take: 30,
  });
  const already = new Set((await prisma.roleAssignment.findMany({ where: { communityId: groupId, status: 'ACTIVE' }, select: { personId: true } })).map((r) => r.personId));
  return rows.map((r) => r.person).filter((p) => !already.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function appointGroupLeader(actorPersonId: string, authority: Authority, groupId: string, personId: string) {
  const group = await prisma.community.findUnique({ where: { id: groupId }, select: { id: true, kind: true, name: true } });
  if (!group || group.kind !== 'GROUP') throw new GroupLeaderError('Group not found.', 404);
  if (!allowed(authority, groupId)) throw new GroupLeaderError('This group is not in your generation.', 403);
  const owner = await owningAssembly(groupId);
  const belongs = await prisma.communityMembership.findFirst({
    where: { personId, status: 'ACTIVE', communityId: { in: [groupId, ...(owner ? [owner.id] : [])] } },
    select: { id: true },
  });
  if (!belongs) throw new GroupLeaderError('This person is not a member of the group or its assembly.', 400);
  if (await isCentralAdminPerson(personId)) throw new GroupLeaderError('The central admin already leads everything.', 400);
  const existing = await prisma.roleAssignment.findFirst({ where: { personId, communityId: groupId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, select: { id: true } });
  if (existing) throw new GroupLeaderError('This person already leads this group.', 409);

  const user = await actingUserFor(actorPersonId);
  const created = await prisma.roleAssignment.create({ data: { personId, roleType: 'SCOPED_LEADER', communityId: groupId, assignedByUserId: user.id } });
  await notifyRoleAssigned(created).catch(() => {});
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'ROLE_ASSIGNMENT_CREATED',
    targetType: 'RoleAssignment',
    targetId: created.id,
    metadata: { personId, roleType: 'SCOPED_LEADER', communityId: groupId, via: authority.kind === 'ADMIN' ? 'group-leader' : 'group-leader-by-representative', actorPersonId },
  });
  return created;
}
