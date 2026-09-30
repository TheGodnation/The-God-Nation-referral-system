import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Reporting/Export Gap phase — server tests for:
//   - GET /api/admin/export (Registrations) — existing behavior/fields
//     unchanged, now also audit-logged.
//   - GET /api/admin/communities/export (CommunityMembership) — new,
//     minimum-necessary CSV export.
// Mirrors the exact conventions established throughout this codebase
// (agentWithUniqueIp, createAdmin/createLeader, bootstrap) — see
// adminLocations.test.ts for the precedent this file follows.
const RUN = Math.random().toString(36).slice(2, 10);

const app = createApp();

let ipCounter = 9500;
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
  const email = `export-leader${n}-${RUN}@test.local`;
  const { user } = await createLeader(`Export Leader ${n}`, email, `EXP${n}${RUN}`);
  const person = await prisma.person.create({
    data: { name: `Export Leader Person ${n}`, whatsappNumber: `+237982${RUN}${String(n).padStart(3, '0')}`.slice(0, 16) },
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
async function makePerson(name: string, extra: { email?: string; locationCountry?: string } = {}) {
  personCounter += 1;
  return prisma.person.create({
    data: {
      name,
      whatsappNumber: `+23799${RUN.slice(0, 2)}${String(personCounter).padStart(6, '0')}`.slice(0, 18),
      email: extra.email ?? null,
      locationCountry: extra.locationCountry ?? null,
    },
  });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name: `${name} ${RUN}` } });
}

function parseCsv(body: string): { header: string[]; rows: string[][] } {
  const lines = body.split('\n').filter((l) => l.length > 0);
  const header = lines[0].split(',');
  const rows = lines.slice(1).map((l) => l.split(','));
  return { header, rows };
}

describe('GET /api/admin/export (Registrations) — existing behavior preserved', () => {
  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/admin/export');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Admin (Leader) session', async () => {
    const community = await makeCommunity('Reg Export Auth Community');
    const { agent } = await setupCommunityLeader(1, community.id);
    const res = await agent.get('/api/admin/export');
    expect(res.status).toBe(403);
  });

  it('an authenticated Admin still receives the CSV with unchanged fields', async () => {
    const { agent } = await loginAsAdmin(`admin-reg-export-${RUN}@test.local`);
    const res = await agent.get('/api/admin/export?includeTestData=true');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="registrations.csv"');
    const { header } = parseCsv(res.text);
    expect(header).toEqual(['id', 'name', 'whatsapp', 'language', 'leader', 'utmSource', 'utmMedium', 'utmCampaign', 'createdAt']);
  });

  it('records an audit log entry for a successful export', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'REGISTRATIONS_EXPORTED' } });
    const { agent } = await loginAsAdmin(`admin-reg-export-audit-${RUN}@test.local`);
    const res = await agent.get('/api/admin/export?includeTestData=true');
    expect(res.status).toBe(200);
    const after = await prisma.auditLog.count({ where: { action: 'REGISTRATIONS_EXPORTED' } });
    expect(after).toBe(before + 1);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'REGISTRATIONS_EXPORTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect(entry!.targetType).toBe('Registration');
    expect((entry!.metadata as any).rowCount).toBeTypeOf('number');
  });
});

describe('GET /api/admin/communities/export — authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/admin/communities/export');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Admin (Leader) session', async () => {
    const community = await makeCommunity('Membership Export Auth Community');
    const { agent } = await setupCommunityLeader(2, community.id);
    const res = await agent.get('/api/admin/communities/export');
    expect(res.status).toBe(403);
  });

  it('an authenticated Admin can access the export', async () => {
    const { agent } = await loginAsAdmin(`admin-mem-export-auth-${RUN}@test.local`);
    const res = await agent.get('/api/admin/communities/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="community-memberships.csv"');
  });
});

describe('GET /api/admin/communities/export — content correctness', () => {
  it('exports one row per membership with the correct Person/Community/status/joinedAt fields', async () => {
    const community = await makeCommunity('Content Export Community');
    const person = await makePerson(`Content Export Person ${RUN}`);
    const membership = await prisma.communityMembership.create({
      data: { personId: person.id, communityId: community.id, status: 'ACTIVE' },
    });

    const { agent } = await loginAsAdmin(`admin-mem-export-content-${RUN}@test.local`);
    const res = await agent.get('/api/admin/communities/export');
    expect(res.status).toBe(200);

    const { header, rows } = parseCsv(res.text);
    expect(header).toEqual(['personName', 'personId', 'communityName', 'communityId', 'status', 'joinedAt']);

    const row = rows.find((r) => r.includes(person.id));
    expect(row).toBeTruthy();
    expect(row![0]).toBe(JSON.stringify(person.name));
    expect(row![1]).toBe(person.id);
    expect(row![2]).toBe(JSON.stringify(community.name));
    expect(row![3]).toBe(community.id);
    expect(row![4]).toBe('ACTIVE');
    expect(row![5]).toBe(membership.joinedAt.toISOString());
  });

  it('exports an INACTIVE membership with its correct status', async () => {
    const community = await makeCommunity('Inactive Export Community');
    const person = await makePerson(`Inactive Export Person ${RUN}`);
    await prisma.communityMembership.create({
      data: { personId: person.id, communityId: community.id, status: 'INACTIVE' },
    });

    const { agent } = await loginAsAdmin(`admin-mem-export-inactive-${RUN}@test.local`);
    const res = await agent.get('/api/admin/communities/export');
    const { rows } = parseCsv(res.text);
    const row = rows.find((r) => r.includes(person.id));
    expect(row![4]).toBe('INACTIVE');
  });

  it('never exposes WhatsApp, email, or location fields', async () => {
    const community = await makeCommunity('Privacy Export Community');
    const person = await makePerson(`Privacy Export Person ${RUN}`, {
      email: 'should-never-leak@example.com',
      locationCountry: 'ShouldNeverLeakCountry',
    });
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id, status: 'ACTIVE' } });

    const { agent } = await loginAsAdmin(`admin-mem-export-privacy-${RUN}@test.local`);
    const res = await agent.get('/api/admin/communities/export');
    expect(res.text).not.toMatch(/should-never-leak/i);
    expect(res.text).not.toMatch(person.whatsappNumber);
    expect(res.text).not.toMatch(/ShouldNeverLeakCountry/);
  });

  it('records an audit log entry for a successful export without storing exported personal data', async () => {
    const community = await makeCommunity('Audit Export Community');
    const person = await makePerson(`Audit Export Person ${RUN}`);
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id, status: 'ACTIVE' } });

    const before = await prisma.auditLog.count({ where: { action: 'COMMUNITY_MEMBERSHIPS_EXPORTED' } });
    const { agent } = await loginAsAdmin(`admin-mem-export-audit-${RUN}@test.local`);
    const res = await agent.get('/api/admin/communities/export');
    expect(res.status).toBe(200);

    const after = await prisma.auditLog.count({ where: { action: 'COMMUNITY_MEMBERSHIPS_EXPORTED' } });
    expect(after).toBe(before + 1);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'COMMUNITY_MEMBERSHIPS_EXPORTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect(entry!.targetType).toBe('CommunityMembership');
    expect((entry!.metadata as any).rowCount).toBeTypeOf('number');
    const metadataSerialized = JSON.stringify(entry!.metadata);
    expect(metadataSerialized).not.toContain(person.id);
    expect(metadataSerialized).not.toContain(person.name);
    expect(metadataSerialized).not.toContain(community.id);
  });

  it('performs no write to CommunityMembership, Person, or Community', async () => {
    const membershipsBefore = await prisma.communityMembership.count();
    const personsBefore = await prisma.person.count();
    const communitiesBefore = await prisma.community.count();

    const { agent } = await loginAsAdmin(`admin-mem-export-nowrite-${RUN}@test.local`);
    await agent.get('/api/admin/communities/export');

    expect(await prisma.communityMembership.count()).toBe(membershipsBefore);
    expect(await prisma.person.count()).toBe(personsBefore);
    expect(await prisma.community.count()).toBe(communitiesBefore);
  });
});
