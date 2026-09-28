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
 * Phase 3K — narrowly scoped to Geography only (unlike wouldCreateCycle
 * above, which is a generic two-hierarchy helper). Returns `rootId` itself
 * plus every descendant id, walking DOWN via Geography.parentId one level
 * at a time (breadth-first, one batched query per level) — application-
 * level traversal consistent with the rest of this codebase, never a
 * $queryRaw or recursive SQL CTE. The `seen` set is both the accumulator
 * and the cycle guard: a child already seen is never re-queued, so
 * malformed/cyclic data can never cause an infinite loop.
 */
export async function getDescendantGeographyIds(rootId: string): Promise<string[]> {
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.geography.findMany({
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
