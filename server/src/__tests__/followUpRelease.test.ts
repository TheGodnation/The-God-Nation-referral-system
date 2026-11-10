import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { myLeaderOf } from '../lib/leaderIntro';
import { bootstrap } from './testUtils';

// "Take back everyone a leader follows": undoes a mistaken or test assignment. Nothing is deleted.
const app = createApp();
let n = 0;
const PASSWORD = 'GoodPass123!';

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.201.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
const person = (name: string) => prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378300${String(n).padStart(5, '0')}` } });

describe('Taking back everyone a leader follows', () => {
  it('closes that leader\'s follow-ups in that assembly only, deletes nobody, and frees the people to be assigned again', async () => {
    const admin = await prisma.user.create({ data: { name: 'Release Admin', email: `rel-${++n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN' } });
    const agent = agentWithIp();
    const { csrf } = await bootstrap(agent as any);
    expect((await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: admin.email, password: PASSWORD })).status).toBe(200);

    const here = await prisma.community.create({ data: { name: `RelHere ${++n}` } });
    const elsewhere = await prisma.community.create({ data: { name: `RelElsewhere ${++n}` } });
    const leader = await person('Test Leader');
    const other = await person('Other Leader');
    const people = [await person('P1'), await person('P2'), await person('P3')];
    const assign = (followerId: string, followedPersonId: string, contextId: string) =>
      prisma.followUpAssignment.create({ data: { followerId, followedPersonId, contextType: 'COMMUNITY', contextId, assignedByUserId: admin.id, introducedAt: new Date() } });
    for (const p of people) await assign(leader.id, p.id, here.id);
    const elsewhereOne = await assign(leader.id, (await person('Far')).id, elsewhere.id);
    const othersOne = await assign(other.id, (await person('Theirs')).id, here.id);
    expect((await myLeaderOf(people[0].id))?.personId).toBe(leader.id);

    const res = await agent.post('/api/admin/cells/release').set('X-CSRF-Token', csrf).send({ fromLeaderPersonId: leader.id, communityId: here.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: 3 });

    const closed = await prisma.followUpAssignment.findMany({ where: { followerId: leader.id, contextId: here.id } });
    expect(closed).toHaveLength(3);
    expect(closed.every((a) => a.status === 'CLOSED' && a.closeReason === 'Taken back by the central admin' && a.closedByUserId === admin.id)).toBe(true);
    // Not in another assembly, not another leader's people, and nobody was deleted.
    expect((await prisma.followUpAssignment.findUniqueOrThrow({ where: { id: elsewhereOne.id } })).status).toBe('ACTIVE');
    expect((await prisma.followUpAssignment.findUniqueOrThrow({ where: { id: othersOne.id } })).status).toBe('ACTIVE');
    expect(await prisma.person.count({ where: { id: { in: people.map((p) => p.id) } } })).toBe(3);
    // The people no longer show that leader as theirs.
    expect(await myLeaderOf(people[0].id)).toBeNull();
    // Pressing it again changes nothing.
    expect((await agent.post('/api/admin/cells/release').set('X-CSRF-Token', csrf).send({ fromLeaderPersonId: leader.id, communityId: here.id })).body).toEqual({ released: 0 });
    // It is recorded.
    expect(await prisma.auditLog.count({ where: { action: 'FOLLOW_UP_CLOSED', targetId: here.id } })).toBeGreaterThanOrEqual(1);
    expect((await agent.post('/api/admin/cells/release').set('X-CSRF-Token', csrf).send({})).status).toBe(400);
  });

  it('is for the central admin only', async () => {
    const agent = agentWithIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/admin/cells/release').set('X-CSRF-Token', csrf).send({ fromLeaderPersonId: 'x', communityId: 'y' });
    expect([401, 403]).toContain(res.status);
  });
});
