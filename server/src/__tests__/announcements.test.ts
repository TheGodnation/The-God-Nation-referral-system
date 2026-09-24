import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Phase 3M.3 — Central Authority Targeted Announcements. Mirrors the exact
// conventions established in communityConversations.test.ts/
// followUpConversations.test.ts: agentWithUniqueIp, createLeader/createAdmin,
// bootstrap, loginAsMember.

const app = createApp();

let ipCounter = 1000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.98.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const email = `ann-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

async function setupLeader(n: number) {
  const email = `ann-leader${n}@test.local`;
  const { user } = await createLeader(`Announcement Leader ${n}`, email, `AN${n}CODE`);
  const person = await prisma.person.create({
    data: { name: `Announcement Leader Person ${n}`, whatsappNumber: `+237698${String(n).padStart(6, '0')}` },
  });
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function loginAsMember(whatsapp: string, email: string, name = 'Announcement Member') {
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

async function makeGeography(name: string, parentId?: string) {
  return prisma.geography.create({
    data: { name, parentId: parentId ?? null, type: 'REGION', countryCode: 'CM' },
  });
}

async function joinCommunity(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function assignGeography(personId: string, geographyId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.geographicAssignment.create({ data: { personId, geographyId, status } });
}

describe('Phase 3M.3 — Announcement model integrity', () => {
  it('rejects an AnnouncementTarget with both communityId and geographyId set', async () => {
    const user = await createAdmin('ann-model-integrity1@test.local');
    const announcement = await prisma.announcement.create({
      data: { titleEn: 'T', bodyEn: 'B', createdByUserId: user.id },
    });
    const community = await makeCommunity('Check Constraint Community');
    const geography = await makeGeography('Check Constraint Geography');

    await expect(
      prisma.announcementTarget.create({
        data: { announcementId: announcement.id, communityId: community.id, geographyId: geography.id },
      }),
    ).rejects.toThrow();
  });

  it('rejects an AnnouncementTarget with neither communityId nor geographyId set', async () => {
    const user = await createAdmin('ann-model-integrity2@test.local');
    const announcement = await prisma.announcement.create({
      data: { titleEn: 'T', bodyEn: 'B', createdByUserId: user.id },
    });

    await expect(
      prisma.announcementTarget.create({
        data: { announcementId: announcement.id },
      }),
    ).rejects.toThrow();
  });
});

describe('Phase 3M.3 — Admin authorization', () => {
  it('an Admin can create a draft announcement', async () => {
    const { agent, csrf } = await loginAsAdmin(3);
    const res = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Draft Title', bodyEn: 'Draft body.' });
    expect(res.status).toBe(201);
    expect(res.body.publishedAt).toBeNull();
    expect(res.body.archivedAt).toBeNull();
  });

  it('a Leader cannot create an announcement', async () => {
    const { agent, csrf } = await setupLeader(101);
    const res = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Nope', bodyEn: 'Nope.' });
    expect(res.status).toBe(403);
  });

  it('a Member cannot create an announcement', async () => {
    const { agent, csrf } = await loginAsMember('+237699900001', 'ann-member1@example.com');
    const res = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Nope', bodyEn: 'Nope.' });
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot create an announcement', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.post('/api/admin/announcements').send({ titleEn: 'Nope', bodyEn: 'Nope.' });
    expect(res.status).toBe(401);
  });

  it('CSRF protection is enforced on create', async () => {
    const { agent } = await loginAsAdmin(4);
    const res = await agent.post('/api/admin/announcements').send({ titleEn: 'No CSRF', bodyEn: 'No CSRF.' });
    expect(res.status).toBe(403);
  });

  it('the dedicated announcement mutation rate limiter applies', async () => {
    const { agent, csrf } = await loginAsAdmin(5);
    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent
        .post('/api/admin/announcements')
        .set('X-CSRF-Token', csrf)
        .send({ titleEn: `Rate ${i}`, bodyEn: 'Body.' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('Phase 3M.4 — a Leader cannot PATCH an announcement', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(48);
    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Symmetry Patch Target', bodyEn: 'Body.' });
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupLeader(107);

    const res = await leaderAgent
      .patch(`/api/admin/announcements/${created.body.id}`)
      .set('X-CSRF-Token', leaderCsrf)
      .send({ titleEn: 'Should not apply' });
    expect(res.status).toBe(403);
  });

  it('Phase 3M.4 — a Leader cannot publish an announcement', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(49);
    const community = await makeCommunity('Symmetry Publish Community');
    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Symmetry Publish Target', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupLeader(108);

    const res = await leaderAgent
      .post(`/api/admin/announcements/${created.body.id}/publish`)
      .set('X-CSRF-Token', leaderCsrf);
    expect(res.status).toBe(403);
  });

  it('Phase 3M.4 — a Leader cannot archive an announcement', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(50);
    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Symmetry Archive Target', bodyEn: 'Body.' });
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupLeader(109);

    const res = await leaderAgent
      .post(`/api/admin/announcements/${created.body.id}/archive`)
      .set('X-CSRF-Token', leaderCsrf);
    expect(res.status).toBe(403);
  });
});

describe('Phase 3M.3 — draft editing and lifecycle immutability', () => {
  it('an Admin can edit a draft\'s title/body/targets', async () => {
    const { agent, csrf } = await loginAsAdmin(6);
    const community = await makeCommunity('Editable Draft Community');
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Original', bodyEn: 'Original body.' });

    const patched = await agent
      .patch(`/api/admin/announcements/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Updated', targets: [{ communityId: community.id }] });
    expect(patched.status).toBe(200);
    expect(patched.body.titleEn).toBe('Updated');
    expect(patched.body.targets).toHaveLength(1);
  });

  it('editing a published announcement is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(7);
    const community = await makeCommunity('Published Immutable Community');
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'To Publish', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    const published = await agent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(published.status).toBe(200);

    const patchAttempt = await agent
      .patch(`/api/admin/announcements/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Should not apply' });
    expect(patchAttempt.status).toBe(409);
  });

  it('editing an archived announcement is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(8);
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'To Archive', bodyEn: 'Body.' });
    const archived = await agent.post(`/api/admin/announcements/${created.body.id}/archive`).set('X-CSRF-Token', csrf);
    expect(archived.status).toBe(200);

    const patchAttempt = await agent
      .patch(`/api/admin/announcements/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Should not apply' });
    expect(patchAttempt.status).toBe(409);
  });
});

describe('Phase 3M.3 — publication atomicity', () => {
  it('publishing without any target is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(9);
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'No Targets', bodyEn: 'Body.' });
    const res = await agent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(400);
  });

  it('publishing twice returns 409 the second time', async () => {
    const { agent, csrf } = await loginAsAdmin(10);
    const community = await makeCommunity('Double Publish Community');
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Once', bodyEn: 'Body.', targets: [{ communityId: community.id }] });

    const first = await agent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(first.status).toBe(200);
    const second = await agent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(second.status).toBe(409);
  });

  it('publishing an archived draft is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(11);
    const community = await makeCommunity('Archived Before Publish Community');
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Archived First', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await agent.post(`/api/admin/announcements/${created.body.id}/archive`).set('X-CSRF-Token', csrf);

    const res = await agent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(409);
  });
});

describe('Phase 3M.3 — archive lifecycle', () => {
  it('archiving a draft discards it (no separate hard-delete path)', async () => {
    const { agent, csrf } = await loginAsAdmin(12);
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Discard Me', bodyEn: 'Body.' });
    const res = await agent.post(`/api/admin/announcements/${created.body.id}/archive`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).not.toBeNull();
    expect(res.body.publishedAt).toBeNull();

    const stillStored = await prisma.announcement.findUnique({ where: { id: created.body.id } });
    expect(stillStored).not.toBeNull();
  });

  it('archiving an already-archived announcement returns 409', async () => {
    const { agent, csrf } = await loginAsAdmin(13);
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Archive Twice', bodyEn: 'Body.' });
    await agent.post(`/api/admin/announcements/${created.body.id}/archive`).set('X-CSRF-Token', csrf);
    const second = await agent.post(`/api/admin/announcements/${created.body.id}/archive`).set('X-CSRF-Token', csrf);
    expect(second.status).toBe(409);
  });

  it('an archived announcement no longer appears in the recipient feed even though eligibility would otherwise match', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(14);
    const community = await makeCommunity('Archived From Feed Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900002', 'ann-member2@example.com');
    await joinCommunity(person.id, community.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Will Be Archived', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/archive`).set('X-CSRF-Token', csrf);

    const feed = await memberAgent.get('/api/me/announcements');
    expect(feed.status).toBe(200);
    expect(feed.body.items.find((a: any) => a.id === created.body.id)).toBeUndefined();

    const detail = await memberAgent.get(`/api/me/announcements/${created.body.id}`);
    expect(detail.status).toBe(404);
  });
});

describe('Phase 3M.3 — Community targeting', () => {
  it('a Member with ACTIVE membership in the exact targeted Community sees the announcement', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(15);
    const community = await makeCommunity('Exact Match Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900003', 'ann-member3@example.com');
    await joinCommunity(person.id, community.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Community Announcement', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });

  it('a Member with INACTIVE membership in the targeted Community does not see it', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(16);
    const community = await makeCommunity('Inactive Membership Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900004', 'ann-member4@example.com');
    await joinCommunity(person.id, community.id, 'INACTIVE');

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Inactive Test', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });

  it('a Member in an untargeted Community does not see the announcement', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(17);
    const targeted = await makeCommunity('Targeted Only Community');
    const other = await makeCommunity('Untargeted Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900005', 'ann-member5@example.com');
    await joinCommunity(person.id, other.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Targeted Only', bodyEn: 'Body.', targets: [{ communityId: targeted.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });

  it('a Leader with a RoleAssignment (but no CommunityMembership) in the targeted Community does not qualify', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(18);
    const community = await makeCommunity('Leader Role Only Community');
    const { agent: leaderAgent, person: leaderPerson, user: leaderUser } = await setupLeader(102);
    await prisma.roleAssignment.create({
      data: { personId: leaderPerson.id, roleType: 'SCOPED_LEADER', assignedByUserId: leaderUser.id, communityId: community.id },
    });

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Leader Role Only', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await leaderAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });

  it('targeting a parent Community does not include a child Community\'s members (exact match only)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(19);
    const parent = await makeCommunity('Parent Community');
    const child = await makeCommunity('Child Community', parent.id);
    const { agent: memberAgent, person } = await loginAsMember('+237699900006', 'ann-member6@example.com');
    await joinCommunity(person.id, child.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Parent Only', bodyEn: 'Body.', targets: [{ communityId: parent.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });
});

describe('Phase 3M.3 — Geography targeting', () => {
  it('a Person whose GeographicAssignment matches the exact targeted Geography sees the announcement', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(20);
    const geography = await makeGeography('Exact Match Geography');
    const { agent: memberAgent, person } = await loginAsMember('+237699900007', 'ann-member7@example.com');
    await assignGeography(person.id, geography.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Geo Exact', bodyEn: 'Body.', targets: [{ geographyId: geography.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });

  it('a Person whose GeographicAssignment is a descendant of the targeted Geography sees the announcement', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(21);
    const region = await makeGeography('Descendant Region');
    const city = await makeGeography('Descendant City', region.id);
    const { agent: memberAgent, person } = await loginAsMember('+237699900008', 'ann-member8@example.com');
    await assignGeography(person.id, city.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Geo Descendant', bodyEn: 'Body.', targets: [{ geographyId: region.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });

  it('multi-level descendant (grandchild) still qualifies', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(22);
    const country = await makeGeography('GC Country');
    const region = await makeGeography('GC Region', country.id);
    const city = await makeGeography('GC City', region.id);
    const { agent: memberAgent, person } = await loginAsMember('+237699900009', 'ann-member9@example.com');
    await assignGeography(person.id, city.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Geo Grandchild', bodyEn: 'Body.', targets: [{ geographyId: country.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });

  it('a Person whose GeographicAssignment is an ANCESTOR of the targeted Geography does not qualify (outside subtree)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(23);
    const region = await makeGeography('Ancestor Region');
    const city = await makeGeography('Ancestor City', region.id);
    const { agent: memberAgent, person } = await loginAsMember('+237699900010', 'ann-member10@example.com');
    await assignGeography(person.id, region.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Geo Ancestor Exclusion', bodyEn: 'Body.', targets: [{ geographyId: city.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });

  it('a Person with an INACTIVE GeographicAssignment does not qualify', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(24);
    const geography = await makeGeography('Inactive Geo Assignment');
    const { agent: memberAgent, person } = await loginAsMember('+237699900011', 'ann-member11@example.com');
    await assignGeography(person.id, geography.id, 'INACTIVE');

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Geo Inactive', bodyEn: 'Body.', targets: [{ geographyId: geography.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });

  it('Phase 3M.4 — an active geographical RoleAssignment alone does not grant Geography-targeted announcement access (RoleAssignment ≠ GeographicAssignment)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(44);
    const geography = await makeGeography('Leader Geo Role Only Region');
    const { agent: leaderAgent, person: leaderPerson, user: leaderUser } = await setupLeader(106);
    await prisma.roleAssignment.create({
      data: { personId: leaderPerson.id, roleType: 'SCOPED_LEADER', assignedByUserId: leaderUser.id, geographyId: geography.id },
    });
    // Deliberately no GeographicAssignment for leaderPerson at all.

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Geo Leader Role Only', bodyEn: 'Body.', targets: [{ geographyId: geography.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await leaderAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });

  it('Phase 3M.4 — a Person with NO GeographicAssignment row at all (distinct from an INACTIVE one) does not qualify', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(45);
    const geography = await makeGeography('No Assignment At All Region');
    const { agent: memberAgent } = await loginAsMember('+237699900024', 'ann-member24@example.com');
    // No assignGeography call at all — no GeographicAssignment row exists for this Person.

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Geo No Assignment', bodyEn: 'Body.', targets: [{ geographyId: geography.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);

    const assignment = await prisma.geographicAssignment.findFirst({ where: { geographyId: geography.id } });
    expect(assignment).toBeNull();
  });
});

describe('Phase 3M.3 — combined targeting and deduplication', () => {
  it('a Person matching only the Geography target of a combined Community+Geography announcement still sees it', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(25);
    const community = await makeCommunity('Combined Community');
    const geography = await makeGeography('Combined Geography');
    const { agent: memberAgent, person } = await loginAsMember('+237699900012', 'ann-member12@example.com');
    await assignGeography(person.id, geography.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({
        titleEn: 'Combined Target',
        bodyEn: 'Body.',
        targets: [{ communityId: community.id }, { geographyId: geography.id }],
      });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });

  it('a Person matching multiple targets of the same announcement sees it only once', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(26);
    const communityA = await makeCommunity('Dedup Community A');
    const communityB = await makeCommunity('Dedup Community B');
    const { agent: memberAgent, person } = await loginAsMember('+237699900013', 'ann-member13@example.com');
    await joinCommunity(person.id, communityA.id);
    await joinCommunity(person.id, communityB.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({
        titleEn: 'Dedup Target',
        bodyEn: 'Body.',
        targets: [{ communityId: communityA.id }, { communityId: communityB.id }],
      });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    const matches = res.body.items.filter((a: any) => a.id === created.body.id);
    expect(matches).toHaveLength(1);
  });

  it('Phase 3M.4 — a Person matching two Geography targets on the same announcement receives it only once', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(46);
    const country = await makeGeography('Dedup Geo Country');
    const region = await makeGeography('Dedup Geo Region', country.id);
    const city = await makeGeography('Dedup Geo City', region.id);
    const { agent: memberAgent, person } = await loginAsMember('+237699900025', 'ann-member25@example.com');
    await assignGeography(person.id, city.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({
        titleEn: 'Dedup Geo Target',
        bodyEn: 'Body.',
        // Both targets are ancestors of `city` at different levels of the
        // same chain, so `person` independently matches both.
        targets: [{ geographyId: country.id }, { geographyId: region.id }],
      });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    const matches = res.body.items.filter((a: any) => a.id === created.body.id);
    expect(matches).toHaveLength(1);
  });

  it('Phase 3M.4 — overlapping parent + child Geography targets on the same announcement: Person assigned to the child is eligible and receives it once', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(47);
    const parentGeo = await makeGeography('Overlap Parent Region');
    const childGeo = await makeGeography('Overlap Child Division', parentGeo.id);
    const { agent: memberAgent, person } = await loginAsMember('+237699900026', 'ann-member26@example.com');
    await assignGeography(person.id, childGeo.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({
        titleEn: 'Overlapping Parent Child Geo',
        bodyEn: 'Body.',
        targets: [{ geographyId: parentGeo.id }, { geographyId: childGeo.id }],
      });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/announcements');
    const matches = res.body.items.filter((a: any) => a.id === created.body.id);
    expect(matches).toHaveLength(1);
  });
});

describe('Phase 3M.3 — dynamic eligibility (current state controls access)', () => {
  it('joining a targeted Community after publication grants access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(27);
    const community = await makeCommunity('Join After Publish Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900014', 'ann-member14@example.com');

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Join After', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const before = await memberAgent.get('/api/me/announcements');
    expect(before.body.items.map((a: any) => a.id)).not.toContain(created.body.id);

    await joinCommunity(person.id, community.id);

    const after = await memberAgent.get('/api/me/announcements');
    expect(after.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });

  it('leaving a targeted Community after publication removes access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(28);
    const community = await makeCommunity('Leave After Publish Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900015', 'ann-member15@example.com');
    const membership = await joinCommunity(person.id, community.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Leave After', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const before = await memberAgent.get('/api/me/announcements');
    expect(before.body.items.map((a: any) => a.id)).toContain(created.body.id);

    await prisma.communityMembership.update({ where: { id: membership.id }, data: { status: 'INACTIVE' } });

    const after = await memberAgent.get('/api/me/announcements');
    expect(after.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });

  it('moving Geography after publication removes access to the old target and can grant access to a new one', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(29);
    const oldGeo = await makeGeography('Move From Geo');
    const newGeo = await makeGeography('Move To Geo');
    const { agent: memberAgent, person } = await loginAsMember('+237699900016', 'ann-member16@example.com');
    await assignGeography(person.id, oldGeo.id);

    const oldAnnouncement = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Old Geo Announcement', bodyEn: 'Body.', targets: [{ geographyId: oldGeo.id }] });
    await adminAgent.post(`/api/admin/announcements/${oldAnnouncement.body.id}/publish`).set('X-CSRF-Token', csrf);
    const newAnnouncement = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'New Geo Announcement', bodyEn: 'Body.', targets: [{ geographyId: newGeo.id }] });
    await adminAgent.post(`/api/admin/announcements/${newAnnouncement.body.id}/publish`).set('X-CSRF-Token', csrf);

    const before = await memberAgent.get('/api/me/announcements');
    expect(before.body.items.map((a: any) => a.id)).toContain(oldAnnouncement.body.id);
    expect(before.body.items.map((a: any) => a.id)).not.toContain(newAnnouncement.body.id);

    await prisma.geographicAssignment.update({ where: { personId: person.id }, data: { geographyId: newGeo.id } });

    const after = await memberAgent.get('/api/me/announcements');
    expect(after.body.items.map((a: any) => a.id)).not.toContain(oldAnnouncement.body.id);
    expect(after.body.items.map((a: any) => a.id)).toContain(newAnnouncement.body.id);
  });

  it('a Person eligible via one target retains access after losing eligibility via another target', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(30);
    const community = await makeCommunity('Retain Via Other Target Community');
    const geography = await makeGeography('Retain Via Other Target Geography');
    const { agent: memberAgent, person } = await loginAsMember('+237699900017', 'ann-member17@example.com');
    const membership = await joinCommunity(person.id, community.id);
    await assignGeography(person.id, geography.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({
        titleEn: 'Retained Via Geography',
        bodyEn: 'Body.',
        targets: [{ communityId: community.id }, { geographyId: geography.id }],
      });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    await prisma.communityMembership.update({ where: { id: membership.id }, data: { status: 'INACTIVE' } });

    const res = await memberAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });
});

describe('Phase 3M.3 — Member/Leader/Admin recipient-surface separation', () => {
  it('a Leader qualifies under the exact same audience rules as a Member (via their own linked Person)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(31);
    const community = await makeCommunity('Leader Recipient Community');
    const { agent: leaderAgent, person: leaderPerson } = await setupLeader(103);
    await joinCommunity(leaderPerson.id, community.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'For Leader Too', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await leaderAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });

  it('Phase 3M.4 — a Leader receives a Geography-targeted announcement under the exact same audience rules as a Member (via their own linked Person), with no special access granted', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(43);
    const geography = await makeGeography('Leader Geography Recipient Region');
    const { agent: leaderAgent, person: leaderPerson } = await setupLeader(105);
    await assignGeography(leaderPerson.id, geography.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Geo For Leader Too', bodyEn: 'Body.', targets: [{ geographyId: geography.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await leaderAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).toContain(created.body.id);
  });

  it('being a Leader alone (no matching membership/assignment) does not grant access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(32);
    const community = await makeCommunity('Leader Without Membership Community');
    const { agent: leaderAgent } = await setupLeader(104);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Leader No Access', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await leaderAgent.get('/api/me/announcements');
    expect(res.body.items.map((a: any) => a.id)).not.toContain(created.body.id);
  });

  it('an Admin session cannot use the recipient endpoint as a bypass', async () => {
    const { agent } = await loginAsAdmin(33);
    const res = await agent.get('/api/me/announcements');
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot access the recipient endpoint', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/me/announcements');
    expect(res.status).toBe(401);
  });
});

describe('Phase 3M.3 — IDOR / non-disclosure', () => {
  it('GET /api/me/announcements/:id returns 404 for an unknown id', async () => {
    const { agent } = await loginAsMember('+237699900018', 'ann-member18@example.com');
    const res = await agent.get('/api/me/announcements/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('GET /api/me/announcements/:id returns 404 for a real but ineligible announcement', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(34);
    const community = await makeCommunity('IDOR Community');
    const { agent: memberAgent } = await loginAsMember('+237699900019', 'ann-member19@example.com');

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Not For You', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get(`/api/me/announcements/${created.body.id}`);
    expect(res.status).toBe(404);
  });

  it('GET /api/me/announcements/:id returns 404 for an unpublished draft, even for an eligible Person', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(35);
    const community = await makeCommunity('Draft Not Visible Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900020', 'ann-member20@example.com');
    await joinCommunity(person.id, community.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Still Draft', bodyEn: 'Body.', targets: [{ communityId: community.id }] });

    const res = await memberAgent.get(`/api/me/announcements/${created.body.id}`);
    expect(res.status).toBe(404);
  });
});

describe('Phase 3M.3 — recipient response privacy', () => {
  it('the recipient response never exposes target/organizational internals', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(36);
    const community = await makeCommunity('Privacy Check Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900021', 'ann-member21@example.com');
    await joinCommunity(person.id, community.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Privacy Check', titleFr: 'Verification', bodyEn: 'Body.', bodyFr: 'Corps.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get(`/api/me/announcements/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['bodyEn', 'bodyFr', 'id', 'publishedAt', 'titleEn', 'titleFr'].sort());
    expect(res.body).not.toHaveProperty('targets');
    expect(res.body).not.toHaveProperty('createdByUserId');
    expect(res.body).not.toHaveProperty('createdBy');
    expect(res.body).not.toHaveProperty('archivedAt');
  });

  it('the Admin list response never exposes a per-Person recipient list', async () => {
    const { agent, csrf } = await loginAsAdmin(37);
    const community = await makeCommunity('Admin Response Community');
    const created = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Admin View', bodyEn: 'Body.', targets: [{ communityId: community.id }] });

    const res = await agent.get(`/api/admin/announcements/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('recipients');
    expect(res.body).not.toHaveProperty('recipientCount');
    expect(res.body.targets[0].communityName).toBe('Admin Response Community');
  });
});

describe('Phase 3M.3 — pagination', () => {
  it('GET /api/me/announcements paginates deterministically with no duplicates across pages', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(38);
    const community = await makeCommunity('Pagination Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900022', 'ann-member22@example.com');
    await joinCommunity(person.id, community.id);

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const created = await adminAgent
        .post('/api/admin/announcements')
        .set('X-CSRF-Token', csrf)
        .send({ titleEn: `Page Item ${i}`, bodyEn: 'Body.', targets: [{ communityId: community.id }] });
      await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
      ids.push(created.body.id);
    }

    const page1 = await memberAgent.get('/api/me/announcements?page=1&pageSize=2');
    const page2 = await memberAgent.get('/api/me/announcements?page=2&pageSize=2');
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(2);
    const page1Ids = page1.body.items.map((a: any) => a.id);
    const page2Ids = page2.body.items.map((a: any) => a.id);
    expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
    expect(page1.body.pagination.total).toBeGreaterThanOrEqual(5);
  });

  it('GET /api/admin/announcements paginates by createdAt desc', async () => {
    const { agent, csrf } = await loginAsAdmin(39);
    const first = await agent.post('/api/admin/announcements').set('X-CSRF-Token', csrf).send({ titleEn: 'First Created', bodyEn: 'Body.' });
    const second = await agent.post('/api/admin/announcements').set('X-CSRF-Token', csrf).send({ titleEn: 'Second Created', bodyEn: 'Body.' });

    const res = await agent.get('/api/admin/announcements?page=1&pageSize=2');
    expect(res.status).toBe(200);
    const ids = res.body.items.map((a: any) => a.id);
    expect(ids.indexOf(second.body.id)).toBeLessThan(ids.indexOf(first.body.id));
  });
});

describe('Phase 3M.3 — i18n fallback fields', () => {
  it('an announcement created without French content returns null titleFr/bodyFr for the client to fall back on', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(40);
    const community = await makeCommunity('No French Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699900023', 'ann-member23@example.com');
    await joinCommunity(person.id, community.id);

    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'English Only', bodyEn: 'English body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get(`/api/me/announcements/${created.body.id}`);
    expect(res.body.titleFr).toBeNull();
    expect(res.body.bodyFr).toBeNull();
    expect(res.body.titleEn).toBe('English Only');
  });
});

describe('Phase 3M.3 — target validation', () => {
  it('rejects a target with both communityId and geographyId at the API layer', async () => {
    const { agent, csrf } = await loginAsAdmin(41);
    const community = await makeCommunity('Invalid Target Community');
    const geography = await makeGeography('Invalid Target Geography');
    const res = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Invalid', bodyEn: 'Body.', targets: [{ communityId: community.id, geographyId: geography.id }] });
    expect(res.status).toBe(400);
  });

  it('rejects a target referencing an unknown Community id', async () => {
    const { agent, csrf } = await loginAsAdmin(42);
    const res = await agent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Unknown Ref', bodyEn: 'Body.', targets: [{ communityId: '00000000-0000-0000-0000-000000000000' }] });
    expect(res.status).toBe(400);
  });
});
