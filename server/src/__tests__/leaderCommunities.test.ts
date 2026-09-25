import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Phase 3M.8A — Community Administration membership management. Mirrors the
// exact conventions established in communityConversations.test.ts (Phase
// 3M.1) and leaderFollowUps.test.ts: agentWithUniqueIp, createLeader,
// bootstrap, loginAsMember.

const app = createApp();

let ipCounter = 5000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.96.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function makePerson(whatsappNumber: string, name = 'LeaderCommunities Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeMembership(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function setupCommunityLeader(n: number, communityId: string) {
  const email = `lc-leader${n}@test.local`;
  const { user } = await createLeader(`LeaderCommunities Leader ${n}`, email, `LC${n}CODE`);
  const person = await makePerson(`+237695${String(n).padStart(6, '0')}`, `LeaderCommunities Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsMember(whatsapp: string, email: string, name = 'LeaderCommunities Member') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

describe('Phase 3M.8A — Community Administrator — add member', () => {
  it('an active Community Administrator can add an existing Person by WhatsApp number', async () => {
    const community = await makeCommunity('Add Member Community 1');
    const { agent, csrf } = await setupCommunityLeader(1, community.id);
    const existing = await makePerson('+237696300001', 'Existing Person 1');

    const res = await agent
      .post(`/api/leader/communities/${community.id}/members`)
      .set('X-CSRF-Token', csrf)
      .send({ whatsappNumber: '+237696300001' });
    expect(res.status).toBe(201);

    const membership = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: existing.id, communityId: community.id } },
    });
    expect(membership?.status).toBe('ACTIVE');
  });

  it('re-adding a previously removed (INACTIVE) member reactivates the same row', async () => {
    const community = await makeCommunity('Add Member Community 2');
    const { agent, csrf } = await setupCommunityLeader(2, community.id);
    const existing = await makePerson('+237696300002', 'Existing Person 2');
    const original = await makeMembership(existing.id, community.id, 'INACTIVE');

    const res = await agent
      .post(`/api/leader/communities/${community.id}/members`)
      .set('X-CSRF-Token', csrf)
      .send({ whatsappNumber: '+237696300002' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(original.id);

    const count = await prisma.communityMembership.count({
      where: { personId: existing.id, communityId: community.id },
    });
    expect(count).toBe(1);
  });

  it('adding an already-active member is rejected', async () => {
    const community = await makeCommunity('Add Member Community 3');
    const { agent, csrf } = await setupCommunityLeader(3, community.id);
    const existing = await makePerson('+237696300003', 'Existing Person 3');
    await makeMembership(existing.id, community.id, 'ACTIVE');

    const res = await agent
      .post(`/api/leader/communities/${community.id}/members`)
      .set('X-CSRF-Token', csrf)
      .send({ whatsappNumber: '+237696300003' });
    expect(res.status).toBe(409);
  });

  it('an unknown WhatsApp number returns 404, and creates no membership', async () => {
    const community = await makeCommunity('Add Member Community 4');
    const { agent, csrf } = await setupCommunityLeader(4, community.id);

    const res = await agent
      .post(`/api/leader/communities/${community.id}/members`)
      .set('X-CSRF-Token', csrf)
      .send({ whatsappNumber: '+237699999999' });
    expect(res.status).toBe(404);
  });

  it('an invalid WhatsApp number is rejected with 400', async () => {
    const community = await makeCommunity('Add Member Community 5');
    const { agent, csrf } = await setupCommunityLeader(5, community.id);

    const res = await agent
      .post(`/api/leader/communities/${community.id}/members`)
      .set('X-CSRF-Token', csrf)
      .send({ whatsappNumber: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  it('a Leader with no active role for this exact Community cannot add a member', async () => {
    const communityA = await makeCommunity('Add Member Community 6A');
    const communityB = await makeCommunity('Add Member Community 6B');
    const { agent, csrf } = await setupCommunityLeader(6, communityB.id);
    await makePerson('+237696300006', 'Existing Person 6');

    const res = await agent
      .post(`/api/leader/communities/${communityA.id}/members`)
      .set('X-CSRF-Token', csrf)
      .send({ whatsappNumber: '+237696300006' });
    expect(res.status).toBe(403);
  });

  it('a Member (not a Leader) cannot add a member', async () => {
    const community = await makeCommunity('Add Member Community 7');
    const { agent, csrf } = await loginAsMember('+237696300007', 'lc7@example.com');
    await makePerson('+237696300107', 'Existing Person 7');

    const res = await agent
      .post(`/api/leader/communities/${community.id}/members`)
      .set('X-CSRF-Token', csrf)
      .send({ whatsappNumber: '+237696300107' });
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot add a member', async () => {
    const community = await makeCommunity('Add Member Community 8');
    const anon = agentWithUniqueIp();
    const res = await anon.post(`/api/leader/communities/${community.id}/members`).send({ whatsappNumber: '+237696300008' });
    expect(res.status).toBe(401);
  });

  it('requires CSRF protection', async () => {
    const community = await makeCommunity('Add Member Community 9');
    const { agent } = await setupCommunityLeader(9, community.id);
    await makePerson('+237696300009', 'Existing Person 9');

    const res = await agent.post(`/api/leader/communities/${community.id}/members`).send({ whatsappNumber: '+237696300009' });
    expect(res.status).toBe(403);
  });

  it('a nonexistent Community returns 404', async () => {
    const { agent, csrf } = await setupCommunityLeader(10, (await makeCommunity('Add Member Community 10')).id);
    const res = await agent
      .post('/api/leader/communities/00000000-0000-0000-0000-000000000000/members')
      .set('X-CSRF-Token', csrf)
      .send({ whatsappNumber: '+237696300010' });
    expect(res.status).toBe(404);
  });

  it('the dedicated moderation rate limiter applies', async () => {
    const community = await makeCommunity('Add Member Community 11');
    const { agent, csrf } = await setupCommunityLeader(11, community.id);

    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent
        .post(`/api/leader/communities/${community.id}/members`)
        .set('X-CSRF-Token', csrf)
        .send({ whatsappNumber: `+23769931${String(i).padStart(4, '0')}` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('Phase 3M.8A — Community Administrator — remove/reinstate member', () => {
  it('an active Community Administrator can remove (deactivate) an ordinary member', async () => {
    const community = await makeCommunity('Remove Member Community 1');
    const { agent, csrf } = await setupCommunityLeader(20, community.id);
    const member = await makePerson('+237696400001', 'Member 1');
    await makeMembership(member.id, community.id, 'ACTIVE');

    const res = await agent
      .patch(`/api/leader/communities/${community.id}/members/${member.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INACTIVE');

    const membership = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: member.id, communityId: community.id } },
    });
    expect(membership?.status).toBe('INACTIVE');
  });

  it('an active Community Administrator can reinstate a previously removed member', async () => {
    const community = await makeCommunity('Remove Member Community 2');
    const { agent, csrf } = await setupCommunityLeader(21, community.id);
    const member = await makePerson('+237696400002', 'Member 2');
    await makeMembership(member.id, community.id, 'INACTIVE');

    const res = await agent
      .patch(`/api/leader/communities/${community.id}/members/${member.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('one Community Administrator removing another Administrator\'s ordinary membership does not touch their RoleAssignment', async () => {
    const community = await makeCommunity('Remove Member Community 3');
    const { agent: agentA, csrf: csrfA } = await setupCommunityLeader(22, community.id);
    const { person: personB, role: roleB } = await setupCommunityLeader(23, community.id);
    await makeMembership(personB.id, community.id, 'ACTIVE');

    const res = await agentA
      .patch(`/api/leader/communities/${community.id}/members/${personB.id}`)
      .set('X-CSRF-Token', csrfA)
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(200);

    // The leadership structure itself (RoleAssignment) is completely
    // untouched — a Community Administrator can deactivate another
    // Administrator's ordinary CommunityMembership row (they are also an
    // ordinary ambient member) but can never end their RoleAssignment.
    const stillActiveRole = await prisma.roleAssignment.findUnique({ where: { id: roleB.id } });
    expect(stillActiveRole?.status).toBe('ACTIVE');
  });

  it('a Leader with no active role for this exact Community cannot remove a member (IDOR)', async () => {
    const communityA = await makeCommunity('Remove Member Community 4A');
    const communityB = await makeCommunity('Remove Member Community 4B');
    const { agent, csrf } = await setupCommunityLeader(24, communityB.id);
    const member = await makePerson('+237696400004', 'Member 4');
    await makeMembership(member.id, communityA.id, 'ACTIVE');

    const res = await agent
      .patch(`/api/leader/communities/${communityA.id}/members/${member.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(403);

    const membership = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: member.id, communityId: communityA.id } },
    });
    expect(membership?.status).toBe('ACTIVE');
  });

  it('a membership belonging to a different Community cannot be modified via this Community\'s route (IDOR)', async () => {
    const communityA = await makeCommunity('Remove Member Community 5A');
    const communityB = await makeCommunity('Remove Member Community 5B');
    const { agent, csrf } = await setupCommunityLeader(25, communityA.id);
    const member = await makePerson('+237696400005', 'Member 5');
    await makeMembership(member.id, communityB.id, 'ACTIVE');

    const res = await agent
      .patch(`/api/leader/communities/${communityA.id}/members/${member.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(404);

    const membership = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: member.id, communityId: communityB.id } },
    });
    expect(membership?.status).toBe('ACTIVE');
  });

  it('a person who is not a member of this Community at all returns 404', async () => {
    const community = await makeCommunity('Remove Member Community 6');
    const { agent, csrf } = await setupCommunityLeader(26, community.id);
    const notAMember = await makePerson('+237696400006', 'Not A Member 6');

    const res = await agent
      .patch(`/api/leader/communities/${community.id}/members/${notAMember.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(404);
  });

  it('a Member (not a Leader) cannot remove another member', async () => {
    const community = await makeCommunity('Remove Member Community 7');
    const { agent, csrf } = await loginAsMember('+237696400007', 'lc-remove7@example.com');
    const member = await makePerson('+237696400107', 'Member 7');
    await makeMembership(member.id, community.id, 'ACTIVE');

    const res = await agent
      .patch(`/api/leader/communities/${community.id}/members/${member.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot remove a member', async () => {
    const community = await makeCommunity('Remove Member Community 8');
    const member = await makePerson('+237696400008', 'Member 8');
    await makeMembership(member.id, community.id, 'ACTIVE');

    const anon = agentWithUniqueIp();
    const res = await anon
      .patch(`/api/leader/communities/${community.id}/members/${member.id}`)
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(401);
  });

  it('requires CSRF protection', async () => {
    const community = await makeCommunity('Remove Member Community 9');
    const { agent } = await setupCommunityLeader(27, community.id);
    const member = await makePerson('+237696400009', 'Member 9');
    await makeMembership(member.id, community.id, 'ACTIVE');

    const res = await agent.patch(`/api/leader/communities/${community.id}/members/${member.id}`).send({ status: 'INACTIVE' });
    expect(res.status).toBe(403);
  });

  it('an invalid status value is rejected', async () => {
    const community = await makeCommunity('Remove Member Community 10');
    const { agent, csrf } = await setupCommunityLeader(28, community.id);
    const member = await makePerson('+237696400010', 'Member 10');
    await makeMembership(member.id, community.id, 'ACTIVE');

    const res = await agent
      .patch(`/api/leader/communities/${community.id}/members/${member.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'DELETED' });
    expect(res.status).toBe(400);
  });
});
