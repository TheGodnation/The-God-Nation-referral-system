import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';
import { shareWithLeader, unassignedMembers } from '../lib/followUpShare';
import { makeLeaders } from '../lib/cells';

// Leaders are followed up only by the central admin and the generation representatives, never by other leaders.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.221.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
const person = (name: string) => prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378500${String(n).padStart(5, '0')}` } });

async function world() {
  const adminPerson = await person('Founder');
  const adminUser = await prisma.user.create({ data: { name: 'Founder', email: `fl-${++n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', personId: adminPerson.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  expect((await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: adminUser.email, password: PASSWORD })).status).toBe(200);
  const hq = await prisma.community.create({ data: { name: `FlHQ ${++n}`, autoPlacementEligible: false } });
  const other = await prisma.community.create({ data: { name: `FlOther ${++n}`, parentId: hq.id, autoPlacementEligible: false } });
  const leaderA = await person('Leader A');
  const leaderB = await person('Leader B (leads elsewhere)');
  const rep = await person('Representative');
  const member = await person('Member');
  await prisma.roleAssignment.create({ data: { personId: leaderA.id, roleType: 'SCOPED_LEADER', communityId: hq.id, assignedByUserId: adminUser.id } });
  await prisma.roleAssignment.create({ data: { personId: leaderB.id, roleType: 'SCOPED_LEADER', communityId: other.id, assignedByUserId: adminUser.id } });
  await prisma.generationRepresentative.create({ data: { personId: rep.id, generation: 1 } });
  for (const p of [leaderA, leaderB, rep, member]) await prisma.communityMembership.create({ data: { personId: p.id, communityId: hq.id } });
  const body = (followerId: string, followedPersonId: string) => ({ followerId, followedPersonId, contextType: 'COMMUNITY', contextId: hq.id });
  return { adminPerson, adminUser, agent, csrf, hq, other, leaderA, leaderB, rep, member, body };
}

describe('Leaders are followed up only by the central admin and the representatives', () => {
  it('the admin\'s way of adding a follow-up refuses a leader following a leader, and allows the central admin or a representative', async () => {
    const w = await world();
    const post = (followerId: string, followedId: string) => w.agent.post('/api/admin/follow-ups').set('X-CSRF-Token', w.csrf).send(w.body(followerId, followedId));
    const refused = await post(w.leaderA.id, w.leaderB.id);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('LEADER_NOT_FOLLOWED_BY_LEADERS');
    expect((await post(w.rep.id, w.leaderB.id)).status).toBe(201);
    expect((await post(w.adminPerson.id, w.leaderA.id)).status).toBe(201);
    // Members are followed up by leaders as before.
    expect((await post(w.leaderA.id, w.member.id)).status).toBe(201);
  });

  it('the automatic tools never hand a leader to a leader, wherever they lead', async () => {
    const w = await world();
    const pool = (await unassignedMembers(w.hq.id)).map((p) => p.id);
    expect(pool).toContain(w.member.id);
    expect(pool).not.toContain(w.leaderB.id); // leads another assembly, still a leader
    expect(pool).not.toContain(w.leaderA.id);
    expect(await shareWithLeader({ personId: w.leaderB.id, toLeaderId: w.leaderA.id, communityId: w.hq.id, actorUserId: w.adminUser.id })).toEqual({ created: false });
    expect(await shareWithLeader({ personId: w.leaderB.id, toLeaderId: w.rep.id, communityId: w.hq.id, actorUserId: w.adminUser.id })).toEqual({ created: true });
  });

  it('someone who becomes a leader stops being followed by other leaders, but not by the central admin or a representative', async () => {
    const w = await world();
    const newLeader = await person('New Leader');
    const ordinary = await person('Ordinary Leader');
    await prisma.roleAssignment.create({ data: { personId: ordinary.id, roleType: 'SCOPED_LEADER', communityId: w.hq.id, assignedByUserId: w.adminUser.id } });
    const make = (followerId: string) => prisma.followUpAssignment.create({ data: { followerId, followedPersonId: newLeader.id, contextType: 'COMMUNITY', contextId: w.hq.id, assignedByUserId: w.adminUser.id } });
    const byOrdinary = await make(ordinary.id);
    const byRep = await make(w.rep.id);
    const byAdmin = await make(w.adminPerson.id);
    await makeLeaders(w.hq.id, [newLeader.id], { id: w.adminUser.id, email: w.adminUser.email });
    const status = async (id: string) => (await prisma.followUpAssignment.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(byOrdinary.id)).toBe('CLOSED');
    expect(await status(byRep.id)).toBe('ACTIVE');
    expect(await status(byAdmin.id)).toBe('ACTIVE');
  });

  it('the migration closes existing follow-ups of leaders by ordinary leaders, and keeps the others', async () => {
    const w = await world();
    const make = (followerId: string, followedPersonId: string) => prisma.followUpAssignment.create({ data: { followerId, followedPersonId, contextType: 'COMMUNITY', contextId: w.hq.id, assignedByUserId: w.adminUser.id } });
    const leaderByLeader = await make(w.leaderA.id, w.leaderB.id);
    const leaderByRep = await make(w.rep.id, w.leaderB.id);
    const memberByLeader = await make(w.leaderA.id, w.member.id);
    const sql = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261224090000_leaders_followed_by_admin_and_reps/migration.sql'), 'utf8');
    await prisma.$executeRawUnsafe(sql);
    const status = async (id: string) => (await prisma.followUpAssignment.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(leaderByLeader.id)).toBe('CLOSED');
    expect(await status(leaderByRep.id)).toBe('ACTIVE');
    expect(await status(memberByLeader.id)).toBe('ACTIVE');
  });
});
