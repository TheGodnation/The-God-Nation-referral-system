import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// "Add many people": pick by generation, tick who goes, add to an assembly in one go.
const app = createApp();
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.141.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

async function admin() {
  n += 1;
  const email = `bulk-admin-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

async function member(name: string, withAccount = true) {
  n += 1;
  const p = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376700${String(n).padStart(5, '0')}` } });
  if (withAccount) await prisma.memberAccount.create({ data: { personId: p.id, email: `bulk${n}@example.com`, passwordHash: await bcrypt.hash('x', 4) } });
  return p;
}

async function assembly(name: string, parentId?: string) {
  const c = await prisma.community.create({ data: { name: `${name} ${++n}`, parentId: parentId ?? null } });
  await prisma.conversation.create({ data: { communityId: c.id } });
  return c;
}

const join = (personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
  prisma.communityMembership.create({ data: { personId, communityId, status } });

async function withHeadquarters<T>(hqId: string, run: () => Promise<T>) {
  const before = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hqId }, create: { id: 'singleton', headquartersCommunityId: hqId } as any });
  try {
    return await run();
  } finally {
    await prisma.settings.update({ where: { id: 'singleton' }, data: { headquartersCommunityId: before?.headquartersCommunityId ?? null } });
  }
}

describe('Add many people — choosing by generation', () => {
  it('lists only the people of the chosen generation, searchable, with Select all ids', async () => {
    const { agent } = await admin();
    const hq = await assembly('BulkHQ');
    const g1a = await assembly('BulkG1a', hq.id);
    const g1b = await assembly('BulkG1b', hq.id);
    const g2 = await assembly('BulkG2', g1a.id);
    const a = await member('Ada Gen1');
    const b = await member('Bea Gen1');
    const c = await member('Cy Gen2');
    await join(a.id, g1a.id);
    await join(b.id, g1b.id);
    await join(c.id, g2.id);
    await join(c.id, hq.id, 'INACTIVE'); // left HQ: does not count there

    await withHeadquarters(hq.id, async () => {
      const gens = await agent.get('/api/admin/bulk-members/generations');
      expect(gens.status).toBe(200);
      expect(gens.body.generations.map((g: any) => g.generation)).toEqual([0, 1, 2]);
      expect(gens.body.generations[1]).toMatchObject({ assemblies: 2, people: 2 });

      const list = await agent.get('/api/admin/bulk-members/people?source=gen:1');
      expect(list.body.items.map((p: any) => p.id).sort()).toEqual([a.id, b.id].sort());
      expect(list.body.total).toBe(2);

      const searched = await agent.get('/api/admin/bulk-members/people?source=gen:1&search=Ada');
      expect(searched.body.items.map((p: any) => p.id)).toEqual([a.id]);

      const ids = await agent.get('/api/admin/bulk-members/ids?source=gen:2');
      expect(ids.body).toEqual({ ids: [c.id], capped: false });
    });
  });

  it('lists members who have no assembly yet', async () => {
    const { agent } = await admin();
    const lonely = await member('Lonely One');
    const placed = await member('Placed One');
    const hq = await assembly('BulkNoneHQ');
    await join(placed.id, hq.id);
    const res = await agent.get(`/api/admin/bulk-members/people?source=none&search=${encodeURIComponent('Lonely One')}`);
    expect(res.body.items.map((p: any) => p.id)).toEqual([lonely.id]);
    const res2 = await agent.get(`/api/admin/bulk-members/people?source=none&search=${encodeURIComponent('Placed One')}`);
    expect(res2.body.items).toEqual([]);
  });

  it('refuses a bad source', async () => {
    const { agent } = await admin();
    expect((await agent.get('/api/admin/bulk-members/people?source=whatever')).status).toBe(400);
  });
});

describe('Add many people — adding', () => {
  it('adds to an existing assembly, counts who was already in, brings back anyone who had left, and notifies once each', async () => {
    const { agent, csrf } = await admin();
    const dest = await assembly('BulkDest');
    const fresh = await member('Fresh');
    const already = await member('Already');
    const returning = await member('Returning');
    await join(already.id, dest.id);
    await join(returning.id, dest.id, 'INACTIVE');

    const res = await agent.post('/api/admin/bulk-members/add').set('X-CSRF-Token', csrf).send({ personIds: [fresh.id, already.id, returning.id], destinationId: dest.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ added: 2, alreadyIn: 1, removed: 0, created: false });
    const rows = await prisma.communityMembership.findMany({ where: { communityId: dest.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'ACTIVE')).toBe(true);
    expect(await prisma.notification.count({ where: { type: 'ADDED_TO_ASSEMBLY', targetId: dest.id } })).toBe(2);
    expect(await prisma.auditLog.findFirst({ where: { action: 'COMMUNITY_MEMBERS_BULK_ADDED', targetId: dest.id } })).toBeTruthy();
    // Adding again changes nothing and notifies nobody new.
    const again = await agent.post('/api/admin/bulk-members/add').set('X-CSRF-Token', csrf).send({ personIds: [fresh.id], destinationId: dest.id });
    expect(again.body).toMatchObject({ added: 0, alreadyIn: 1 });
    expect(await prisma.notification.count({ where: { type: 'ADDED_TO_ASSEMBLY', targetId: dest.id } })).toBe(2);
  });

  it('creates a new assembly (with its chat) under a parent and can take people out of the old generation', async () => {
    const { agent, csrf } = await admin();
    const hq = await assembly('BulkNewHQ');
    const g1 = await assembly('BulkOld', hq.id);
    const p1 = await member('Mover');
    await join(p1.id, g1.id);
    const other = await assembly('BulkStays', hq.id);
    await join(p1.id, other.id);

    await withHeadquarters(hq.id, async () => {
      const res = await agent
        .post('/api/admin/bulk-members/add')
        .set('X-CSRF-Token', csrf)
        .send({ personIds: [p1.id], newAssembly: { name: 'Brand New Assembly', parentId: g1.id }, removeFromSource: 'gen:1' });
      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
      expect(res.body.removed).toBe(2);
      const created = await prisma.community.findUnique({ where: { id: res.body.destination.id }, include: { conversation: true } });
      // Under the first generation-1 assembly (the Headquarters already has its two assemblies).
      expect(created?.parentId).toBe(g1.id);
      expect(created?.conversation).toBeTruthy();
      const active = await prisma.communityMembership.findMany({ where: { personId: p1.id, status: 'ACTIVE' } });
      expect(active.map((m) => m.communityId)).toEqual([created!.id]);
    });
  });

  it('will not make a third assembly under an assembly that already has two', async () => {
    const { agent, csrf } = await admin();
    const hq = await assembly('BulkFullHQ');
    await assembly('BulkFullA', hq.id);
    await assembly('BulkFullB', hq.id);
    const p1 = await member('NoRoom');
    await withHeadquarters(hq.id, async () => {
      const res = await agent
        .post('/api/admin/bulk-members/add')
        .set('X-CSRF-Token', csrf)
        .send({ personIds: [p1.id], newAssembly: { name: 'Third Assembly', parentId: hq.id } });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already has its 2 assemblies/);
    });
  });

  it('validates the request', async () => {
    const { agent, csrf } = await admin();
    const dest = await assembly('BulkValid');
    const p = await member('Someone');
    const post = (body: any) => agent.post('/api/admin/bulk-members/add').set('X-CSRF-Token', csrf).send(body);
    expect((await post({ personIds: [], destinationId: dest.id })).status).toBe(400);
    expect((await post({ personIds: [p.id] })).status).toBe(400);
    expect((await post({ personIds: [p.id], destinationId: dest.id, newAssembly: { name: 'x' } })).status).toBe(400);
    expect((await post({ personIds: [p.id], destinationId: 'nope' })).status).toBe(404);
  });

  it('is for the central admin only', async () => {
    const anon = agentWithIp();
    expect((await anon.get('/api/admin/bulk-members/generations')).status).toBe(401);
    expect((await anon.get('/api/member/central-bulk-members/generations')).status).toBe(401);
  });
});

describe('Deleting an assembly — where its members go', () => {
  it('moves the members to the chosen assembly before deleting', async () => {
    const { agent, csrf } = await admin();
    const parent = await assembly('DelParent');
    const doomed = await assembly('DelDoomed', parent.id);
    const m1 = await member('Stays One');
    const m2 = await member('Stays Two');
    await join(m1.id, doomed.id);
    await join(m2.id, doomed.id);
    await join(m2.id, parent.id);

    const res = await agent.delete(`/api/admin/communities/${doomed.id}`).set('X-CSRF-Token', csrf).send({ confirmName: doomed.name, moveMembersTo: parent.id });
    expect(res.status).toBe(200);
    expect(res.body.membersMoved).toMatchObject({ added: 1, alreadyIn: 1 });
    expect(await prisma.community.findUnique({ where: { id: doomed.id } })).toBeNull();
    const inParent = await prisma.communityMembership.findMany({ where: { communityId: parent.id, status: 'ACTIVE' } });
    expect(inParent.map((m) => m.personId).sort()).toEqual([m1.id, m2.id].sort());
  });

  it('refuses a missing destination without deleting anything', async () => {
    const { agent, csrf } = await admin();
    const doomed = await assembly('DelKept');
    const res = await agent.delete(`/api/admin/communities/${doomed.id}`).set('X-CSRF-Token', csrf).send({ confirmName: doomed.name, moveMembersTo: 'does-not-exist' });
    expect(res.status).toBe(400);
    expect(await prisma.community.findUnique({ where: { id: doomed.id } })).toBeTruthy();
  });
});
