import { announceJoined } from './joinNotice';
import { prisma } from './prisma';
import { getDescendantCommunityIds, getHeadquartersCommunityId } from './tree';
import { notifyAssemblyOpened } from './notifications';

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
//
// Cells: an assembly holds Settings.assemblyCapacity active members (200 by
// default). A full assembly is skipped. When every open assembly is full,
// the app opens a new child assembly under one of them and places the
// newcomer there ("one brings two": an assembly brings at most two children
// this way), then tells the central admin so leaders can be appointed.
// ---------------------------------------------------------------------------

export const DEFAULT_ASSEMBLY_CAPACITY = 200;
export const MAX_AUTO_CHILDREN = 2;

export interface PlacementLocation {
  country: string | null;
  region: string | null;
}

interface OpenGroup {
  id: string;
  name: string;
  placementCountry: string | null;
  placementRegion: string | null;
  memberCount: number;
  /** How many assemblies the app has already opened under this one. */
  autoChildCount: number;
  /** How many assemblies of any kind of origin sit directly under this one (at most MAX_CHILD_ASSEMBLIES). */
  assemblyChildCount?: number;
  createdAt: Date;
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Every ACTIVE, autoPlacementEligible group in the Headquarters tree. */
async function findOpenGroups(headquartersId: string): Promise<OpenGroup[]> {
  const treeIds = await getDescendantCommunityIds(headquartersId);
  const groups = await prisma.community.findMany({
    where: { id: { in: treeIds }, active: true, autoPlacementEligible: true, kind: 'ASSEMBLY' },
    select: {
      id: true,
      name: true,
      placementCountry: true,
      placementRegion: true,
      createdAt: true,
    },
  });

  if (groups.length === 0) return [];

  const childCounts = await prisma.community.groupBy({
    by: ['parentId'],
    where: { parentId: { in: groups.map((g) => g.id) }, autoCreated: true },
    _count: { _all: true },
  });
  const childCountById = new Map(childCounts.map((c) => [c.parentId as string, c._count._all]));

  const allChildCounts = await prisma.community.groupBy({
    by: ['parentId'],
    where: { parentId: { in: groups.map((g) => g.id) }, kind: 'ASSEMBLY' },
    _count: { _all: true },
  });
  const allChildCountById = new Map(allChildCounts.map((c) => [c.parentId as string, c._count._all]));

  const counts = await prisma.communityMembership.groupBy({
    by: ['communityId'],
    where: { communityId: { in: groups.map((g) => g.id) }, status: 'ACTIVE' },
    _count: { _all: true },
  });
  const countById = new Map(counts.map((c) => [c.communityId, c._count._all]));

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    placementCountry: g.placementCountry,
    placementRegion: g.placementRegion,
    memberCount: countById.get(g.id) ?? 0,
    autoChildCount: childCountById.get(g.id) ?? 0,
    assemblyChildCount: allChildCountById.get(g.id) ?? 0,
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

export type PlacementPlan =
  | { kind: 'place'; groupId: string }
  | { kind: 'split'; parentId: string };

/**
 * Pure plan — exported for unit testing. Place in an assembly that still
 * has room; when all are full, open a child under a full assembly that has
 * fewer than two app-opened children (chosen by the same mode/location rules).
 * If somehow no assembly can host a new child, the smallest one takes the
 * newcomer anyway: nobody is ever left without an assembly.
 * Returns null when there are no open assemblies at all.
 */
export function planPlacement(
  groups: OpenGroup[],
  mode: 'SMALLEST_GROUP' | 'BY_LOCATION',
  location: PlacementLocation,
  capacity: number,
): PlacementPlan | null {
  if (groups.length === 0) return null;
  const withRoom = groups.filter((g) => g.memberCount < capacity);
  if (withRoom.length > 0) return { kind: 'place', groupId: chooseGroup(withRoom, mode, location)! };

  // Counting every assembly under it, the ones made by hand as well, never more than two.
  const canHostChild = groups.filter((g) => g.autoChildCount < MAX_AUTO_CHILDREN && (g.assemblyChildCount ?? g.autoChildCount) < MAX_AUTO_CHILDREN);
  if (canHostChild.length > 0) return { kind: 'split', parentId: chooseGroup(canHostChild, mode, location)! };

  return { kind: 'place', groupId: smallest(groups)!.id };
}

// One lock for every placement, so two people signing up at the same moment
// can never open two new assemblies for the same overflow.
const PLACEMENT_LOCK_KEY = 7340011;

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

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PLACEMENT_LOCK_KEY})`;

      // Another request may have placed this person while we waited.
      const again = await tx.communityMembership.findFirst({ where: { personId, status: 'ACTIVE' }, select: { communityId: true } });
      if (again) return { communityId: again.communityId, opened: null as null | { id: string; name: string; parentName: string } };

      const settings = await tx.settings.findUnique({
        where: { id: 'singleton' },
        select: { placementMode: true, assemblyCapacity: true },
      });
      const mode = settings?.placementMode ?? 'SMALLEST_GROUP';
      const capacity = Math.max(1, settings?.assemblyCapacity ?? DEFAULT_ASSEMBLY_CAPACITY);

      const groups = await findOpenGroups(headquartersId);
      const plan = planPlacement(groups, mode, location, capacity);

      let chosen = headquartersId;
      let opened: { id: string; name: string; parentName: string } | null = null;
      if (plan?.kind === 'place') {
        chosen = plan.groupId;
      } else if (plan?.kind === 'split') {
        const parent = groups.find((g) => g.id === plan.parentId)!;
        const child = await tx.community.create({
          data: {
            name: `${parent.name} · ${parent.autoChildCount + 1}`,
            parentId: parent.id,
            autoPlacementEligible: true,
            autoCreated: true,
            placementCountry: parent.placementCountry,
            placementRegion: parent.placementRegion,
          },
        });
        await tx.conversation.create({ data: { communityId: child.id } });
        chosen = child.id;
        opened = { id: child.id, name: child.name, parentName: parent.name };
      }

      // upsert: an INACTIVE membership row for the same (person, group) pair
      // may already exist (the pair is unique) — reactivate it instead of
      // failing on the unique constraint.
      await tx.communityMembership.upsert({
        where: { personId_communityId: { personId, communityId: chosen } },
        create: { personId, communityId: chosen },
        update: { status: 'ACTIVE', joinedAt: new Date() },
      });
      return { communityId: chosen, opened };
    },
    { timeout: 20000, maxWait: 20000 },
  );

  // The assembly's chat shows that this person just joined.
  await announceJoined(result.communityId, [personId]);
  if (result.opened) {
    // Tell the central admin; a failure here must never undo the signup.
    notifyAssemblyOpened(result.opened).catch(() => {});
  }
  return result.communityId;
}
