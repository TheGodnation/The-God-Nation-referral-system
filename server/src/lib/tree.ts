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
