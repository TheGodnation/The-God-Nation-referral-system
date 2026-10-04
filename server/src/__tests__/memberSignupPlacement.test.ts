import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { chooseGroup } from '../lib/placement';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// New member sign-up (email + phone -> emailed link -> details form) and
// automatic group placement (smallest open group, or by location).
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.112.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

function tokenFrom(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function signup(email: string, whatsapp: string, language: 'en' | 'fr' = 'en') {
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/signup').set('X-CSRF-Token', csrf).send({ email, whatsapp, language });
  const call = spy.mock.calls[0]?.[0];
  spy.mockRestore();
  return { res, agent, csrf, link: call?.link as string | undefined, sentTo: call?.to as string | undefined };
}

/** Full happy path up to a signed-in member who hasn't filled the details form. */
async function signupAndSignIn(email: string, whatsapp: string) {
  const s = await signup(email, whatsapp);
  expect(s.link).toBeTruthy();
  const consume = await s.agent.post('/api/member/auth/consume').set('X-CSRF-Token', s.csrf).send({ token: tokenFrom(s.link!) });
  expect(consume.status).toBe(200);
  return s;
}

async function makeHeadquarters(name = 'Headquarters') {
  const hq = await prisma.community.create({ data: { name } });
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', headquartersCommunityId: hq.id },
    update: { headquartersCommunityId: hq.id },
  });
  return hq;
}

let phoneCounter = 0;
async function addMembers(communityId: string, count: number, prefix: string) {
  for (let i = 0; i < count; i++) {
    phoneCounter += 1;
    const p = await prisma.person.create({
      data: { name: `${prefix} ${i}`, whatsappNumber: `+23769900${String(phoneCounter).padStart(4, '0')}` },
    });
    await prisma.communityMembership.create({ data: { personId: p.id, communityId } });
  }
}

const CAMEROON_DETAILS = {
  name: 'Jean Ngono',
  country: 'Cameroon',
  region: 'Centre',
  division: 'Mfoundi',
  subdivision: 'Yaoundé III',
  quarter: 'Efoulan',
};

describe('Member sign-up — step 1 (email + phone)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates a new person, a member account and a registration, and emails a link', async () => {
    const { res, link, sentTo } = await signup('new.member@example.com', '+237670101001');
    expect(res.status).toBe(200);
    expect(link).toContain('/member/login/confirm?token=');
    expect(sentTo).toBe('new.member@example.com');

    const person = await prisma.person.findUnique({ where: { whatsappNumber: '+237670101001' }, include: { memberAccount: true } });
    expect(person).toBeTruthy();
    expect(person!.memberAccount?.email).toBe('new.member@example.com');
    expect(person!.profileCompletedAt).toBeNull();

    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: '+237670101001' } });
    expect(registration?.personId).toBe(person!.id);
    expect(registration?.pathway).toBe('DISCOVER_GROW');
  });

  it('rejects an invalid phone number with a clear message', async () => {
    const { res } = await signup('bad.phone@example.com', '12');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PHONE');
  });

  it('gives the same reply for a known email, and sends the link only to that account', async () => {
    await signup('same@example.com', '+237670101002');
    const second = await signup('same@example.com', '+237670101003');
    expect(second.res.status).toBe(200);
    expect(second.sentTo).toBe('same@example.com');
    // The second phone number is never attached to anyone.
    expect(await prisma.person.findUnique({ where: { whatsappNumber: '+237670101003' } })).toBeNull();
  });

  it('never redirects a known phone number to a different email', async () => {
    await signup('owner@example.com', '+237670101004');
    const attacker = await signup('attacker@example.com', '+237670101004');
    expect(attacker.res.status).toBe(200);
    expect(attacker.link).toBeUndefined();
    const account = await prisma.memberAccount.findUnique({ where: { email: 'attacker@example.com' } });
    expect(account).toBeNull();
  });

  it('links an existing person from the old WhatsApp form to a new member account', async () => {
    const existing = await prisma.person.create({ data: { name: 'Old Registrant', whatsappNumber: '+237670101005' } });
    const { link } = await signup('old.registrant@example.com', '+237670101005');
    expect(link).toBeTruthy();
    const account = await prisma.memberAccount.findUnique({ where: { personId: existing.id } });
    expect(account?.email).toBe('old.registrant@example.com');
  });
});

describe('Member sign-up — step 2 (details form) and automatic placement', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports profileComplete=false until the details form is filled', async () => {
    const { agent } = await signupAndSignIn('step2@example.com', '+237670102001');
    const me = await agent.get('/api/member/auth/me');
    expect(me.body.member.profileComplete).toBe(false);
  });

  it('saves Cameroon location details and places the member in Headquarters', async () => {
    const hq = await makeHeadquarters();
    const { agent, csrf } = await signupAndSignIn('cm@example.com', '+237670102002');

    const res = await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send(CAMEROON_DETAILS);
    expect(res.status).toBe(200);
    expect(res.body.community).toEqual({ id: hq.id, name: 'Headquarters' });

    const person = await prisma.person.findUnique({ where: { whatsappNumber: '+237670102002' } });
    expect(person).toMatchObject({
      name: 'Jean Ngono',
      locationCountry: 'Cameroon',
      locationRegion: 'Centre',
      locationDivision: 'Mfoundi',
      locationSubdivision: 'Yaoundé III',
      locationQuarter: 'Efoulan',
    });
    expect(person!.profileCompletedAt).not.toBeNull();

    const me = await agent.get('/api/member/auth/me');
    expect(me.body.member.profileComplete).toBe(true);

    // The placeholder registration name is replaced by the real one.
    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: '+237670102002' } });
    expect(registration?.name).toBe('Jean Ngono');
  });

  it('requires region, division, subdivision and quarter for Cameroon', async () => {
    await makeHeadquarters();
    const { agent, csrf } = await signupAndSignIn('cm-missing@example.com', '+237670102003');
    const res = await agent
      .post('/api/member/auth/complete-profile')
      .set('X-CSRF-Token', csrf)
      .send({ ...CAMEROON_DETAILS, quarter: '' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('quarter');
  });

  it('requires a city outside Cameroon', async () => {
    await makeHeadquarters();
    const { agent, csrf } = await signupAndSignIn('ng@example.com', '+237670102004');
    const missing = await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send({ name: 'Ada', country: 'Nigeria' });
    expect(missing.status).toBe(400);
    expect(missing.body.field).toBe('city');

    const ok = await agent
      .post('/api/member/auth/complete-profile')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Ada', country: 'Nigeria', city: 'Lagos' });
    expect(ok.status).toBe(200);
  });

  it('places newcomers in the smallest child group once Headquarters has children', async () => {
    const hq = await makeHeadquarters();
    const a = await prisma.community.create({ data: { name: 'Group A', parentId: hq.id } });
    const b = await prisma.community.create({ data: { name: 'Group B', parentId: hq.id } });
    await addMembers(a.id, 3, 'AAA');
    await addMembers(b.id, 1, 'BBB');

    const { agent, csrf } = await signupAndSignIn('smallest@example.com', '+237670102005');
    const res = await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send(CAMEROON_DETAILS);
    expect(res.body.community.id).toBe(b.id);
  });

  it('never moves a member who already has a group when they update details again', async () => {
    const hq = await makeHeadquarters();
    const { agent, csrf } = await signupAndSignIn('again@example.com', '+237670102006');
    await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send(CAMEROON_DETAILS);
    await prisma.community.create({ data: { name: 'Child', parentId: hq.id } });

    const res = await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send(CAMEROON_DETAILS);
    expect(res.body.community.id).toBe(hq.id);
    const memberships = await prisma.communityMembership.count({ where: { person: { whatsappNumber: '+237670102006' } } });
    expect(memberships).toBe(1);
  });

  it('in BY_LOCATION mode sends members to the group tagged with their region', async () => {
    const hq = await makeHeadquarters();
    const general = await prisma.community.create({ data: { name: 'General', parentId: hq.id } });
    const centre = await prisma.community.create({
      data: { name: 'Centre group', parentId: hq.id, placementCountry: 'Cameroon', placementRegion: 'Centre' },
    });
    await addMembers(centre.id, 5, 'CCC');
    await prisma.settings.update({ where: { id: 'singleton' }, data: { placementMode: 'BY_LOCATION' } });

    const { agent, csrf } = await signupAndSignIn('byloc@example.com', '+237670102007');
    const res = await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send(CAMEROON_DETAILS);
    // The tagged group wins even though it is bigger than the general one.
    expect(res.body.community.id).toBe(centre.id);
    expect(general.id).not.toBe(centre.id);
  });
});

describe('Placement choice rules', () => {
  const g = (id: string, memberCount: number, country: string | null = null, region: string | null = null, ageMs = 0) => ({
    id,
    memberCount,
    placementCountry: country,
    placementRegion: region,
    createdAt: new Date(1_000_000 + ageMs),
  });

  it('returns null when there are no open groups', () => {
    expect(chooseGroup([], 'SMALLEST_GROUP', { country: null, region: null })).toBeNull();
  });

  it('picks the smallest group, oldest first on a tie', () => {
    expect(chooseGroup([g('a', 5), g('b', 2), g('c', 2, null, null, 10)], 'SMALLEST_GROUP', { country: null, region: null })).toBe('b');
  });

  it('ignores location tags in SMALLEST_GROUP mode', () => {
    expect(chooseGroup([g('tagged', 1, 'Nigeria'), g('plain', 3)], 'SMALLEST_GROUP', { country: 'Cameroon', region: null })).toBe('tagged');
  });

  it('prefers a region match over a country-wide match', () => {
    const groups = [g('country', 0, 'Cameroon'), g('region', 9, 'Cameroon', 'Littoral')];
    expect(chooseGroup(groups, 'BY_LOCATION', { country: 'cameroon', region: ' littoral ' })).toBe('region');
  });

  it('does not send someone to a group for a different region', () => {
    const groups = [g('littoral', 0, 'Cameroon', 'Littoral'), g('plain', 7)];
    expect(chooseGroup(groups, 'BY_LOCATION', { country: 'Cameroon', region: 'Centre' })).toBe('plain');
  });

  it('falls back to the smallest untagged group, then to any group', () => {
    expect(chooseGroup([g('ng', 0, 'Nigeria'), g('plain', 4)], 'BY_LOCATION', { country: 'Ghana', region: null })).toBe('plain');
    expect(chooseGroup([g('ng', 2, 'Nigeria'), g('cm', 1, 'Cameroon')], 'BY_LOCATION', { country: 'Ghana', region: null })).toBe('cm');
  });
});

describe('Admin placement settings and group location tags', () => {
  async function loginAsAdmin(email: string, password = 'AdminPass123!') {
    await createAdmin(email, password);
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
    return { agent, csrf };
  }

  it('reads and switches the placement mode', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-place@test.local');
    const before = await agent.get('/api/admin/communities/placement-settings');
    expect(before.body.placementMode).toBe('SMALLEST_GROUP');

    const put = await agent.put('/api/admin/communities/placement-settings').set('X-CSRF-Token', csrf).send({ placementMode: 'BY_LOCATION' });
    expect(put.status).toBe(200);
    const after = await agent.get('/api/admin/communities/placement-settings');
    expect(after.body.placementMode).toBe('BY_LOCATION');

    const bad = await agent.put('/api/admin/communities/placement-settings').set('X-CSRF-Token', csrf).send({ placementMode: 'RANDOM' });
    expect(bad.status).toBe(400);
  });

  it('sets and clears a group location tag', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-tag@test.local');
    const created = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Douala group', placementCountry: 'Cameroon', placementRegion: 'Littoral' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ placementCountry: 'Cameroon', placementRegion: 'Littoral' });

    const cleared = await agent
      .patch(`/api/admin/communities/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ placementRegion: '' });
    expect(cleared.body).toMatchObject({ placementCountry: 'Cameroon', placementRegion: null });
  });

  it('is admin-only', async () => {
    const agent = agentWithUniqueIp();
    await bootstrap(agent as any);
    const res = await agent.get('/api/admin/communities/placement-settings');
    expect(res.status).toBe(401);
  });
});
