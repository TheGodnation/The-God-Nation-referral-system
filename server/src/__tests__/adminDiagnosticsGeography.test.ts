import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Temporary Geography-retirement diagnostic — server tests for
// GET /api/admin/diagnostics/geography-dependencies. Mirrors the exact
// conventions established in adminLocations.test.ts: agentWithUniqueIp,
// createAdmin/createLeader, bootstrap, and delta-based assertions (before
// vs. after) rather than absolute-value assertions, since this suite's
// shared test database is never truncated between files and other test
// files (geography.test.ts, etc.) legitimately create their own
// Geography-dependent rows. LeadershipProposal was retired in Geography
// Retirement Step 1, GeographyConversation/GeographyMessage/
// GeographyConversationRead in Step 2, AnnouncementTarget.geographyId in
// Step 4, FollowUpAssignment's GEOGRAPHY context in Step 5A, and
// GeographicAssignment/RoleAssignment.geographyId entirely in Step 5B — this
// endpoint no longer reports on any of them.
const RUN = Math.random().toString(36).slice(2, 10);

const app = createApp();

let ipCounter = 15000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.95.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function setupCommunityLeader(n: number, communityId: string) {
  const email = `diag-leader${n}-${RUN}@test.local`;
  const { user } = await createLeader(`Diag Leader ${n}`, email, `DIAG${n}${RUN}`);
  const person = await prisma.person.create({
    data: { name: `Diag Leader Person ${n}`, whatsappNumber: `+237982${RUN}${String(n).padStart(3, '0')}`.slice(0, 16) },
  });
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, person };
}

let personCounter = 0;
async function makePerson(overrides: { locationCountry?: string; locationCity?: string; locationArea?: string } = {}) {
  personCounter += 1;
  return prisma.person.create({
    data: {
      name: `Diag Person ${RUN}-${personCounter}`,
      whatsappNumber: `+23799${RUN.slice(0, 2)}${String(personCounter).padStart(6, '0')}`.slice(0, 18),
      ...overrides,
    },
  });
}

async function makeGeography(name: string, active = true) {
  return prisma.geography.create({ data: { name: `${name} ${RUN}`, type: 'REGION', countryCode: 'CM', active } });
}

async function getDiagnostics(agent: ReturnType<typeof agentWithUniqueIp>) {
  const res = await agent.get('/api/admin/diagnostics/geography-dependencies');
  return res;
}

describe('GET /api/admin/diagnostics/geography-dependencies — authentication', () => {
  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await getDiagnostics(anon);
    expect(res.status).toBe(401);
  });

  it('rejects a non-Admin (Leader) session using existing authorization behavior', async () => {
    const community = await prisma.community.create({ data: { name: `Diag Auth Community ${RUN}` } });
    const { agent } = await setupCommunityLeader(1, community.id);
    const res = await getDiagnostics(agent);
    expect(res.status).toBe(403);
  });

  it('an authenticated Admin receives a successful response', async () => {
    const { agent } = await loginAsAdmin(`diag-admin-auth-${RUN}@test.local`);
    const res = await getDiagnostics(agent);
    expect(res.status).toBe(200);
    expect(res.body.geography).toBeDefined();
  });
});

describe('GET /api/admin/diagnostics/geography-dependencies — security / no writes', () => {
  it('performs no write of any kind', async () => {
    const counts = {
      geography: await prisma.geography.count(),
      roleAssignment: await prisma.roleAssignment.count(),
      announcementTarget: await prisma.announcementTarget.count(),
      followUpAssignment: await prisma.followUpAssignment.count(),
      person: await prisma.person.count(),
    };

    const { agent } = await loginAsAdmin(`diag-nowrite-${RUN}@test.local`);
    await getDiagnostics(agent);

    expect(await prisma.geography.count()).toBe(counts.geography);
    expect(await prisma.roleAssignment.count()).toBe(counts.roleAssignment);
    expect(await prisma.announcementTarget.count()).toBe(counts.announcementTarget);
    expect(await prisma.followUpAssignment.count()).toBe(counts.followUpAssignment);
    expect(await prisma.person.count()).toBe(counts.person);
  });
});

describe('GET /api/admin/diagnostics/geography-dependencies — Geography counts', () => {
  it('total/active/inactive counts reflect actual rows (delta-based)', async () => {
    const { agent } = await loginAsAdmin(`diag-geo-counts-${RUN}@test.local`);
    const before = await getDiagnostics(agent);

    const active = await makeGeography('Diag Active Geo', true);
    const inactive = await makeGeography('Diag Inactive Geo', false);
    void active;
    void inactive;

    const after = await getDiagnostics(agent);
    expect(after.body.geography.total).toBe(before.body.geography.total + 2);
    expect(after.body.geography.active).toBe(before.body.geography.active + 1);
    expect(after.body.geography.inactive).toBe(before.body.geography.inactive + 1);
  });
});

// Geography Retirement Step 5A removed the GEOGRAPHY value from
// FollowUpAssignment.contextType entirely (see the
// 20260930094423_retire_followup_geography_context migration) — a
// Geography-context FollowUpAssignment can no longer be created at all, so
// the counts/orphan-detection test that used to live here (which depended on
// creating exactly that kind of row) no longer applies. The endpoint's
// followUpAssignments section is now a fixed { geographyContextRetired,
// note } shape — covered directly in
// followUpGeographyRetirement.test.ts's diagnostic test.
//
// Geography Retirement Step 5B removed GeographicAssignment and
// RoleAssignment.geographyId entirely (see the
// 20260930105022_retire_geographic_assignment_and_role_geography
// migration) — a Geography-scoped RoleAssignment can no longer be created
// at all, so the counts test that used to live here no longer applies.
// Both the geographicAssignments and roleAssignments sections of the
// endpoint's response are now fixed retirement-notice shapes — covered
// directly in geographicAssignmentRetirement.test.ts's diagnostic test.

describe('GET /api/admin/diagnostics/geography-dependencies — location data counts', () => {
  it('person location field counts are correct (delta-based, using default test-data exclusion)', async () => {
    const { agent } = await loginAsAdmin(`diag-location-counts-${RUN}@test.local`);
    const before = await getDiagnostics(agent);

    await makePerson({ locationCountry: `DiagCountry-${RUN}` });
    await makePerson({ locationCity: `DiagCity-${RUN}` });
    await makePerson({ locationArea: `DiagArea-${RUN}` });

    const after = await getDiagnostics(agent);
    expect(after.body.locationData.personsWithCountry).toBe(before.body.locationData.personsWithCountry + 1);
    expect(after.body.locationData.personsWithCity).toBe(before.body.locationData.personsWithCity + 1);
    expect(after.body.locationData.personsWithArea).toBe(before.body.locationData.personsWithArea + 1);
  });
});

describe('GET /api/admin/diagnostics/geography-dependencies — privacy', () => {
  it('does not expose prohibited personal fields', async () => {
    const person = await makePerson({ locationCountry: `PrivacyCountry-${RUN}` });
    await prisma.person.update({ where: { id: person.id }, data: { email: 'diag-should-never-leak@example.com' } });

    const { agent } = await loginAsAdmin(`diag-privacy-${RUN}@test.local`);
    const res = await getDiagnostics(agent);
    const serialized = JSON.stringify(res.body);

    expect(serialized).not.toMatch(/whatsapp/i);
    expect(serialized).not.toMatch(/diag-should-never-leak/);
    expect(serialized).not.toMatch(person.id);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/DATABASE_URL/i);
    expect(serialized).not.toMatch(/postgresql:\/\//i);
  });
});
