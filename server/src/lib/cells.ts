import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { recordAudit } from './audit';
import { notifyRoleAssigned } from './notifications';

// ---------------------------------------------------------------------------
// Cells — the central admin's view of the assemblies and who is ready to lead.
//
// "Ready to lead" = an active member of the assembly who has passed the exam
// of EVERY Leadership School book (the books that have a published exam) and
// is not already a leader of that assembly. There is no limit on how many
// leaders an assembly can have: the central admin appoints as many as he
// wants, himself, from this list.
// ---------------------------------------------------------------------------

/** The exams a person must pass to have finished the Leadership School. */
export async function requiredLeadershipExamIds(): Promise<string[]> {
  const books = await prisma.libraryBook.findMany({
    where: { kind: 'TRAINING', trainingOrder: { not: null }, exam: { is: { status: { in: ['PUBLISHED', 'LOCKED'] } } } },
    select: { exam: { select: { id: true } } },
  });
  return books.map((b) => b.exam!.id);
}

/** When each given person finished the school (null = not finished), among `personIds`. */
export async function graduatesAmong(personIds: string[]): Promise<Map<string, Date>> {
  const examIds = await requiredLeadershipExamIds();
  const result = new Map<string, Date>();
  if (examIds.length === 0 || personIds.length === 0) return result;

  const passes = await prisma.attempt.findMany({
    where: { personId: { in: personIds }, assessmentId: { in: examIds }, status: 'SUBMITTED', passed: true },
    select: { personId: true, assessmentId: true, submittedAt: true },
  });
  const perPerson = new Map<string, Map<string, Date | null>>();
  for (const a of passes) {
    const m = perPerson.get(a.personId) ?? new Map<string, Date | null>();
    const prev = m.get(a.assessmentId);
    if (prev === undefined || (a.submittedAt && (!prev || a.submittedAt < prev))) m.set(a.assessmentId, a.submittedAt);
    perPerson.set(a.personId, m);
  }
  for (const [personId, m] of perPerson) {
    if (m.size < examIds.length) continue;
    // They finished when the last of the exams was first passed.
    const dates = [...m.values()].filter((d): d is Date => Boolean(d));
    result.set(personId, dates.sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0));
  }
  return result;
}

/** How many of the required Leadership School exams each given person has passed. */
export async function schoolProgressAmong(personIds: string[]): Promise<{ required: number; passed: Map<string, number> }> {
  const examIds = await requiredLeadershipExamIds();
  const passed = new Map<string, number>();
  if (examIds.length === 0 || personIds.length === 0) return { required: examIds.length, passed };
  const rows = await prisma.attempt.findMany({
    where: { personId: { in: personIds }, assessmentId: { in: examIds }, status: 'SUBMITTED', passed: true },
    select: { personId: true, assessmentId: true },
    distinct: ['personId', 'assessmentId'],
  });
  for (const r of rows) passed.set(r.personId, (passed.get(r.personId) ?? 0) + 1);
  return { required: examIds.length, passed };
}

export interface ReadyToLeadPerson {
  personId: string;
  name: string;
  whatsappNumber: string;
  finishedAt: string;
}

/** Members of one assembly who have finished the school and do not lead it yet. */
export async function readyToLeadIn(communityId: string): Promise<{ requiredBooks: number; items: ReadyToLeadPerson[] }> {
  const [examIds, members, leaders] = await Promise.all([
    requiredLeadershipExamIds(),
    prisma.communityMembership.findMany({
      where: { communityId, status: 'ACTIVE' },
      select: { person: { select: { id: true, name: true, whatsappNumber: true } } },
    }),
    prisma.roleAssignment.findMany({ where: { communityId, status: 'ACTIVE' }, select: { personId: true } }),
  ]);
  const leaderIds = new Set(leaders.map((l) => l.personId));
  const candidates = members.map((m) => m.person).filter((p) => !leaderIds.has(p.id));
  const graduates = await graduatesAmong(candidates.map((p) => p.id));
  const items = candidates
    .filter((p) => graduates.has(p.id))
    .map((p) => ({ personId: p.id, name: p.name, whatsappNumber: p.whatsappNumber, finishedAt: graduates.get(p.id)!.toISOString() }))
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  return { requiredBooks: examIds.length, items };
}

export interface AssemblyOverviewRow {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  autoCreated: boolean;
  createdAt: string;
  members: number;
  leaders: number;
  readyToLead: number;
  /** Members nobody follows yet (not leaders, not the central admin). */
  unassigned: number;
}

/** Every active assembly with its size, leaders and how many are ready to lead. */
export async function assembliesOverview(): Promise<{ capacity: number; requiredBooks: number; items: AssemblyOverviewRow[] }> {
  const [communities, memberships, roles, settings, examIds, followed, admins] = await Promise.all([
    prisma.community.findMany({
      where: { active: true },
      select: { id: true, name: true, parentId: true, autoCreated: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.communityMembership.findMany({ where: { status: 'ACTIVE' }, select: { personId: true, communityId: true } }),
    prisma.roleAssignment.findMany({ where: { status: 'ACTIVE', communityId: { not: null } }, select: { personId: true, communityId: true } }),
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { assemblyCapacity: true } }),
    requiredLeadershipExamIds(),
    prisma.followUpAssignment.findMany({ where: { status: 'ACTIVE' }, select: { contextId: true, followedPersonId: true } }),
    prisma.user.findMany({ where: { role: 'ADMIN', active: true, personId: { not: null } }, select: { personId: true } }),
  ]);
  const followedKey = new Set(followed.map((f) => `${f.contextId}:${f.followedPersonId}`));
  const adminIds = new Set(admins.map((a) => a.personId as string));

  const graduates = await graduatesAmong([...new Set(memberships.map((m) => m.personId))]);
  const nameOf = new Map(communities.map((c) => [c.id, c.name]));
  const leaderKey = new Set(roles.map((r) => `${r.communityId}:${r.personId}`));
  const members = new Map<string, number>();
  const ready = new Map<string, number>();
  const unassigned = new Map<string, number>();
  for (const m of memberships) {
    members.set(m.communityId, (members.get(m.communityId) ?? 0) + 1);
    const key = `${m.communityId}:${m.personId}`;
    if (!leaderKey.has(key) && !followedKey.has(key) && !adminIds.has(m.personId)) {
      unassigned.set(m.communityId, (unassigned.get(m.communityId) ?? 0) + 1);
    }
    if (graduates.has(m.personId) && !leaderKey.has(`${m.communityId}:${m.personId}`)) {
      ready.set(m.communityId, (ready.get(m.communityId) ?? 0) + 1);
    }
  }
  const leaders = new Map<string, number>();
  for (const r of roles) leaders.set(r.communityId!, (leaders.get(r.communityId!) ?? 0) + 1);

  return {
    capacity: settings?.assemblyCapacity ?? 200,
    requiredBooks: examIds.length,
    items: communities.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      parentName: c.parentId ? (nameOf.get(c.parentId) ?? null) : null,
      autoCreated: c.autoCreated,
      createdAt: c.createdAt.toISOString(),
      members: members.get(c.id) ?? 0,
      leaders: leaders.get(c.id) ?? 0,
      readyToLead: ready.get(c.id) ?? 0,
      unassigned: unassigned.get(c.id) ?? 0,
    })),
  };
}

export type AppointResult = { ok: true; id: string } | { ok: false; status: 400 | 409; error: string };

/**
 * Makes a person a leader of an assembly (the same record the older
 * "New Assignment" form creates). No limit on leaders per assembly.
 * `actor` is the central admin's own user account.
 */
export async function appointLeader(
  personId: string,
  communityId: string,
  actor: { id: string; email: string },
): Promise<AppointResult> {
  const [person, community] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { id: true } }),
    prisma.community.findUnique({ where: { id: communityId }, select: { id: true } }),
  ]);
  if (!person) return { ok: false, status: 400, error: 'Person not found.' };
  if (!community) return { ok: false, status: 400, error: 'Community not found.' };

  let created;
  try {
    created = await prisma.roleAssignment.create({
      data: { personId, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: actor.id },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, status: 409, error: 'This person already leads this assembly.' };
    }
    throw err;
  }
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'ROLE_ASSIGNMENT_CREATED',
    targetType: 'RoleAssignment',
    targetId: created.id,
    metadata: { personId, roleType: 'SCOPED_LEADER', communityId, via: 'ready-to-lead' },
  });
  await notifyRoleAssigned(created);
  return { ok: true, id: created.id };
}
