import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// Mirrors the small, per-file `includeTestData` helper already duplicated
// across adminPeople.ts/admin.ts — not shared/imported, matching this
// codebase's own established convention for this one-line check.
function includeTestData(req: any): boolean {
  return req.query.includeTestData === 'true';
}

interface LocationGroup {
  country: string | null;
  city: string | null;
  area: string | null;
  memberCount: number;
  assignedCount: number;
  unassignedCount: number;
  communities: { communityId: string; communityName: string; count: number }[];
}

// Groups every Person who has provided at least one location field by the
// exact (locationCountry, locationCity, locationArea) triple. A Person with
// all three fields null contributes to no group — this is intelligence
// about members who HAVE shared location information, not a census of
// everyone. assignedCount counts PEOPLE, never membership rows: a Person
// with multiple ACTIVE CommunityMemberships is counted once in
// assignedCount, exactly like every other "how many distinct people"
// question in this codebase (see lib/leaderPeers.ts's own de-duplication
// precedent) — only the per-Community `communities` breakdown reflects
// their membership in more than one Community.
//
// Computed in application code from one bounded query, matching the
// established "correctness-first over exotic SQL for an Admin-only,
// human-scale aggregation" precedent (lib/announcements.ts's
// computeVisibleAnnouncementsForPerson, lib/leaderPeers.ts). No index
// backs this query — see the Person model's own schema comment for why.
async function computeLocationAggregation(includeTest: boolean): Promise<LocationGroup[]> {
  const people = await prisma.person.findMany({
    where: {
      ...(includeTest ? {} : { isTestData: false }),
      OR: [{ locationCountry: { not: null } }, { locationCity: { not: null } }, { locationArea: { not: null } }],
    },
    select: {
      locationCountry: true,
      locationCity: true,
      locationArea: true,
      communityMemberships: {
        where: { status: 'ACTIVE' },
        select: { communityId: true, community: { select: { name: true } } },
      },
    },
  });

  const groups = new Map<
    string,
    {
      country: string | null;
      city: string | null;
      area: string | null;
      memberCount: number;
      assignedCount: number;
      communities: Map<string, { communityId: string; communityName: string; count: number }>;
    }
  >();

  for (const person of people) {
    const key = `${person.locationCountry ?? ''}\u0000${person.locationCity ?? ''}\u0000${person.locationArea ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        country: person.locationCountry,
        city: person.locationCity,
        area: person.locationArea,
        memberCount: 0,
        assignedCount: 0,
        communities: new Map(),
      };
      groups.set(key, group);
    }
    group.memberCount += 1;
    if (person.communityMemberships.length > 0) {
      group.assignedCount += 1;
      for (const m of person.communityMemberships) {
        const existing = group.communities.get(m.communityId);
        if (existing) {
          existing.count += 1;
        } else {
          group.communities.set(m.communityId, { communityId: m.communityId, communityName: m.community.name, count: 1 });
        }
      }
    }
  }

  const items: LocationGroup[] = Array.from(groups.values()).map((g) => ({
    country: g.country,
    city: g.city,
    area: g.area,
    memberCount: g.memberCount,
    assignedCount: g.assignedCount,
    unassignedCount: g.memberCount - g.assignedCount,
    communities: Array.from(g.communities.values()).sort((a, b) => b.count - a.count),
  }));

  // Largest concentrations first — the most immediately useful ordering for
  // "where should Central Authority look first."
  items.sort((a, b) => b.memberCount - a.memberCount);
  return items;
}

// GET /api/admin/locations — aggregated member-location intelligence.
// Never returns individual Person data (no id, name, WhatsApp, email, DOB,
// or any other personal/private field) — only counts and Community names,
// per this phase's explicit data-minimization requirement. Reuses the
// existing pagination convention: the full aggregation is computed first
// (bounded by the number of distinct location combinations, not the number
// of Persons), then sliced for the requested page — same "compute the full,
// correctly-derived result set, then paginate" precedent already used by
// GET /api/leader/peers.
router.get('/locations', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const all = await computeLocationAggregation(includeTestData(req));
  const items = all.slice(skip, skip + take);
  res.json(paginatedResult(items, all.length, page, pageSize));
}));

export default router;
