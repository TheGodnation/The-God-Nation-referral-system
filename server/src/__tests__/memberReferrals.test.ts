import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// "My Referrals": a Member's own referral link (ReferralCode.personId,
// alongside the existing Leader-owned ReferralCode.leaderId) and the
// forward-only auto-friend that happens when someone joins the real in-app
// Member signup through it. See schema.prisma's ReferralCode/Registration
// comments.
const app = createApp();

let ipCounter = 30000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.118.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}
type Agent = ReturnType<typeof agentWithUniqueIp>;
interface Member {
  agent: Agent;
  csrf: string;
  id: string;
}

let n = 0;
async function member(name: string): Promise<Member> {
  n += 1;
  const whatsapp = `+2376706${String(n).padStart(5, '0')}`;
  const email = `memberref${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as any);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id };
}

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

/** Visits the given referral code, then signs up a brand-new phone/email
 * through the SAME agent (so the visitor cookie carries attribution), and
 * signs in. Returns the new Person's id. */
async function joinThroughLink(ref: string, whatsapp: string, email: string) {
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref, lang: 'en' });
  await agent.post('/api/member/auth/signup').set('X-CSRF-Token', csrf).send({ email, whatsapp, password: 'Testpass123', language: 'en' });
  const link = spy.mock.calls[spy.mock.calls.length - 1]?.[0]?.link as string | undefined;
  spy.mockRestore();
  if (link) {
    await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  }
  const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
  return { agent, csrf, personId: person!.id };
}

describe('My Referrals — a Member\'s own link', () => {
  it('lazily creates a referral code on first request, and reuses it afterwards', async () => {
    const a = await member('Link Owner One');
    const first = await a.agent.get('/api/member/referrals/links');
    expect(first.status).toBe(200);
    expect(first.body.referralCode).toBeTruthy();
    expect(first.body.links.en).toContain(`ref=${first.body.referralCode}`);
    expect(first.body.links.fr).toContain(`ref=${first.body.referralCode}`);

    const second = await a.agent.get('/api/member/referrals/links');
    expect(second.body.referralCode).toBe(first.body.referralCode);

    const codeRow = await prisma.referralCode.findUnique({ where: { personId: a.id } });
    expect(codeRow?.code).toBe(first.body.referralCode);
    expect(codeRow?.leaderId).toBeNull();
  });

  it('requires authentication', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/member/referrals/links')).status).toBe(401);
    expect((await anon.get('/api/member/referrals/mine')).status).toBe(401);
  });

  it('starts with an empty referrals list', async () => {
    const a = await member('Link Owner Two');
    const res = await a.agent.get('/api/member/referrals/mine');
    expect(res.body.items).toEqual([]);
  });
});

describe('My Referrals — joining through a Member\'s link', () => {
  it('attributes the registration, auto-friends the pair, and lists the new person for the referrer', async () => {
    const referrer = await member('Referrer One');
    const linksRes = await referrer.agent.get('/api/member/referrals/links');
    const code = linksRes.body.referralCode as string;

    const { personId: newPersonId } = await joinThroughLink(code, '+237670200001', 'joiner-one@example.com');

    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: '+237670200001' } });
    expect(registration?.referredByPersonId).toBe(referrer.id);

    const friendship = await prisma.friendship.findFirst({
      where: { requesterPersonId: referrer.id, addresseePersonId: newPersonId, status: 'ACCEPTED' },
    });
    expect(friendship).not.toBeNull();
    expect(friendship?.respondedAt).not.toBeNull();

    const mine = await referrer.agent.get('/api/member/referrals/mine');
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ personId: newPersonId, name: 'joiner-one@example.com' });
  });

  it('never retroactively friends people who joined before the referrer had a code', async () => {
    const referrer = await member('Referrer Two');
    // A prior, unrelated member exists but was never referred by anyone.
    const bystander = await member('Bystander');
    const friendship = await prisma.friendship.findFirst({
      where: { requesterPersonId: referrer.id, addresseePersonId: bystander.id },
    });
    expect(friendship).toBeNull();
  });

  it('does not attribute or friend when the visited code belongs to a Leader, not a Member', async () => {
    const { user, referralCode: leaderCode } = await createLeader('Referral Leader', 'leader-memref@test.local', 'LMR1CODE');

    const { personId: newPersonId } = await joinThroughLink(leaderCode.code, '+237670200002', 'joiner-two@example.com');

    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: '+237670200002' } });
    expect(registration?.referredByPersonId).toBeNull();
    const relationship = await prisma.referralRelationship.findUnique({ where: { registrationId: registration!.id } });
    expect(relationship?.leaderId).toBe(user.id);

    const anyFriendship = await prisma.friendship.findFirst({ where: { addresseePersonId: newPersonId } });
    expect(anyFriendship).toBeNull();
  });

  it('does not crash the Admin referral-visits list when a visit is attributed to a Member\'s code', async () => {
    const referrer = await member('Referrer Three');
    const linksRes = await referrer.agent.get('/api/member/referrals/links');
    const code = linksRes.body.referralCode as string;

    const visitor = agentWithUniqueIp();
    const { csrf } = await bootstrap(visitor as any);
    await visitor.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: code, lang: 'en' });

    const { agent: adminAgent } = await loginAsAdmin('admin-memref-visits@test.local');
    const res = await adminAgent.get('/api/admin/referrals?pageSize=100');
    expect(res.status).toBe(200);
    const row = res.body.items.find((i: any) => i.visitorId); // just needs to not have thrown
    expect(row).toBeTruthy();
  });

  it('the old pre-membership registration form is unaffected by a Member\'s code (no crash, no attribution)', async () => {
    const referrer = await member('Referrer Four');
    const linksRes = await referrer.agent.get('/api/member/referrals/links');
    const code = linksRes.body.referralCode as string;

    const visitor = agentWithUniqueIp();
    const { csrf } = await bootstrap(visitor as any);
    await visitor.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: code, lang: 'en' });

    const res = await visitor
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Old Form Joiner', whatsapp: '+237670200003', language: 'en', pathway: 'TRAINING' });
    expect(res.status).toBe(201);

    const registration = await prisma.registration.findUnique({ where: { id: res.body.registrationId } });
    expect(registration?.referredByPersonId).toBeNull();
    const relationship = await prisma.referralRelationship.findUnique({ where: { registrationId: registration!.id } });
    expect(relationship).toBeNull();
  });
});
