import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Unified Leader/Member identity: a single ReferralCode can now carry BOTH
// Leader attribution (leaderId) and Member auto-friending (personId) at
// once (Section 1/2), a missing code falls back to the single catch-all
// Person so nobody is ever truly unattributed (Section 6/14), every new
// Person gets their own code eagerly at signup (Section 1), and signing in
// as a Member whose Person is linked to an active Leader User silently
// establishes a Leader session too (Section 9).
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.121.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
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

async function start(email: string, password = 'Testpass123') {
  const spy = vi.spyOn(EmailService, 'sendMemberSignupCode').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/signup/start').set('X-CSRF-Token', csrf).send({ email, password, pathway: 'DISCOVER_GROW', language: 'en' });
  const code = spy.mock.calls[0]?.[0]?.code as string | undefined;
  spy.mockRestore();
  return { agent, csrf, code };
}

const CAMEROON_DETAILS = {
  name: 'Jean Ngono',
  country: 'Cameroon',
  region: 'Centre',
  division: 'Mfoundi',
  subdivision: 'Yaoundé III',
  quarter: 'Efoulan',
};

let phoneCounter = 0;
function freshPhone(): string {
  phoneCounter += 1;
  return `+237671${String(300000 + phoneCounter).padStart(6, '0')}`;
}

afterEach(() => vi.restoreAllMocks());

describe('Unified referral code: Leader attribution + Member auto-friend together', () => {
  it('a dual-purpose code (leaderId + personId both set) creates BOTH a ReferralRelationship and a REFERRAL-origin Friendship', async () => {
    await makeHeadquarters();
    const referrerPerson = await prisma.person.create({ data: { name: 'Dual Referrer', whatsappNumber: freshPhone() } });
    await prisma.memberAccount.create({ data: { personId: referrerPerson.id, email: 'dual-referrer@test.local', passwordHash: 'h' } });
    const leaderUser = await prisma.user.create({ data: { name: 'Dual Referrer', email: 'dual-referrer-leader@test.local', passwordHash: 'h', role: 'LEADER', personId: referrerPerson.id } });
    const code = await prisma.referralCode.create({ data: { code: 'DUALCODE1', personId: referrerPerson.id, leaderId: leaderUser.id } });

    const email = 'dual-joiner@example.com';
    const { agent, csrf, code: signupCode } = await start(email);
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: code.code });
    const whatsapp = freshPhone();
    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code: signupCode, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(200);

    const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: whatsapp } });

    const relationship = await prisma.referralRelationship.findUnique({ where: { registrationId: registration!.id } });
    expect(relationship?.leaderId).toBe(leaderUser.id);

    const friendship = await prisma.friendship.findFirst({
      where: { requesterPersonId: referrerPerson.id, addresseePersonId: person!.id },
    });
    expect(friendship?.status).toBe('ACCEPTED');
    expect(friendship?.origin).toBe('REFERRAL');
  });

  it('every new Person gets their own ReferralCode eagerly at signup, without visiting /referrals/links first', async () => {
    await makeHeadquarters();
    const email = 'eager-code@example.com';
    const { agent, csrf, code: signupCode } = await start(email);
    const whatsapp = freshPhone();
    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code: signupCode, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(200);

    const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
    const ownCode = await prisma.referralCode.findUnique({ where: { personId: person!.id } });
    expect(ownCode).not.toBeNull();
  });
});

describe('Settings.defaultReferrerPersonId — catch-all for a purely organic join', () => {
  it('auto-friends (REFERRAL origin) and attributes the registration to the catch-all Person when no referral code was ever visited', async () => {
    await makeHeadquarters();
    const catchAll = await prisma.person.create({ data: { name: 'Catch All', whatsappNumber: freshPhone() } });
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      update: { defaultReferrerPersonId: catchAll.id },
      create: { id: 'singleton', defaultReferrerPersonId: catchAll.id },
    });

    const email = 'organic-joiner@example.com';
    const { agent, csrf, code: signupCode } = await start(email);
    const whatsapp = freshPhone();
    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code: signupCode, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(200);

    const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: whatsapp } });
    expect(registration?.referredByPersonId).toBe(catchAll.id);

    const friendship = await prisma.friendship.findFirst({
      where: { requesterPersonId: catchAll.id, addresseePersonId: person!.id },
    });
    expect(friendship?.origin).toBe('REFERRAL');
    expect(friendship?.status).toBe('ACCEPTED');
  });

  it('never applies when a real referral code WAS visited, even if it has no personId (Leader-only code)', async () => {
    await makeHeadquarters();
    const catchAll = await prisma.person.create({ data: { name: 'Catch All Two', whatsappNumber: freshPhone() } });
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      update: { defaultReferrerPersonId: catchAll.id },
      create: { id: 'singleton', defaultReferrerPersonId: catchAll.id },
    });
    const leaderUser = await prisma.user.create({ data: { name: 'Leader Only', email: 'leader-only-catchall@test.local', passwordHash: 'h', role: 'LEADER' } });
    const code = await prisma.referralCode.create({ data: { code: 'LEADERONLY1', leaderId: leaderUser.id } });

    const email = 'leader-code-joiner@example.com';
    const { agent, csrf, code: signupCode } = await start(email);
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: code.code });
    const whatsapp = freshPhone();
    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code: signupCode, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(200);

    const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
    const friendship = await prisma.friendship.findFirst({ where: { addresseePersonId: person!.id } });
    expect(friendship).toBeNull();
  });

  it('with no catch-all configured and no referral code, nobody is auto-friended and referredByPersonId stays null', async () => {
    await makeHeadquarters();
    const email = 'no-catchall-joiner@example.com';
    const { agent, csrf, code: signupCode } = await start(email);
    const whatsapp = freshPhone();
    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code: signupCode, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(200);

    const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: whatsapp } });
    expect(registration?.referredByPersonId).toBeNull();
    const friendship = await prisma.friendship.findFirst({ where: { addresseePersonId: person!.id } });
    expect(friendship).toBeNull();
  });
});

describe('Auto-pairing: signing in as a Member silently establishes a Leader session too', () => {
  async function createBridgedLeader(email: string, whatsapp: string, password: string) {
    const person = await prisma.person.create({ data: { name: 'Bridged Leader', whatsappNumber: whatsapp, email } });
    const passwordHash = (await import('bcryptjs')).default.hashSync(password, 10);
    await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash } });
    const leaderUser = await prisma.user.create({ data: { name: 'Bridged Leader', email: `leader-${email}`, passwordHash: 'x', role: 'LEADER', active: true, personId: person.id } });
    return { person, leaderUser };
  }

  it('establishes a sid Leader session automatically on ordinary Member password login', async () => {
    const { leaderUser } = await createBridgedLeader('autopair1@test.local', freshPhone(), 'Testpass123');

    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email: 'autopair1@test.local', password: 'Testpass123' });
    expect(res.status).toBe(200);

    const memberMe = await agent.get('/api/member/auth/me');
    expect(memberMe.body.member).not.toBeNull();

    const leaderMe = await agent.get('/api/auth/me');
    expect(leaderMe.body.user?.id).toBe(leaderUser.id);
    expect(leaderMe.body.user?.role).toBe('LEADER');
  });

  it('never auto-pairs for a Person linked to an ADMIN User', async () => {
    const email = 'autopair-admin@test.local';
    const whatsapp = freshPhone();
    const person = await prisma.person.create({ data: { name: 'Bridged Admin', whatsappNumber: whatsapp, email } });
    const bcrypt = (await import('bcryptjs')).default;
    const passwordHash = bcrypt.hashSync('Testpass123', 10);
    await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash } });
    await createAdmin(`admin-${email}`, 'AdminPass123!');
    await prisma.user.update({ where: { email: `admin-${email}` }, data: { personId: person.id } });

    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'Testpass123' });
    expect(res.status).toBe(200);

    const leaderMe = await agent.get('/api/auth/me');
    expect(leaderMe.body.user).toBeFalsy();
  });

  it('never auto-pairs for an inactive (deactivated) Leader User', async () => {
    const email = 'autopair-inactive@test.local';
    const whatsapp = freshPhone();
    const bcrypt = (await import('bcryptjs')).default;
    const passwordHash = bcrypt.hashSync('Testpass123', 10);
    const person = await prisma.person.create({ data: { name: 'Inactive Leader', whatsappNumber: whatsapp, email } });
    await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash } });
    await prisma.user.create({ data: { name: 'Inactive Leader', email: `inactive-${email}`, passwordHash: 'x', role: 'LEADER', active: false, personId: person.id } });

    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'Testpass123' });
    expect(res.status).toBe(200);

    const leaderMe = await agent.get('/api/auth/me');
    expect(leaderMe.body.user).toBeFalsy();
  });
});
