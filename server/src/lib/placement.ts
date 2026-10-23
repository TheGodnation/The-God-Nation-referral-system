import { prisma } from './prisma';
import { getDescendantCommunityIds, getHeadquartersCommunityId } from './tree';

// ---------------------------------------------------------------------------
// Automatic group placement for newly signed-up members.
//
// The groups that receive newcomers are the "open" groups: every ACTIVE
// group in the Headquarters tree with autoPlacementEligible = true. This is
// an explicit, Admin-set flag on each Community — deliberately NOT derived
// from tree position (it used to be "has no ACTIVE child of its own," which
// meant a mother group silently lost newcomers the instant it grew its
// first sub-group, e.g. a "Leaders only" or "Prayer" group meant only for
// people already inside it). A group keeps or loses open status purely by
// Admin's own choice now, independent of how many children it has. While
// Headquarters has no other eligible group yet, Headquarters itself is the
// only open group (its own default is true).
//
// Two modes (Settings.placementMode):
//  - SMALLEST_GROUP: the open group with the fewest ACTIVE members.
//  - BY_LOCATION: open groups tagged with the member's country (and, when
//    the group has a region tag, the same region) are tried first — a
//    region match beats a country-only match. If no tagged group matches,
//    the member goes to the smallest UNTAGGED open group, or the smallest
//    open group of all if every open group is tagged. Nobody is ever left
//    without a group.
// ---------------------------------------------------------------------------

export interface PlacementLocation {
  country: string | null;
  region: string | null;
}

interface OpenGroup {
  id: string;
  placementCountry: string | null;
  placementRegion: string | null;
  memberCount: number;
  createdAt: Date;
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Every ACTIVE, autoPlacementEligible group in the Headquarters tree. */
async function findOpenGroups(headquartersId: string): Promise<OpenGroup[]> {
  const treeIds = await getDescendantCommunityIds(headquartersId);
  const groups = await prisma.community.findMany({
    where: { id: { in: treeIds }, active: true, autoPlacementEligible: true },
    select: {
      id: true,
      placementCountry: true,
      placementRegion: true,
      createdAt: true,
    },
  });

  if (groups.length === 0) return [];

  const counts = await prisma.communityMembership.groupBy({
    by: ['communityId'],
    where: { communityId: { in: groups.map((g) => g.id) }, status: 'ACTIVE' },
    _count: { _all: true },
  });
  const countById = new Map(counts.map((c) => [c.communityId, c._count._all]));

  return groups.map((g) => ({
    id: g.id,
    placementCountry: g.placementCountry,
    placementRegion: g.placementRegion,
    memberCount: countById.get(g.id) ?? 0,
    createdAt: g.createdAt,
  }));
}

/** Fewest members first; ties go to the oldest group, so results are stable. */
function smallest(groups: OpenGroup[]): OpenGroup | null {
  if (groups.length === 0) return null;
  return [...groups].sort(
    (a, b) => a.memberCount - b.memberCount || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )[0];
}

/**
 * Pure choice of a group — exported for unit testing. Returns the chosen
 * group id, or null when there are no open groups at all.
 */
export function chooseGroup(
  groups: OpenGroup[],
  mode: 'SMALLEST_GROUP' | 'BY_LOCATION',
  location: PlacementLocation,
): string | null {
  if (groups.length === 0) return null;
  if (mode === 'SMALLEST_GROUP') return smallest(groups)?.id ?? null;

  const country = norm(location.country);
  const region = norm(location.region);

  if (country) {
    const countryMatches = groups.filter((g) => norm(g.placementCountry) === country);
    const regionMatches = countryMatches.filter((g) => region && norm(g.placementRegion) === region);
    if (regionMatches.length > 0) return smallest(regionMatches)!.id;
    // A group tagged with a DIFFERENT region of the same country is not a
    // match; a country-wide group (no region tag) is.
    const countryWide = countryMatches.filter((g) => !norm(g.placementRegion));
    if (countryWide.length > 0) return smallest(countryWide)!.id;
  }

  const untagged = groups.filter((g) => !norm(g.placementCountry));
  return (smallest(untagged) ?? smallest(groups))!.id;
}

/**
 * Places a Person into a group if they don't already have an ACTIVE
 * membership anywhere. Returns the community id they are in afterwards
 * (existing or new), or null when no Headquarters is configured yet.
 * Safe to call more than once for the same Person.
 */
export async function placePersonInGroup(personId: string, location: PlacementLocation): Promise<string | null> {
  const existing = await prisma.communityMembership.findFirst({
    where: { personId, status: 'ACTIVE' },
    select: { communityId: true },
  });
  if (existing) return existing.communityId;

  const headquartersId = await getHeadquartersCommunityId();
  if (!headquartersId) return null;

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { placementMode: true } });
  const mode = settings?.placementMode ?? 'SMALLEST_GROUP';

  const groups = await findOpenGroups(headquartersId);
  const chosen = chooseGroup(groups, mode, location) ?? headquartersId;

  // upsert: an INACTIVE membership row for the same (person, group) pair
  // may already exist (the pair is unique) — reactivate it instead of
  // failing on the unique constraint.
  await prisma.communityMembership.upsert({
    where: { personId_communityId: { personId, communityId: chosen } },
    create: { personId, communityId: chosen },
    update: { status: 'ACTIVE', joinedAt: new Date() },
  });

  return chosen;
}
