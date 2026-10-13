import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma';
import { getCommunityGeneration, getDescendantCommunityIds } from '../lib/tree';

async function makeCommunity(name: string, parentId?: string) {
  return prisma.community.create({ data: { name, parentId: parentId ?? null } });
}

// Geography Retirement Step 5B removed getDescendantGeographyIds entirely —
// its only two call sites (isGeographyInLeaderScope and the roster's
// Geography branch) were both retired in this step. This file's coverage of
// the shared downward-walk traversal continues via getDescendantCommunityIds
// below, which exercises the identical algorithm.

describe('Headquarters Network Posts — getDescendantCommunityIds', () => {
  it('a root with no children returns only itself', async () => {
    const root = await makeCommunity('CDescendant Root A');
    const ids = await getDescendantCommunityIds(root.id);
    expect(ids).toEqual([root.id]);
  });

  it('a root with one child returns both', async () => {
    const root = await makeCommunity('CDescendant Root B');
    const child = await makeCommunity('CDescendant Child B', root.id);
    const ids = await getDescendantCommunityIds(root.id);
    expect(ids.slice().sort()).toEqual([root.id, child.id].sort());
  });

  it('a deep arbitrary-depth chain returns every level', async () => {
    const root = await makeCommunity('CDescendant Root C');
    const gen1 = await makeCommunity('CDescendant C1', root.id);
    const gen2 = await makeCommunity('CDescendant C2', gen1.id);
    const gen3 = await makeCommunity('CDescendant C3', gen2.id);

    const ids = await getDescendantCommunityIds(root.id);
    expect(ids.slice().sort()).toEqual([root.id, gen1.id, gen2.id, gen3.id].sort());
  });

  it('a wide branching tree returns every branch', async () => {
    const root = await makeCommunity('CDescendant Root D');
    const childA = await makeCommunity('CDescendant Child D-A', root.id);
    const childB = await makeCommunity('CDescendant Child D-B', root.id);
    const grandchildA1 = await makeCommunity('CDescendant Grandchild D-A1', childA.id);
    const grandchildB1 = await makeCommunity('CDescendant Grandchild D-B1', childB.id);

    const ids = await getDescendantCommunityIds(root.id);
    expect(ids.slice().sort()).toEqual([root.id, childA.id, childB.id, grandchildA1.id, grandchildB1.id].sort());
  });

  it('a branch is included only when it is actually a descendant of the requested root, not merely a sibling of one', async () => {
    const root = await makeCommunity('CDescendant Root G');
    const childA = await makeCommunity('CDescendant Child G-A', root.id);
    const childB = await makeCommunity('CDescendant Child G-B', root.id);

    const idsFromChildA = await getDescendantCommunityIds(childA.id);
    expect(idsFromChildA).toEqual([childA.id]);
    expect(idsFromChildA).not.toContain(childB.id);
    expect(idsFromChildA).not.toContain(root.id);
  });

  it('excludes an unrelated root entirely', async () => {
    const root = await makeCommunity('CDescendant Root H');
    await makeCommunity('CDescendant Child H', root.id);
    const unrelated = await makeCommunity('CDescendant Unrelated H');

    const ids = await getDescendantCommunityIds(root.id);
    expect(ids).not.toContain(unrelated.id);
  });

  it('is defensive against malformed/cyclic parentId data and always terminates', async () => {
    const a = await makeCommunity('CDescendant Cyclic A');
    const b = await makeCommunity('CDescendant Cyclic B', a.id);
    await prisma.community.update({ where: { id: a.id }, data: { parentId: b.id } });

    const ids = await getDescendantCommunityIds(a.id);
    expect(ids.slice().sort()).toEqual([a.id, b.id].sort());
  });
});

describe('National Headquarters — getCommunityGeneration', () => {
  it('Headquarters itself is generation 0', async () => {
    const hq = await makeCommunity('Generation HQ A');
    expect(await getCommunityGeneration(hq.id, hq.id)).toBe(0);
  });

  it('a direct child is generation 1', async () => {
    const hq = await makeCommunity('Generation HQ B');
    const child = await makeCommunity('Generation Child B', hq.id);
    expect(await getCommunityGeneration(child.id, hq.id)).toBe(1);
  });

  it('a deep chain increments generation at every level', async () => {
    const hq = await makeCommunity('Generation HQ C');
    const gen1 = await makeCommunity('Generation C1', hq.id);
    const gen2 = await makeCommunity('Generation C2', gen1.id);
    const gen3 = await makeCommunity('Generation C3', gen2.id);
    const gen4 = await makeCommunity('Generation C4', gen3.id);

    expect(await getCommunityGeneration(gen1.id, hq.id)).toBe(1);
    expect(await getCommunityGeneration(gen2.id, hq.id)).toBe(2);
    expect(await getCommunityGeneration(gen3.id, hq.id)).toBe(3);
    expect(await getCommunityGeneration(gen4.id, hq.id)).toBe(4);
  });

  it('a wide branching tree gives every sibling branch the correct generation', async () => {
    const hq = await makeCommunity('Generation HQ D');
    const a = await makeCommunity('Generation D-A', hq.id);
    const b = await makeCommunity('Generation D-B', hq.id);
    const a1 = await makeCommunity('Generation D-A1', a.id);
    const b1 = await makeCommunity('Generation D-B1', b.id);

    expect(await getCommunityGeneration(a.id, hq.id)).toBe(1);
    expect(await getCommunityGeneration(b.id, hq.id)).toBe(1);
    expect(await getCommunityGeneration(a1.id, hq.id)).toBe(2);
    expect(await getCommunityGeneration(b1.id, hq.id)).toBe(2);
  });

  it('an unrelated root Community (not descended from Headquarters) returns null, never a fabricated generation', async () => {
    const hq = await makeCommunity('Generation HQ E');
    const unrelated = await makeCommunity('Generation Unrelated E');
    expect(await getCommunityGeneration(unrelated.id, hq.id)).toBeNull();
  });

  it('a Community descended from an unrelated root (not Headquarters) also returns null', async () => {
    const hq = await makeCommunity('Generation HQ F');
    const unrelatedRoot = await makeCommunity('Generation Unrelated Root F');
    const unrelatedChild = await makeCommunity('Generation Unrelated Child F', unrelatedRoot.id);
    expect(await getCommunityGeneration(unrelatedChild.id, hq.id)).toBeNull();
  });

  it('is defensive against malformed/cyclic parentId data and always terminates', async () => {
    const hq = await makeCommunity('Generation HQ G');
    const a = await makeCommunity('Generation Cyclic G-A');
    const b = await makeCommunity('Generation Cyclic G-B', a.id);
    // Force a cycle the application itself would never create (wouldCreateCycle
    // already prevents this on every reparent) — proves the upward walk can
    // never loop forever even if the underlying data were corrupted, and
    // never falsely reports a generation for data that never actually
    // reaches Headquarters.
    await prisma.community.update({ where: { id: a.id }, data: { parentId: b.id } });

    expect(await getCommunityGeneration(a.id, hq.id)).toBeNull();
    expect(await getCommunityGeneration(b.id, hq.id)).toBeNull();
  });
});
