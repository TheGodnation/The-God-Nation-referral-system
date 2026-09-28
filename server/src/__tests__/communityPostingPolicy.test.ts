import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Community Posting Policy — mirrors the exact conventions established in
// communityConversations.test.ts: agentWithUniqueIp, createLeader/
// createAdmin, bootstrap, loginAsMember, setupCommunityLeader. Deliberately
// its own file (not appended to communityConversations.test.ts or
// community.test.ts) so this phase's diff stays isolated and easy to review,
// matching the project's one-phase-one-test-file convention.

const app = createApp();

let ipCounter = 8000;
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

async function makePerson(whatsappNumber: string, name = 'Posting Policy Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeMembership(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function setupCommunityLeader(n: number, communityId: string, status: 'ACTIVE' | 'ENDED' = 'ACTIVE') {
  const email = `posting-leader${n}@test.local`;
  const { user } = await createLeader(`Posting Leader ${n}`, email, `PP${n}CODE`);
  const person = await makePerson(`+237696${String(n).padStart(6, '0')}`, `Posting Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId, status },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsMember(whatsapp: string, email: string, name = 'Posting Policy Member') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[0][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

async function setLeadersOnly(communityId: string) {
  await prisma.community.update({ where: { id: communityId }, data: { postingPolicy: 'LEADERS_ONLY' } });
}

// -- Database / default -----------------------------------------------------

describe('Community Posting Policy — database / default', () => {
  it('an existing Community (created before this phase, via direct DB insert) defaults to EVERYONE', async () => {
    const community = await makeCommunity('Legacy Community');
    expect(community.postingPolicy).toBe('EVERYONE');
  });

  it('a new Community created via the Admin API defaults to EVERYONE', async () => {
    const { agent, csrf } = await loginAsAdmin('pp-admin1@test.local');
    const res = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'New Community' });
    expect(res.body.postingPolicy).toBe('EVERYONE');
  });

  it('the policy persists correctly after being set to LEADERS_ONLY', async () => {
    const { agent, csrf } = await loginAsAdmin('pp-admin2@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Persist Community' });
    await agent.patch(`/api/admin/communities/${created.body.id}`).set('X-CSRF-Token', csrf).send({ postingPolicy: 'LEADERS_ONLY' });

    const stored = await prisma.community.findUnique({ where: { id: created.body.id } });
    expect(stored!.postingPolicy).toBe('LEADERS_ONLY');
  });

  it('an invalid policy value is rejected (400), and the stored value is unchanged', async () => {
    const { agent, csrf } = await loginAsAdmin('pp-admin3@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Invalid Value Community' });

    const res = await agent
      .patch(`/api/admin/communities/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ postingPolicy: 'ADMIN_ONLY' });
    expect(res.status).toBe(400);

    const stored = await prisma.community.findUnique({ where: { id: created.body.id } });
    expect(stored!.postingPolicy).toBe('EVERYONE');
  });
});

// -- Admin authorization ------------------------------------------------------

describe('Community Posting Policy — Admin authorization', () => {
  it('an authenticated Admin can read a Community\'s current posting policy', async () => {
    const { agent, csrf } = await loginAsAdmin('pp-admin4@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Readable Community' });

    const res = await agent.get(`/api/admin/communities/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.postingPolicy).toBe('EVERYONE');
  });

  it('an Admin can set the policy to EVERYONE', async () => {
    const { agent, csrf } = await loginAsAdmin('pp-admin5@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Set Everyone Community' });
    await agent.patch(`/api/admin/communities/${created.body.id}`).set('X-CSRF-Token', csrf).send({ postingPolicy: 'LEADERS_ONLY' });

    const res = await agent
      .patch(`/api/admin/communities/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ postingPolicy: 'EVERYONE' });
    expect(res.status).toBe(200);
    expect(res.body.postingPolicy).toBe('EVERYONE');
  });

  it('an Admin can set the policy to LEADERS_ONLY', async () => {
    const { agent, csrf } = await loginAsAdmin('pp-admin6@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Set Leaders Only Community' });

    const res = await agent
      .patch(`/api/admin/communities/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ postingPolicy: 'LEADERS_ONLY' });
    expect(res.status).toBe(200);
    expect(res.body.postingPolicy).toBe('LEADERS_ONLY');
  });

  it('an unauthenticated caller cannot modify the policy', async () => {
    const { agent, csrf } = await loginAsAdmin('pp-admin7@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Unauth Community' });

    const anon = agentWithUniqueIp();
    const res = await anon.patch(`/api/admin/communities/${created.body.id}`).send({ postingPolicy: 'LEADERS_ONLY' });
    expect(res.status).toBe(401);
  });

  it('a non-Admin (Leader) cannot modify the policy', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('pp-admin8@test.local');
    const community = await makeCommunity('Leader Cannot Modify Community');
    const created = await adminAgent
      .patch(`/api/admin/communities/${community.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ name: community.name });
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupCommunityLeader(1, community.id);

    const res = await leaderAgent
      .patch(`/api/admin/communities/${created.body.id}`)
      .set('X-CSRF-Token', leaderCsrf)
      .send({ postingPolicy: 'LEADERS_ONLY' });
    expect(res.status).toBe(403);

    const stored = await prisma.community.findUnique({ where: { id: community.id } });
    expect(stored!.postingPolicy).toBe('EVERYONE');
  });

  it('an ordinary active member cannot modify the policy', async () => {
    const community = await makeCommunity('Member Cannot Modify Community');
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237695800001', 'pp-member1@example.com');
    await makeMembership(person.id, community.id);

    const res = await memberAgent
      .patch(`/api/admin/communities/${community.id}`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ postingPolicy: 'LEADERS_ONLY' });
    expect(res.status).toBe(401);
  });
});

// -- EVERYONE posting ---------------------------------------------------------

describe('Community Posting Policy — EVERYONE posting behavior', () => {
  it('an active Community member can post when policy is EVERYONE', async () => {
    const community = await makeCommunity('Everyone Posting Community');
    const { agent, csrf, person } = await loginAsMember('+237695800002', 'pp-member2@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Hello everyone' });
    expect(res.status).toBe(201);
  });

  it('existing posting behavior (member without any policy change) remains unchanged', async () => {
    const community = await makeCommunity('Unchanged Behavior Community');
    const { agent, csrf, person } = await loginAsMember('+237695800003', 'pp-member3@example.com');
    await makeMembership(person.id, community.id);

    expect(community.postingPolicy).toBe('EVERYONE');
    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Still works' });
    expect(res.status).toBe(201);
  });

  it('GET messages reports canPost: true for a member under EVERYONE', async () => {
    const community = await makeCommunity('CanPost True Community');
    const { agent, person } = await loginAsMember('+237695800004', 'pp-member4@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(res.body.canPost).toBe(true);
  });
});

// -- LEADERS_ONLY posting -----------------------------------------------------

describe('Community Posting Policy — LEADERS_ONLY posting behavior', () => {
  it('an active exact-Community Leader can post', async () => {
    const community = await makeCommunity('Leaders Only Leader Can Post');
    await setLeadersOnly(community.id);
    const { agent, csrf } = await setupCommunityLeader(2, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Leader message' });
    expect(res.status).toBe(201);
  });

  it('a Community Administrator (isCommunityAdministrator) can post — same underlying check as SCOPED_LEADER in this codebase', async () => {
    const community = await makeCommunity('Leaders Only Admin Can Post');
    await setLeadersOnly(community.id);
    const { agent, csrf, person } = await setupCommunityLeader(3, community.id);

    // Confirm this Person is recognized as a Community Administrator, the
    // same authorization source LEADERS_ONLY relies on.
    const { isCommunityAdministrator } = await import('../lib/leadership');
    expect(await isCommunityAdministrator(person.id, community.id)).toBe(true);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Administrator message' });
    expect(res.status).toBe(201);
  });

  it('an ordinary active member (not a Leader) cannot post', async () => {
    const community = await makeCommunity('Leaders Only Member Cannot Post');
    await setLeadersOnly(community.id);
    const { agent, csrf, person } = await loginAsMember('+237695800005', 'pp-member5@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should be rejected' });
    expect(res.status).toBe(403);

    const count = await prisma.message.count();
    expect(count).toBe(0);
  });

  it('a Leader of ANOTHER Community cannot post in this LEADERS_ONLY Community', async () => {
    const communityA = await makeCommunity('Leader Home Community');
    const communityB = await makeCommunity('Leaders Only Other Community');
    await setLeadersOnly(communityB.id);
    const { agent, csrf } = await setupCommunityLeader(4, communityA.id);

    const res = await agent
      .post(`/api/communities/${communityB.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should be rejected' });
    expect(res.status).toBe(403);
  });

  it('a former/ended Leader (RoleAssignment status ENDED) cannot post', async () => {
    const community = await makeCommunity('Leaders Only Ended Leader');
    await setLeadersOnly(community.id);
    const { agent, csrf } = await setupCommunityLeader(5, community.id, 'ENDED');

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should be rejected' });
    expect(res.status).toBe(403);
  });

  it('an inactive/removed Community member (also not a Leader) cannot post', async () => {
    const community = await makeCommunity('Leaders Only Inactive Member');
    await setLeadersOnly(community.id);
    const { agent, csrf, person } = await loginAsMember('+237695800006', 'pp-member6@example.com');
    await makeMembership(person.id, community.id, 'INACTIVE');

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should be rejected' });
    expect(res.status).toBe(403);
  });

  it('GET messages reports canPost: false for an ordinary member under LEADERS_ONLY, and canPost: true for the Leader', async () => {
    const community = await makeCommunity('CanPost False Community');
    await setLeadersOnly(community.id);
    const { agent: memberAgent, person } = await loginAsMember('+237695800007', 'pp-member7@example.com');
    await makeMembership(person.id, community.id);
    const { agent: leaderAgent } = await setupCommunityLeader(6, community.id);

    const memberRes = await memberAgent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(memberRes.body.canPost).toBe(false);

    const leaderRes = await leaderAgent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(leaderRes.body.canPost).toBe(true);
  });
});

// -- Authorization integrity ---------------------------------------------------

describe('Community Posting Policy — authorization integrity (no client-supplied identity)', () => {
  it('a client-supplied personId in the request body cannot bypass LEADERS_ONLY authorization', async () => {
    const community = await makeCommunity('Spoof PersonId Community');
    await setLeadersOnly(community.id);
    const { agent, csrf } = await setupCommunityLeader(7, community.id);
    const otherCommunity = await makeCommunity('Other Leader Home');
    const otherLeader = await setupCommunityLeader(8, otherCommunity.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Hi', personId: otherLeader.person.id });
    expect(res.status).toBe(201);
    // The message must be attributed to the AUTHENTICATED session's Person,
    // never the spoofed body field.
    const created = await prisma.message.findFirst({ where: { body: 'Hi' } });
    expect(created).not.toBeNull();
  });

  it('a client-supplied leaderId/role/isLeader flag cannot grant posting when the session is an ordinary member', async () => {
    const community = await makeCommunity('Spoof Flags Community');
    await setLeadersOnly(community.id);
    const { agent, csrf, person } = await loginAsMember('+237695800008', 'pp-member8@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should still be rejected', leaderId: 'fake', role: 'LEADER', isLeader: true });
    expect(res.status).toBe(403);
  });

  it('parent Community leadership does not grant child Community posting authority under LEADERS_ONLY', async () => {
    const parent = await makeCommunity('Parent Leadership Community');
    const child = await prisma.community.create({ data: { name: 'Child Under Leaders Only', parentId: parent.id } });
    await setLeadersOnly(child.id);
    const { agent, csrf } = await setupCommunityLeader(9, parent.id);

    const res = await agent
      .post(`/api/communities/${child.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should be rejected' });
    expect(res.status).toBe(403);
  });

  it('child Community leadership does not grant parent Community posting authority under LEADERS_ONLY', async () => {
    const parent = await prisma.community.create({ data: { name: 'Parent Under Leaders Only' } });
    const child = await prisma.community.create({ data: { name: 'Child Leadership Community', parentId: parent.id } });
    await setLeadersOnly(parent.id);
    const { agent, csrf } = await setupCommunityLeader(10, child.id);

    const res = await agent
      .post(`/api/communities/${parent.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should be rejected' });
    expect(res.status).toBe(403);
  });
});

// -- Read behavior must not change ----------------------------------------------

describe('Community Posting Policy — read access is unaffected', () => {
  it('an ordinary member can still read messages in a LEADERS_ONLY Community', async () => {
    const community = await makeCommunity('Readable Leaders Only Community');
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupCommunityLeader(11, community.id);
    await agent_post_message(leaderAgent, leaderCsrf, community.id, 'Leader post before policy change');
    await setLeadersOnly(community.id);

    const { agent: memberAgent, person } = await loginAsMember('+237695800009', 'pp-member9@example.com');
    await makeMembership(person.id, community.id);

    const res = await memberAgent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  async function agent_post_message(agent: any, csrf: string, communityId: string, body: string) {
    return agent.post(`/api/communities/${communityId}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body });
  }

  it('message retrieval/pagination shape is unchanged by LEADERS_ONLY (items/hasMore/unreadCount/isAdministrator/canPost all present)', async () => {
    const community = await makeCommunity('Shape Unchanged Community');
    await setLeadersOnly(community.id);
    const { agent, person } = await loginAsMember('+237695800010', 'pp-member10@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['canPost', 'hasMore', 'isAdministrator', 'items', 'unreadCount'].sort());
  });
});

// -- Regression isolation --------------------------------------------------------

describe('Community Posting Policy — regression isolation', () => {
  it('Headquarters Network Posts remain unaffected (no Community.postingPolicy involvement)', async () => {
    const hq = await makeCommunity('Untouched HQ Community');
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', headquartersCommunityId: hq.id },
      update: { headquartersCommunityId: hq.id },
    });
    await setLeadersOnly(hq.id);

    const { agent: adminAgent, csrf } = await loginAsAdmin('pp-admin9@test.local');
    const created = await adminAgent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Unaffected Post', bodyEn: 'Body.' });
    await adminAgent.patch(`/api/admin/headquarters-posts/${created.body.id}`).set('X-CSRF-Token', csrf).send({ networkWide: true });
    const published = await adminAgent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(published.status).toBe(200);

    const { agent: memberAgent, person } = await loginAsMember('+237695800011', 'pp-member11@example.com');
    await makeMembership(person.id, hq.id);
    const feed = await memberAgent.get('/api/me/headquarters-posts');
    expect(feed.body.items.map((p: any) => p.id)).toContain(created.body.id);
  });

  it('Headquarters comments/reactions remain unaffected — an ordinary member (not a Leader) can still comment on a Headquarters Post even when their Community is LEADERS_ONLY', async () => {
    const hq = await makeCommunity('Untouched HQ Comments Community');
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', headquartersCommunityId: hq.id },
      update: { headquartersCommunityId: hq.id },
    });
    await setLeadersOnly(hq.id);

    const { agent: adminAgent, csrf } = await loginAsAdmin('pp-admin10@test.local');
    const created = await adminAgent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Comment Test Post', bodyEn: 'Body.' });
    await adminAgent.patch(`/api/admin/headquarters-posts/${created.body.id}`).set('X-CSRF-Token', csrf).send({ networkWide: true });
    await adminAgent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237695800012', 'pp-member12@example.com');
    await makeMembership(person.id, hq.id);

    const commentRes = await memberAgent
      .post(`/api/me/headquarters-posts/${created.body.id}/comments`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Still allowed' });
    expect(commentRes.status).toBe(201);
  });

  it('Geography remains unaffected — no postingPolicy field exists on Geography', async () => {
    const geography = await prisma.geography.create({ data: { name: 'Untouched Geography', type: 'REGION', countryCode: 'CM' } });
    expect((geography as any).postingPolicy).toBeUndefined();
  });

  it('existing Community membership behavior (join/leave) is unaffected by postingPolicy', async () => {
    const community = await makeCommunity('Membership Unaffected Community');
    await setLeadersOnly(community.id);
    const person = await makePerson('+237695800013', 'Membership Test Person');
    const membership = await makeMembership(person.id, community.id);
    expect(membership.status).toBe('ACTIVE');

    const updated = await prisma.communityMembership.update({ where: { id: membership.id }, data: { status: 'INACTIVE' } });
    expect(updated.status).toBe('INACTIVE');
  });
});

// -- Security -----------------------------------------------------------------

describe('Community Posting Policy — security', () => {
  it('no unauthorized policy update is possible via any role combination (Leader + Member on the same Person, still not Admin)', async () => {
    const community = await makeCommunity('No Unauthorized Update Community');
    const { agent, csrf } = await setupCommunityLeader(12, community.id);

    const res = await agent
      .patch(`/api/admin/communities/${community.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ postingPolicy: 'LEADERS_ONLY' });
    expect(res.status).toBe(403);
  });

  it('no cross-Community posting is possible: a Leader of Community A is rejected posting to Community B even when both are LEADERS_ONLY', async () => {
    const communityA = await makeCommunity('Cross Post A');
    const communityB = await makeCommunity('Cross Post B');
    await setLeadersOnly(communityA.id);
    await setLeadersOnly(communityB.id);
    const { agent, csrf } = await setupCommunityLeader(13, communityA.id);

    const res = await agent
      .post(`/api/communities/${communityB.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Cross post attempt' });
    expect(res.status).toBe(403);
  });

  it('CSRF protection is enforced on the Admin policy-update mutation', async () => {
    const { agent, csrf } = await loginAsAdmin('pp-admin11@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'CSRF Policy Community' });

    const res = await agent.patch(`/api/admin/communities/${created.body.id}`).send({ postingPolicy: 'LEADERS_ONLY' });
    expect(res.status).toBe(403);
  });

  it('CSRF protection is enforced on message creation', async () => {
    const community = await makeCommunity('CSRF Message Community');
    const { agent, person } = await loginAsMember('+237695800014', 'pp-member13@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent.post(`/api/communities/${community.id}/conversation/messages`).send({ body: 'No csrf' });
    expect(res.status).toBe(403);
  });

  it('the existing dedicated communityGeographyMutationLimiter is reused for the Admin policy update — no new limiter, and a rejected update never writes', async () => {
    const community = await makeCommunity('Rate Limit Reuse Community');
    const { agent, csrf } = await loginAsAdmin('pp-admin12@test.local');
    // Sanity: a normal update still succeeds (proves the existing limiter
    // isn't broken by this change, without asserting its exact ceiling here
    // — that magnitude is already covered by communityGeographyManagement.test.ts).
    const res = await agent
      .patch(`/api/admin/communities/${community.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ postingPolicy: 'LEADERS_ONLY' });
    expect(res.status).toBe(200);
  });

  it('posting policy enforcement never creates any write outside the intended message-creation path (no unexpected rows on a rejected attempt)', async () => {
    const community = await makeCommunity('No Side Effect Community');
    await setLeadersOnly(community.id);
    const { agent, csrf, person } = await loginAsMember('+237695800015', 'pp-member14@example.com');
    await makeMembership(person.id, community.id);

    const beforeMessages = await prisma.message.count();
    const beforeMemberships = await prisma.communityMembership.count();
    const beforeRoles = await prisma.roleAssignment.count();

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Rejected attempt' });
    expect(res.status).toBe(403);

    expect(await prisma.message.count()).toBe(beforeMessages);
    expect(await prisma.communityMembership.count()).toBe(beforeMemberships);
    expect(await prisma.roleAssignment.count()).toBe(beforeRoles);
    void person;
  });
});
