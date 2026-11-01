import { prisma } from './prisma';
import { startAdaptiveLoop } from './activity';
import { isCentralAdminPerson } from './centralAdmin';
import { leaderLoads } from './followUpShare';
import { notifyEscalationAnswered, notifyEscalationBypassed, notifyEscalationReceived, type EscalationNoticeInfo } from './notifications';

// ---------------------------------------------------------------------------
// Escalation. A leader sends a hard question about one of their people to the
// leaders of the parent assembly, or straight to the central admin. If the
// parent leaders are all away it goes straight on to the central admin; if
// nobody answers in 24 hours (2 hours when urgent) it is passed on, and the
// leaders who were skipped, and the leader who asked, are told.
// ---------------------------------------------------------------------------

export const ESCALATION_HOURS = 24;
export const URGENT_ESCALATION_HOURS = 2;
const HOUR = 60 * 60 * 1000;

/** Who is looking at an escalation: a leader (person) or the central admin (account and/or member profile). */
export type EscalationActor = { kind: 'PERSON'; personId: string } | { kind: 'ADMIN'; userId: string | null; personId: string | null };

async function parentOf(communityId: string): Promise<string | null> {
  const c = await prisma.community.findUnique({ where: { id: communityId }, select: { parentId: true } });
  return c?.parentId ?? null;
}

/** The active leaders of the assembly above `communityId`. */
export async function parentLeaders(communityId: string) {
  const parentId = await parentOf(communityId);
  return parentId ? leaderLoads(parentId) : [];
}

export async function isParentLeader(personId: string, communityId: string): Promise<boolean> {
  return (await parentLeaders(communityId)).some((l) => l.personId === personId);
}

async function noticeInfo(e: { id: string; askerPersonId: string; aboutPersonId: string; urgent: boolean }): Promise<EscalationNoticeInfo> {
  const people = await prisma.person.findMany({ where: { id: { in: [e.askerPersonId, e.aboutPersonId] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '';
  return { id: e.id, askerName: nameOf(e.askerPersonId), aboutName: nameOf(e.aboutPersonId), urgent: e.urgent };
}

export type CreateEscalationResult = { ok: true; id: string; level: 'PARENT_LEADERS' | 'CENTRAL_ADMIN'; bypassed: boolean } | { ok: false; status: 400 | 403; error: string };

export async function createEscalation(opts: {
  askerPersonId: string;
  aboutPersonId: string;
  question: string;
  urgent: boolean;
  to: 'PARENT' | 'CENTRAL';
  now?: Date;
}): Promise<CreateEscalationResult> {
  const now = opts.now ?? new Date();
  const assignment = await prisma.followUpAssignment.findFirst({
    where: { followerId: opts.askerPersonId, followedPersonId: opts.aboutPersonId, status: 'ACTIVE' },
    select: { contextId: true },
  });
  if (!assignment) return { ok: false, status: 403, error: 'This person is not one of your people.' };

  const leaders = opts.to === 'PARENT' ? (await parentLeaders(assignment.contextId)).filter((l) => l.personId !== opts.askerPersonId) : [];
  const present = leaders.filter((l) => !l.away);
  const toParent = present.length > 0;
  // Asked the parent leaders, but they are all away: straight to the central admin.
  const bypassedAtOnce = opts.to === 'PARENT' && !toParent && leaders.length > 0;

  const created = await prisma.followUpEscalation.create({
    data: {
      askerPersonId: opts.askerPersonId,
      aboutPersonId: opts.aboutPersonId,
      communityId: assignment.contextId,
      question: opts.question,
      urgent: opts.urgent,
      level: toParent ? 'PARENT_LEADERS' : 'CENTRAL_ADMIN',
      dueAt: toParent ? new Date(now.getTime() + (opts.urgent ? URGENT_ESCALATION_HOURS : ESCALATION_HOURS) * HOUR) : null,
      bypassedAt: bypassedAtOnce ? now : null,
      bypassReason: bypassedAtOnce ? 'AWAY' : null,
      messages: { create: { senderPersonId: opts.askerPersonId, body: opts.question } },
    },
  });
  const info = await noticeInfo(created);
  if (toParent) {
    await notifyEscalationReceived(info, present.map((l) => l.personId));
    // The parent leaders who are away are told they were passed over.
    const away = leaders.filter((l) => l.away).map((l) => l.personId);
    if (away.length) await notifyEscalationBypassed(info, away, 'SKIPPED', 'AWAY');
  } else {
    await notifyEscalationReceived(info, 'ADMIN', bypassedAtOnce);
    if (bypassedAtOnce) {
      await notifyEscalationBypassed(info, leaders.map((l) => l.personId), 'SKIPPED', 'AWAY');
      await notifyEscalationBypassed(info, [opts.askerPersonId], 'ASKER', 'AWAY');
    }
  }
  return { ok: true, id: created.id, level: created.level, bypassed: bypassedAtOnce };
}

/** Pass on every question whose time ran out. Returns how many were passed on. */
export async function processEscalationBypass(now = new Date()): Promise<number> {
  const due = await prisma.followUpEscalation.findMany({
    where: { status: 'OPEN', level: 'PARENT_LEADERS', dueAt: { lte: now } },
  });
  for (const e of due) {
    // Move it first so a slow send is never repeated by the next tick.
    const moved = await prisma.followUpEscalation.updateMany({
      where: { id: e.id, status: 'OPEN', level: 'PARENT_LEADERS' },
      data: { level: 'CENTRAL_ADMIN', dueAt: null, bypassedAt: now, bypassReason: 'NO_REPLY' },
    });
    if (moved.count === 0) continue;
    const info = await noticeInfo(e);
    const skipped = (await parentLeaders(e.communityId)).filter((l) => l.personId !== e.askerPersonId).map((l) => l.personId);
    await notifyEscalationReceived(info, 'ADMIN', true).catch(() => {});
    if (skipped.length) await notifyEscalationBypassed(info, skipped, 'SKIPPED', 'NO_REPLY').catch(() => {});
    await notifyEscalationBypassed(info, [e.askerPersonId], 'ASKER', 'NO_REPLY').catch(() => {});
  }
  return due.length;
}

/** Looks for questions that ran out of time (every minute while the app is in use, every 30 minutes when quiet). */
export function startEscalationLoop(): void {
  startAdaptiveLoop(processEscalationBypass, (err) => console.error('[escalations] bypass tick failed', { error: err instanceof Error ? err.message : String(err) }));
}

async function isAdminActor(actor: EscalationActor): Promise<boolean> {
  return actor.kind === 'ADMIN' || (actor.kind === 'PERSON' && (await isCentralAdminPerson(actor.personId)));
}

async function canSee(e: { askerPersonId: string; communityId: string }, actor: EscalationActor): Promise<boolean> {
  if (await isAdminActor(actor)) return true;
  if (actor.kind !== 'PERSON') return false;
  return actor.personId === e.askerPersonId || (await isParentLeader(actor.personId, e.communityId));
}

export interface EscalationView {
  id: string;
  askerName: string;
  aboutName: string;
  aboutPersonId: string;
  communityName: string | null;
  question: string;
  urgent: boolean;
  level: 'PARENT_LEADERS' | 'CENTRAL_ADMIN';
  status: 'OPEN' | 'ANSWERED';
  dueAt: string | null;
  bypassReason: string | null;
  createdAt: string;
  answeredAt: string | null;
  mine: boolean;
  messages: { id: string; senderName: string; mine: boolean; body: string; createdAt: string }[];
}

async function toViews(rows: Awaited<ReturnType<typeof loadRows>>, actor: EscalationActor): Promise<EscalationView[]> {
  const personIds = new Set<string>();
  const userIds = new Set<string>();
  for (const e of rows) {
    personIds.add(e.askerPersonId);
    personIds.add(e.aboutPersonId);
    for (const m of e.messages) {
      if (m.senderPersonId) personIds.add(m.senderPersonId);
      if (m.senderUserId) userIds.add(m.senderUserId);
    }
  }
  const [people, users, communities] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }),
    prisma.community.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.communityId))] } }, select: { id: true, name: true } }),
  ]);
  const nameOfPerson = new Map(people.map((p) => [p.id, p.name]));
  const nameOfUser = new Map(users.map((u) => [u.id, u.name]));
  const nameOfCommunity = new Map(communities.map((c) => [c.id, c.name]));
  const myPersonId = actor.personId ?? null;
  const myUserId = actor.kind === 'ADMIN' ? actor.userId : null;
  return rows.map((e) => ({
    id: e.id,
    askerName: nameOfPerson.get(e.askerPersonId) ?? '',
    aboutName: nameOfPerson.get(e.aboutPersonId) ?? '',
    aboutPersonId: e.aboutPersonId,
    communityName: nameOfCommunity.get(e.communityId) ?? null,
    question: e.question,
    urgent: e.urgent,
    level: e.level,
    status: e.status,
    dueAt: e.dueAt?.toISOString() ?? null,
    bypassReason: e.bypassReason,
    createdAt: e.createdAt.toISOString(),
    answeredAt: e.answeredAt?.toISOString() ?? null,
    mine: e.askerPersonId === myPersonId,
    messages: e.messages.map((m) => ({
      id: m.id,
      senderName: (m.senderPersonId ? nameOfPerson.get(m.senderPersonId) : m.senderUserId ? nameOfUser.get(m.senderUserId) : '') ?? '',
      mine: (m.senderPersonId !== null && m.senderPersonId === myPersonId) || (m.senderUserId !== null && m.senderUserId === myUserId),
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  }));
}

function loadRows(where: object, take = 100) {
  return prisma.followUpEscalation.findMany({
    where,
    include: { messages: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ status: 'asc' }, { urgent: 'desc' }, { createdAt: 'desc' }],
    take,
  });
}

/** Questions this leader asked. */
export async function escalationsAskedBy(personId: string) {
  return toViews(await loadRows({ askerPersonId: personId }), { kind: 'PERSON', personId });
}

/** Questions sent to this leader as a leader of the parent assembly. */
export async function escalationsForLeader(personId: string) {
  const roles = await prisma.roleAssignment.findMany({ where: { personId, status: 'ACTIVE', communityId: { not: null } }, select: { communityId: true } });
  const parentIds = roles.map((r) => r.communityId as string);
  if (parentIds.length === 0) return [];
  const children = await prisma.community.findMany({ where: { parentId: { in: parentIds } }, select: { id: true } });
  if (children.length === 0) return [];
  return toViews(
    await loadRows({ communityId: { in: children.map((c) => c.id) }, askerPersonId: { not: personId } }),
    { kind: 'PERSON', personId },
  );
}

/** Everything open or recent, for the central admin. */
export async function escalationsForAdmin(actor: EscalationActor) {
  return toViews(await loadRows({}, 200), actor);
}

export type AddMessageResult = { ok: true } | { ok: false; status: 403 | 404; error: string };

export async function addEscalationMessage(id: string, actor: EscalationActor, body: string): Promise<AddMessageResult> {
  const e = await prisma.followUpEscalation.findUnique({ where: { id } });
  if (!e) return { ok: false, status: 404, error: 'Question not found.' };
  if (!(await canSee(e, actor))) return { ok: false, status: 403, error: 'You cannot take part in this question.' };

  await prisma.followUpEscalationMessage.create({
    data: { escalationId: id, senderPersonId: actor.personId ?? null, senderUserId: actor.kind === 'ADMIN' && !actor.personId ? actor.userId : null, body },
  });
  const isAsker = actor.personId === e.askerPersonId;
  const info = await noticeInfo(e);
  if (!isAsker && e.status === 'OPEN') {
    await prisma.followUpEscalation.update({
      where: { id },
      data: { status: 'ANSWERED', answeredAt: new Date(), answeredByPersonId: actor.personId ?? null, answeredByUserId: actor.kind === 'ADMIN' ? actor.userId : null, dueAt: null },
    });
  }
  if (!isAsker) {
    const name = actor.personId
      ? ((await prisma.person.findUnique({ where: { id: actor.personId }, select: { name: true } }))?.name ?? '')
      : actor.kind === 'ADMIN' && actor.userId
        ? ((await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? '')
        : '';
    await notifyEscalationAnswered(info, e.askerPersonId, name).catch(() => {});
  } else if (e.answeredByPersonId) {
    await notifyEscalationReceived(info, [e.answeredByPersonId]).catch(() => {});
  }
  return { ok: true };
}

export async function escalationViewFor(id: string, actor: EscalationActor): Promise<EscalationView | null> {
  const e = await prisma.followUpEscalation.findUnique({ where: { id }, select: { askerPersonId: true, communityId: true } });
  if (!e || !(await canSee(e, actor))) return null;
  return (await toViews(await loadRows({ id }), actor))[0] ?? null;
}
