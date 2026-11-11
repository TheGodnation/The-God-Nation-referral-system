import { whatsappConsentOf, recordWhatsAppStop, type WhatsAppConsentState } from './whatsappConsent';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { centralAdminAmong, isCentralAdminPerson } from './centralAdmin';
import { followBlock, followBlockMessage } from './followRules';
import { getHeadquartersCommunityId } from './tree';
import { recordAudit } from './audit';

// "People who need me": the National Coordinator's own desk. Everyone who has joined, how far each one has got, who
// their leader is and when anyone last contacted them, so the central admin can see at once who is being neglected and
// follow up directly: WhatsApp, an in-app message, or take the person over from a leader who is not doing the work.

const DAY = 24 * 60 * 60 * 1000;
const MAX_PEOPLE = 2000;
const PAGE_SIZE = 30;
/** A leader who has not contacted a person for this long is "not following up". */
export const LEADER_SILENT_DAYS = 7;
/** Someone who joined this long ago and never came back after their first day is "never came back". */
const NEVER_BACK_AFTER_DAYS = 3;

export type InviteeStatus = 'NOT_CONFIRMED' | 'PROFILE_INCOMPLETE' | 'QUIET' | 'ACTIVE';

/** How far someone has got: not signed in yet, still to give their name and place, quiet for a while, or active. */
export function inviteeStatusOf(
  p: { profileCompletedAt: Date | null; lastSeenAt: Date | null; memberAccount: { lastLoginAt: Date | null } | null },
  quietBefore: Date,
): InviteeStatus {
  if (!p.memberAccount?.lastLoginAt) return 'NOT_CONFIRMED';
  if (!p.profileCompletedAt) return 'PROFILE_INCOMPLETE';
  const last = p.lastSeenAt ?? p.profileCompletedAt;
  return last < quietBefore ? 'QUIET' : 'ACTIVE';
}

export type DeskFilter = 'today' | 'needs' | 'all' | 'not_confirmed' | 'profile_incomplete' | 'never_back' | 'quiet' | 'no_leader' | 'leader_silent' | 'not_in_group' | 'mine';
export const DESK_FILTERS: DeskFilter[] = ['today', 'needs', 'all', 'not_confirmed', 'profile_incomplete', 'never_back', 'quiet', 'no_leader', 'leader_silent', 'not_in_group', 'mine'];

export interface DeskQuery {
  filter?: DeskFilter;
  q?: string;
  communityId?: string;
  language?: 'en' | 'fr';
  page?: number;
}

export interface DeskPerson {
  personId: string;
  name: string;
  photoStorageKey: string | null;
  photoUpdatedAt: Date | null;
  whatsapp: string | null;
  language: 'en' | 'fr';
  joinedAt: Date;
  lastSeenAt: Date | null;
  status: InviteeStatus;
  daysQuiet: number | null;
  leader: { personId: string; name: string } | null;
  mine: boolean;
  lastContactAt: Date | null;
  /** How that last contact went (a leader's or the coordinator's record), when one was recorded. */
  lastWellbeing: Wellbeing | null;
  leaderSilent: boolean;
  noLeader: boolean;
  notInGroup: boolean;
  /** Signed in and finished setup, but has not been back since their first day (and joined at least 3 days ago). */
  neverBack: boolean;
  /** Their WhatsApp consent (see lib/whatsappConsent.ts). */
  whatsappConsent: WhatsAppConsentState;
}

const needsMe = (p: DeskPerson) => p.status !== 'ACTIVE' || p.noLeader || p.leaderSilent || p.notInGroup;

// "Today's 20" is worked out over everyone (see todaysTwenty), so it has no simple test of its own.
const FILTERS: Record<Exclude<DeskFilter, 'today'>, (p: DeskPerson) => boolean> = {
  all: () => true,
  needs: (p) => !p.mine && needsMe(p),
  not_confirmed: (p) => p.status === 'NOT_CONFIRMED',
  profile_incomplete: (p) => p.status === 'PROFILE_INCOMPLETE',
  never_back: (p) => p.neverBack,
  quiet: (p) => p.status === 'QUIET',
  no_leader: (p) => p.noLeader,
  leader_silent: (p) => p.leaderSilent,
  not_in_group: (p) => p.notInGroup,
  mine: (p) => p.mine,
};

/** Everyone the desk covers (up to MAX_PEOPLE, newest first), with all the facts worked out. */
async function loadDesk(adminPersonId: string, query: Pick<DeskQuery, 'q' | 'communityId' | 'language'>): Promise<{ people: DeskPerson[]; capped: boolean }> {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { reminderQuietDays: true } });
  const quietBefore = new Date(Date.now() - (settings?.reminderQuietDays ?? 7) * DAY);
  const rows = await prisma.person.findMany({
    where: {
      erasedAt: null,
      deletionRequestedAt: null,
      memberAccount: { isNot: null },
      users: { none: { role: 'ADMIN' } },
      ...(query.q?.trim() ? { name: { contains: query.q.trim(), mode: 'insensitive' as const } } : {}),
      ...(query.language ? { preferredLanguage: query.language } : {}),
      ...(query.communityId ? { communityMemberships: { some: { communityId: query.communityId, status: 'ACTIVE' as const } } } : {}),
    },
    select: {
      id: true, name: true, photoStorageKey: true, photoUpdatedAt: true, whatsappNumber: true, preferredLanguage: true, createdAt: true,
      profileCompletedAt: true, lastSeenAt: true, memberAccount: { select: { lastLoginAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_PEOPLE + 1,
  });
  const capped = rows.length > MAX_PEOPLE;
  const persons = rows.slice(0, MAX_PEOPLE);
  const ids = persons.map((p) => p.id);
  if (ids.length === 0) return { people: [], capped };

  const consents = await whatsappConsentOf(ids);
  const [assignments, contacts, messages, registrations] = await Promise.all([
    prisma.followUpAssignment.findMany({
      where: { followedPersonId: { in: ids } },
      select: { id: true, followedPersonId: true, followerId: true, status: true, assignedAt: true, follower: { select: { name: true } } },
    }),
    // The newest recorded contact per person, from a leader's notes or the coordinator's own record, and how it went.
    prisma.$queryRaw<{ pid: string; status: Wellbeing; at: Date }[]>(Prisma.sql`
      SELECT DISTINCT ON (x.pid) x.pid, x.status, x.at FROM (
        SELECT a."followedPersonId" AS pid, c."wellbeingStatus"::text AS status, c."contactedAt" AS at
          FROM "FollowUpContact" c JOIN "FollowUpAssignment" a ON a.id = c."followUpAssignmentId"
          WHERE a."followedPersonId" = ANY(${ids}::text[])
        UNION ALL
        SELECT "personId" AS pid, "wellbeingStatus"::text AS status, "contactedAt" AS at FROM "CoordinatorContact" WHERE "personId" = ANY(${ids}::text[])
      ) x ORDER BY x.pid, x.at DESC`),
    // The newest private message anyone from the organization side sent them (a leader or the coordinator).
    prisma.$queryRaw<{ pid: string; last: Date }[]>(Prisma.sql`
      SELECT c."memberPersonId" AS pid, MAX(m."createdAt") AS last
      FROM "PrivateMessage" m JOIN "PrivateConversation" c ON c.id = m."conversationId"
      WHERE c."memberPersonId" = ANY(${ids}::text[]) AND (m."senderPersonId" IS NULL OR m."senderPersonId" <> c."memberPersonId") AND m."deletedAt" IS NULL
      GROUP BY c."memberPersonId"`),
    prisma.registration.findMany({ where: { personId: { in: ids } }, select: { id: true, personId: true } }),
  ]);
  const events = registrations.length
    ? await prisma.event.findMany({ where: { type: { in: ['WHATSAPP_CLICKED', 'GROUP_LINK_CLICKED'] }, registrationId: { in: registrations.map((r) => r.id) } }, select: { registrationId: true }, distinct: ['registrationId'] })
    : [];
  const tappedRegs = new Set(events.map((e) => e.registrationId));
  const hasRegistration = new Set<string>();
  const tapped = new Set<string>();
  for (const r of registrations) {
    if (!r.personId) continue;
    hasRegistration.add(r.personId);
    if (tappedRegs.has(r.id)) tapped.add(r.personId);
  }

  const lastContact = new Map<string, Date>();
  const wellbeing = new Map<string, Wellbeing>();
  const bump = (pid: string, at: Date | null | undefined) => {
    if (at && (!lastContact.get(pid) || at > lastContact.get(pid)!)) lastContact.set(pid, at);
  };
  for (const c of contacts) {
    bump(c.pid, c.at);
    wellbeing.set(c.pid, c.status);
  }
  for (const m of messages) bump(m.pid, m.last);

  const byPerson = new Map<string, typeof assignments>();
  for (const a of assignments) if (a.status === 'ACTIVE') byPerson.set(a.followedPersonId, [...(byPerson.get(a.followedPersonId) ?? []), a]);

  const silentBefore = Date.now() - LEADER_SILENT_DAYS * DAY;
  const people = persons.map((p): DeskPerson => {
    const active = (byPerson.get(p.id) ?? []).sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
    const mine = active.some((a) => a.followerId === adminPersonId);
    const lead = active.find((a) => a.followerId !== adminPersonId) ?? null;
    const last = lastContact.get(p.id) ?? null;
    const status = inviteeStatusOf(p, quietBefore);
    const seen = p.lastSeenAt ?? p.profileCompletedAt;
    return {
      personId: p.id,
      name: p.name,
      photoStorageKey: p.photoStorageKey,
      photoUpdatedAt: p.photoUpdatedAt,
      whatsapp: p.whatsappNumber,
      language: p.preferredLanguage === 'fr' ? 'fr' : 'en',
      joinedAt: p.createdAt,
      lastSeenAt: p.lastSeenAt,
      status,
      daysQuiet: status === 'QUIET' && seen ? Math.floor((Date.now() - seen.getTime()) / DAY) : null,
      leader: lead ? { personId: lead.followerId, name: lead.follower.name } : null,
      mine,
      lastContactAt: last,
      lastWellbeing: wellbeing.get(p.id) ?? null,
      noLeader: !lead && !mine,
      leaderSilent: Boolean(lead) && !mine && (last ? last.getTime() < silentBefore : lead!.assignedAt.getTime() < silentBefore),
      // Only people who came through the sign-up page can be known to have (or not have) tapped the group link.
      notInGroup: hasRegistration.has(p.id) && !tapped.has(p.id),
      neverBack:
        status !== 'NOT_CONFIRMED' &&
        status !== 'PROFILE_INCOMPLETE' &&
        Date.now() - p.createdAt.getTime() > NEVER_BACK_AFTER_DAYS * DAY &&
        (!p.lastSeenAt || p.lastSeenAt.getTime() - p.createdAt.getTime() < DAY),
      whatsappConsent: consents.get(p.id) ?? 'NONE',
    };
  });
  // Those who have waited longest for any contact come first; people never contacted lead.
  people.sort((a, b) => (a.lastContactAt?.getTime() ?? 0) - (b.lastContactAt?.getTime() ?? 0) || b.joinedAt.getTime() - a.joinedAt.getTime());
  return { people, capped };
}

export interface DeskResult {
  items: DeskPerson[];
  total: number;
  page: number;
  pageSize: number;
  capped: boolean;
  counts: Record<DeskFilter, number>;
  /** How many different people the coordinator has recorded reaching out to today. */
  contactedToday: number;
}

export const TODAY_SIZE = 20;
/** Someone reached in the last 20 hours is not on today's list again. */
const RECENT_CONTACT_MS = 20 * 60 * 60 * 1000;
const WELLBEING_WEIGHT: Record<Wellbeing, number> = { EMERGENCY: 12, NEEDS_ATTENTION: 5, UNABLE_TO_REACH: 3, GOOD: 0 };

/** How much a person needs the coordinator today: the higher, the sooner. */
export function urgencyOf(p: DeskPerson, now = Date.now()): number {
  const days = p.lastContactAt ? (now - p.lastContactAt.getTime()) / DAY : null;
  return (
    (p.lastWellbeing ? WELLBEING_WEIGHT[p.lastWellbeing] : 0) +
    (p.noLeader ? 3 : 0) +
    (p.leaderSilent ? 3 : 0) +
    (p.status === 'NOT_CONFIRMED' || p.status === 'PROFILE_INCOMPLETE' ? 2 : p.status === 'QUIET' ? 1 + Math.min(p.daysQuiet ?? 0, 30) / 15 : 0) +
    (p.notInGroup ? 1 : 0) +
    (days === null ? 3 : Math.min(days / 7, 3))
  );
}

/** The short list for today: the people who most need contact and have not just been reached. */
export function todaysTwenty(people: DeskPerson[], now = Date.now()): DeskPerson[] {
  return people
    .filter((p) => {
      const days = p.lastContactAt ? (now - p.lastContactAt.getTime()) / DAY : null;
      if (p.lastContactAt && now - p.lastContactAt.getTime() < RECENT_CONTACT_MS) return false;
      const overdueMine = p.mine && (days === null || days >= LEADER_SILENT_DAYS);
      const worried = (p.lastWellbeing === 'EMERGENCY' || p.lastWellbeing === 'NEEDS_ATTENTION') && (days === null || days >= 1);
      return needsMe(p) || overdueMine || worried;
    })
    .map((p) => ({ p, score: urgencyOf(p, now) }))
    .sort((a, b) => b.score - a.score || (a.p.lastContactAt?.getTime() ?? 0) - (b.p.lastContactAt?.getTime() ?? 0))
    .slice(0, TODAY_SIZE)
    .map((x) => x.p);
}

function matching(people: DeskPerson[], filter: DeskFilter): DeskPerson[] {
  return filter === 'today' ? todaysTwenty(people) : people.filter(FILTERS[filter]);
}

/** Midnight (Cameroon time, UTC+1) that started today. */
const startOfToday = (now = Date.now()) => new Date(Math.floor((now + 3600_000) / DAY) * DAY - 3600_000);

export async function peopleNeedingMe(adminPersonId: string, query: DeskQuery = {}): Promise<DeskResult> {
  const { people, capped } = await loadDesk(adminPersonId, query);
  const counts = Object.fromEntries(DESK_FILTERS.map((f) => [f, matching(people, f).length])) as Record<DeskFilter, number>;
  const list = matching(people, query.filter ?? 'today');
  const page = Math.max(1, query.page ?? 1);
  const today = await prisma.coordinatorContact.findMany({ where: { contactedAt: { gte: startOfToday() } }, select: { personId: true }, distinct: ['personId'] });
  return { items: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: list.length, page, pageSize: PAGE_SIZE, capped, counts, contactedToday: today.length };
}

/** Everyone matching, for "select all" (at most `limit`), with what is needed to message or WhatsApp them. */
export async function deskPersonIds(adminPersonId: string, query: DeskQuery, limit = 1000) {
  const { people } = await loadDesk(adminPersonId, query);
  const list = matching(people, query.filter ?? 'today');
  const chosen = list.slice(0, limit);
  return {
    ids: chosen.map((p) => p.personId),
    total: list.length,
    languages: Object.fromEntries(chosen.map((p) => [p.personId, p.language])) as Record<string, 'en' | 'fr'>,
    people: chosen.map((p) => ({ personId: p.personId, name: p.name, whatsapp: p.whatsapp, language: p.language, whatsappConsent: p.whatsappConsent })),
  };
}

/** They asked to stop being written to on WhatsApp: recorded, and they are left out of every WhatsApp queue from now on. */
export async function stopWhatsApp(adminPersonId: string, personId: string): Promise<{ ok: true }> {
  await requireDeskOwner(adminPersonId);
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) throw new DeskError('Person not found.', 404);
  await recordWhatsAppStop(personId);
  return { ok: true };
}

export class DeskError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** The desk belongs to the central admin only. Returns their user. */
export async function requireDeskOwner(personId: string | null | undefined) {
  if (!personId || !(await isCentralAdminPerson(personId))) throw new DeskError('Only the central admin can use this.', 403);
  const user = await prisma.user.findUnique({ where: { personId }, select: { id: true, email: true } });
  if (!user) throw new DeskError('Only the central admin can use this.', 403);
  return user;
}

/**
 * Takes a person over: whoever follows them up now (a leader) stops, and the central admin follows them up directly.
 * Nothing is deleted. Doing it twice changes nothing.
 */
export async function takeOver(adminPersonId: string, personId: string): Promise<{ changed: boolean }> {
  const admin = await requireDeskOwner(adminPersonId);
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, erasedAt: true, deletionRequestedAt: true } });
  if (!person || person.erasedAt || person.deletionRequestedAt) throw new DeskError('Person not found.', 404);
  const block = await followBlock(adminPersonId, personId);
  if (block) throw new DeskError(followBlockMessage(block));
  const open = await prisma.followUpAssignment.findMany({ where: { followedPersonId: personId, status: 'ACTIVE' }, orderBy: { assignedAt: 'desc' } });
  if (open.some((a) => a.followerId === adminPersonId)) return { changed: false };

  let context: { contextType: 'COMMUNITY'; contextId: string } | null = open[0] ? { contextType: 'COMMUNITY', contextId: open[0].contextId } : null;
  if (!context) {
    const membership = await prisma.communityMembership.findFirst({ where: { personId, status: 'ACTIVE' }, orderBy: { joinedAt: 'desc' }, select: { communityId: true } });
    const contextId = membership?.communityId ?? (await getHeadquartersCommunityId());
    if (!contextId) throw new DeskError('This person is not in any assembly yet.');
    context = { contextType: 'COMMUNITY', contextId };
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.followUpAssignment.updateMany({
      where: { id: { in: open.map((a) => a.id) }, status: 'ACTIVE' },
      data: { status: 'CLOSED', closedAt: now, closedByUserId: admin.id, closeReason: 'Taken over by the central admin' },
    }),
    prisma.followUpAssignment.create({ data: { followerId: adminPersonId, followedPersonId: personId, contextType: context.contextType, contextId: context.contextId, assignedByUserId: admin.id } }),
  ]);
  await recordAudit({ actorId: admin.id, actorEmail: admin.email, action: 'FOLLOW_UP_ASSIGNED', targetType: 'Person', targetId: personId, metadata: { via: 'needs-me take over', closed: open.length } }).catch(() => {});
  return { changed: true };
}

export type Wellbeing = 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH';

/**
 * Records that the central admin reached out to a person: by WhatsApp, a call or a message. Works for anyone, whoever
 * follows them up; it counts as contact (so they leave today's list) and changes nobody's follow-up.
 */
export async function markContacted(adminPersonId: string, personId: string, input: { wellbeing?: Wellbeing; note?: string | null } = {}): Promise<{ id: string }> {
  const admin = await requireDeskOwner(adminPersonId);
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, erasedAt: true } });
  if (!person || person.erasedAt || (await isCentralAdminPerson(personId))) throw new DeskError('Person not found.', 404);
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;
  return prisma.coordinatorContact.create({ data: { personId, adminUserId: admin.id, wellbeingStatus: input.wellbeing ?? 'GOOD', note }, select: { id: true } });
}

// ---- Leaders who are not following up ---------------------------------------------------------------------------

export interface LeaderAlert {
  personId: string;
  name: string;
  photoStorageKey: string | null;
  photoUpdatedAt: Date | null;
  peopleCount: number;
  /** Days since the leader last logged a contact or sent a message; null when they never have. */
  silentDays: number | null;
}

/** Leaders who look after people but have not contacted anyone for a week or more (never-contacting leaders first). */
export async function leaderAlerts(now = Date.now()): Promise<LeaderAlert[]> {
  const roles = await prisma.roleAssignment.findMany({
    where: { roleType: 'SCOPED_LEADER', status: 'ACTIVE', person: { erasedAt: null, users: { none: { role: 'ADMIN' } } } },
    select: { personId: true, person: { select: { name: true, photoStorageKey: true, photoUpdatedAt: true } } },
    distinct: ['personId'],
  });
  if (roles.length === 0) return [];
  const ids = roles.map((r) => r.personId);
  const [counts, oldest, activity] = await Promise.all([
    prisma.followUpAssignment.groupBy({ by: ['followerId'], where: { followerId: { in: ids }, status: 'ACTIVE', followedPerson: { erasedAt: null } }, _count: { _all: true } }),
    prisma.followUpAssignment.groupBy({ by: ['followerId'], where: { followerId: { in: ids }, status: 'ACTIVE' }, _min: { assignedAt: true } }),
    prisma.$queryRaw<{ pid: string; at: Date }[]>(Prisma.sql`
      SELECT x.pid, MAX(x.at) AS at FROM (
        SELECT a."followerId" AS pid, c."contactedAt" AS at FROM "FollowUpContact" c JOIN "FollowUpAssignment" a ON a.id = c."followUpAssignmentId" WHERE a."followerId" = ANY(${ids}::text[])
        UNION ALL
        SELECT "senderPersonId" AS pid, "createdAt" AS at FROM "PrivateMessage" WHERE "senderPersonId" = ANY(${ids}::text[]) AND "deletedAt" IS NULL
      ) x GROUP BY x.pid`),
  ]);
  const count = new Map(counts.map((c) => [c.followerId, c._count._all]));
  const since = new Map(oldest.map((o) => [o.followerId, o._min.assignedAt]));
  const last = new Map(activity.map((a) => [a.pid, a.at]));
  const cutoff = now - LEADER_SILENT_DAYS * DAY;
  const out: LeaderAlert[] = [];
  for (const r of roles) {
    const people = count.get(r.personId) ?? 0;
    if (people === 0) continue;
    const at = last.get(r.personId) ?? null;
    const flagged = at ? at.getTime() < cutoff : (since.get(r.personId)?.getTime() ?? now) < cutoff;
    if (!flagged) continue;
    out.push({ personId: r.personId, name: r.person.name, photoStorageKey: r.person.photoStorageKey, photoUpdatedAt: r.person.photoUpdatedAt, peopleCount: people, silentDays: at ? Math.floor((now - at.getTime()) / DAY) : null });
  }
  return out.sort((a, b) => (a.silentDays === null ? 1 : 0) !== (b.silentDays === null ? 1 : 0) ? (a.silentDays === null ? -1 : 1) : (b.silentDays ?? 0) - (a.silentDays ?? 0));
}

/** Takes over every person a leader follows up (the coordinator now follows them directly; nothing is deleted). */
export async function takeOverLeader(adminPersonId: string, leaderPersonId: string): Promise<{ taken: number }> {
  await requireDeskOwner(adminPersonId);
  const rows = await prisma.followUpAssignment.findMany({ where: { followerId: leaderPersonId, status: 'ACTIVE' }, select: { followedPersonId: true }, distinct: ['followedPersonId'], take: 500 });
  let taken = 0;
  for (const r of rows) {
    try {
      if ((await takeOver(adminPersonId, r.followedPersonId)).changed) taken++;
    } catch {
      // Someone who cannot be taken over (erased, or the central admin) is simply left out.
    }
  }
  return { taken };
}

/** Ids of the central admin among these people (never messaged or listed). */
export async function withoutAdmin(personIds: string[]): Promise<string[]> {
  const admins = await centralAdminAmong(personIds);
  return personIds.filter((id) => !admins.has(id));
}
