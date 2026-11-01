import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma';
import { planPlacement, placePersonInGroup } from '../lib/placement';
import { createAdmin } from './helpers';

// Cells: an assembly holds ~200 members (adjustable); when every open
// assembly is full, the app opens a child assembly ("one brings two": at
// most two per assembly), places the newcomer there and tells the central admin.

const loc = { country: null, region: null };
const g = (id: string, memberCount: number, autoChildCount = 0, createdAt = new Date(2026, 0, Number(id.replace(/\D/g, '')) || 1)) => ({
  id,
  name: id,
  placementCountry: null,
  placementRegion: null,
  memberCount,
  autoChildCount,
  createdAt,
});

describe('planPlacement', () => {
  it('places in an assembly that still has room, the smallest first', () => {
    expect(planPlacement([g('a1', 200), g('a2', 50), g('a3', 10)], 'SMALLEST_GROUP', loc, 200)).toEqual({ kind: 'place', groupId: 'a3' });
  });

  it('opens a child under a full assembly when all are full', () => {
    expect(planPlacement([g('a1', 200)], 'SMALLEST_GROUP', loc, 200)).toEqual({ kind: 'split', parentId: 'a1' });
  });

  it('never opens a third child under one assembly', () => {
    const plan = planPlacement([g('a1', 200, 2), g('a2', 200, 1)], 'SMALLEST_GROUP', loc, 200);
    expect(plan).toEqual({ kind: 'split', parentId: 'a2' });
  });

  it('still places the newcomer if nothing can open a new assembly', () => {
    const plan = planPlacement([g('a1', 205, 2), g('a2', 200, 2)], 'SMALLEST_GROUP', loc, 200);
    expect(plan).toEqual({ kind: 'place', groupId: 'a2' });
  });

  it('says nothing when there are no open assemblies', () => {
    expect(planPlacement([], 'SMALLEST_GROUP', loc, 200)).toBeNull();
  });
});

describe('placePersonInGroup with a small capacity', () => {
  async function setup(capacity: number) {
    const hq = await prisma.community.create({ data: { name: 'Headquarters' } });
    await prisma.conversation.create({ data: { communityId: hq.id } });
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', headquartersCommunityId: hq.id, assemblyCapacity: capacity },
      update: { headquartersCommunityId: hq.id, assemblyCapacity: capacity },
    });
    return hq;
  }
  let n = 0;
  async function newPerson() {
    n += 1;
    return prisma.person.create({ data: { name: `Member ${n}`, whatsappNumber: `+23769911${String(n).padStart(4, '0')}` } });
  }

  it('fills the assembly, then opens a child, tells the admin, and keeps filling it', async () => {
    const hq = await setup(2);
    const admin = await createAdmin();
    const adminPerson = await prisma.person.create({ data: { name: 'Central Admin', whatsappNumber: '+237699000001' } });
    await prisma.user.update({ where: { id: admin.id }, data: { personId: adminPerson.id } });

    const first = await placePersonInGroup((await newPerson()).id, loc);
    const second = await placePersonInGroup((await newPerson()).id, loc);
    expect(first).toBe(hq.id);
    expect(second).toBe(hq.id);

    const third = await placePersonInGroup((await newPerson()).id, loc);
    expect(third).not.toBe(hq.id);
    const child = await prisma.community.findUniqueOrThrow({ where: { id: third! }, include: { conversation: true } });
    expect(child.parentId).toBe(hq.id);
    expect(child.autoCreated).toBe(true);
    expect(child.name).toBe('Headquarters · 1');
    expect(child.conversation).not.toBeNull();

    // The admin is told (asynchronously — give the notice a moment to land).
    let notice = null;
    for (let i = 0; i < 20 && !notice; i++) {
      notice = await prisma.notification.findFirst({ where: { recipientPersonId: adminPerson.id, type: 'ASSEMBLY_OPENED' } });
      if (!notice) await new Promise((r) => setTimeout(r, 50));
    }
    expect(notice).not.toBeNull();
    expect(notice!.targetId).toBe(child.id);

    // The next newcomer goes to the new assembly, not another new one.
    const fourth = await placePersonInGroup((await newPerson()).id, loc);
    expect(fourth).toBe(third);
    expect(await prisma.community.count({ where: { autoCreated: true } })).toBe(1);
  });

  it('opens a second child, then grows from the children, never a third under one', async () => {
    const hq = await setup(1);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await placePersonInGroup((await newPerson()).id, loc))!);

    const kids = await prisma.community.findMany({ where: { parentId: hq.id }, orderBy: { createdAt: 'asc' } });
    expect(kids.map((k) => k.name)).toEqual(['Headquarters · 1', 'Headquarters · 2']);
    // Person 1 in HQ, 2 and 3 in the two children, 4 and 5 under the children.
    expect(ids[0]).toBe(hq.id);
    expect(await prisma.community.count({ where: { parentId: hq.id } })).toBe(2);
    expect(await prisma.community.count({ where: { autoCreated: true } })).toBe(4);
  });

  it('does not move someone who is already in an assembly', async () => {
    const hq = await setup(1);
    const p = await newPerson();
    expect(await placePersonInGroup(p.id, loc)).toBe(hq.id);
    expect(await placePersonInGroup(p.id, loc)).toBe(hq.id);
    expect(await prisma.community.count()).toBe(1);
  });
});
