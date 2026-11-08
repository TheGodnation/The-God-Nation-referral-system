import { prisma } from './prisma';
import { getCommunityIdsAtGeneration, getHeadquartersCommunityId } from './tree';
import { listLeaders } from './leaderInstructions';
import { notifyRepresentativeAppointed, notifyRepresentativeEnded } from './notifications';

// One representative per generation of the assembly tree, chosen by the central admin from the leaders and
// ended only by the central admin. A representative can post instructions to the leaders of their generation,
// follow who is done or late, mute members and send removal requests in that generation, and joins that
// generation's leaders' room labelled "Representing the central team". They cannot appoint or remove anyone,
// act in another generation, or read private chats or prayer requests.

export class RepresentativeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const MAX_GENERATIONS = 20;

/** The generations that exist (1 = directly under the Headquarters), each with how many assemblies it has. */
export async function existingGenerations(): Promise<{ generation: number; assemblies: number }[]> {
  const hq = await getHeadquartersCommunityId();
  const out: { generation: number; assemblies: number }[] = [];
  if (!hq) return out;
  for (let g = 1; g <= MAX_GENERATIONS; g++) {
    const ids = await getCommunityIdsAtGeneration(hq, g);
    if (ids.length === 0) break;
    out.push({ generation: g, assemblies: ids.length });
  }
  return out;
}

/** The generation this person currently represents, or null. */
export async function representedGeneration(personId: string): Promise<number | null> {
  const row = await prisma.generationRepresentative.findFirst({ where: { personId, endedAt: null }, select: { generation: true } });
  return row?.generation ?? null;
}

/** Every assembly of the generation this person represents (empty if they represent none). */
export async function representedCommunityIds(personId: string): Promise<string[]> {
  const generation = await representedGeneration(personId);
  if (generation === null) return [];
  const hq = await getHeadquartersCommunityId();
  return hq ? getCommunityIdsAtGeneration(hq, generation) : [];
}

export async function overview() {
  const [generations, active] = await Promise.all([
    existingGenerations(),
    prisma.generationRepresentative.findMany({ where: { endedAt: null }, include: { person: { select: { name: true } } } }),
  ]);
  const byGeneration = new Map(active.map((r) => [r.generation, r]));
  return generations.map((g) => {
    const rep = byGeneration.get(g.generation);
    return { ...g, representative: rep ? { id: rep.id, personId: rep.personId, name: rep.person.name, appointedAt: rep.appointedAt } : null };
  });
}

/** Leaders who could be appointed (not already representing a generation), found by name. */
export async function eligibleLeaders(search: string) {
  const q = search.trim().toLowerCase();
  const [leaders, active] = await Promise.all([listLeaders(), prisma.generationRepresentative.findMany({ where: { endedAt: null }, select: { personId: true } })]);
  const taken = new Set(active.map((r) => r.personId));
  return leaders
    .filter((l) => !taken.has(l.personId) && (!q || l.name.toLowerCase().includes(q)))
    .slice(0, 30)
    .map((l) => ({ id: l.personId, name: l.name, generations: l.generations, assemblies: l.assemblies }));
}

export async function appoint(personId: string, generation: number, adminUserId: string | null) {
  const generations = await existingGenerations();
  if (!generations.some((g) => g.generation === generation)) throw new RepresentativeError('That generation does not exist yet.');
  const leaders = await listLeaders();
  if (!leaders.some((l) => l.personId === personId)) throw new RepresentativeError('A representative must be a leader of an assembly.');
  if (await representedGeneration(personId) !== null) throw new RepresentativeError('This leader already represents a generation.', 409);
  const current = await prisma.generationRepresentative.findFirst({ where: { generation, endedAt: null } });
  if (current) throw new RepresentativeError('This generation already has a representative. Remove them first.', 409);
  const row = await prisma.generationRepresentative.create({ data: { personId, generation, appointedByUserId: adminUserId } });
  await notifyRepresentativeAppointed(personId, generation).catch(() => {});
  return row;
}

export async function end(id: string, adminUserId: string | null) {
  const row = await prisma.generationRepresentative.findUnique({ where: { id } });
  if (!row || row.endedAt) throw new RepresentativeError('Representative not found.', 404);
  await prisma.generationRepresentative.update({ where: { id }, data: { endedAt: new Date(), endedByUserId: adminUserId } });
  await notifyRepresentativeEnded(row.personId, row.generation).catch(() => {});
  return row;
}
