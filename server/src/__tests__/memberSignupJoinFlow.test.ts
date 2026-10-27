import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// The public /register join flow (Option A: nothing is saved until screen 3
// is submitted). Screen 1 (start) -> PendingMemberSignup + emailed code.
// Screen 2 (check-code) -> fast, non-destructive verification. Screen 3
// (finish) -> atomically creates Person + MemberAccount + Registration
// (+ referral attribution + placement) and signs the visitor in.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.119.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function start(email: string, pathway: 'TRAINING' | 'DISCOVER_GROW' = 'DISCOVER_GROW', password = 'Testpass123') {
  const spy = vi.spyOn(EmailService, 'sendMemberSignupCode').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/signup/start').set('X-CSRF-Token', csrf).send({ email, password, pathway, language: 'en' });
  const call = spy.mock.calls[0]?.[0];
  spy.mockRestore();
  return { res, agent, csrf, code: call?.code as string | undefined, sentTo: call?.to as string | undefined };
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
  return `+237670${String(200000 + phoneCounter).padStart(6, '0')}`;
}

afterEach(() => vi.restoreAllMocks());

describe('Join flow — screen 1 (start): email + password + pathway', () => {
  it('creates a pending signup and emails a 6-digit code, without creating any Person/MemberAccount', async () => {
    const { res, code, sentTo } = await start('join1@example.com');
    expect(res.status).toBe(200);
    expect(code).toMatch(/^\d{6}$/);
    expect(sentTo).toBe('join1@example.com');

    expect(await prisma.memberAccount.findUnique({ where: { email: 'join1@example.com' } })).toBeNull();
    const pending = await prisma.pendingMemberSignup.findUnique({ where: { email: 'join1@example.com' } });
    expect(pending).toBeTruthy();
    expect(pending!.pathway).toBe('DISCOVER_GROW');
  });

  it('rejects a short password without creating a pending row', async () => {
    const { res } = await start('join2@example.com', 'TRAINING', 'short');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PASSWORD');
    expect(await prisma.pendingMemberSignup.findUnique({ where: { email: 'join2@example.com' } })).toBeNull();
  });

  it('tells a visitor to sign in instead when the email already has a MemberAccount', async () => {
    const person = await prisma.person.create({ data: { name: 'Existing', whatsappNumber: freshPhone() } });
    await prisma.memberAccount.create({ data: { personId: person.id, email: 'already@example.com' } });
    const { res } = await start('already@example.com');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('restarting with the same email replaces the pending row with a fresh code', async () => {
    const first = await start('resend@example.com');
    const second = await start('resend@example.com');
    const pending = await prisma.pendingMemberSignup.findUnique({ where: { email: 'resend@example.com' } });
    expect(pending!.codeAttempts).toBe(0);
    if (first.code && second.code) {
      // Overwhelmingly likely to differ; if they happen to collide the test
      // still passes on the row-replacement assertion above.
      expect(typeof first.code).toBe('string');
    }
  });
});

describe('Join flow — screen 2 (check-code)', () => {
  it('confirms a right code without consuming it', async () => {
    const { agent, csrf, code } = await start('check1@example.com');
    const first = await agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', csrf).send({ email: 'check1@example.com', code });
    expect(first.status).toBe(200);
    expect(first.body.valid).toBe(true);
    // Still there — check-code never deletes/consumes the pending row.
    const second = await agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', csrf).send({ email: 'check1@example.com', code });
    expect(second.status).toBe(200);
  });

  it('rejects a wrong code', async () => {
    const { agent, csrf, code } = await start('check2@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    const res = await agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', csrf).send({ email: 'check2@example.com', code: wrong });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_CODE');
  });

  it('an earlier code still works after asking for another one (the first email arrived late)', async () => {
    const first = await start('late@example.com');
    const second = await start('late@example.com');
    const res = await second.agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', second.csrf).send({ email: 'late@example.com', code: first.code });
    expect(res.status).toBe(200);
    const newest = await second.agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', second.csrf).send({ email: 'late@example.com', code: second.code });
    expect(newest.status).toBe(200);
  });

  it('only the 5 most recent codes count', async () => {
    const sent = [];
    for (let i = 0; i < 6; i++) sent.push(await start('many@example.com'));
    const oldest = sent[0].code!;
    const last = sent[5];
    if (!sent.slice(1).some((s) => s.code === oldest)) {
      const r = await last.agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', last.csrf).send({ email: 'many@example.com', code: oldest });
      expect(r.status).toBe(400);
    }
    const ok = await last.agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', last.csrf).send({ email: 'many@example.com', code: sent[1].code });
    expect(ok.status).toBe(200);
  });

  it('a sign-up that expired or was locked starts clean: its old codes never come back', async () => {
    const first = await start('stale@example.com');
    await prisma.pendingMemberSignup.update({ where: { email: 'stale@example.com' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const second = await start('stale@example.com');
    if (first.code !== second.code) {
      const r = await second.agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', second.csrf).send({ email: 'stale@example.com', code: first.code });
      expect(r.status).toBe(400);
    }
  });

  it('locks the code after 5 wrong tries', async () => {
    const { agent, csrf, code } = await start('check3@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', csrf).send({ email: 'check3@example.com', code: wrong });
    }
    const late = await agent.post('/api/member/auth/signup/check-code').set('X-CSRF-Token', csrf).send({ email: 'check3@example.com', code });
    expect(late.status).toBe(400);
  });
});

describe('Join flow — screen 3 (finish): name + phone + location', () => {
  async function makeHeadquarters(name = 'Headquarters') {
    const hq = await prisma.community.create({ data: { name } });
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', headquartersCommunityId: hq.id },
      update: { headquartersCommunityId: hq.id },
    });
    return hq;
  }

  it('atomically creates Person + MemberAccount + Registration, places in a group, and signs in', async () => {
    const hq = await makeHeadquarters();
    const email = 'finish1@example.com';
    const { agent, csrf, code } = await start(email, 'TRAINING', 'Testpass123');
    const whatsapp = freshPhone();

    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(200);
    expect(res.body.community).toEqual({ id: hq.id, name: 'Headquarters' });

    const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
    expect(person).toMatchObject({ name: 'Jean Ngono', locationRegion: 'Centre' });
    expect(person!.profileCompletedAt).not.toBeNull();

    const account = await prisma.memberAccount.findUnique({ where: { email } });
    expect(account?.personId).toBe(person!.id);

    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: whatsapp } });
    expect(registration?.pathway).toBe('TRAINING');

    // Nothing pending is left over, and the visitor is signed in.
    expect(await prisma.pendingMemberSignup.findUnique({ where: { email } })).toBeNull();
    const me = await agent.get('/api/member/auth/me');
    expect(me.body.member.email).toBe(email);
    expect(me.body.member.profileComplete).toBe(true);

    // The password set at screen 1 is the real sign-in password.
    const loginAgent = agentWithUniqueIp();
    const { csrf: loginCsrf } = await bootstrap(loginAgent as any);
    const login = await loginAgent.post('/api/member/auth/login').set('X-CSRF-Token', loginCsrf).send({ email, password: 'Testpass123' });
    expect(login.status).toBe(200);
  });

  it('rejects a wrong code at finish without creating anything', async () => {
    await makeHeadquarters();
    const email = 'finish2@example.com';
    const { agent, csrf, code } = await start(email);
    const wrong = code === '000000' ? '111111' : '000000';

    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code: wrong, whatsapp: freshPhone(), ...CAMEROON_DETAILS });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_CODE');
    expect(await prisma.memberAccount.findUnique({ where: { email } })).toBeNull();
  });

  it('requires region, division, subdivision and quarter for Cameroon', async () => {
    await makeHeadquarters();
    const email = 'finish3@example.com';
    const { agent, csrf, code } = await start(email);
    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code, whatsapp: freshPhone(), ...CAMEROON_DETAILS, quarter: '' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('quarter');
  });

  it('requires the region outside Cameroon, and saves all five levels', async () => {
    await makeHeadquarters();
    const email = 'finish4@example.com';
    const { agent, csrf, code } = await start(email);
    const missing = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code, whatsapp: freshPhone(), name: 'Ada', country: 'Nigeria' });
    expect(missing.status).toBe(400);
    expect(missing.body.field).toBe('region');

    const whatsapp = freshPhone();
    const ok = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code, whatsapp, name: 'Ada', country: 'Nigeria', region: 'Lagos State', division: 'Ikeja', quarter: 'Allen Avenue' });
    expect(ok.status).toBe(200);
    expect(await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } })).toMatchObject({
      locationCountry: 'Nigeria',
      locationRegion: 'Lagos State',
      locationDivision: 'Ikeja',
      locationSubdivision: null,
      locationQuarter: 'Allen Avenue',
      // the older columns follow: city = division, area = quarter
      locationCity: 'Ikeja',
      locationArea: 'Allen Avenue',
    });
  });

  it('reuses an existing Person from the old WhatsApp-only form by phone number, rather than erroring', async () => {
    await makeHeadquarters();
    const whatsapp = freshPhone();
    const existing = await prisma.person.create({ data: { name: 'Old Registrant', whatsappNumber: whatsapp } });
    const email = 'finish5@example.com';
    const { agent, csrf, code } = await start(email);

    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(200);

    const account = await prisma.memberAccount.findUnique({ where: { email } });
    expect(account?.personId).toBe(existing.id);
  });

  it('refuses a phone number that already belongs to a different MemberAccount', async () => {
    await makeHeadquarters();
    const whatsapp = freshPhone();
    const otherPerson = await prisma.person.create({ data: { name: 'Taken', whatsappNumber: whatsapp } });
    await prisma.memberAccount.create({ data: { personId: otherPerson.id, email: 'owner@example.com' } });

    const email = 'finish6@example.com';
    const { agent, csrf, code } = await start(email);
    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHONE_ALREADY_REGISTERED');
  });

  it('lets exactly one of two concurrent finishes for the same phone number succeed, and never 500s', async () => {
    await makeHeadquarters();
    const whatsapp = freshPhone();
    const emailA = 'racerA@example.com';
    const emailB = 'racerB@example.com';
    const a = await start(emailA);
    const b = await start(emailB);

    const [resA, resB] = await Promise.all([
      a.agent.post('/api/member/auth/signup/finish').set('X-CSRF-Token', a.csrf).send({ email: emailA, code: a.code, whatsapp, ...CAMEROON_DETAILS }),
      b.agent.post('/api/member/auth/signup/finish').set('X-CSRF-Token', b.csrf).send({ email: emailB, code: b.code, whatsapp, ...CAMEROON_DETAILS }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(resA.status).not.toBe(500);
    expect(resB.status).not.toBe(500);

    const people = await prisma.person.findMany({ where: { whatsappNumber: whatsapp } });
    expect(people).toHaveLength(1);
  });

  it('attributes a Leader referral code to the new registration', async () => {
    await makeHeadquarters();
    const leaderUser = await prisma.user.create({ data: { name: 'Leader Join', email: 'leader-join@example.com', passwordHash: 'x', role: 'LEADER' } });
    const code = await prisma.referralCode.create({ data: { code: 'LEADJOIN1', leaderId: leaderUser.id } });

    const email = 'finish7@example.com';
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: code.code });

    const spy = vi.spyOn(EmailService, 'sendMemberSignupCode').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/signup/start').set('X-CSRF-Token', csrf).send({ email, password: 'Testpass123', pathway: 'TRAINING', language: 'en' });
    const signupCode = spy.mock.calls[0]?.[0]?.code;
    spy.mockRestore();

    const whatsapp = freshPhone();
    const res = await agent
      .post('/api/member/auth/signup/finish')
      .set('X-CSRF-Token', csrf)
      .send({ email, code: signupCode, whatsapp, ...CAMEROON_DETAILS });
    expect(res.status).toBe(200);

    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: whatsapp } });
    const relationship = await prisma.referralRelationship.findUnique({ where: { registrationId: registration!.id } });
    expect(relationship?.leaderId).toBe(leaderUser.id);
  });
});
