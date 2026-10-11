import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Headquarters Network Posts & Shared Engagement — mirrors the exact
// conventions established in announcements.test.ts: agentWithUniqueIp,
// createLeader/createAdmin, bootstrap, loginAsMember. Structurally separate
// from Announcement's own test suite — own model family, own routes, own
// authorization helper (lib/headquartersPosts.ts).

const app = createApp();

let ipCounter = 5000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.99.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsAdmin(n: number) {
  const email = `hqp-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

async function setupLeader(n: number) {
  const email = `hqp-leader${n}@test.local`;
  const { user } = await createLeader(`HQ Post Leader ${n}`, email, `HQ${n}CODE`);
  const person = await prisma.person.create({
    data: { name: `HQ Post Leader Person ${n}`, whatsappNumber: `+237697${String(n).padStart(6, '0')}` },
  });
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function loginAsMember(whatsapp: string, email: string, name = 'HQ Post Member') {
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

async function makeCommunity(name: string, parentId?: string) {
  return prisma.community.create({ data: { name, parentId: parentId ?? null } });
}

async function joinCommunity(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function setHeadquarters(communityId: string) {
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', headquartersCommunityId: communityId },
    update: { headquartersCommunityId: communityId },
  });
}

describe('Headquarters Network Posts — Admin authorization', () => {
  it('an Admin can create a draft headquarters post', async () => {
    const { agent, csrf } = await loginAsAdmin(1);
    const res = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Draft Title', bodyEn: 'Draft body.' });
    expect(res.status).toBe(201);
    expect(res.body.publishedAt).toBeNull();
    expect(res.body.archivedAt).toBeNull();
    expect(res.body.networkWide).toBe(false);
  });

  it('a Leader cannot create a headquarters post', async () => {
    const { agent, csrf } = await setupLeader(1);
    const res = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Nope', bodyEn: 'Nope.' });
    expect(res.status).toBe(403);
  });

  it('a Member cannot create a headquarters post', async () => {
    const { agent, csrf } = await loginAsMember('+237696900001', 'hqp-member1@example.com');
    const res = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Nope', bodyEn: 'Nope.' });
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot create a headquarters post', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.post('/api/admin/headquarters-posts').send({ titleEn: 'Nope', bodyEn: 'Nope.' });
    expect(res.status).toBe(401);
  });

  it('CSRF protection is enforced on create', async () => {
    const { agent } = await loginAsAdmin(2);
    const res = await agent.post('/api/admin/headquarters-posts').send({ titleEn: 'No CSRF', bodyEn: 'No CSRF.' });
    expect(res.status).toBe(403);
  });

  it('the dedicated headquarters post mutation rate limiter applies', async () => {
    const { agent, csrf } = await loginAsAdmin(3);
    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent
        .post('/api/admin/headquarters-posts')
        .set('X-CSRF-Token', csrf)
        .send({ titleEn: `Rate ${i}`, bodyEn: 'Body.' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('a Leader cannot PATCH a headquarters post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(4);
    const created = await adminAgent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Symmetry Patch Target', bodyEn: 'Body.' });
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupLeader(2);

    const res = await leaderAgent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', leaderCsrf)
      .send({ titleEn: 'Should not apply' });
    expect(res.status).toBe(403);
  });

  it('a Leader cannot publish a headquarters post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(5);
    const created = await adminAgent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Symmetry Publish Target', bodyEn: 'Body.' });
    await adminAgent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ networkWide: true });
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupLeader(3);

    const res = await leaderAgent
      .post(`/api/admin/headquarters-posts/${created.body.id}/publish`)
      .set('X-CSRF-Token', leaderCsrf);
    expect(res.status).toBe(403);
  });

  it('a Leader cannot archive a headquarters post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(6);
    const created = await adminAgent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Symmetry Archive Target', bodyEn: 'Body.' });
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupLeader(4);

    const res = await leaderAgent
      .post(`/api/admin/headquarters-posts/${created.body.id}/archive`)
      .set('X-CSRF-Token', leaderCsrf);
    expect(res.status).toBe(403);
  });
});

describe('Headquarters Network Posts — draft editing and lifecycle immutability', () => {
  it('an Admin can edit a draft\'s title/body', async () => {
    const { agent, csrf } = await loginAsAdmin(7);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Original', bodyEn: 'Original body.' });

    const patched = await agent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Updated' });
    expect(patched.status).toBe(200);
    expect(patched.body.titleEn).toBe('Updated');
  });

  it('editing a published headquarters post is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(8);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'To Publish', bodyEn: 'Body.' });
    await agent.patch(`/api/admin/headquarters-posts/${created.body.id}`).set('X-CSRF-Token', csrf).send({ networkWide: true });
    const published = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(published.status).toBe(200);

    const patchAttempt = await agent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Should not apply' });
    expect(patchAttempt.status).toBe(409);
  });

  it('editing an archived headquarters post is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(9);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'To Archive', bodyEn: 'Body.' });
    const archived = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/archive`).set('X-CSRF-Token', csrf);
    expect(archived.status).toBe(200);

    const patchAttempt = await agent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Should not apply' });
    expect(patchAttempt.status).toBe(409);
  });
});

describe('Headquarters Network Posts — mutually exclusive audience modes', () => {
  it('setting networkWide true clears any existing selected-Community targets', async () => {
    const { agent, csrf } = await loginAsAdmin(10);
    const community = await makeCommunity('Exclusive Mode Community A');
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Mode Test', bodyEn: 'Body.' });
    await agent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ targetCommunityIds: [community.id] });

    const switched = await agent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ networkWide: true });
    expect(switched.body.networkWide).toBe(true);
    expect(switched.body.targets).toHaveLength(0);
  });

  it('setting non-empty targetCommunityIds clears networkWide back to false', async () => {
    const { agent, csrf } = await loginAsAdmin(11);
    const community = await makeCommunity('Exclusive Mode Community B');
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Mode Test B', bodyEn: 'Body.' });
    await agent.patch(`/api/admin/headquarters-posts/${created.body.id}`).set('X-CSRF-Token', csrf).send({ networkWide: true });

    const switched = await agent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ targetCommunityIds: [community.id] });
    expect(switched.body.networkWide).toBe(false);
    expect(switched.body.targets).toHaveLength(1);
  });
});

describe('Headquarters Network Posts — publication atomicity', () => {
  it('publishing with no audience (neither networkWide nor targets) is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(12);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'No Audience', bodyEn: 'Body.' });
    const res = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(400);
  });

  it('publishing twice returns 409 the second time', async () => {
    const { agent, csrf } = await loginAsAdmin(13);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Once', bodyEn: 'Body.' });
    await agent.patch(`/api/admin/headquarters-posts/${created.body.id}`).set('X-CSRF-Token', csrf).send({ networkWide: true });

    const first = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(first.status).toBe(200);
    const second = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(second.status).toBe(409);
  });

  it('publishing an archived draft is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(14);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Archived First', bodyEn: 'Body.' });
    await agent.post(`/api/admin/headquarters-posts/${created.body.id}/archive`).set('X-CSRF-Token', csrf);

    const res = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(409);
  });
});

describe('Headquarters Network Posts — archive lifecycle', () => {
  it('archiving a draft discards it (no separate hard-delete path)', async () => {
    const { agent, csrf } = await loginAsAdmin(15);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Discard Me', bodyEn: 'Body.' });
    const res = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/archive`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).not.toBeNull();

    const stillStored = await prisma.headquartersPost.findUnique({ where: { id: created.body.id } });
    expect(stillStored).not.toBeNull();
  });

  it('archiving an already-archived headquarters post returns 409', async () => {
    const { agent, csrf } = await loginAsAdmin(16);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Archive Twice', bodyEn: 'Body.' });
    await agent.post(`/api/admin/headquarters-posts/${created.body.id}/archive`).set('X-CSRF-Token', csrf);
    const second = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/archive`).set('X-CSRF-Token', csrf);
    expect(second.status).toBe(409);
  });

  it('an archived headquarters post no longer appears in the recipient feed even though eligibility would otherwise match', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(17);
    const community = await makeCommunity('Archived From Feed Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900002', 'hqp-member2@example.com');
    await joinCommunity(person.id, community.id);

    const created = await adminAgent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Will Be Archived', bodyEn: 'Body.' });
    await adminAgent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ targetCommunityIds: [community.id] });
    await adminAgent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    await adminAgent.post(`/api/admin/headquarters-posts/${created.body.id}/archive`).set('X-CSRF-Token', csrf);

    const feed = await memberAgent.get('/api/me/headquarters-posts');
    expect(feed.body.items.find((p: any) => p.id === created.body.id)).toBeUndefined();

    const detail = await memberAgent.get(`/api/me/headquarters-posts/${created.body.id}`);
    expect(detail.status).toBe(404);
  });
});

async function publishNetworkWide(adminAgent: any, csrf: string, titleEn: string) {
  const created = await adminAgent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', csrf).send({ titleEn, bodyEn: 'Body.' });
  await adminAgent.patch(`/api/admin/headquarters-posts/${created.body.id}`).set('X-CSRF-Token', csrf).send({ networkWide: true });
  await adminAgent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
  return created.body.id;
}

async function publishTargeted(adminAgent: any, csrf: string, titleEn: string, communityIds: string[]) {
  const created = await adminAgent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', csrf).send({ titleEn, bodyEn: 'Body.' });
  await adminAgent
    .patch(`/api/admin/headquarters-posts/${created.body.id}`)
    .set('X-CSRF-Token', csrf)
    .send({ targetCommunityIds: communityIds });
  await adminAgent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
  return created.body.id;
}

describe('Headquarters Network Posts — network-wide targeting', () => {
  it('a Member with ACTIVE membership in the Headquarters Community itself qualifies for a network-wide post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(18);
    const hq = await makeCommunity('NetworkWide HQ A');
    await setHeadquarters(hq.id);
    const { agent: memberAgent, person } = await loginAsMember('+237696900003', 'hqp-member3@example.com');
    await joinCommunity(person.id, hq.id);

    const id = await publishNetworkWide(adminAgent, csrf, 'Network Wide A');
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).toContain(id);
  });

  it('a Member with ACTIVE membership in a descendant Community of Headquarters qualifies for a network-wide post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(19);
    const hq = await makeCommunity('NetworkWide HQ B');
    const child = await makeCommunity('NetworkWide Child B', hq.id);
    await setHeadquarters(hq.id);
    const { agent: memberAgent, person } = await loginAsMember('+237696900004', 'hqp-member4@example.com');
    await joinCommunity(person.id, child.id);

    const id = await publishNetworkWide(adminAgent, csrf, 'Network Wide B');
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).toContain(id);
  });

  it('a Member with ACTIVE membership in a grandchild Community of Headquarters qualifies for a network-wide post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(20);
    const hq = await makeCommunity('NetworkWide HQ C');
    const child = await makeCommunity('NetworkWide Child C', hq.id);
    const grandchild = await makeCommunity('NetworkWide Grandchild C', child.id);
    await setHeadquarters(hq.id);
    const { agent: memberAgent, person } = await loginAsMember('+237696900005', 'hqp-member5@example.com');
    await joinCommunity(person.id, grandchild.id);

    const id = await publishNetworkWide(adminAgent, csrf, 'Network Wide C');
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).toContain(id);
  });

  it('a Member with ACTIVE membership in a Community OUTSIDE the Headquarters tree does not qualify for a network-wide post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(21);
    const hq = await makeCommunity('NetworkWide HQ D');
    const outside = await makeCommunity('NetworkWide Outside D');
    await setHeadquarters(hq.id);
    const { agent: memberAgent, person } = await loginAsMember('+237696900006', 'hqp-member6@example.com');
    await joinCommunity(person.id, outside.id);

    const id = await publishNetworkWide(adminAgent, csrf, 'Network Wide D');
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).not.toContain(id);
  });

  it('a Member with INACTIVE membership in the Headquarters Community does not qualify for a network-wide post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(22);
    const hq = await makeCommunity('NetworkWide HQ E');
    await setHeadquarters(hq.id);
    const { agent: memberAgent, person } = await loginAsMember('+237696900007', 'hqp-member7@example.com');
    await joinCommunity(person.id, hq.id, 'INACTIVE');

    const id = await publishNetworkWide(adminAgent, csrf, 'Network Wide E');
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).not.toContain(id);
  });
});

describe('Headquarters Network Posts — selected-Community targeting (exact match)', () => {
  it('a Member with ACTIVE membership in the exact targeted Community sees the post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(23);
    const community = await makeCommunity('Exact Match Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900008', 'hqp-member8@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Targeted A', [community.id]);
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).toContain(id);
  });

  it('a Member with INACTIVE membership in the targeted Community does not see it', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(24);
    const community = await makeCommunity('Inactive Membership Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900009', 'hqp-member9@example.com');
    await joinCommunity(person.id, community.id, 'INACTIVE');

    const id = await publishTargeted(adminAgent, csrf, 'Targeted B', [community.id]);
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).not.toContain(id);
  });

  it('a Member in an untargeted Community does not see the post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(25);
    const targeted = await makeCommunity('Targeted Only Community');
    const other = await makeCommunity('Untargeted Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900010', 'hqp-member10@example.com');
    await joinCommunity(person.id, other.id);

    const id = await publishTargeted(adminAgent, csrf, 'Targeted C', [targeted.id]);
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).not.toContain(id);
  });

  it('targeting a parent Community does not include a child Community\'s members (exact match only, not descendant-aware)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(26);
    const parent = await makeCommunity('Parent Community');
    const child = await makeCommunity('Child Community', parent.id);
    const { agent: memberAgent, person } = await loginAsMember('+237696900011', 'hqp-member11@example.com');
    await joinCommunity(person.id, child.id);

    const id = await publishTargeted(adminAgent, csrf, 'Targeted D', [parent.id]);
    const res = await memberAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).not.toContain(id);
  });

  it('a Leader with a RoleAssignment (but no CommunityMembership) in the targeted Community does not qualify', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(27);
    const community = await makeCommunity('Leader Role Only Community');
    const { agent: leaderAgent, person: leaderPerson, user: leaderUser } = await setupLeader(5);
    await prisma.roleAssignment.create({
      data: { personId: leaderPerson.id, roleType: 'SCOPED_LEADER', assignedByUserId: leaderUser.id, communityId: community.id },
    });

    const id = await publishTargeted(adminAgent, csrf, 'Targeted E', [community.id]);
    const res = await leaderAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).not.toContain(id);
  });
});

describe('Headquarters Network Posts — dynamic eligibility', () => {
  it('joining a targeted Community after publication grants access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(28);
    const community = await makeCommunity('Join After Publish Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900012', 'hqp-member12@example.com');

    const id = await publishTargeted(adminAgent, csrf, 'Join After', [community.id]);

    const before = await memberAgent.get('/api/me/headquarters-posts');
    expect(before.body.items.map((p: any) => p.id)).not.toContain(id);

    await joinCommunity(person.id, community.id);

    const after = await memberAgent.get('/api/me/headquarters-posts');
    expect(after.body.items.map((p: any) => p.id)).toContain(id);
  });

  it('leaving a targeted Community after publication removes access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(29);
    const community = await makeCommunity('Leave After Publish Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900013', 'hqp-member13@example.com');
    const membership = await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Leave After', [community.id]);

    const before = await memberAgent.get('/api/me/headquarters-posts');
    expect(before.body.items.map((p: any) => p.id)).toContain(id);

    await prisma.communityMembership.update({ where: { id: membership.id }, data: { status: 'INACTIVE' } });

    const after = await memberAgent.get('/api/me/headquarters-posts');
    expect(after.body.items.map((p: any) => p.id)).not.toContain(id);
  });
});

describe('Headquarters Network Posts — Member/Leader/Admin recipient-surface separation', () => {
  it('a Leader qualifies under the exact same audience rules as a Member (via their own linked Person)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(30);
    const community = await makeCommunity('Leader Recipient Community');
    const { agent: leaderAgent, person: leaderPerson } = await setupLeader(6);
    await joinCommunity(leaderPerson.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'For Leader Too', [community.id]);
    const res = await leaderAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).toContain(id);
  });

  it('being a Leader alone (no matching membership) does not grant access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(31);
    const community = await makeCommunity('Leader Without Membership Community');
    const { agent: leaderAgent } = await setupLeader(7);

    const id = await publishTargeted(adminAgent, csrf, 'Leader No Access', [community.id]);
    const res = await leaderAgent.get('/api/me/headquarters-posts');
    expect(res.body.items.map((p: any) => p.id)).not.toContain(id);
  });

  it('an Admin session cannot use the recipient endpoint as a bypass', async () => {
    const { agent } = await loginAsAdmin(32);
    const res = await agent.get('/api/me/headquarters-posts');
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot access the recipient endpoint', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/me/headquarters-posts');
    expect(res.status).toBe(401);
  });
});

describe('Headquarters Network Posts — IDOR / non-disclosure', () => {
  it('GET /api/me/headquarters-posts/:id returns 404 for an unknown id', async () => {
    const { agent } = await loginAsMember('+237696900014', 'hqp-member14@example.com');
    const res = await agent.get('/api/me/headquarters-posts/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('GET /api/me/headquarters-posts/:id returns 404 for a real but ineligible post', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(33);
    const community = await makeCommunity('IDOR Community');
    const { agent: memberAgent } = await loginAsMember('+237696900015', 'hqp-member15@example.com');

    const id = await publishTargeted(adminAgent, csrf, 'Not For You', [community.id]);
    const res = await memberAgent.get(`/api/me/headquarters-posts/${id}`);
    expect(res.status).toBe(404);
  });

  it('GET /api/me/headquarters-posts/:id returns 404 for an unpublished draft, even for an eligible Person', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(34);
    const community = await makeCommunity('Draft Not Visible Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900016', 'hqp-member16@example.com');
    await joinCommunity(person.id, community.id);

    const created = await adminAgent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Still Draft', bodyEn: 'Body.' });
    await adminAgent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ targetCommunityIds: [community.id] });

    const res = await memberAgent.get(`/api/me/headquarters-posts/${created.body.id}`);
    expect(res.status).toBe(404);
  });
});

describe('Headquarters Network Posts — recipient response privacy', () => {
  it('the recipient response never exposes target/organizational/creator internals', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(35);
    const community = await makeCommunity('Privacy Check Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900017', 'hqp-member17@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Privacy Check', [community.id]);
    const res = await memberAgent.get(`/api/me/headquarters-posts/${id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['bodyEn', 'bodyFr', 'commentCount', 'id', 'media', 'networkWide', 'publishedAt', 'reactionCount', 'titleEn', 'titleFr', 'viewerHasReacted'].sort(),
    );
    expect(res.body).not.toHaveProperty('targets');
    expect(res.body).not.toHaveProperty('createdByUserId');
    expect(res.body).not.toHaveProperty('createdBy');
    expect(res.body).not.toHaveProperty('archivedAt');
  });

  it('the Admin list response never exposes a per-Person recipient list, and includes community names/engagement counts', async () => {
    const { agent, csrf } = await loginAsAdmin(36);
    const community = await makeCommunity('Admin Response Community');
    const id = await publishTargeted(agent, csrf, 'Admin View', [community.id]);

    const res = await agent.get(`/api/admin/headquarters-posts/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('recipients');
    expect(res.body).not.toHaveProperty('recipientCount');
    expect(res.body.targets[0].communityName).toBe('Admin Response Community');
    expect(res.body.commentCount).toBe(0);
    expect(res.body.reactionCount).toBe(0);
  });
});

describe('Headquarters Network Posts — pagination', () => {
  it('GET /api/me/headquarters-posts paginates deterministically with no duplicates across pages', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(37);
    const community = await makeCommunity('Pagination Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900018', 'hqp-member18@example.com');
    await joinCommunity(person.id, community.id);

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await publishTargeted(adminAgent, csrf, `Page Item ${i}`, [community.id]));
    }

    const page1 = await memberAgent.get('/api/me/headquarters-posts?page=1&pageSize=2');
    const page2 = await memberAgent.get('/api/me/headquarters-posts?page=2&pageSize=2');
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(2);
    const page1Ids = page1.body.items.map((p: any) => p.id);
    const page2Ids = page2.body.items.map((p: any) => p.id);
    expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
    expect(page1.body.pagination.total).toBeGreaterThanOrEqual(5);
  });

  it('GET /api/admin/headquarters-posts paginates by createdAt desc', async () => {
    const { agent, csrf } = await loginAsAdmin(38);
    const first = await agent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', csrf).send({ titleEn: 'First Created', bodyEn: 'Body.' });
    const second = await agent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', csrf).send({ titleEn: 'Second Created', bodyEn: 'Body.' });

    const res = await agent.get('/api/admin/headquarters-posts?page=1&pageSize=2');
    expect(res.status).toBe(200);
    const ids = res.body.items.map((p: any) => p.id);
    expect(ids.indexOf(second.body.id)).toBeLessThan(ids.indexOf(first.body.id));
  });
});

describe('Headquarters Network Posts — i18n fallback fields', () => {
  it('a post created without French content returns null titleFr/bodyFr for the client to fall back on', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(39);
    const community = await makeCommunity('No French Community');
    const { agent: memberAgent, person } = await loginAsMember('+237696900019', 'hqp-member19@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'English Only', [community.id]);
    const res = await memberAgent.get(`/api/me/headquarters-posts/${id}`);
    expect(res.body.titleFr).toBeNull();
    expect(res.body.bodyFr).toBeNull();
    expect(res.body.titleEn).toBe('English Only');
  });
});

describe('Headquarters Network Posts — target validation', () => {
  it('rejects a target referencing an unknown Community id', async () => {
    const { agent, csrf } = await loginAsAdmin(40);
    const created = await agent
      .post('/api/admin/headquarters-posts')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Unknown Ref', bodyEn: 'Body.' });
    const res = await agent
      .patch(`/api/admin/headquarters-posts/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ targetCommunityIds: ['00000000-0000-0000-0000-000000000000'] });
    expect(res.status).toBe(400);
  });
});

describe('Headquarters Network Posts — comments (shared engagement)', () => {
  it('an eligible Member can post a comment and it appears in the shared list', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(41);
    const community = await makeCommunity('Comment Community A');
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237696900020', 'hqp-member20@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Comment Post A', [community.id]);
    const posted = await memberAgent
      .post(`/api/me/headquarters-posts/${id}/comments`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Praise God!' });
    expect(posted.status).toBe(201);
    expect(posted.body.body).toBe('Praise God!');
    expect(posted.body.isOwn).toBe(true);

    const list = await memberAgent.get(`/api/me/headquarters-posts/${id}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: any) => c.id)).toContain(posted.body.id);
  });

  it('two different eligible Persons see the SAME single shared comment thread (one canonical post)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(42);
    const community = await makeCommunity('Comment Community B');
    const { agent: memberAgent1, csrf: memberCsrf1, person: person1 } = await loginAsMember('+237696900021', 'hqp-member21@example.com');
    const { agent: memberAgent2, person: person2 } = await loginAsMember('+237696900022', 'hqp-member22@example.com');
    await joinCommunity(person1.id, community.id);
    await joinCommunity(person2.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Comment Post B', [community.id]);
    const posted = await memberAgent1
      .post(`/api/me/headquarters-posts/${id}/comments`)
      .set('X-CSRF-Token', memberCsrf1)
      .send({ body: 'Shared thread test' });

    const list2 = await memberAgent2.get(`/api/me/headquarters-posts/${id}/comments`);
    expect(list2.body.items.map((c: any) => c.id)).toContain(posted.body.id);
    expect(list2.body.items.find((c: any) => c.id === posted.body.id).isOwn).toBe(false);
  });

  it('an ineligible Person cannot post a comment (404)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(43);
    const community = await makeCommunity('Comment Community C');
    const { agent: memberAgent, csrf: memberCsrf } = await loginAsMember('+237696900023', 'hqp-member23@example.com');

    const id = await publishTargeted(adminAgent, csrf, 'Comment Post C', [community.id]);
    const res = await memberAgent
      .post(`/api/me/headquarters-posts/${id}/comments`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Should not work' });
    expect(res.status).toBe(404);

    const count = await prisma.headquartersPostComment.count({ where: { headquartersPostId: id } });
    expect(count).toBe(0);
  });

  it('an ineligible Person cannot list comments (404)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(44);
    const community = await makeCommunity('Comment Community D');
    const { agent: memberAgent } = await loginAsMember('+237696900024', 'hqp-member24@example.com');

    const id = await publishTargeted(adminAgent, csrf, 'Comment Post D', [community.id]);
    const res = await memberAgent.get(`/api/me/headquarters-posts/${id}/comments`);
    expect(res.status).toBe(404);
  });

  it('CSRF protection is enforced on posting a comment', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(45);
    const community = await makeCommunity('Comment Community E');
    const { agent: memberAgent, person } = await loginAsMember('+237696900025', 'hqp-member25@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Comment Post E', [community.id]);
    const res = await memberAgent.post(`/api/me/headquarters-posts/${id}/comments`).send({ body: 'No CSRF' });
    expect(res.status).toBe(403);
  });

  it('comments are cursor-paginated oldest-first for direct rendering', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(46);
    const community = await makeCommunity('Comment Community F');
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237696900026', 'hqp-member26@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Comment Post F', [community.id]);
    const postedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await memberAgent
        .post(`/api/me/headquarters-posts/${id}/comments`)
        .set('X-CSRF-Token', memberCsrf)
        .send({ body: `Comment ${i}` });
      postedIds.push(r.body.id);
    }

    const list = await memberAgent.get(`/api/me/headquarters-posts/${id}/comments`);
    const ids = list.body.items.map((c: any) => c.id);
    expect(ids).toEqual(postedIds);
  });

  it('commentCount in the feed reflects the actual number of comments', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(47);
    const community = await makeCommunity('Comment Count Community');
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237696900027', 'hqp-member27@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Comment Count Post', [community.id]);
    await memberAgent.post(`/api/me/headquarters-posts/${id}/comments`).set('X-CSRF-Token', memberCsrf).send({ body: 'One' });
    await memberAgent.post(`/api/me/headquarters-posts/${id}/comments`).set('X-CSRF-Token', memberCsrf).send({ body: 'Two' });

    const detail = await memberAgent.get(`/api/me/headquarters-posts/${id}`);
    expect(detail.body.commentCount).toBe(2);
  });
});

describe('Headquarters Network Posts — reactions (shared engagement)', () => {
  it('an eligible Member can react to a post (idempotent toggle-on)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(48);
    const community = await makeCommunity('Reaction Community A');
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237696900028', 'hqp-member28@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Reaction Post A', [community.id]);
    const first = await memberAgent.post(`/api/me/headquarters-posts/${id}/reaction`).set('X-CSRF-Token', memberCsrf);
    expect(first.status).toBe(200);
    expect(first.body.viewerHasReacted).toBe(true);
    expect(first.body.reactionCount).toBe(1);

    const second = await memberAgent.post(`/api/me/headquarters-posts/${id}/reaction`).set('X-CSRF-Token', memberCsrf);
    expect(second.body.reactionCount).toBe(1);
  });

  it('a Member can remove their reaction (idempotent toggle-off)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(49);
    const community = await makeCommunity('Reaction Community B');
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237696900029', 'hqp-member29@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Reaction Post B', [community.id]);
    await memberAgent.post(`/api/me/headquarters-posts/${id}/reaction`).set('X-CSRF-Token', memberCsrf);

    const removed = await memberAgent.delete(`/api/me/headquarters-posts/${id}/reaction`).set('X-CSRF-Token', memberCsrf);
    expect(removed.status).toBe(200);
    expect(removed.body.viewerHasReacted).toBe(false);
    expect(removed.body.reactionCount).toBe(0);

    const again = await memberAgent.delete(`/api/me/headquarters-posts/${id}/reaction`).set('X-CSRF-Token', memberCsrf);
    expect(again.status).toBe(200);
    expect(again.body.reactionCount).toBe(0);
  });

  it('one shared reaction set: reactionCount is visible to every eligible reader, and viewerHasReacted is scoped per-Person', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(50);
    const community = await makeCommunity('Reaction Community C');
    const { agent: memberAgent1, csrf: memberCsrf1, person: person1 } = await loginAsMember('+237696900030', 'hqp-member30@example.com');
    const { agent: memberAgent2, person: person2 } = await loginAsMember('+237696900031', 'hqp-member31@example.com');
    await joinCommunity(person1.id, community.id);
    await joinCommunity(person2.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Reaction Post C', [community.id]);
    await memberAgent1.post(`/api/me/headquarters-posts/${id}/reaction`).set('X-CSRF-Token', memberCsrf1);

    const view2 = await memberAgent2.get(`/api/me/headquarters-posts/${id}`);
    expect(view2.body.reactionCount).toBe(1);
    expect(view2.body.viewerHasReacted).toBe(false);

    const view1 = await memberAgent1.get(`/api/me/headquarters-posts/${id}`);
    expect(view1.body.reactionCount).toBe(1);
    expect(view1.body.viewerHasReacted).toBe(true);
  });

  it('an ineligible Person cannot react (404)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(51);
    const community = await makeCommunity('Reaction Community D');
    const { agent: memberAgent, csrf: memberCsrf } = await loginAsMember('+237696900032', 'hqp-member32@example.com');

    const id = await publishTargeted(adminAgent, csrf, 'Reaction Post D', [community.id]);
    const res = await memberAgent.post(`/api/me/headquarters-posts/${id}/reaction`).set('X-CSRF-Token', memberCsrf);
    expect(res.status).toBe(404);

    const count = await prisma.headquartersPostReaction.count({ where: { headquartersPostId: id } });
    expect(count).toBe(0);
  });

  it('CSRF protection is enforced on reacting', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(52);
    const community = await makeCommunity('Reaction Community E');
    const { agent: memberAgent, person } = await loginAsMember('+237696900033', 'hqp-member33@example.com');
    await joinCommunity(person.id, community.id);

    const id = await publishTargeted(adminAgent, csrf, 'Reaction Post E', [community.id]);
    const res = await memberAgent.post(`/api/me/headquarters-posts/${id}/reaction`);
    expect(res.status).toBe(403);
  });
});

describe('Headquarters Network Posts — Announcement/Conversation independence', () => {
  it('creating and publishing a headquarters post never creates an Announcement row', async () => {
    const { agent, csrf } = await loginAsAdmin(53);
    const before = await prisma.announcement.count();
    await publishNetworkWide(agent, csrf, 'Independence Check');
    const after = await prisma.announcement.count();
    expect(after).toBe(before);
  });

  it('creating and publishing a headquarters post never creates a Conversation/Message row', async () => {
    const { agent, csrf } = await loginAsAdmin(54);
    const beforeConv = await prisma.conversation.count();
    const beforeMsg = await prisma.message.count();
    await publishNetworkWide(agent, csrf, 'Independence Check 2');
    expect(await prisma.conversation.count()).toBe(beforeConv);
    expect(await prisma.message.count()).toBe(beforeMsg);
  });
});
