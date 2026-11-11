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

export type DeskFilter = 'needs' | 'all' | 'not_confirmed' | 'profile_incomplete' | 'quiet' | 'no_leader' | 'leader_silent' | 'not_in_group' | 'mine';
export const DESK_FILTERS: DeskFilter[] = ['needs', 'all', 'not_confirmed', 'profile_incomplete', 'quiet', 'no_leader', 'leader_silent', 'not_in_group', 'mine'];

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
  leaderSilent: boolean;
  noLeader: boolean;
  notInGroup: boolean;
}

const needsMe = (p: DeskPerson) => p.status !== 'ACTIVE' || p.noLeader || p.leaderSilent || p.notInGroup;

const FILTERS: Record<DeskFilter, (p: DeskPerson) => boolean> = {
  all: () => true,
  needs: (p) => !p.mine && needsMe(p),
  not_confirmed: (p) => p.status === 'NOT_CONFIRMED',
  profile_incomplete: (p) => p.status === 'PROFILE_INCOMPLETE',
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

  const [assignments, contacts, messages, registrations] = await Promise.all([
    prisma.followUpAssignment.findMany({
      where: { followedPersonId: { in: ids } },
      select: { id: true, followedPersonId: true, followerId: true, status: true, assignedAt: true, follower: { select: { name: true } } },
    }),
    prisma.followUpContact.groupBy({ by: ['followUpAssignmentId'], where: { followUpAssignment: { followedPersonId: { in: ids } } }, _max: { contactedAt: true } }),
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

  const assignmentPerson = new Map(assignments.map((a) => [a.id, a.followedPersonId]));
  const lastContact = new Map<string, Date>();
  const bump = (pid: string, at: Date | null | undefined) => {
    if (at && (!lastContact.get(pid) || at > lastContact.get(pid)!)) lastContact.set(pid, at);
  };
  for (const c of contacts) bump(assignmentPerson.get(c.followUpAssignmentId) ?? '', c._max.contactedAt);
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
      noLeader: !lead && !mine,
      leaderSilent: Boolean(lead) && !mine && (last ? last.getTime() < silentBefore : lead!.assignedAt.getTime() < silentBefore),
      // Only people who came through the sign-up page can be known to have (or not have) tapped the group link.
      notInGroup: hasRegistration.has(p.id) && !tapped.has(p.id),
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
}

export async function peopleNeedingMe(adminPersonId: string, query: DeskQuery = {}): Promise<DeskResult> {
  const { people, capped } = await loadDesk(adminPersonId, query);
  const counts = Object.fromEntries(DESK_FILTERS.map((f) => [f, people.filter(FILTERS[f]).length])) as Record<DeskFilter, number>;
  const matching = people.filter(FILTERS[query.filter ?? 'needs']);
  const page = Math.max(1, query.page ?? 1);
  return { items: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: matching.length, page, pageSize: PAGE_SIZE, capped, counts };
}

/** Everyone matching, for "select all" (at most `limit`). */
export async function deskPersonIds(adminPersonId: string, query: DeskQuery, limit = 1000): Promise<{ ids: string[]; total: number; languages: Record<string, 'en' | 'fr'> }> {
  const { people } = await loadDesk(adminPersonId, query);
  const matching = people.filter(FILTERS[query.filter ?? 'needs']);
  const chosen = matching.slice(0, limit);
  return { ids: chosen.map((p) => p.personId), total: matching.length, languages: Object.fromEntries(chosen.map((p) => [p.personId, p.language])) };
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

/** Records that the central admin contacted a person they follow up. */
export async function markContacted(adminPersonId: string, personId: string, input: { wellbeing?: Wellbeing; note?: string | null } = {}): Promise<{ id: string }> {
  const admin = await requireDeskOwner(adminPersonId);
  const mine = await prisma.followUpAssignment.findFirst({ where: { followerId: adminPersonId, followedPersonId: personId, status: 'ACTIVE' }, select: { id: true } });
  if (!mine) throw new DeskError('Take this person over first, then you can record your contact.', 409);
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;
  const contact = await prisma.followUpContact.create({ data: { followUpAssignmentId: mine.id, wellbeingStatus: input.wellbeing ?? 'GOOD', note, loggedByUserId: admin.id }, select: { id: true } });
  return contact;
}

/** Ids of the central admin among these people (never messaged or listed). */
export async function withoutAdmin(personIds: string[]): Promise<string[]> {
  const admins = await centralAdminAmong(personIds);
  return personIds.filter((id) => !admins.has(id));
}
