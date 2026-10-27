import crypto from 'crypto';
import { prisma } from './prisma';
import { isCentralAdminPerson } from './centralAdmin';
import { hasConversationAccess } from './communityConversation';
import { isCommunityAdministrator } from './leadership';

/** "I'm here" can be used from half an hour before the start until half an hour after the end. */
export const CHECK_IN_BEFORE_MS = 30 * 60 * 1000;
export const CHECK_IN_AFTER_MS = 30 * 60 * 1000;
export const DEFAULT_EVENT_MS = 2 * 60 * 60 * 1000;

export function newCheckInCode(): string {
  return crypto.randomInt(0, 10000).toString().padStart(4, '0');
}

export function checkInWindow(event: { startsAt: Date; endsAt: Date }, now = Date.now()) {
  const opensAt = new Date(event.startsAt.getTime() - CHECK_IN_BEFORE_MS);
  const closesAt = new Date(event.endsAt.getTime() + CHECK_IN_AFTER_MS);
  return { opensAt, closesAt, open: now >= opensAt.getTime() && now <= closesAt.getTime() };
}

/** Who may add, change and mark attendance for events in this assembly: its leaders and the central admin. */
export const canManageEvents = isCommunityAdministrator;
export const canSeeEvents = hasConversationAccess;

/** The assemblies a person can see events of (all of them for the central admin). */
export async function visibleCommunityIds(personId: string): Promise<string[] | 'ALL'> {
  if (await isCentralAdminPerson(personId)) return 'ALL';
  const [memberships, roles] = await Promise.all([
    prisma.communityMembership.findMany({ where: { personId, status: 'ACTIVE' }, select: { communityId: true } }),
    prisma.roleAssignment.findMany({ where: { personId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } }, select: { communityId: true } }),
  ]);
  return [...new Set([...memberships.map((m) => m.communityId), ...roles.map((r) => r.communityId!).filter(Boolean)])];
}

/** The assemblies where this person may add events. */
export async function creatableCommunities(personId: string) {
  if (await isCentralAdminPerson(personId)) {
    return prisma.community.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 300 });
  }
  const roles = await prisma.roleAssignment.findMany({
    where: { personId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } },
    select: { community: { select: { id: true, name: true } } },
  });
  return roles.map((r) => r.community).filter((c): c is { id: string; name: string } => Boolean(c)).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Who counts as present at each event: ticked by a leader or typed the code
 * ("LIVE"), or — when the event points to a recorded teaching — finished that
 * teaching ("REPLAY"). Live wins when both are true.
 */
export async function presenceMap(events: { id: string; replayTeachingId: string | null }[], personIds?: string[]) {
  const ids = events.map((e) => e.id);
  const out = new Map<string, Map<string, { live: 'LEADER' | 'SELF' | null; replay: boolean }>>();
  for (const id of ids) out.set(id, new Map());
  if (ids.length === 0) return out;
  const personFilter = personIds ? { personId: { in: personIds } } : {};
  const teachingIds = [...new Set(events.map((e) => e.replayTeachingId).filter((t): t is string => Boolean(t)))];
  const [attendances, progress] = await Promise.all([
    prisma.eventAttendance.findMany({ where: { eventId: { in: ids }, ...personFilter }, select: { eventId: true, personId: true, method: true } }),
    teachingIds.length
      ? prisma.teachingProgress.findMany({ where: { teachingId: { in: teachingIds }, completedAt: { not: null }, ...personFilter }, select: { teachingId: true, personId: true } })
      : Promise.resolve([] as { teachingId: string; personId: string }[]),
  ]);
  const cell = (eventId: string, personId: string) => {
    const m = out.get(eventId)!;
    if (!m.has(personId)) m.set(personId, { live: null, replay: false });
    return m.get(personId)!;
  };
  for (const a of attendances) cell(a.eventId, a.personId).live = a.method;
  const eventsOfTeaching = new Map<string, string[]>();
  for (const e of events) if (e.replayTeachingId) eventsOfTeaching.set(e.replayTeachingId, [...(eventsOfTeaching.get(e.replayTeachingId) ?? []), e.id]);
  for (const p of progress) for (const eventId of eventsOfTeaching.get(p.teachingId) ?? []) cell(eventId, p.personId).replay = true;
  return out;
}

export const isPresent = (c: { live: unknown; replay: boolean } | undefined) => Boolean(c && (c.live || c.replay));
