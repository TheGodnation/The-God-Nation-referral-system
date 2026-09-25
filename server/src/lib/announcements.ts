import { prisma } from './prisma';
import { getDescendantGeographyIds } from './tree';
import type { Announcement, AnnouncementTarget } from '@prisma/client';

type TargetRow = Pick<AnnouncementTarget, 'communityId' | 'geographyId'>;

/**
 * Phase 3M.3 — audience/authorization for Central Authority targeted
 * announcements. Kept entirely separate from lib/leadership.ts: existing
 * leadership authorization semantics (findActiveScopedRole,
 * isGeographyInLeaderScope, personBelongsToContext) are never modified or
 * reused here as an authority source — only the plain tree-traversal
 * utility getDescendantGeographyIds is reused, for the same reason two
 * unrelated features can both use a sorting function.
 *
 * A Person qualifies for a Community target only via an ACTIVE
 * CommunityMembership in that EXACT Community — never via holding a
 * RoleAssignment/leadership role there, and never via roster visibility.
 * A Person qualifies for a Geography target if their own current ACTIVE
 * GeographicAssignment is that exact Geography or one of its descendants
 * — this is an announcement-audience rule, not a re-derivation of Phase
 * 3K's Leader-roster descendant visibility (a different concept entirely,
 * scoped to a Leader's own authority, not to who is eligible to read an
 * announcement).
 */

/**
 * Whether personId matches at least one of the given targets, using only
 * live, server-side organizational data. Never trusts anything about the
 * targets except their own communityId/geographyId — the caller is
 * responsible for having loaded those from the database.
 */
export async function personMatchesTargets(personId: string, targets: TargetRow[]): Promise<boolean> {
  const communityTargetIds = targets.map((t) => t.communityId).filter((id): id is string => Boolean(id));
  const geographyTargetIds = targets.map((t) => t.geographyId).filter((id): id is string => Boolean(id));

  if (communityTargetIds.length > 0) {
    const membership = await prisma.communityMembership.findFirst({
      where: { personId, status: 'ACTIVE', communityId: { in: communityTargetIds } },
      select: { id: true },
    });
    if (membership) return true;
  }

  if (geographyTargetIds.length > 0) {
    const assignment = await prisma.geographicAssignment.findUnique({ where: { personId } });
    if (assignment && assignment.status === 'ACTIVE') {
      for (const targetGeographyId of geographyTargetIds) {
        const descendants = await getDescendantGeographyIds(targetGeographyId);
        if (descendants.includes(assignment.geographyId)) return true;
      }
    }
  }

  return false;
}

/**
 * Whether personId may currently view announcementId: it must exist, be
 * published, not be archived, and the Person must match at least one of
 * its targets. Returns false (never throws) for a nonexistent id, so
 * callers can respond 404 uniformly regardless of which check failed —
 * never confirming to an unauthorized caller whether the id exists at all.
 */
export async function personCanViewAnnouncement(personId: string, announcementId: string): Promise<boolean> {
  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    include: { targets: { select: { communityId: true, geographyId: true } } },
  });
  if (!announcement) return false;
  if (!announcement.publishedAt) return false;
  if (announcement.archivedAt) return false;
  return personMatchesTargets(personId, announcement.targets);
}

/**
 * Every published, non-archived Announcement personId currently qualifies
 * for, ordered publishedAt DESC (already the required recipient-feed
 * order). Derived fresh on every call — nothing is persisted or cached
 * beyond the lifetime of this one computation (a per-target descendant-set
 * cache, to avoid recomputing the same tree walk for the same Geography
 * target across multiple announcements in one request).
 */
export async function computeVisibleAnnouncementsForPerson(
  personId: string,
): Promise<(Announcement & { targets: TargetRow[] })[]> {
  const [memberships, assignment] = await Promise.all([
    prisma.communityMembership.findMany({
      where: { personId, status: 'ACTIVE' },
      select: { communityId: true },
    }),
    prisma.geographicAssignment.findUnique({ where: { personId } }),
  ]);
  const communityIds = new Set(memberships.map((m) => m.communityId));
  const personGeographyId = assignment && assignment.status === 'ACTIVE' ? assignment.geographyId : null;

  const announcements = await prisma.announcement.findMany({
    where: { publishedAt: { not: null }, archivedAt: null },
    include: { targets: { select: { communityId: true, geographyId: true } } },
    orderBy: { publishedAt: 'desc' },
  });

  const descendantCache = new Map<string, string[]>();
  async function descendantsOf(geographyId: string): Promise<string[]> {
    let cached = descendantCache.get(geographyId);
    if (!cached) {
      cached = await getDescendantGeographyIds(geographyId);
      descendantCache.set(geographyId, cached);
    }
    return cached;
  }

  const eligible: (Announcement & { targets: TargetRow[] })[] = [];
  for (const announcement of announcements) {
    let matches = false;
    for (const target of announcement.targets) {
      if (target.communityId && communityIds.has(target.communityId)) {
        matches = true;
        break;
      }
      if (target.geographyId && personGeographyId) {
        const descendants = await descendantsOf(target.geographyId);
        if (descendants.includes(personGeographyId)) {
          matches = true;
          break;
        }
      }
    }
    if (matches) eligible.push(announcement);
  }
  return eligible;
}

/**
 * Phase 3M.5 — read-state helpers. Deliberately small and
 * announcement-specific (no generic notification/read-state engine): every
 * function here takes personId as an argument, never resolves it itself —
 * callers (routes/announcements.ts) are responsible for resolving personId
 * via the existing requireAnnouncementRecipient middleware, exactly as
 * personCanViewAnnouncement/computeVisibleAnnouncementsForPerson already
 * require. Read state is historical: nothing here ever deletes a row, and
 * nothing here is consulted by personMatchesTargets/personCanViewAnnouncement
 * /computeVisibleAnnouncementsForPerson — eligibility and read state are
 * fully independent concerns.
 */

/**
 * Marks announcementId as read by personId. Idempotent: a second call for
 * the same pair is a safe no-op (the unique constraint on
 * (personId, announcementId) makes this a create-if-absent, not a
 * create-or-overwrite of readAt). Never called for a Person who cannot
 * currently view the announcement — callers must check
 * personCanViewAnnouncement first.
 */
export async function markAnnouncementRead(personId: string, announcementId: string): Promise<void> {
  await prisma.announcementRead.upsert({
    where: { personId_announcementId: { personId, announcementId } },
    create: { personId, announcementId },
    update: {},
  });
}

/**
 * Whether personId has ever read announcementId. Used only by the detail
 * route, which must remain a pure read (see markAnnouncementRead for the
 * one place a read row is ever created).
 */
export async function isAnnouncementRead(personId: string, announcementId: string): Promise<boolean> {
  const row = await prisma.announcementRead.findUnique({
    where: { personId_announcementId: { personId, announcementId } },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Batch lookup: which of the given announcementIds has personId already
 * read? One query regardless of how many ids are passed — used by the list
 * route to flag isRead per item and derive unreadCount without a
 * per-announcement query.
 */
export async function getReadAnnouncementIds(personId: string, announcementIds: string[]): Promise<Set<string>> {
  if (announcementIds.length === 0) return new Set();
  const rows = await prisma.announcementRead.findMany({
    where: { personId, announcementId: { in: announcementIds } },
    select: { announcementId: true },
  });
  return new Set(rows.map((r) => r.announcementId));
}

/**
 * Confirms every referenced Community/Geography id in a proposed target
 * list actually exists. Used at both draft-creation/edit time and again at
 * publish time (defensive re-validation) — a client-supplied id is never
 * trusted merely because it was accepted once before.
 */
export async function validateTargetReferences(
  targets: { communityId?: string | null; geographyId?: string | null }[],
): Promise<boolean> {
  const communityIds = targets.map((t) => t.communityId).filter((id): id is string => Boolean(id));
  const geographyIds = targets.map((t) => t.geographyId).filter((id): id is string => Boolean(id));

  const [communityCount, geographyCount] = await Promise.all([
    communityIds.length > 0
      ? prisma.community.count({ where: { id: { in: communityIds } } })
      : Promise.resolve(0),
    geographyIds.length > 0
      ? prisma.geography.count({ where: { id: { in: geographyIds } } })
      : Promise.resolve(0),
  ]);

  return communityCount === new Set(communityIds).size && geographyCount === new Set(geographyIds).size;
}
