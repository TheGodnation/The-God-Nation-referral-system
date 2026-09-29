import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Book / Resource Access Grants — mirrors the exact conventions established
// in privateMessaging.test.ts / communityPostingPolicy.test.ts:
// agentWithUniqueIp, createLeader/createAdmin, bootstrap, loginAsMember,
// setupCommunityLeader.

const app = createApp();

let ipCounter = 10000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.93.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const email = `ra-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

async function makePerson(whatsappNumber: string, name = 'RA Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeMembership(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function setupCommunityLeader(n: number, communityId: string) {
  const email = `ra-leader${n}@test.local`;
  const { user } = await createLeader(`RA Leader ${n}`, email, `RA${n}CODE`);
  const person = await makePerson(`+237693${String(n).padStart(6, '0')}`, `RA Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

async function loginAsMember(whatsapp: string, email: string, name = 'RA Member') {
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

async function createResource(agent: any, csrf: string, titleEn: string) {
  const res = await agent.post('/api/admin/resources').set('X-CSRF-Token', csrf).send({ titleEn });
  return res.body;
}

describe('Resource Access Grants — authentication', () => {
  it('an unauthenticated caller cannot list resources', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/me/resources');
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot grant access', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.post('/api/admin/people/00000000-0000-0000-0000-000000000000/resource-access').send({ resourceId: 'x' });
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot revoke access', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.patch('/api/admin/resource-access/00000000-0000-0000-0000-000000000000/revoke');
    expect(res.status).toBe(401);
  });
});

describe('Resource Access Grants — Admin authorization', () => {
  it('an Admin can grant access', async () => {
    const { agent, csrf } = await loginAsAdmin(1);
    const resource = await createResource(agent, csrf, 'Grant Test Resource');
    const person = await makePerson('+237692900001', 'Grant Test Person');

    const res = await agent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('an Admin can revoke access', async () => {
    const { agent, csrf } = await loginAsAdmin(2);
    const resource = await createResource(agent, csrf, 'Revoke Test Resource');
    const person = await makePerson('+237692900002', 'Revoke Test Person');
    const granted = await agent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });

    const res = await agent.patch(`/api/admin/resource-access/${granted.body.id}/revoke`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REVOKED');
  });

  it('a non-Admin (Leader) cannot grant access', async () => {
    const community = await makeCommunity('Leader Cannot Grant Community');
    const { agent, csrf } = await setupCommunityLeader(1, community.id);
    const person = await makePerson('+237692900003', 'Leader Grant Target');

    const res = await agent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(403);
  });

  it('a non-Admin (Member) cannot revoke access', async () => {
    const { agent, csrf } = await loginAsMember('+237692900004', 'ra-member1@example.com');
    const res = await agent.patch('/api/admin/resource-access/00000000-0000-0000-0000-000000000000/revoke').set('X-CSRF-Token', csrf);
    expect(res.status).toBe(401);
  });

  it('a client-supplied grantedByUserId in the request body cannot bypass or spoof authorization', async () => {
    const { agent, csrf } = await loginAsAdmin(3);
    const otherAdmin = await createAdmin('ra-other-admin@test.local');
    const resource = await createResource(agent, csrf, 'Spoof GrantedBy Resource');
    const person = await makePerson('+237692900005', 'Spoof GrantedBy Person');

    const res = await agent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id, grantedByUserId: otherAdmin.id });
    expect(res.status).toBe(201);

    const stored = await prisma.resourceAccessGrant.findFirst({ where: { personId: person.id, resourceId: resource.id } });
    expect(stored!.grantedByUserId).not.toBe(otherAdmin.id);
  });
});

describe('Resource Access Grants — grant behavior', () => {
  it('a granted Person receives access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(4);
    const resource = await createResource(adminAgent, csrf, 'Access Granted Resource');
    const { agent: memberAgent, person } = await loginAsMember('+237692900006', 'ra-member2@example.com');
    await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });

    const res = await memberAgent.get('/api/me/resources');
    expect(res.body.items.map((r: any) => r.id)).toContain(resource.id);
  });

  it('a Person without a grant does not receive access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(5);
    const resource = await createResource(adminAgent, csrf, 'No Grant Resource');
    const { agent: memberAgent } = await loginAsMember('+237692900007', 'ra-member3@example.com');

    const res = await memberAgent.get('/api/me/resources');
    expect(res.body.items.map((r: any) => r.id)).not.toContain(resource.id);
  });

  it('a duplicate active grant is idempotent (same underlying row, no error)', async () => {
    const { agent, csrf } = await loginAsAdmin(6);
    const resource = await createResource(agent, csrf, 'Duplicate Grant Resource');
    const person = await makePerson('+237692900008', 'Duplicate Grant Person');

    const first = await agent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });
    const second = await agent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const count = await prisma.resourceAccessGrant.count({ where: { personId: person.id, resourceId: resource.id } });
    expect(count).toBe(1);
  });

  it('a revoked grant removes access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(7);
    const resource = await createResource(adminAgent, csrf, 'Revoke Removes Access Resource');
    const { agent: memberAgent, person } = await loginAsMember('+237692900009', 'ra-member4@example.com');
    const granted = await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });

    const before = await memberAgent.get('/api/me/resources');
    expect(before.body.items.map((r: any) => r.id)).toContain(resource.id);

    await adminAgent.patch(`/api/admin/resource-access/${granted.body.id}/revoke`).set('X-CSRF-Token', csrf);

    const after = await memberAgent.get('/api/me/resources');
    expect(after.body.items.map((r: any) => r.id)).not.toContain(resource.id);
  });

  it('granting the same Resource again after revocation reactivates access correctly', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(8);
    const resource = await createResource(adminAgent, csrf, 'Re-grant Resource');
    const { agent: memberAgent, person } = await loginAsMember('+237692900010', 'ra-member5@example.com');
    const granted = await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });
    await adminAgent.patch(`/api/admin/resource-access/${granted.body.id}/revoke`).set('X-CSRF-Token', csrf);

    const regrant = await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });
    expect(regrant.status).toBe(201);
    expect(regrant.body.status).toBe('ACTIVE');
    expect(regrant.body.id).toBe(granted.body.id);

    const after = await memberAgent.get('/api/me/resources');
    expect(after.body.items.map((r: any) => r.id)).toContain(resource.id);
  });

  it('revoking an already-revoked grant returns 409', async () => {
    const { agent, csrf } = await loginAsAdmin(9);
    const resource = await createResource(agent, csrf, 'Double Revoke Resource');
    const person = await makePerson('+237692900011', 'Double Revoke Person');
    const granted = await agent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });
    await agent.patch(`/api/admin/resource-access/${granted.body.id}/revoke`).set('X-CSRF-Token', csrf);

    const second = await agent.patch(`/api/admin/resource-access/${granted.body.id}/revoke`).set('X-CSRF-Token', csrf);
    expect(second.status).toBe(409);
  });
});

describe('Resource Access Grants — identity isolation', () => {
  it('a Member cannot use another Person\'s id to obtain access (their own list is always scoped to their own session)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(10);
    const resource = await createResource(adminAgent, csrf, 'Isolation Resource');
    const { person: p1 } = await loginAsMember('+237692900012', 'ra-member6@example.com');
    const { agent: p2Agent } = await loginAsMember('+237692900013', 'ra-member7@example.com');
    await adminAgent.post(`/api/admin/people/${p1.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });

    const res = await p2Agent.get('/api/me/resources');
    expect(res.body.items.map((r: any) => r.id)).not.toContain(resource.id);
  });

  it('a client-supplied personId in the request body/query cannot change the authenticated identity used for access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(11);
    const resource = await createResource(adminAgent, csrf, 'Spoof Identity Resource');
    const { person: p1 } = await loginAsMember('+237692900014', 'ra-member8@example.com');
    const { agent: p2Agent } = await loginAsMember('+237692900015', 'ra-member9@example.com');
    await adminAgent.post(`/api/admin/people/${p1.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });

    const res = await p2Agent.get(`/api/me/resources?personId=${p1.id}`);
    expect(res.body.items.map((r: any) => r.id)).not.toContain(resource.id);

    const detail = await p2Agent.get(`/api/me/resources/${resource.id}`);
    expect(detail.status).toBe(404);
  });

  it('a Leader cannot grant access merely because they lead a Community', async () => {
    const community = await makeCommunity('Leader No Grant Authority Community');
    const { agent, csrf, person: leaderPerson } = await setupCommunityLeader(2, community.id);
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin(12);
    const resource = await createResource(adminAgent, adminCsrf, 'Leader Authority Resource');
    void leaderPerson;

    const res = await agent
      .post(`/api/admin/people/${leaderPerson.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    expect(res.status).toBe(403);
  });
});

describe('Resource Access Grants — resource protection', () => {
  it('an unauthorized Person cannot retrieve protected resource content', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(13);
    const resource = await createResource(adminAgent, csrf, 'Protected Content Resource');
    const { agent: memberAgent } = await loginAsMember('+237692900016', 'ra-member10@example.com');

    const res = await memberAgent.get(`/api/me/resources/${resource.id}`);
    expect(res.status).toBe(404);
  });

  it('an authorized Person can retrieve permitted resource content', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(14);
    const resource = await adminAgent
      .post('/api/admin/resources')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Readable Resource', url: 'https://example.com/book.pdf' });
    const { agent: memberAgent, person } = await loginAsMember('+237692900017', 'ra-member11@example.com');
    await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.body.id });

    const res = await memberAgent.get(`/api/me/resources/${resource.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://example.com/book.pdf');
  });

  it('a nonexistent Resource is handled correctly (404, never a 500)', async () => {
    const { agent } = await loginAsMember('+237692900018', 'ra-member12@example.com');
    const res = await agent.get('/api/me/resources/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('an inactive Resource is never visible to a granted Person, matching its intended availability rule', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(15);
    const resource = await createResource(adminAgent, csrf, 'Deactivated Resource');
    const { agent: memberAgent, person } = await loginAsMember('+237692900019', 'ra-member13@example.com');
    await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });
    await adminAgent.patch(`/api/admin/resources/${resource.id}`).set('X-CSRF-Token', csrf).send({ active: false });

    const list = await memberAgent.get('/api/me/resources');
    expect(list.body.items.map((r: any) => r.id)).not.toContain(resource.id);

    const detail = await memberAgent.get(`/api/me/resources/${resource.id}`);
    expect(detail.status).toBe(404);
  });
});

describe('Resource Access Grants — domain isolation', () => {
  it('Community membership alone does not grant access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(16);
    const resource = await createResource(adminAgent, csrf, 'Community Alone Resource');
    const community = await makeCommunity('Membership Alone Community');
    const { agent: memberAgent, person } = await loginAsMember('+237692900020', 'ra-member14@example.com');
    await makeMembership(person.id, community.id);

    const res = await memberAgent.get('/api/me/resources');
    expect(res.body.items.map((r: any) => r.id)).not.toContain(resource.id);
  });

  it('Leader status alone does not grant access', async () => {
    const community = await makeCommunity('Leader Alone Community');
    const { agent, csrf: leaderCsrf, person: leaderPerson } = await setupCommunityLeader(3, community.id);
    const { agent: adminAgent, csrf } = await loginAsAdmin(17);
    const resource = await createResource(adminAgent, csrf, 'Leader Alone Resource');
    void leaderCsrf;

    const detail = await agent.get(`/api/me/resources/${resource.id}`);
    expect(detail.status).toBe(404);
    void leaderPerson;
  });

  it('Geography does not grant access', async () => {
    const geography = await prisma.geography.create({ data: { name: 'RA Geography', type: 'REGION', countryCode: 'CM' } });
    const { agent: adminAgent, csrf } = await loginAsAdmin(18);
    const resource = await createResource(adminAgent, csrf, 'Geography Alone Resource');
    const { agent: memberAgent, person } = await loginAsMember('+237692900021', 'ra-member15@example.com');
    await prisma.geographicAssignment.create({ data: { personId: person.id, geographyId: geography.id } });

    const res = await memberAgent.get('/api/me/resources');
    expect(res.body.items.map((r: any) => r.id)).not.toContain(resource.id);
  });

  it('private-message participation does not grant access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(19);
    const resource = await createResource(adminAgent, csrf, 'PM Alone Resource');
    const { agent: memberAgent, person } = await loginAsMember('+237692900022', 'ra-member16@example.com');
    await adminAgent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });

    const res = await memberAgent.get('/api/me/resources');
    expect(res.body.items.map((r: any) => r.id)).not.toContain(resource.id);
  });

  it('Announcement receipt does not grant access', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(20);
    const resource = await createResource(adminAgent, csrf, 'Announcement Alone Resource');
    const community = await makeCommunity('Announcement Alone Community');
    const { agent: memberAgent, person } = await loginAsMember('+237692900023', 'ra-member17@example.com');
    await makeMembership(person.id, community.id);
    const created = await adminAgent
      .post('/api/admin/announcements')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Alone', bodyEn: 'Body.', targets: [{ communityId: community.id }] });
    await adminAgent.post(`/api/admin/announcements/${created.body.id}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get('/api/me/resources');
    expect(res.body.items.map((r: any) => r.id)).not.toContain(resource.id);
  });

  it('a FollowUpAssignment does not grant access', async () => {
    const community = await makeCommunity('FollowUp Alone Community');
    const { agent, csrf } = await setupCommunityLeader(4, community.id);
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin(21);
    const resource = await createResource(adminAgent, adminCsrf, 'FollowUp Alone Resource');
    const { agent: memberAgent, person: followed } = await loginAsMember('+237692900024', 'ra-member18@example.com');
    await makeMembership(followed.id, community.id);

    await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    const res = await memberAgent.get('/api/me/resources');
    expect(res.body.items.map((r: any) => r.id)).not.toContain(resource.id);
  });
});

describe('Resource Access Grants — existing systems remain unchanged', () => {
  it('MonthlyDevotional member eligibility behavior is unaffected', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(22);
    const community = await makeCommunity('Devotional Unaffected Community');
    const devotional = await adminAgent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', csrf)
      .send({
        titleEn: 'Unaffected Devotional',
        contentEn: 'Content.',
        communityId: community.id,
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T00:00:00Z',
      });
    await adminAgent.patch(`/api/admin/devotionals/${devotional.body.id}`).set('X-CSRF-Token', csrf).send({ status: 'PUBLISHED' });

    const { agent: memberAgent, person } = await loginAsMember('+237692900025', 'ra-member19@example.com');
    await makeMembership(person.id, community.id);

    const res = await memberAgent.get('/api/member/devotionals');
    expect(res.status).toBe(200);
    expect(res.body.items.map((d: any) => d.id)).toContain(devotional.body.id);
  });
});

describe('Resource Access Grants — pagination', () => {
  it('the Resource catalog list paginates deterministically', async () => {
    const { agent, csrf } = await loginAsAdmin(23);
    for (let i = 0; i < 5; i++) {
      await createResource(agent, csrf, `Pagination Resource ${i}`);
    }

    const page1 = await agent.get('/api/admin/resources?page=1&pageSize=2');
    const page2 = await agent.get('/api/admin/resources?page=2&pageSize=2');
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(2);
    const ids1 = page1.body.items.map((r: any) => r.id);
    const ids2 = page2.body.items.map((r: any) => r.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
    expect(page1.body.pagination.total).toBeGreaterThanOrEqual(5);
  });

  it('a Member\'s own resource list paginates deterministically', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(24);
    const { agent: memberAgent, person } = await loginAsMember('+237692900026', 'ra-member20@example.com');
    for (let i = 0; i < 5; i++) {
      const resource = await createResource(adminAgent, csrf, `Member Pagination Resource ${i}`);
      await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });
    }

    const page1 = await memberAgent.get('/api/me/resources?page=1&pageSize=2');
    const page2 = await memberAgent.get('/api/me/resources?page=2&pageSize=2');
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(2);
    expect(page1.body.pagination.total).toBeGreaterThanOrEqual(5);
  });
});

describe('Resource Access Grants — privacy', () => {
  it('member-facing responses never expose grant/audit internals or unrelated Person fields', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(25);
    const resource = await createResource(adminAgent, csrf, 'Privacy Check Resource');
    const { agent: memberAgent, person } = await loginAsMember('+237692900027', 'ra-member21@example.com');
    await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });

    const detail = await memberAgent.get(`/api/me/resources/${resource.id}`);
    expect(Object.keys(detail.body).sort()).toEqual(['descriptionEn', 'descriptionFr', 'id', 'titleEn', 'titleFr', 'url'].sort());

    const list = await memberAgent.get('/api/me/resources');
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain('whatsapp');
    expect(raw).not.toContain(person.whatsappNumber);
    expect(raw).not.toContain('grantedByUserId');
  });

  it('a non-Admin cannot enumerate another Person\'s grants', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(26);
    const resource = await createResource(adminAgent, csrf, 'Enumerate Resource');
    const { person } = await loginAsMember('+237692900028', 'ra-member22@example.com');
    await adminAgent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });

    const { agent: strangerAgent, csrf: strangerCsrf } = await loginAsMember('+237692900029', 'ra-member23@example.com');
    const res = await strangerAgent.get(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', strangerCsrf);
    expect(res.status).toBe(401);
  });
});

describe('Resource Access Grants — security', () => {
  it('CSRF protection is enforced on granting', async () => {
    const { agent, csrf } = await loginAsAdmin(27);
    const resource = await createResource(agent, csrf, 'CSRF Grant Resource');
    const person = await makePerson('+237692900030', 'CSRF Grant Person');

    const res = await agent.post(`/api/admin/people/${person.id}/resource-access`).send({ resourceId: resource.id });
    expect(res.status).toBe(403);
  });

  it('CSRF protection is enforced on revoking', async () => {
    const { agent, csrf } = await loginAsAdmin(28);
    const resource = await createResource(agent, csrf, 'CSRF Revoke Resource');
    const person = await makePerson('+237692900031', 'CSRF Revoke Person');
    const granted = await agent.post(`/api/admin/people/${person.id}/resource-access`).set('X-CSRF-Token', csrf).send({ resourceId: resource.id });

    const res = await agent.patch(`/api/admin/resource-access/${granted.body.id}/revoke`);
    expect(res.status).toBe(403);
  });

  it('an unauthorized grant attempt never writes any row', async () => {
    const community = await makeCommunity('No Write Community');
    const { agent, csrf } = await setupCommunityLeader(5, community.id);
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin(29);
    const resource = await createResource(adminAgent, adminCsrf, 'No Write Resource');
    const person = await makePerson('+237692900032', 'No Write Person');

    const before = await prisma.resourceAccessGrant.count();
    const res = await agent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    expect(res.status).toBe(403);
    const after = await prisma.resourceAccessGrant.count();
    expect(after).toBe(before);
  });
});
