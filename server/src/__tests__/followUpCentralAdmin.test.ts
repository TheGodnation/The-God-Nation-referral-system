import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';
import { shareWithLeader, shareUnassigned, unassignedMembers } from '../lib/followUpShare';
import { introducePendingAssignments, myLeaderOf } from '../lib/leaderIntro';

// The central admin follows up the leaders; leaders never follow up the central admin.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.211.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
const person = (name: string) => prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378400${String(n).padStart(5, '0')}` } });

async function world() {
  const adminPerson = await person('Founder');
  const adminUser = await prisma.user.create({ data: { name: 'Founder', email: `ca-${++n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', personId: adminPerson.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  expect((await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: adminUser.email, password: PASSWORD })).status).toBe(200);
  const community = await prisma.community.create({ data: { name: `CaHQ ${++n}`, autoPlacementEligible: false } });
  const leaderA = await person('Leader A');
  const leaderB = await person('Leader B');
  for (const l of [leaderA, leaderB]) {
    await prisma.roleAssignment.create({ data: { personId: l.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: adminUser.id } });
    await prisma.communityMembership.create({ data: { personId: l.id, communityId: community.id } });
  }
  await prisma.communityMembership.create({ data: { personId: adminPerson.id, communityId: community.id } });
  const members = [await person('M1'), await person('M2'), await person('M3'), await person('M4')];
  for (const m of members) await prisma.communityMembership.create({ data: { personId: m.id, communityId: community.id } });
  return { adminPerson, adminUser, agent, csrf, community, leaderA, leaderB, members };
}

describe('Nobody follows up the central admin', () => {
  it('the admin\'s own way of adding a follow-up refuses the central admin, and still works for an ordinary member', async () => {
    const w = await world();
    const refused = await w.agent.post('/api/admin/follow-ups').set('X-CSRF-Token', w.csrf).send({ followerId: w.leaderA.id, followedPersonId: w.adminPerson.id, contextType: 'COMMUNITY', contextId: w.community.id });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('CENTRAL_ADMIN_NOT_FOLLOWED');
    const ok = await w.agent.post('/api/admin/follow-ups').set('X-CSRF-Token', w.csrf).send({ followerId: w.leaderA.id, followedPersonId: w.members[0].id, contextType: 'COMMUNITY', contextId: w.community.id });
    expect(ok.status).toBe(201);
  });

  it('splitting between leaders leaves the central admin out', async () => {
    const w = await world();
    const res = await w.agent.post('/api/admin/follow-ups/bulk-distribute').set('X-CSRF-Token', w.csrf).send({ followerPersonIds: [w.leaderA.id, w.leaderB.id], contextType: 'COMMUNITY', contextId: w.community.id });
    expect(res.status).toBe(201);
    const followed = (await prisma.followUpAssignment.findMany({ where: { contextId: w.community.id, status: 'ACTIVE' } })).map((a) => a.followedPersonId);
    expect(followed).not.toContain(w.adminPerson.id);
    expect(followed.sort()).toEqual(w.members.map((m) => m.id).sort());
  });

  it('the "Assign people" tool and sharing a person leave the central admin out too', async () => {
    const w = await world();
    expect((await unassignedMembers(w.community.id)).map((p) => p.id)).not.toContain(w.adminPerson.id);
    await shareUnassigned(w.community.id, w.adminUser.id, { leaderPersonIds: [w.leaderA.id] });
    expect(await prisma.followUpAssignment.count({ where: { followedPersonId: w.adminPerson.id } })).toBe(0);
    expect(await shareWithLeader({ personId: w.adminPerson.id, toLeaderId: w.leaderB.id, communityId: w.community.id, actorUserId: w.adminUser.id })).toEqual({ created: false });
    expect(await prisma.followUpAssignment.count({ where: { followedPersonId: w.adminPerson.id } })).toBe(0);
  });

  it('even if one slips through, the central admin is never told about a leader and sees no "Your leader" card', async () => {
    const w = await world();
    await prisma.followUpAssignment.create({ data: { followerId: w.leaderA.id, followedPersonId: w.adminPerson.id, contextType: 'COMMUNITY', contextId: w.community.id, assignedByUserId: w.adminUser.id } });
    expect(await introducePendingAssignments(w.leaderA.id)).toBe(0);
    expect(await prisma.privateMessage.count({ where: { senderPersonId: w.leaderA.id, conversation: { memberPersonId: w.adminPerson.id } } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientPersonId: w.adminPerson.id, type: 'LEADER_ASSIGNED' } })).toBe(0);
    await prisma.followUpAssignment.updateMany({ where: { followedPersonId: w.adminPerson.id }, data: { introducedAt: new Date() } });
    expect(await myLeaderOf(w.adminPerson.id)).toBeNull();
  });

  it('the migration closes any follow-up of the central admin that already exists, and touches nothing else', async () => {
    const w = await world();
    const ofAdmin = await prisma.followUpAssignment.create({ data: { followerId: w.leaderA.id, followedPersonId: w.adminPerson.id, contextType: 'COMMUNITY', contextId: w.community.id, assignedByUserId: w.adminUser.id } });
    const ofMember = await prisma.followUpAssignment.create({ data: { followerId: w.leaderA.id, followedPersonId: w.members[0].id, contextType: 'COMMUNITY', contextId: w.community.id, assignedByUserId: w.adminUser.id } });
    const sql = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261223090000_central_admin_not_followed/migration.sql'), 'utf8');
    await prisma.$executeRawUnsafe(sql);
    const a = await prisma.followUpAssignment.findUniqueOrThrow({ where: { id: ofAdmin.id } });
    expect(a.status).toBe('CLOSED');
    expect(a.closeReason).toBe('The central admin is not followed up by leaders');
    expect((await prisma.followUpAssignment.findUniqueOrThrow({ where: { id: ofMember.id } })).status).toBe('ACTIVE');
    expect(await prisma.person.findUnique({ where: { id: w.adminPerson.id } })).not.toBeNull();
  });
});
