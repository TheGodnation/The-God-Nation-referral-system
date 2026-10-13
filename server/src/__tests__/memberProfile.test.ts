import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { createLeader } from './helpers';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.90.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function loginAsMember(whatsapp: string, email: string, name = 'Profile Test Member') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp, email: 'person-on-file@example.com' } });
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

describe('Phase 3F — PATCH /api/member/me/profile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.patch('/api/member/me/profile').send({ name: 'New Name' });
    expect(res.status).toBe(401);
  });

  it('lets an authenticated member update their own name', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000001', 'profile1@example.com');

    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.name).toBe('Updated Name');
  });

  it('lets an authenticated member update their own preferredLanguage', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000002', 'profile2@example.com');

    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ preferredLanguage: 'fr' });
    expect(res.status).toBe(200);
    expect(res.body.preferredLanguage).toBe('fr');

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.preferredLanguage).toBe('fr');
  });

  it('a partial update (name only) leaves preferredLanguage unchanged', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000003', 'profile3@example.com');
    await prisma.person.update({ where: { id: person.id }, data: { preferredLanguage: 'fr' } });

    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ name: 'Only Name Changed' });
    expect(res.status).toBe(200);
    expect(res.body.preferredLanguage).toBe('fr');

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.name).toBe('Only Name Changed');
    expect(stored!.preferredLanguage).toBe('fr');
  });

  it('a partial update (preferredLanguage only) leaves name unchanged', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000004', 'profile4@example.com', 'Original Name');

    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ preferredLanguage: 'fr' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Original Name');

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.name).toBe('Original Name');
  });

  it('rejects an empty name', async () => {
    const { agent, csrf } = await loginAsMember('+237690000005', 'profile5@example.com');
    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a whitespace-only name', async () => {
    const { agent, csrf } = await loginAsMember('+237690000006', 'profile6@example.com');
    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a name over the maximum length', async () => {
    const { agent, csrf } = await loginAsMember('+237690000007', 'profile7@example.com');
    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ name: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid preferredLanguage value', async () => {
    const { agent, csrf } = await loginAsMember('+237690000008', 'profile8@example.com');
    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ preferredLanguage: 'de' });
    expect(res.status).toBe(400);
  });

  it('a supplied personId cannot redirect the update to another Person', async () => {
    const { agent: agentA, csrf: csrfA, person: personA } = await loginAsMember('+237690000009', 'profile9a@example.com');
    const { person: personB } = await loginAsMember('+237690000109', 'profile9b@example.com');

    const res = await agentA
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrfA)
      .send({ name: 'Attempted Redirect', personId: personB.id });
    expect(res.status).toBe(200);

    const storedA = await prisma.person.findUnique({ where: { id: personA.id } });
    const storedB = await prisma.person.findUnique({ where: { id: personB.id } });
    expect(storedA!.name).toBe('Attempted Redirect');
    expect(storedB!.name).not.toBe('Attempted Redirect');
  });

  it('a supplied whatsappNumber is never modified', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000010', 'profile10@example.com');
    const originalWhatsapp = person.whatsappNumber;

    const res = await agent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Name Change', whatsappNumber: '+237699999999' });
    expect(res.status).toBe(200);
    expect(res.body.whatsappNumber).toBeUndefined();

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.whatsappNumber).toBe(originalWhatsapp);
  });

  it('a supplied Person.email is never modified', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000011', 'profile11@example.com');
    const originalEmail = person.email;

    const res = await agent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Name Change', email: 'spoofed@example.com' });
    expect(res.status).toBe(200);

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.email).toBe(originalEmail);
    expect(stored!.email).not.toBe('spoofed@example.com');
  });

  it('a supplied MemberAccount.email is never modified', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000012', 'profile12@example.com');

    const res = await agent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Name Change', memberAccountEmail: 'spoofed2@example.com' });
    expect(res.status).toBe(200);

    const account = await prisma.memberAccount.findUnique({ where: { personId: person.id } });
    expect(account!.email).toBe('profile12@example.com');
  });

  it('community/geography/role/follow-up fields cannot be modified via this endpoint', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000013', 'profile13@example.com');
    const community = await prisma.community.create({ data: { name: 'Profile Test Community' } });
    const membership = await prisma.communityMembership.create({
      data: { personId: person.id, communityId: community.id, status: 'ACTIVE' },
    });

    const res = await agent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Name Change', communityMemberships: [], geographicAssignment: null, roleAssignments: [] });
    expect(res.status).toBe(200);

    const stillThere = await prisma.communityMembership.findUnique({ where: { id: membership.id } });
    expect(stillThere).toBeTruthy();
    expect(stillThere!.status).toBe('ACTIVE');
  });

  it('requires CSRF protection', async () => {
    const { agent } = await loginAsMember('+237690000014', 'profile14@example.com');
    const res = await agent.patch('/api/member/me/profile').send({ name: 'No CSRF' });
    expect(res.status).toBe(403);
  });

  it('enforces the dedicated profile-update rate limiter', async () => {
    const { agent, csrf } = await loginAsMember('+237690000015', 'profile15@example.com');

    let lastStatus = 200;
    for (let i = 0; i < 21; i++) {
      const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ name: `Name ${i}` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('persists changes durably (verified via a fresh lookup)', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000016', 'profile16@example.com');
    await agent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Persisted Name', preferredLanguage: 'fr' });

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.name).toBe('Persisted Name');
    expect(stored!.preferredLanguage).toBe('fr');
  });

  it('creates an audit entry for the profile update', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000017', 'profile17@example.com');
    await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ name: 'Audited Name' });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'MEMBER_PROFILE_UPDATED', targetType: 'Person', targetId: person.id },
    });
    expect(audit).toBeTruthy();
  });
});

describe('Member Location — Person.locationCountry/locationCity/locationArea', () => {
  it('a newly created Person has null location fields by default', async () => {
    const { person } = await loginAsMember('+237690000018', 'location1@example.com');
    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.locationCountry).toBeNull();
    expect(stored!.locationCity).toBeNull();
    expect(stored!.locationArea).toBeNull();
  });

  it('an unauthenticated location update is rejected', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.patch('/api/member/me/profile').send({ locationCountry: 'Cameroon' });
    expect(res.status).toBe(401);
  });

  it('an authenticated member can set their own country/city/area', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000019', 'location2@example.com');

    const res = await agent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrf)
      .send({ locationCountry: 'Cameroon', locationCity: 'Douala', locationArea: 'Bonamoussadi' });
    expect(res.status).toBe(200);
    expect(res.body.locationCountry).toBe('Cameroon');
    expect(res.body.locationCity).toBe('Douala');
    expect(res.body.locationArea).toBe('Bonamoussadi');

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.locationCountry).toBe('Cameroon');
    expect(stored!.locationCity).toBe('Douala');
    expect(stored!.locationArea).toBe('Bonamoussadi');
  });

  it('a member cannot update another Person\'s location — a supplied personId cannot redirect the update', async () => {
    const { agent: agentA, csrf: csrfA, person: personA } = await loginAsMember('+237690000020', 'location3a@example.com');
    const { person: personB } = await loginAsMember('+237690000021', 'location3b@example.com');

    const res = await agentA
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrfA)
      .send({ locationCountry: 'Nigeria', personId: personB.id });
    expect(res.status).toBe(200);

    const storedA = await prisma.person.findUnique({ where: { id: personA.id } });
    const storedB = await prisma.person.findUnique({ where: { id: personB.id } });
    expect(storedA!.locationCountry).toBe('Nigeria');
    expect(storedB!.locationCountry).toBeNull();
  });

  it('blank optional location values are accepted and clear an existing value', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000022', 'location4@example.com');
    await prisma.person.update({ where: { id: person.id }, data: { locationCity: 'Yaoundé' } });

    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ locationCity: '' });
    expect(res.status).toBe(200);
    expect(res.body.locationCity).toBeNull();

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.locationCity).toBeNull();
  });

  it('a partial update (country only) leaves city and area unchanged', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000023', 'location5@example.com');
    await prisma.person.update({ where: { id: person.id }, data: { locationCity: 'Douala', locationArea: 'Akwa' } });

    const res = await agent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrf)
      .send({ locationCountry: 'Cameroon' });
    expect(res.status).toBe(200);

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.locationCountry).toBe('Cameroon');
    expect(stored!.locationCity).toBe('Douala');
    expect(stored!.locationArea).toBe('Akwa');
  });

  it('omitting location fields entirely leaves them unchanged', async () => {
    const { agent, csrf, person } = await loginAsMember('+237690000024', 'location6@example.com');
    await prisma.person.update({ where: { id: person.id }, data: { locationCountry: 'Cameroon' } });

    const res = await agent.patch('/api/member/me/profile').set('X-CSRF-Token', csrf).send({ name: 'Just A Name Change' });
    expect(res.status).toBe(200);

    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored!.locationCountry).toBe('Cameroon');
  });

  it('a location value over the maximum length is rejected', async () => {
    const { agent, csrf } = await loginAsMember('+237690000025', 'location7@example.com');
    const res = await agent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', csrf)
      .send({ locationCountry: 'x'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('location fields never leak into the Leader roster response', async () => {
    // Regression guard: GET /api/leader/roster explicitly selects
    // { id, name } for each Person (see leader.ts) — adding new Person
    // columns must never surface them here.
    const { csrf: memberCsrf, agent: memberAgent, person } = await loginAsMember('+237690000026', 'location8@example.com');
    await memberAgent
      .patch('/api/member/me/profile')
      .set('X-CSRF-Token', memberCsrf)
      .send({ locationCountry: 'Cameroon', locationCity: 'Douala', locationArea: 'Bonamoussadi' });

    const community = await prisma.community.create({ data: { name: 'Location Leak Test Community' } });
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id, status: 'ACTIVE' } });

    const email = 'location-leak-leader@test.local';
    const { user } = await createLeader('Location Leak Leader', email, 'LOCLEAK1');
    const leaderPerson = await prisma.person.create({ data: { name: 'Location Leak Leader Person', whatsappNumber: '+237988700001' } });
    await prisma.user.update({ where: { id: user.id }, data: { personId: leaderPerson.id } });
    await prisma.roleAssignment.create({
      data: { personId: leaderPerson.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: user.id },
    });

    const leaderAgent = agentWithUniqueIp();
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent as any);
    await leaderAgent.post('/api/auth/login').set('X-CSRF-Token', leaderCsrf).send({ email, password: 'password123' });

    const res = await leaderAgent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/Bonamoussadi|Douala/);
  });
});
