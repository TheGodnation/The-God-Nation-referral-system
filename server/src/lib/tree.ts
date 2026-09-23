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
