import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma';
import { getDescendantGeographyIds } from '../lib/tree';

async function makeGeography(name: string, type = 'REGION', countryCode = 'CM', parentId?: string) {
  return prisma.geography.create({ data: { name, type, countryCode, parentId: parentId ?? null } });
}

describe('Phase 3K — getDescendantGeographyIds', () => {
  it('a root with no children returns only itself', async () => {
    const root = await makeGeography('Descendant Root A');
    const ids = await getDescendantGeographyIds(root.id);
    expect(ids).toEqual([root.id]);
  });

  it('a root with one child returns both', async () => {
    const root = await makeGeography('Descendant Root B');
    const child = await makeGeography('Descendant Child B', 'DIVISION', 'CM', root.id);
    const ids = await getDescendantGeographyIds(root.id);
    expect(ids.slice().sort()).toEqual([root.id, child.id].sort());
  });

  it('a deep arbitrary-depth chain returns every level (World -> Continent -> Country -> Region -> Division -> Sub-Division -> Village)', async () => {
    const world = await makeGeography('Descendant World C', 'WORLD', 'CM');
    const continent = await makeGeography('Descendant Continent C', 'CONTINENT', 'CM', world.id);
    const country = await makeGeography('Descendant Country C', 'COUNTRY', 'CM', continent.id);
    const region = await makeGeography('Descendant Region C', 'REGION', 'CM', country.id);
    const division = await makeGeography('Descendant Division C', 'DIVISION', 'CM', region.id);
    const subdivision = await makeGeography('Descendant SubDivision C', 'SUBDIVISION', 'CM', division.id);
    const village = await makeGeography('Descendant Village C', 'VILLAGE', 'CM', subdivision.id);

    const ids = await getDescendantGeographyIds(world.id);
    expect(ids.slice().sort()).toEqual(
      [world.id, continent.id, country.id, region.id, division.id, subdivision.id, village.id].sort(),
    );
  });

  it('a wide branching tree returns every branch', async () => {
    const root = await makeGeography('Descendant Root D');
    const childA = await makeGeography('Descendant Child D-A', 'DIVISION', 'CM', root.id);
    const childB = await makeGeography('Descendant Child D-B', 'DIVISION', 'CM', root.id);
    const grandchildA1 = await makeGeography('Descendant Grandchild D-A1', 'SUBDIVISION', 'CM', childA.id);
    const grandchildB1 = await makeGeography('Descendant Grandchild D-B1', 'SUBDIVISION', 'CM', childB.id);

    const ids = await getDescendantGeographyIds(root.id);
    expect(ids.slice().sort()).toEqual([root.id, childA.id, childB.id, grandchildA1.id, grandchildB1.id].sort());
  });

  it('includes the root node itself even when it has descendants', async () => {
    const root = await makeGeography('Descendant Root E');
    await makeGeography('Descendant Child E', 'DIVISION', 'CM', root.id);
    const ids = await getDescendantGeographyIds(root.id);
    expect(ids).toContain(root.id);
  });

  it('includes descendants at every level, not just direct children', async () => {
    const root = await makeGeography('Descendant Root F');
    const child = await makeGeography('Descendant Child F', 'DIVISION', 'CM', root.id);
    const grandchild = await makeGeography('Descendant Grandchild F', 'SUBDIVISION', 'CM', child.id);
    const ids = await getDescendantGeographyIds(root.id);
    expect(ids).toContain(child.id);
    expect(ids).toContain(grandchild.id);
  });

  it('a branch is included only when it is actually a descendant of the requested root, not merely a sibling of one', async () => {
    const root = await makeGeography('Descendant Root G');
    const childA = await makeGeography('Descendant Child G-A', 'DIVISION', 'CM', root.id);
    const childB = await makeGeography('Descendant Child G-B', 'DIVISION', 'CM', root.id);

    const idsFromChildA = await getDescendantGeographyIds(childA.id);
    expect(idsFromChildA).toEqual([childA.id]);
    expect(idsFromChildA).not.toContain(childB.id);
    expect(idsFromChildA).not.toContain(root.id);
  });

  it('excludes an unrelated root entirely', async () => {
    const root = await makeGeography('Descendant Root H');
    await makeGeography('Descendant Child H', 'DIVISION', 'CM', root.id);
    const unrelated = await makeGeography('Descendant Unrelated H');

    const ids = await getDescendantGeographyIds(root.id);
    expect(ids).not.toContain(unrelated.id);
  });

  it('is defensive against malformed/cyclic parentId data and always terminates', async () => {
    const a = await makeGeography('Descendant Cyclic A');
    const b = await makeGeography('Descendant Cyclic B', 'DIVISION', 'CM', a.id);
    // Force a cycle the application itself would never create (wouldCreateCycle
    // already prevents this on every reparent) — proves the traversal can
    // never loop forever even if the underlying data were corrupted.
    await prisma.geography.update({ where: { id: a.id }, data: { parentId: b.id } });

    const ids = await getDescendantGeographyIds(a.id);
    expect(ids.slice().sort()).toEqual([a.id, b.id].sort());
  });
});
