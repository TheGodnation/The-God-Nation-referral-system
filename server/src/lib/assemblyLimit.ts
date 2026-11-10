import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { getCommunityGeneration, getHeadquartersCommunityId } from './tree';

/**
 * "One brings two": an assembly can have at most two assemblies directly under it. That is what makes the generations
 * grow 2, 4, 8, 16… Groups (women, youth, prayer, leadership…) are not generations and have no limit.
 */
export const MAX_CHILD_ASSEMBLIES = 2;

type Db = PrismaClient | Prisma.TransactionClient;

/** How many assemblies sit directly under this one (groups are not counted). `excludeIds` are ignored (for a move). */
export async function childAssemblyCount(db: Db, parentId: string, excludeIds: string[] = []): Promise<number> {
  return db.community.count({ where: { parentId, kind: 'ASSEMBLY', ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}) } });
}

export const fullMessage = (parentName?: string): string =>
  `${parentName ? `“${parentName}”` : 'This assembly'} already has its ${MAX_CHILD_ASSEMBLIES} assemblies. Each assembly can have at most ${MAX_CHILD_ASSEMBLIES} assemblies under it.`;

/**
 * Returns an error message when adding `adding` assemblies directly under `parentId` would go past the limit, else
 * null. Anything already there stays: this only stops new ones. `excludeIds` are assemblies being moved out of the way.
 */
export async function limitError(db: Db, parentId: string | null | undefined, adding = 1, excludeIds: string[] = []): Promise<string | null> {
  if (!parentId) return null;
  const used = await childAssemblyCount(db, parentId, excludeIds);
  if (used + adding <= MAX_CHILD_ASSEMBLIES) return null;
  const parent = await db.community.findUnique({ where: { id: parentId }, select: { name: true } });
  return fullMessage(parent?.name);
}

export interface NewChildPreview {
  kind: 'ASSEMBLY' | 'GROUP';
  /** The generation it will have; null when the assembly is outside the Headquarters tree. */
  generation: number | null;
  used: number;
  max: number;
  /** For an assembly: true when the parent has no place left. A group is never blocked. */
  full: boolean;
  parentName: string;
}

/** What creating a new group or assembly inside `parentId` would do: its generation and how many places are used. */
export async function previewNewChild(parentId: string, kind: 'ASSEMBLY' | 'GROUP'): Promise<NewChildPreview | null> {
  const parent = await prisma.community.findUnique({ where: { id: parentId }, select: { id: true, name: true, kind: true } });
  if (!parent) return null;
  const hq = await getHeadquartersCommunityId();
  const parentGeneration = hq ? await getCommunityGeneration(parentId, hq) : null;
  const used = await childAssemblyCount(prisma, parentId);
  return {
    kind,
    generation: parentGeneration === null ? null : kind === 'ASSEMBLY' ? parentGeneration + 1 : parentGeneration,
    used,
    max: MAX_CHILD_ASSEMBLIES,
    full: kind === 'ASSEMBLY' && used >= MAX_CHILD_ASSEMBLIES,
    parentName: parent.name,
  };
}
