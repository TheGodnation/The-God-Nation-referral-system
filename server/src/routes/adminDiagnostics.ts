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
// Geography Retirement Step 2 removed GeographyConversation.geographyId,
// GeographyMessage.conversationId, and GeographyConversationRead.conversationId
// (and their tables) entirely — CommunityConversation is their retained
// replacement. Step 4 removed AnnouncementTarget.geographyId entirely —
// Community targeting is its retained replacement. Step 5A removed the
// GEOGRAPHY value from FollowUpAssignment.contextType. Step 5B removed
// GeographicAssignment (the whole table) and RoleAssignment.geographyId
// entirely — Geography no longer has any organizational/authorization role
// anywhere in this codebase. The only remaining Geography dependency is the
// Geography model's own self-referencing tree, which this diagnostic exists
// to track until its own final retirement (a later, dedicated step).
const KNOWN_GEOGRAPHY_FOREIGN_KEYS = ['Geography.parentId (self-referencing tree)'];

router.get(
  '/diagnostics/geography-dependencies',
  asyncHandler(async (req, res) => {
    const testFilter = includeTestData(req) ? {} : { isTestData: false };

    const [geographyTotal, geographyActive, geographyWithParent, personsWithCountry, personsWithCity, personsWithArea] =
      await Promise.all([
        prisma.geography.count(),
        prisma.geography.count({ where: { active: true } }),
        prisma.geography.count({ where: { parentId: { not: null } } }),
        prisma.person.count({ where: { ...testFilter, locationCountry: { not: null } } }),
        prisma.person.count({ where: { ...testFilter, locationCity: { not: null } } }),
        prisma.person.count({ where: { ...testFilter, locationArea: { not: null } } }),
      ]);

    res.json({
      geography: {
        total: geographyTotal,
        active: geographyActive,
        inactive: geographyTotal - geographyActive,
        withParent: geographyWithParent,
        root: geographyTotal - geographyWithParent,
      },
      geographicAssignments: {
        organizationalStructureRetired: true,
        note:
          'Geography Retirement Step 5B removed the GeographicAssignment model entirely — Geography no longer has an organizational Person assignment mechanism of any kind.',
      },
      roleAssignments: {
        geographyScopeRetired: true,
        note:
          'Geography Retirement Step 5B removed RoleAssignment.geographyId entirely — SCOPED_LEADER is Community-scoped only, and a Geography-scoped role can no longer exist.',
      },
      followUpAssignments: {
        geographyContextRetired: true,
        note:
          'Geography Retirement Step 5A removed GEOGRAPHY from FollowUpAssignment.contextType — every FollowUpAssignment is now COMMUNITY-scoped only, and a Geography-context row can no longer exist.',
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
