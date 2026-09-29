import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

// Temporary Geography-retirement diagnostic — Admin-only, strictly
// read-only. NOT part of the Geography removal itself: this endpoint only
// reports counts and non-personal identifiers needed to plan that removal
// safely. Every query below is a plain read (count/groupBy/findMany with a
// narrow `select`) — no create/update/delete/upsert anywhere in this file.
// Intended to be removed again once the staging data has been reviewed.
router.use(requireAuth, requireRole('ADMIN'));

// Mirrors the small, per-file `includeTestData` helper already duplicated
// across adminPeople.ts/admin.ts/adminLocations.ts — not shared/imported,
// matching this codebase's own established convention for this one-line
// check.
function includeTestData(req: any): boolean {
  return req.query.includeTestData === 'true';
}

// The exhaustive list of tables with a real database foreign key to
// Geography, re-derived (a second time, independently, in this session) by
// grep'ing every one of the 26 migration files for `REFERENCES "Geography"`
// — not a live schema introspection. This codebase has no existing
// convention for raw SQL/information_schema queries anywhere (every
// aggregation in lib/announcements.ts, lib/leaderPeers.ts, and
// adminLocations.ts's own computeLocationAggregation is plain Prisma calls
// computed in application code), and introducing one here — for a
// *temporary* diagnostic endpoint — would trade a real, verifiable,
// git-auditable fact (the migration files themselves) for a live raw-SQL
// query against a shared database, for no proportionate benefit: Prisma
// migrations are the deterministic source of truth for applied schema, and
// `prisma migrate status` (checked in every phase's regression, including
// this one) already confirms there is no drift between them and the live
// database.
const KNOWN_GEOGRAPHY_FOREIGN_KEYS = [
  'Geography.parentId (self-referencing tree)',
  'GeographicAssignment.geographyId (ON DELETE RESTRICT)',
  'RoleAssignment.geographyId (ON DELETE CASCADE)',
  'AnnouncementTarget.geographyId (ON DELETE CASCADE)',
  'GeographyConversation.geographyId (ON DELETE CASCADE, unique)',
  'GeographyMessage.conversationId -> GeographyConversation (transitive CASCADE)',
  'GeographyConversationRead.conversationId -> GeographyConversation (transitive CASCADE)',
  'FollowUpAssignment.contextId (NO foreign key — application-validated only, see followUpAssignments.orphaned below)',
];

router.get(
  '/diagnostics/geography-dependencies',
  asyncHandler(async (req, res) => {
    const testFilter = includeTestData(req) ? {} : { isTestData: false };

    const [
      geographyTotal,
      geographyActive,
      geographyWithParent,
      geographicAssignmentTotal,
      geographicAssignmentActive,
      geographicAssignmentDistinctGeography,
      roleAssignmentGeographyTotal,
      roleAssignmentGeographyActive,
      roleAssignmentGeographyEnded,
      roleAssignmentDistinctGeography,
      geographyConversationTotal,
      geographyMessageTotal,
      geographyConversationReadTotal,
      announcementTargetGeographyTotal,
      announcementTargetDistinctGeography,
      followUpGeographyRows,
      personsWithCountry,
      personsWithCity,
      personsWithArea,
    ] = await Promise.all([
      prisma.geography.count(),
      prisma.geography.count({ where: { active: true } }),
      prisma.geography.count({ where: { parentId: { not: null } } }),
      prisma.geographicAssignment.count(),
      prisma.geographicAssignment.count({ where: { status: 'ACTIVE' } }),
      prisma.geographicAssignment.groupBy({ by: ['geographyId'] }),
      prisma.roleAssignment.count({ where: { geographyId: { not: null } } }),
      prisma.roleAssignment.count({ where: { geographyId: { not: null }, status: 'ACTIVE' } }),
      prisma.roleAssignment.count({ where: { geographyId: { not: null }, status: 'ENDED' } }),
      prisma.roleAssignment.groupBy({ by: ['geographyId'], where: { geographyId: { not: null } } }),
      prisma.geographyConversation.count(),
      prisma.geographyMessage.count(),
      prisma.geographyConversationRead.count(),
      prisma.announcementTarget.count({ where: { geographyId: { not: null } } }),
      prisma.announcementTarget.groupBy({ by: ['geographyId'], where: { geographyId: { not: null } } }),
      prisma.followUpAssignment.findMany({
        where: { contextType: 'GEOGRAPHY' },
        select: { status: true, contextId: true },
      }),
      prisma.person.count({ where: { ...testFilter, locationCountry: { not: null } } }),
      prisma.person.count({ where: { ...testFilter, locationCity: { not: null } } }),
      prisma.person.count({ where: { ...testFilter, locationArea: { not: null } } }),
    ]);

    // GeographicAssignment.geographyId is ON DELETE RESTRICT, so an orphan
    // here should be structurally impossible — checked anyway, defensively,
    // the same way every other orphan check in this endpoint is: in
    // application code, never a raw anti-join query.
    const referencedGeographyIds = Array.from(
      new Set([
        ...geographicAssignmentDistinctGeography.map((g) => g.geographyId),
        ...followUpGeographyRows.map((f) => f.contextId),
      ]),
    );
    const existingGeographyRows = await prisma.geography.findMany({
      where: { id: { in: referencedGeographyIds } },
      select: { id: true },
    });
    const existingGeographyIdSet = new Set(existingGeographyRows.map((g) => g.id));

    const geographicAssignmentOrphaned = geographicAssignmentDistinctGeography.filter(
      (g) => !existingGeographyIdSet.has(g.geographyId),
    ).length;

    const followUpExisting = followUpGeographyRows.filter((f) => existingGeographyIdSet.has(f.contextId));
    const followUpOrphaned = followUpGeographyRows.filter((f) => !existingGeographyIdSet.has(f.contextId));
    const followUpDistinctGeographyIds = new Set(followUpGeographyRows.map((f) => f.contextId));
    // Geography ids only (place identifiers, never a Person id) — bounded,
    // safe to return in full for migration planning.
    const orphanedGeographyIds = Array.from(new Set(followUpOrphaned.map((f) => f.contextId)));

    res.json({
      geography: {
        total: geographyTotal,
        active: geographyActive,
        inactive: geographyTotal - geographyActive,
        withParent: geographyWithParent,
        root: geographyTotal - geographyWithParent,
      },
      geographicAssignments: {
        total: geographicAssignmentTotal,
        active: geographicAssignmentActive,
        distinctGeographyIds: geographicAssignmentDistinctGeography.length,
        orphaned: geographicAssignmentOrphaned,
      },
      roleAssignments: {
        geographyScopedTotal: roleAssignmentGeographyTotal,
        active: roleAssignmentGeographyActive,
        ended: roleAssignmentGeographyEnded,
        distinctGeographyIds: roleAssignmentDistinctGeography.length,
      },
      geographyConversations: {
        total: geographyConversationTotal,
        messageTotal: geographyMessageTotal,
        readReceiptTotal: geographyConversationReadTotal,
      },
      announcementTargets: {
        geographyTotal: announcementTargetGeographyTotal,
        distinctGeographyIds: announcementTargetDistinctGeography.length,
      },
      followUpAssignments: {
        geographyContextTotal: followUpGeographyRows.length,
        active: followUpGeographyRows.filter((f) => f.status === 'ACTIVE').length,
        closed: followUpGeographyRows.filter((f) => f.status === 'CLOSED').length,
        existingGeographyReference: followUpExisting.length,
        orphaned: followUpOrphaned.length,
        distinctGeographyIdsReferenced: followUpDistinctGeographyIds.size,
        orphanedGeographyIds,
      },
      locationData: {
        personsWithCountry,
        personsWithCity,
        personsWithArea,
      },
      foreignKeyInventoryMethodology:
        'Derived from an exhaustive grep of every migration file for REFERENCES "Geography" (not a live schema introspection) — see KNOWN_GEOGRAPHY_FOREIGN_KEYS in this route file.',
      knownGeographyForeignKeys: KNOWN_GEOGRAPHY_FOREIGN_KEYS,
    });
  }),
);

export default router;
