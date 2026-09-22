import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
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

describe('Phase 3G — Community reparenting protections', () => {
  it('rejects a Community being set as its own parent', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg1@test.local');
    const node = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'CG Self Parent' });

    const res = await agent
      .patch(`/api/admin/communities/${node.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ parentId: node.body.id });
    expect(res.status).toBe(400);

    const unchanged = await prisma.community.findUnique({ where: { id: node.body.id } });
    expect(unchanged!.parentId).toBeNull();
  });

  it('rejects reparenting a Community into its own descendant', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg2@test.local');
    const grandparent = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'CG Grandparent' });
    const parent = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Parent', parentId: grandparent.body.id });
    const child = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Child', parentId: parent.body.id });

    // Attempt to make the grandparent a child of its own grandchild.
    const res = await agent
      .patch(`/api/admin/communities/${grandparent.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ parentId: child.body.id });
    expect(res.status).toBe(400);

    const unchanged = await prisma.community.findUnique({ where: { id: grandparent.body.id } });
    expect(unchanged!.parentId).toBeNull();
  });

  it('allows a valid reparent to an unrelated existing Community', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg3@test.local');
    const communityA = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'CG Valid A' });
    const communityB = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'CG Valid B' });

    const res = await agent
      .patch(`/api/admin/communities/${communityB.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ parentId: communityA.body.id });
    expect(res.status).toBe(200);
    expect(res.body.parentId).toBe(communityA.body.id);
  });
});

describe('Phase 3G — Geography reparenting protections', () => {
  it('rejects a Geography node being set as its own parent', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg4@test.local');
    const node = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Self Parent', type: 'COUNTRY', countryCode: 'CG' });

    const res = await agent
      .patch(`/api/admin/geography/${node.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ parentId: node.body.id });
    expect(res.status).toBe(400);

    const unchanged = await prisma.geography.findUnique({ where: { id: node.body.id } });
    expect(unchanged!.parentId).toBeNull();
  });

  it('rejects reparenting a Geography node into its own descendant', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg5@test.local');
    const country = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Country', type: 'COUNTRY', countryCode: 'CH' });
    const region = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Region', type: 'REGION', parentId: country.body.id });
    const division = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Division', type: 'DIVISION', parentId: region.body.id });

    const res = await agent
      .patch(`/api/admin/geography/${country.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ parentId: division.body.id });
    expect(res.status).toBe(400);

    const unchanged = await prisma.geography.findUnique({ where: { id: country.body.id } });
    expect(unchanged!.parentId).toBeNull();
  });

  it('allows a valid reparent to an unrelated existing Geography node', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg6@test.local');
    const countryA = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Valid A', type: 'COUNTRY', countryCode: 'VA' });
    const countryB = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Valid B', type: 'COUNTRY', countryCode: 'VB' });
    const region = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Valid Region', type: 'REGION', parentId: countryA.body.id });

    const res = await agent
      .patch(`/api/admin/geography/${region.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ parentId: countryB.body.id });
    expect(res.status).toBe(200);
    expect(res.body.parentId).toBe(countryB.body.id);
  });
});

describe('Phase 3G — Community/Geography audit events', () => {
  it('records COMMUNITY_CREATED on create', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg7@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'CG Audit Create' });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'COMMUNITY_CREATED', targetType: 'Community', targetId: created.body.id },
    });
    expect(audit).toBeTruthy();
  });

  it('records COMMUNITY_UPDATED on update', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg8@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'CG Audit Update' });
    await agent.patch(`/api/admin/communities/${created.body.id}`).set('X-CSRF-Token', csrf).send({ name: 'CG Audit Updated Name' });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'COMMUNITY_UPDATED', targetType: 'Community', targetId: created.body.id },
    });
    expect(audit).toBeTruthy();
  });

  it('records GEOGRAPHY_CREATED on create', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg9@test.local');
    const created = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Audit Create', type: 'COUNTRY', countryCode: 'AC' });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'GEOGRAPHY_CREATED', targetType: 'Geography', targetId: created.body.id },
    });
    expect(audit).toBeTruthy();
  });

  it('records GEOGRAPHY_UPDATED on update', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg10@test.local');
    const created = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Audit Update', type: 'COUNTRY', countryCode: 'AU' });
    await agent
      .patch(`/api/admin/geography/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CG Geo Audit Updated Name' });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'GEOGRAPHY_UPDATED', targetType: 'Geography', targetId: created.body.id },
    });
    expect(audit).toBeTruthy();
  });
});

describe('Phase 3G — dedicated rate limiting', () => {
  it('enforces communityGeographyMutationLimiter on Community mutations', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg11@test.local');

    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: `CG Rate Limit ${i}` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('enforces communityGeographyMutationLimiter on Geography mutations', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-cg12@test.local');

    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent
        .post('/api/admin/geography')
        .set('X-CSRF-Token', csrf)
        .send({ name: `CG Geo Rate Limit ${i}`, type: 'COUNTRY', countryCode: 'R' + (i % 10) });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('Phase 3G — existing authorization/CSRF boundaries remain intact', () => {
  it('rejects an unauthenticated Community mutation', async () => {
    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);
    const res = await anon.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('rejects a Leader session on a Community mutation', async () => {
    await createLeader('CG Leader', 'leader-cg@test.local', 'CGLEADER1');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-cg@test.local', password: 'password123' });

    const res = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('rejects a Community mutation missing CSRF token', async () => {
    const { agent } = await loginAsAdmin('admin-cg13@test.local');
    const res = await agent.post('/api/admin/communities').send({ name: 'No CSRF' });
    expect(res.status).toBe(403);
  });

  it('rejects a Geography mutation missing CSRF token', async () => {
    const { agent } = await loginAsAdmin('admin-cg14@test.local');
    const res = await agent.post('/api/admin/geography').send({ name: 'No CSRF', type: 'COUNTRY', countryCode: 'NC' });
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated Geography mutation', async () => {
    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);
    const res = await anon
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Nope', type: 'COUNTRY', countryCode: 'XX' });
    expect(res.status).toBe(401);
  });

  it('rejects a Leader session on a Geography mutation', async () => {
    await createLeader('CG Geo Leader', 'leader-cg-geo@test.local', 'CGGEOLEADER1');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-cg-geo@test.local', password: 'password123' });

    const res = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Nope', type: 'COUNTRY', countryCode: 'XX' });
    expect(res.status).toBe(403);
  });
});
