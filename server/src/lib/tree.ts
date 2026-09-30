import { prisma } from './prisma';

// Shared helper for the two self-referencing hierarchies (Geography,
// Community). Prevents a reparent operation from creating a cycle (making
// a node its own ancestor) by walking up from the candidate new parent
// toward the root — bounded by the tree's actual depth, never loading the
// whole tree.
export async function wouldCreateCycle(
  findById: (id: string) => Promise<{ id: string; parentId: string | null } | null>,
  nodeId: string,
  candidateParentId: string,
): Promise<boolean> {
  let currentId: string | null = candidateParentId;
  const seen = new Set<string>();
  while (currentId) {
    if (currentId === nodeId) return true;
    if (seen.has(currentId)) return true; // defensive: an existing cycle
    seen.add(currentId);
    const node = await findById(currentId);
    if (!node) return false;
    currentId = node.parentId;
  }
  return false;
}

/**
 * Headquarters Network Posts — walks DOWN from rootId via Community.parentId
 * (breadth-first, one batched query per level), returning rootId itself plus
 * every descendant id; a `seen`-set accumulator/cycle-guard, same shape as
 * wouldCreateCycle above. Used for network-wide
 * Headquarters Post eligibility: every Person with an ACTIVE
 * CommunityMembership in the Headquarters Community itself or any of its
 * descendants qualifies (see lib/headquartersPosts.ts). Never used for
 * selected-Community targeting, which is deliberately exact-match only.
 */
export async function getDescendantCommunityIds(rootId: string): Promise<string[]> {
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.community.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    const next: string[] = [];
    for (const child of children) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return Array.from(seen);
}

/**
 * National Headquarters generation — purely derived, never persisted (no
 * generation/depth column exists or is added anywhere in this schema).
 * Walks UP from communityId via Community.parentId one step at a time —
 * bounded and cycle-safe, mirroring wouldCreateCycle's own upward-walk
 * shape above (check `seen` before processing, one query per step, never a
 * $queryRaw or recursive SQL CTE).
 *
 * Returns 0 when communityId IS headquartersCommunityId, 1 for a direct
 * child, 2 for a grandchild, and so on. Returns null when communityId is
 * not actually a descendant of headquartersCommunityId at all (an
 * unrelated root, or any Community outside the Headquarters tree) — never
 * a fabricated generation for a Community the Headquarters tree doesn't
 * contain, and never hangs on malformed/cyclic parentId data.
 */
export async function getCommunityGeneration(
  communityId: string,
  headquartersCommunityId: string,
): Promise<number | null> {
  let currentId: string | null = communityId;
  let depth = 0;
  const seen = new Set<string>();
  while (currentId) {
    if (currentId === headquartersCommunityId) return depth;
    if (seen.has(currentId)) return null; // defensive: an existing cycle
    seen.add(currentId);
    const node: { parentId: string | null } | null = await prisma.community.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!node) return null;
    currentId = node.parentId;
    depth += 1;
  }
  return null; // walked to a root without ever reaching Headquarters
}

// Phase 1 — moved here from adminCommunities.ts (its original, private
// location) so Phase 2A's peer-discovery logic can reuse the exact same
// singleton-row read without a route file importing from another route
// file. The single National Headquarters pointer lives on the Settings
// singleton row (see schema.prisma's own comment on
// Settings.headquartersCommunityId for why a singleton-row pointer, rather
// than a boolean flag on Community, is what actually guarantees "at most
// one Headquarters").
export async function getHeadquartersCommunityId(): Promise<string | null> {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { headquartersCommunityId: true } });
  return settings?.headquartersCommunityId ?? null;
}

/**
 * Phase 2A — the Communities at an exact Headquarters-relative generation.
 * Walks DOWN from headquartersCommunityId exactly `generation` levels via
 * Community.parentId (breadth-first, one batched query per level), the same
 * downward-walk style as getDescendantCommunityIds above. Generation
 * 0 returns the Headquarters id itself with no query at all. Deliberately
 * bounded by the `generation` argument (a fixed, finite number of loop
 * iterations) rather than by a `seen`-set termination check — malformed or
 * cyclic parentId data can therefore never cause this to loop forever, no
 * matter how the data is corrupted; `seen` here exists only to keep the
 * returned ids de-duplicated, not to guarantee termination. Returns an
 * empty array once frontier is empty (a shallower Headquarters tree than
 * the requested generation) — never invents a Community id.
 */
export async function getCommunityIdsAtGeneration(
  headquartersCommunityId: string,
  generation: number,
): Promise<string[]> {
  if (generation < 0) return [];

  let frontier = [headquartersCommunityId];
  const seen = new Set<string>(frontier);

  for (let level = 0; level < generation; level++) {
    if (frontier.length === 0) return [];
    const children = await prisma.community.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    const next: string[] = [];
    for (const child of children) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return frontier;
}
