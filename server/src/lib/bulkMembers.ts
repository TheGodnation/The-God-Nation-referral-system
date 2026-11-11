import { announceJoined } from './joinNotice';
import { prisma } from './prisma';
import { limitError } from './assemblyLimit';
import { getCommunityGeneration, getCommunityIdsAtGeneration, getHeadquartersCommunityId } from './tree';
import { notifyAddedToAssembly } from './notifications';

// The central admin's "add many people" tool: pick people by generation (or one
// assembly, or those with no assembly yet), tick who should go, and add them to
// an assembly in one go.

export const MAX_BULK = 5000;
const MAX_GENERATIONS = 20;

export type Source = { kind: 'generation'; generation: number } | { kind: 'community'; communityId: string } | { kind: 'none' };

export class BulkError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** "gen:1", "community:<id>" or "none" → a Source. */
export function parseSource(raw: unknown): Source {
  const text = String(raw ?? '');
  if (text === 'none') return { kind: 'none' };
  if (text.startsWith('gen:')) {
    const n = Number(text.slice(4));
    if (Number.isInteger(n) && n >= 0 && n <= 50) return { kind: 'generation', generation: n };
  }
  if (text.startsWith('community:') && text.length > 10) return { kind: 'community', communityId: text.slice(10) };
  throw new BulkError('Choose where the people come from.');
}

async function sourceCommunityIds(source: Source): Promise<string[] | null> {
  if (source.kind === 'none') return null;
  if (source.kind === 'community') return [source.communityId];
  const hq = await getHeadquartersCommunityId();
  if (!hq) throw new BulkError('No Headquarters has been designated yet, so generations are not known.');
  return getCommunityIdsAtGeneration(hq, source.generation);
}

function searchFilter(search?: string) {
  const q = search?.trim();
  return q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { whatsappNumber: { contains: q } }] } : {};
}

async function personWhere(source: Source, search?: string) {
  const ids = await sourceCommunityIds(source);
  const base = ids === null
    ? { memberAccount: { isNot: null }, communityMemberships: { none: { status: 'ACTIVE' as const } } }
    : { communityMemberships: { some: { communityId: { in: ids }, status: 'ACTIVE' as const } } };
  return { ...base, ...searchFilter(search) };
}

/** The generations that exist, with how many people are in each (and those with no assembly yet). */
export async function generationSummary() {
  const hq = await getHeadquartersCommunityId();
  const generations: { generation: number; assemblies: number; people: number }[] = [];
  if (hq) {
    for (let g = 0; g < MAX_GENERATIONS; g++) {
      const ids = await getCommunityIdsAtGeneration(hq, g);
      if (ids.length === 0) break;
      const people = await prisma.person.count({ where: { communityMemberships: { some: { communityId: { in: ids }, status: 'ACTIVE' } } } });
      generations.push({ generation: g, assemblies: ids.length, people });
    }
  }
  const noAssembly = await prisma.person.count({ where: await personWhere({ kind: 'none' }) });
  return { hasHeadquarters: Boolean(hq), generations, noAssembly };
}

export async function searchAssemblies(search: string) {
  const q = search.trim();
  if (!q) return [];
  const found = await prisma.community.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 20 });
  const hq = await getHeadquartersCommunityId();
  return Promise.all(found.map(async (c) => ({ ...c, generation: hq ? await getCommunityGeneration(c.id, hq) : null })));
}

export async function listPeople(source: Source, search: string | undefined, skip: number, take: number) {
  const where = await personWhere(source, search);
  const [total, items] = await Promise.all([
    prisma.person.count({ where }),
    prisma.person.findMany({ where, select: { id: true, name: true, whatsappNumber: true }, orderBy: { name: 'asc' }, skip, take }),
  ]);
  return { total, items };
}

/** Every matching person's id (for "Select all"), capped. */
export async function listPeopleIds(source: Source, search?: string) {
  const where = await personWhere(source, search);
  const rows = await prisma.person.findMany({ where, select: { id: true }, orderBy: { name: 'asc' }, take: MAX_BULK + 1 });
  return { ids: rows.slice(0, MAX_BULK).map((r) => r.id), capped: rows.length > MAX_BULK };
}

/**
 * Adds people to an assembly (reactivating anyone who had left it). Returns how many were added and
 * how many were already in. Never touches their other assemblies.
 */
export async function addPeopleToCommunity(personIds: string[], communityId: string) {
  const unique = [...new Set(personIds)];
  const existing = await prisma.communityMembership.findMany({ where: { communityId, personId: { in: unique } }, select: { personId: true, status: true } });
  const active = new Set(existing.filter((m) => m.status === 'ACTIVE').map((m) => m.personId));
  const inactive = existing.filter((m) => m.status !== 'ACTIVE').map((m) => m.personId);
  const known = new Set(existing.map((m) => m.personId));
  const toCreate = unique.filter((id) => !known.has(id));
  const real = await prisma.person.findMany({ where: { id: { in: toCreate } }, select: { id: true } });
  const now = new Date();
  await prisma.$transaction([
    prisma.communityMembership.createMany({ data: real.map((p) => ({ personId: p.id, communityId, joinedAt: now })), skipDuplicates: true }),
    prisma.communityMembership.updateMany({ where: { communityId, personId: { in: inactive } }, data: { status: 'ACTIVE', joinedAt: now } }),
  ]);
  const addedIds = [...real.map((p) => p.id), ...inactive];
  await announceJoined(communityId, addedIds);
  return { addedIds, added: addedIds.length, alreadyIn: active.size };
}

export interface BulkAddInput {
  personIds: string[];
  destinationId?: string;
  newAssembly?: { name: string; parentId?: string | null };
  /** Also take them out of the assemblies they came from (off by default). */
  removeFromSource?: string;
}

export async function bulkAdd(input: BulkAddInput) {
  if (input.personIds.length === 0) throw new BulkError('Select at least one person.');
  if (input.personIds.length > MAX_BULK) throw new BulkError(`Select at most ${MAX_BULK} people at a time.`);
  if (!input.destinationId && !input.newAssembly) throw new BulkError('Choose where to add them.');

  let destination: { id: string; name: string };
  let created = false;
  if (input.newAssembly) {
    if (input.newAssembly.parentId) {
      const parent = await prisma.community.findUnique({ where: { id: input.newAssembly.parentId }, select: { id: true } });
      if (!parent) throw new BulkError('The assembly to put it under was not found.');
      const full = await limitError(prisma, input.newAssembly.parentId);
      if (full) throw new BulkError(full);
    }
    destination = await prisma.$transaction(async (tx) => {
      const community = await tx.community.create({ data: { name: input.newAssembly!.name, parentId: input.newAssembly!.parentId ?? null } });
      await tx.conversation.create({ data: { communityId: community.id } });
      return { id: community.id, name: community.name };
    });
    created = true;
  } else {
    const found = await prisma.community.findUnique({ where: { id: input.destinationId! }, select: { id: true, name: true } });
    if (!found) throw new BulkError('That assembly was not found.', 404);
    destination = found;
  }

  const result = await addPeopleToCommunity(input.personIds, destination.id);

  let removed = 0;
  if (input.removeFromSource) {
    const ids = (await sourceCommunityIds(parseSource(input.removeFromSource)))?.filter((id) => id !== destination.id);
    if (ids && ids.length > 0) {
      const res = await prisma.communityMembership.updateMany({
        where: { personId: { in: input.personIds }, communityId: { in: ids }, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });
      removed = res.count;
    }
  }

  await notifyAddedToAssembly(result.addedIds, destination).catch(() => {});
  return { destination, created, added: result.added, alreadyIn: result.alreadyIn, removed };
}
