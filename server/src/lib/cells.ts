import { closeFollowUpsOfNewLeader } from './followRules';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { recordAudit } from './audit';
import { notifyRoleAssigned } from './notifications';
import { ensureLeaderAccount, type LeaderAccountResult } from './leaderAccounts';
import { addPeopleToCommunity } from './bulkMembers';
import { programmeBookTotal } from './trainingTotal';

// ---------------------------------------------------------------------------
// Cells — the central admin's view of the assemblies and who is ready to lead.
//
// "Ready to lead" = an active member of the assembly who has passed the exam
// of EVERY book of the programme (all 16, even while the last ones are still to
// be put on the site: until every book has its exam, nobody is ready) and
// is not already a leader of that assembly. There is no limit on how many
// leaders an assembly can have: the central admin appoints as many as he
// wants, himself, from this list.
// ---------------------------------------------------------------------------

/** The exams a person must pass to have finished the Leadership Academy. */
export async function requiredLeadershipExamIds(): Promise<string[]> {
  const books = await prisma.libraryBook.findMany({
    where: { kind: 'TRAINING', trainingOrder: { not: null }, exam: { is: { status: { in: ['PUBLISHED', 'LOCKED'] } } } },
    select: { exam: { select: { id: true } } },
  });
  return books.map((b) => b.exam!.id);
}

/**
 * Whether the whole programme is on the site: every book (and at least the programme total, 16) has a published exam.
 * While it is not, nobody can have finished the school. `total` is the number of books students are told about.
 */
export async function programmeCompleteness(): Promise<{ examIds: string[]; total: number; complete: boolean }> {
  const [examIds, booksOnSite] = await Promise.all([
    requiredLeadershipExamIds(),
    prisma.libraryBook.count({ where: { kind: 'TRAINING', trainingOrder: { not: null } } }),
  ]);
  const total = examIds.length === 0 ? 0 : await programmeBookTotal(booksOnSite);
  return { examIds, total, complete: examIds.length > 0 && examIds.length >= total };
}

/** When each given person finished the school (null = not finished), among `personIds`. */
export async function graduatesAmong(personIds: string[]): Promise<Map<string, Date>> {
  const { examIds, complete } = await programmeCompleteness();
  const result = new Map<string, Date>();
  if (!complete || personIds.length === 0) return result;

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

/** How many of the required Leadership Academy exams each given person has passed. */
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
  const [{ total }, members, leaders] = await Promise.all([
    programmeCompleteness(),
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
  return { requiredBooks: total, items };
}

export interface AssemblyOverviewRow {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  autoCreated: boolean;
  /** ASSEMBLY counts as a generation; GROUP (women, youth, prayer, leadership team…) never does. */
  kind: 'ASSEMBLY' | 'GROUP';
  createdAt: string;
  members: number;
  leaders: number;
  readyToLead: number;
  /** Members nobody follows yet (not leaders, not the central admin). */
  unassigned: number;
}

/** Every active assembly with its size, leaders and how many are ready to lead. */
export async function assembliesOverview(): Promise<{ capacity: number; requiredBooks: number; items: AssemblyOverviewRow[] }> {
  const [communities, memberships, roles, settings, { total: requiredTotal }, followed, admins] = await Promise.all([
    prisma.community.findMany({
      where: { active: true },
      select: { id: true, name: true, parentId: true, autoCreated: true, createdAt: true, kind: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.communityMembership.findMany({ where: { status: 'ACTIVE' }, select: { personId: true, communityId: true } }),
    prisma.roleAssignment.findMany({ where: { status: 'ACTIVE', communityId: { not: null } }, select: { personId: true, communityId: true } }),
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { assemblyCapacity: true } }),
    programmeCompleteness(),
    prisma.followUpAssignment.findMany({ where: { status: 'ACTIVE' }, select: { contextId: true, followedPersonId: true } }),
    prisma.user.findMany({ where: { role: 'ADMIN', active: true, personId: { not: null } }, select: { personId: true } }),
  ]);
  const followedKey = new Set(followed.map((f) => `${f.contextId}:${f.followedPersonId}`));
  const adminIds = new Set(admins.map((a) => a.personId as string));

  const graduates = await graduatesAmong([...new Set(memberships.map((m) => m.personId))]);
  const nameOf = new Map(communities.map((c) => [c.id, c.name]));
  const isGroup = new Set(communities.filter((c) => c.kind === 'GROUP').map((c) => c.id));
  const leaderKey = new Set(roles.map((r) => `${r.communityId}:${r.personId}`));
  const members = new Map<string, number>();
  const ready = new Map<string, number>();
  const unassigned = new Map<string, number>();
  for (const m of memberships) {
    members.set(m.communityId, (members.get(m.communityId) ?? 0) + 1);
    const key = `${m.communityId}:${m.personId}`;
    // Following people up happens in assemblies, not in groups.
    if (!isGroup.has(m.communityId) && !leaderKey.has(key) && !followedKey.has(key) && !adminIds.has(m.personId)) {
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
    requiredBooks: requiredTotal,
    items: communities.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      parentName: c.parentId ? (nameOf.get(c.parentId) ?? null) : null,
      autoCreated: c.autoCreated,
      kind: c.kind,
      createdAt: c.createdAt.toISOString(),
      members: members.get(c.id) ?? 0,
      leaders: leaders.get(c.id) ?? 0,
      readyToLead: ready.get(c.id) ?? 0,
      unassigned: unassigned.get(c.id) ?? 0,
    })),
  };
}

export type AppointResult = { ok: true; id: string; leaderAccount: LeaderAccountResult['status'] } | { ok: false; status: 400 | 409; error: string };

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
  await closeFollowUpsOfNewLeader(personId);
  // Leading an assembly also needs the Leader account that opens the "My Leadership Dashboard".
  const leaderAccount = await ensureLeaderAccount(personId, actor);
  return { ok: true, id: created.id, leaderAccount: leaderAccount.status };
}


export interface MakeLeaderOutcome {
  personId: string;
  name: string;
  /** APPOINTED now, ALREADY_LEADER of this assembly, or NOT_FOUND. */
  status: 'APPOINTED' | 'ALREADY_LEADER' | 'NOT_FOUND';
  /** They were not a member of the assembly, so they were added to it. */
  addedToAssembly: boolean;
  /** Their Leader account (what opens the leadership dashboard): CREATED, ALREADY, NO_MEMBER_ACCOUNT (not joined the app yet) or EMAIL_TAKEN. */
  leaderAccount: LeaderAccountResult['status'] | null;
}

/**
 * Makes these people leaders of an assembly (or group) in one step: adds them to it if they are not members yet,
 * appoints them, and gives each the Leader account so their leadership dashboard follows them. Anyone already a leader
 * there is left as they are (but still gets the account if they lack it). Anyone who has not joined the app as a member
 * can be appointed but cannot have a dashboard yet; that is reported, not hidden.
 */
export async function makeLeaders(communityId: string, personIds: string[], actor: { id: string; email: string }): Promise<MakeLeaderOutcome[] | null> {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true } });
  if (!community) return null;
  const out: MakeLeaderOutcome[] = [];
  for (const personId of [...new Set(personIds)]) {
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, name: true, erasedAt: true } });
    if (!person || person.erasedAt) {
      out.push({ personId, name: '', status: 'NOT_FOUND', addedToAssembly: false, leaderAccount: null });
      continue;
    }
    const member = await prisma.communityMembership.findUnique({ where: { personId_communityId: { personId, communityId } }, select: { status: true } });
    let addedToAssembly = false;
    if (member?.status !== 'ACTIVE') {
      await addPeopleToCommunity([personId], communityId);
      addedToAssembly = true;
    }
    let status: MakeLeaderOutcome['status'] = 'APPOINTED';
    try {
      const created = await prisma.roleAssignment.create({ data: { personId, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: actor.id } });
      await notifyRoleAssigned(created);
      await closeFollowUpsOfNewLeader(personId);
      await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'ROLE_ASSIGNMENT_CREATED', targetType: 'RoleAssignment', targetId: created.id, metadata: { personId, roleType: 'SCOPED_LEADER', communityId, via: 'make-leaders', addedToAssembly } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') status = 'ALREADY_LEADER';
      else throw err;
    }
    const leaderAccount = await ensureLeaderAccount(personId, actor);
    out.push({ personId, name: person.name, status, addedToAssembly, leaderAccount: leaderAccount.status });
  }
  return out;
}

/** The people who currently lead this assembly or group (to bring them, in one step, to another). */
export async function leadersOf(communityId: string) {
  const rows = await prisma.roleAssignment.findMany({
    where: { communityId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', person: { erasedAt: null } },
    select: { person: { select: { id: true, name: true } } },
  });
  return rows.map((r) => r.person).sort((a, b) => a.name.localeCompare(b.name));
}

/** Find people by name or phone number (for choosing who to make a leader). */
export async function findPeople(search: string) {
  const q = search.trim();
  if (q.length < 2) return [];
  const rows = await prisma.person.findMany({
    where: { erasedAt: null, OR: [{ name: { contains: q, mode: 'insensitive' } }, { whatsappNumber: { contains: q } }] },
    select: { id: true, name: true, whatsappNumber: true, memberAccount: { select: { id: true } } },
    orderBy: { name: 'asc' },
    take: 20,
  });
  return rows.map((r) => ({ id: r.id, name: r.name, whatsappNumber: r.whatsappNumber, hasMemberAccount: Boolean(r.memberAccount) }));
}
