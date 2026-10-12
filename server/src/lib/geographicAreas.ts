import { prisma } from './prisma';
import type { GeographicLevel } from '@prisma/client';

// Geographical Leadership Directory — shared helpers. See the schema
// comment above GeographicArea for why this is a deliberately separate,
// brand-new concept from the retired Geography model.

export const LEVEL_ORDER: GeographicLevel[] = ['NATIONAL', 'REGION', 'DIVISION', 'SUBDIVISION', 'QUARTER'];

/** The next level down from `level`, or null if `level` is the deepest
 * (QUARTER) — used to validate/derive a new area's level from its parent's,
 * so a level is always exactly "one step below its parent," never
 * client-supplied directly. */
export function levelBelow(level: GeographicLevel): GeographicLevel | null {
  const i = LEVEL_ORDER.indexOf(level);
  return i >= 0 && i < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[i + 1] : null;
}

/** The exact leadership title for a level — the one place these titles are
 * defined, so "Regional Leader" is never used for anything but an actual
 * REGION node (the user's own explicit "do not label every leader a
 * regional leader" requirement). */
export function titleForLevel(level: GeographicLevel): string {
  switch (level) {
    case 'NATIONAL':
      return 'National Representative of The God Nation';
    case 'REGION':
      return 'Regional Leader';
    case 'DIVISION':
      return 'Divisional Leader';
    case 'SUBDIVISION':
      return 'Subdivisional Leader';
    case 'QUARTER':
      return 'Quarter Representative';
  }
}

export interface AreaAncestor {
  id: string;
  name: string;
  level: GeographicLevel;
}

/** Walks parentId up to the NATIONAL root. Tree depth is capped at 5
 * (NATIONAL..QUARTER), so this is always a handful of queries, never an
 * unbounded walk. Returns ancestors ROOT-FIRST (NATIONAL..the area's own
 * parent) — callers needing "Quarter, Subdivision, ..., Country" order (the
 * user's own example format) reverse this themselves alongside the area's
 * own name. */
interface ParentLookupRow {
  parentId: string | null;
}

async function findParentId(id: string): Promise<string | null> {
  const row: ParentLookupRow | null = await prisma.geographicArea.findUnique({ where: { id }, select: { parentId: true } });
  return row ? row.parentId : null;
}

export async function getAreaAncestors(areaId: string): Promise<AreaAncestor[]> {
  const chain: AreaAncestor[] = [];
  let currentId: string = areaId;
  // Walk from the area's own parent up to the root; `areaId` itself is
  // never included — this is ancestors only.
  for (let i = 0; i < LEVEL_ORDER.length; i++) {
    const parentId: string | null = await findParentId(currentId);
    if (!parentId) break;
    const parent: AreaAncestor | null = await prisma.geographicArea.findUnique({
      where: { id: parentId },
      select: { id: true, name: true, level: true },
    });
    if (!parent) break;
    chain.unshift(parent);
    currentId = parent.id;
  }
  return chain;
}

/** "Bepanda, Douala V, Wouri, Littoral, Cameroon" — the area's own name
 * followed by every ancestor, nearest first, matching the user's own
 * examples exactly. */
export function formatAreaPath(area: { name: string }, ancestors: AreaAncestor[]): string {
  return [area.name, ...ancestors.slice().reverse().map((a) => a.name)].join(', ');
}
