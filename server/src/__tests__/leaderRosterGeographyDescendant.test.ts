import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Phase 3K — descendant-aware Geography visibility for GET /api/leader/roster.
// Community behavior is untouched (see leaderRoster.test.ts, unmodified).
// Mirrors the exact conventions already established there: agentWithUniqueIp,
// setupScopedLeader, makePerson/makeGeography.

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.98.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function makePerson(whatsappNumber: string, name = 'Descendant Roster Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeGeography(name: string, type = 'REGION', countryCode = 'CM', parentId?: string) {
  return prisma.geography.create({ data: { name, type, countryCode, parentId: parentId ?? null } });
}

async function setupScopedLeader(n: number, geographyId: string) {
  const email = `leader-geodesc${n}@test.local`;
  const { user } = await createLeader(`Geo Descendant Leader ${n}`, email, `GD${n}CODE`);
  const person = await makePerson(`+237693${String(n).padStart(6, '0')}`, `Geo Descendant Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, geographyId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function assign(personId: string, geographyId: string) {
  return prisma.geographicAssignment.create({ data: { personId, geographyId } });
}

/** Builds one full World -> Continent -> Country -> Region -> Division ->
 * Sub-Division -> Village chain, with a distinct suffix so parallel tests
 * never collide. */
async function buildChain(suffix: string) {
  const world = await makeGeography(`World ${suffix}`, 'WORLD', 'CM');
  const continent = await makeGeography(`Continent ${suffix}`, 'CONTINENT', 'CM', world.id);
  const country = await makeGeography(`Country ${suffix}`, 'COUNTRY', 'CM', continent.id);
  const region = await makeGeography(`Region ${suffix}`, 'REGION', 'CM', country.id);
  const division = await makeGeography(`Division ${suffix}`, 'DIVISION', 'CM', region.id);
  const subdivision = await makeGeography(`SubDivision ${suffix}`, 'SUBDIVISION', 'CM', division.id);
  const village = await makeGeography(`Village ${suffix}`, 'VILLAGE', 'CM', subdivision.id);
  return { world, continent, country, region, division, subdivision, village };
}

describe('Phase 3K — GET /api/leader/roster — Geography descendant visibility', () => {
  it('1. Quarter/Village leader sees a person assigned to their own locality', async () => {
    const chain = await buildChain('A1');
    const { agent } = await setupScopedLeader(1, chain.village.id);
    const person = await makePerson('+237694000001');
    await assign(person.id, chain.village.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.village.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.personId)).toContain(person.id);
  });

  it('2. Quarter/Village leader cannot see a sibling locality, either as visible people or by requesting it directly', async () => {
    const chain = await buildChain('A2');
    const siblingVillage = await makeGeography('Sibling Village A2', 'VILLAGE', 'CM', chain.subdivision.id);
    const { agent } = await setupScopedLeader(2, chain.village.id);
    const siblingPerson = await makePerson('+237694000002');
    await assign(siblingPerson.id, siblingVillage.id);

    const ownRoster = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.village.id}`);
    expect(ownRoster.body.items.map((i: any) => i.personId)).not.toContain(siblingPerson.id);

    const directRequest = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${siblingVillage.id}`);
    expect(directRequest.status).toBe(403);
  });

  it('3-4. Sub-Division leader sees own Sub-Division and descendant Village people', async () => {
    const chain = await buildChain('B');
    const { agent } = await setupScopedLeader(3, chain.subdivision.id);
    const ownLevelPerson = await makePerson('+237694000003');
    await assign(ownLevelPerson.id, chain.subdivision.id);
    const villagePerson = await makePerson('+237694000103');
    await assign(villagePerson.id, chain.village.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.subdivision.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(ownLevelPerson.id);
    expect(ids).toContain(villagePerson.id);
  });

  it('5. Sub-Division leader cannot see a sibling Sub-Division', async () => {
    const chain = await buildChain('C');
    const siblingSubdivision = await makeGeography('Sibling SubDivision C', 'SUBDIVISION', 'CM', chain.division.id);
    const { agent } = await setupScopedLeader(4, chain.subdivision.id);
    const siblingPerson = await makePerson('+237694000004');
    await assign(siblingPerson.id, siblingSubdivision.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${siblingSubdivision.id}`);
    expect(res.status).toBe(403);
  });

  it('6-8. Division leader sees own Division, descendant Sub-Divisions, and descendant Villages', async () => {
    const chain = await buildChain('D');
    const { agent } = await setupScopedLeader(5, chain.division.id);
    const divisionPerson = await makePerson('+237694000005');
    await assign(divisionPerson.id, chain.division.id);
    const subdivisionPerson = await makePerson('+237694000105');
    await assign(subdivisionPerson.id, chain.subdivision.id);
    const villagePerson = await makePerson('+237694000205');
    await assign(villagePerson.id, chain.village.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.division.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(divisionPerson.id);
    expect(ids).toContain(subdivisionPerson.id);
    expect(ids).toContain(villagePerson.id);
  });

  it('9. Division leader cannot see a sibling Division', async () => {
    const chain = await buildChain('E');
    const siblingDivision = await makeGeography('Sibling Division E', 'DIVISION', 'CM', chain.region.id);
    const { agent } = await setupScopedLeader(6, chain.division.id);
    const siblingPerson = await makePerson('+237694000006');
    await assign(siblingPerson.id, siblingDivision.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${siblingDivision.id}`);
    expect(res.status).toBe(403);
  });

  it('10-13. Regional leader sees own Region and descendant Divisions/Sub-Divisions/Villages', async () => {
    const chain = await buildChain('F');
    const { agent } = await setupScopedLeader(7, chain.region.id);
    const regionPerson = await makePerson('+237694000007');
    await assign(regionPerson.id, chain.region.id);
    const divisionPerson = await makePerson('+237694000107');
    await assign(divisionPerson.id, chain.division.id);
    const subdivisionPerson = await makePerson('+237694000207');
    await assign(subdivisionPerson.id, chain.subdivision.id);
    const villagePerson = await makePerson('+237694000307');
    await assign(villagePerson.id, chain.village.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.region.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(regionPerson.id);
    expect(ids).toContain(divisionPerson.id);
    expect(ids).toContain(subdivisionPerson.id);
    expect(ids).toContain(villagePerson.id);
  });

  it('14. Regional leader cannot see a sibling Region', async () => {
    const chain = await buildChain('G');
    const siblingRegion = await makeGeography('Sibling Region G', 'REGION', 'CM', chain.country.id);
    const { agent } = await setupScopedLeader(8, chain.region.id);
    const siblingPerson = await makePerson('+237694000008');
    await assign(siblingPerson.id, siblingRegion.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${siblingRegion.id}`);
    expect(res.status).toBe(403);
  });

  it('15-16. National Leader sees own Country and descendant Regions (and deeper)', async () => {
    const chain = await buildChain('H');
    const { agent } = await setupScopedLeader(9, chain.country.id);
    const countryPerson = await makePerson('+237694000009');
    await assign(countryPerson.id, chain.country.id);
    const regionPerson = await makePerson('+237694000109');
    await assign(regionPerson.id, chain.region.id);
    const villagePerson = await makePerson('+237694000209');
    await assign(villagePerson.id, chain.village.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.country.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(countryPerson.id);
    expect(ids).toContain(regionPerson.id);
    expect(ids).toContain(villagePerson.id);
  });

  it('17. National Leader cannot see another Country', async () => {
    const chain = await buildChain('I1');
    const otherChain = await buildChain('I2');
    const { agent } = await setupScopedLeader(10, chain.country.id);
    const otherCountryPerson = await makePerson('+237694000010');
    await assign(otherCountryPerson.id, otherChain.country.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${otherChain.country.id}`);
    expect(res.status).toBe(403);
  });

  it('18. An ENDED RoleAssignment cannot authorize descendant visibility', async () => {
    const chain = await buildChain('J');
    const { agent, person } = await setupScopedLeader(11, chain.region.id);
    await prisma.roleAssignment.updateMany({
      where: { personId: person.id, geographyId: chain.region.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.division.id}`);
    expect(res.status).toBe(403);
  });

  it('19-20. A Leader with no RoleAssignment at all cannot access any geographical subtree, no matter what scopeId the client sends', async () => {
    const chain = await buildChain('K');
    const { user } = await createLeader('Geo Descendant Unassigned Leader', 'leader-geodesc-unassigned@test.local', 'GDUNASSIGNED');
    const person = await makePerson('+237694000012', 'Unassigned Leader Person');
    await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });

    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-geodesc-unassigned@test.local', password: 'password123' });

    for (const id of [chain.world.id, chain.country.id, chain.region.id, chain.village.id]) {
      const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${id}`);
      expect(res.status).toBe(403);
    }
  });

  it('21. A Geography RoleAssignment does not grant Community roster access', async () => {
    const chain = await buildChain('L');
    const community = await prisma.community.create({ data: { name: 'Descendant Isolation Community L' } });
    const { agent } = await setupScopedLeader(13, chain.region.id);

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(403);
  });

  it('22. A descendant-inclusive Geography roster row exposes only the established minimal fields — no Community data, no WhatsApp/email', async () => {
    const chain = await buildChain('M');
    const { agent } = await setupScopedLeader(14, chain.region.id);
    const villagePerson = await makePerson('+237694000014', 'Minimal Field Descendant Person');
    await assign(villagePerson.id, chain.village.id);
    await prisma.communityMembership.create({
      data: { personId: villagePerson.id, communityId: (await prisma.community.create({ data: { name: 'Unrelated Community M' } })).id },
    });

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.region.id}`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((i: any) => i.personId === villagePerson.id);
    const keys = Object.keys(row).sort();
    expect(keys).toEqual(['geographicAssignedAt', 'name', 'personGeographyId', 'personId'].sort());
    expect(JSON.stringify(res.body)).not.toMatch(/whatsapp/i);
    expect(JSON.stringify(res.body)).not.toMatch(/email/i);
    expect(JSON.stringify(res.body)).not.toMatch(/Unrelated Community M/);
  });

  it('personGeographyId distinguishes an exact-scope row from a descendant-only row', async () => {
    const chain = await buildChain('M2');
    const { agent } = await setupScopedLeader(15, chain.region.id);
    const exactPerson = await makePerson('+237694000015', 'Exact Scope Person');
    await assign(exactPerson.id, chain.region.id);
    const descendantPerson = await makePerson('+237694000115', 'Descendant Scope Person');
    await assign(descendantPerson.id, chain.village.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.region.id}`);
    const exactRow = res.body.items.find((i: any) => i.personId === exactPerson.id);
    const descendantRow = res.body.items.find((i: any) => i.personId === descendantPerson.id);
    expect(exactRow.personGeographyId).toBe(chain.region.id);
    expect(descendantRow.personGeographyId).toBe(chain.village.id);
  });

  it('23. Visibility does not widen Follow-Up authorization — a Regional leader cannot start a Follow-Up for a descendant-only person using the Region as context', async () => {
    const chain = await buildChain('N');
    const { agent, csrf } = await setupScopedLeader(16, chain.region.id);
    const descendantPerson = await makePerson('+237694000016', 'Descendant Only Followup Target');
    await assign(descendantPerson.id, chain.village.id);

    const rosterRes = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.region.id}`);
    expect(rosterRes.body.items.map((i: any) => i.personId)).toContain(descendantPerson.id);

    const followUpRes = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: descendantPerson.id, contextType: 'GEOGRAPHY', contextId: chain.region.id });
    expect(followUpRes.status).toBe(400);
  });

  it('excludes an inactive GeographicAssignment even at a descendant level', async () => {
    const chain = await buildChain('O');
    const { agent } = await setupScopedLeader(17, chain.region.id);
    const inactivePerson = await makePerson('+237694000017', 'Inactive Descendant Person');
    await prisma.geographicAssignment.create({ data: { personId: inactivePerson.id, geographyId: chain.village.id, status: 'INACTIVE' } });

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.region.id}`);
    expect(res.body.items.map((i: any) => i.personId)).not.toContain(inactivePerson.id);
  });

  it('performs no writes to Geography or GeographicAssignment', async () => {
    const chain = await buildChain('P');
    const { agent } = await setupScopedLeader(18, chain.region.id);
    const person = await makePerson('+237694000018');
    const assignment = await assign(person.id, chain.village.id);

    await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${chain.region.id}`);

    const stillThere = await prisma.geographicAssignment.findUnique({ where: { id: assignment.id } });
    expect(stillThere).toEqual(assignment);
  });
});
