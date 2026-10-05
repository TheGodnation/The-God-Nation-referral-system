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

// ---------------------------------------------------------------------------
// GET /api/admin/location-map — counts of people by place, as a tree, for
// the admin member map: country -> (Cameroon) region -> division ->
// subdivision -> quarter, or country -> city elsewhere. Counts only, never
// names or contact details. Spellings are grouped case-insensitively
// ("mfoundi" and "Mfoundi " count together); the most common spelling is
// the one shown.
// ---------------------------------------------------------------------------

interface PlaceNode {
  name: string;
  count: number;
  children: PlaceNode[];
}

interface Bucket {
  spellings: Map<string, number>;
  count: number;
  children: Map<string, Bucket>;
}

function newBucket(): Bucket {
  return { spellings: new Map(), count: 0, children: new Map() };
}

function addPath(root: Map<string, Bucket>, path: (string | null)[]) {
  let level = root;
  for (const raw of path) {
    const value = raw?.trim();
    if (!value) return; // stop at the first missing level
    const key = value.toLowerCase();
    let bucket = level.get(key);
    if (!bucket) {
      bucket = newBucket();
      level.set(key, bucket);
    }
    bucket.count += 1;
    bucket.spellings.set(value, (bucket.spellings.get(value) ?? 0) + 1);
    level = bucket.children;
  }
}

// When two spellings of the same place are equally common, prefer the one
// that starts with a capital letter (how a place name is normally written)
// over e.g. an all-lowercase variant — localeCompare alone sorts lowercase
// before uppercase, which would otherwise pick the worse-looking spelling.
function capitalizedFirst(s: string): number {
  return /^[A-ZÀ-ÖØ-Þ]/.test(s) ? 0 : 1;
}

function toNodes(level: Map<string, Bucket>): PlaceNode[] {
  return Array.from(level.values())
    .map((b) => ({
      name: Array.from(b.spellings.entries()).sort(
        (x, y) => y[1] - x[1] || capitalizedFirst(x[0]) - capitalizedFirst(y[0]) || x[0].localeCompare(y[0]),
      )[0][0],
      count: b.count,
      children: toNodes(b.children),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

router.get('/location-map', asyncHandler(async (req, res) => {
  const people = await prisma.person.findMany({
    where: {
      ...(includeTestData(req) ? {} : { isTestData: false }),
      locationCountry: { not: null },
    },
    select: {
      locationCountry: true,
      locationRegion: true,
      locationDivision: true,
      locationSubdivision: true,
      locationQuarter: true,
      locationCity: true,
    },
  });

  const root = new Map<string, Bucket>();
  for (const p of people) {
    const inCameroon = p.locationCountry!.trim().toLowerCase() === 'cameroon';
    addPath(
      root,
      inCameroon
        ? [p.locationCountry, p.locationRegion, p.locationDivision, p.locationSubdivision, p.locationQuarter]
        : [p.locationCountry, p.locationCity],
    );
  }

  const withoutLocation = await prisma.person.count({
    where: { ...(includeTestData(req) ? {} : { isTestData: false }), locationCountry: null },
  });

  res.json({ total: people.length, withoutLocation, countries: toNodes(root) });
}));

export default router;
