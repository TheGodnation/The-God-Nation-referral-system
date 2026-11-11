import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { centralAdminPerson } from '../lib/trainingWelcome';
import { founderWelcomeText, sendFounderWelcome, markFirstLogin } from '../lib/memberOnboarding';

// A new member's first steps: the founder's welcome (once, approved wording), the first sign-in date, and the
// "Get started" checklist facts.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.193.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
async function ensureFounder() {
  const existing = await centralAdminPerson();
  if (existing) return existing;
  n += 1;
  const person = await prisma.person.create({ data: { name: `Stanley A. Ndoh ${n}`, whatsappNumber: `+2378300${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.user.create({ data: { name: 'Founder', email: `ob-admin-${n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', personId: person.id } });
  return { id: person.id, name: person.name };
}
async function newPerson(name: string, lang: 'en' | 'fr' = 'en', extra: Record<string, unknown> = {}) {
  n += 1;
  return prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2378400${String(n).padStart(5, '0')}`, preferredLanguage: lang, profileCompletedAt: new Date(), ...extra } });
}
async function signedIn(lang: 'en' | 'fr' = 'en') {
  const person = await newPerson('Newbie', lang);
  const email = `ob${n}@example.com`;
  const account = await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { person, account, agent, csrf };
}
const founderChat = (fromId: string, toId: string) => prisma.privateMessage.findMany({ where: { senderPersonId: fromId, conversation: { memberPersonId: toId } } });

afterEach(() => vi.restoreAllMocks());

describe('The founder welcome text', () => {
  it('says the approved things in English, with no price, payment or website', () => {
    const t = founderWelcomeText(false, 'Grace Mbah', 'Stanley A. Ndoh');
    expect(t).toContain('Hello Grace, welcome to The God Nation!');
    expect(t).toContain('secrets to dominate over the circumstances of life');
    expect(t).toContain('The God Nation Leadership Academy');
    expect(t).toContain('1. Open your dashboard');
    expect(t).toContain('2. Install the app');
    expect(t).toContain('3. Turn on notifications');
    expect(t).toContain('no pressure');
    expect(t.trim().endsWith('National Coordinator, The God Nation')).toBe(true);
    expect(t).toContain('Evangelist Stanley A. Ndoh');
    expect(t).not.toMatch(/https?:|www\.|\$|€|FCFA|price|pay/i);
  });
  it('says them in French', () => {
    const t = founderWelcomeText(true, 'Grace Mbah', 'Évangéliste Stanley A. Ndoh');
    expect(t).toContain('Bonjour Grace, bienvenue à The God Nation !');
    expect(t).toContain('les secrets pour dominer les circonstances de la vie');
    expect(t).toContain('Coordinateur national, The God Nation');
    expect(t.match(/Évangéliste Stanley/g)?.length).toBe(1);
    expect(t).not.toMatch(/https?:|www\./i);
  });
});

describe('Sending the founder welcome', () => {
  it('sends it once, in the member’s language, and never twice', async () => {
    const from = await ensureFounder();
    const p = await newPerson('Marie', 'fr');
    expect(await sendFounderWelcome(p.id)).toBe(true);
    expect(await sendFounderWelcome(p.id)).toBe(false);
    const msgs = await founderChat(from.id, p.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toContain('Bonjour Marie');
    const row = await prisma.memberOnboarding.findUnique({ where: { personId: p.id } });
    expect(row?.welcomeMessageSentAt).not.toBeNull();
  });
  it('is skipped for test data, erased people and anyone the founder already wrote to', async () => {
    const from = await ensureFounder();
    const test = await newPerson('Tester', 'en', { isTestData: true });
    expect(await sendFounderWelcome(test.id)).toBe(false);
    const erased = await newPerson('Gone', 'en', { erasedAt: new Date() });
    expect(await sendFounderWelcome(erased.id)).toBe(false);
    const known = await newPerson('Trainee');
    const { sendPrivateNotice } = await import('../lib/privateNotice');
    await sendPrivateNotice(from.id, known.id, 'Welcome to the Leadership School');
    expect(await sendFounderWelcome(known.id)).toBe(false);
    expect(await founderChat(from.id, known.id)).toHaveLength(1);
  });
  it('is not sent to the founder themself', async () => {
    const from = await ensureFounder();
    expect(await sendFounderWelcome(from.id)).toBe(false);
  });
});

describe('First sign-in date', () => {
  it('is stamped the first time and then left alone', async () => {
    const { account, agent } = await signedIn();
    const first = await prisma.memberAccount.findUnique({ where: { id: account.id } });
    expect(first?.firstLoginAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await markFirstLogin(account.id);
    const again = await prisma.memberAccount.findUnique({ where: { id: account.id } });
    expect(again?.firstLoginAt?.getTime()).toBe(first?.firstLoginAt?.getTime());
    void agent;
  });
});

describe('Onboarding endpoints', () => {
  it('needs a signed-in member', async () => {
    const agent = agentWithIp();
    expect((await agent.get('/api/member/onboarding')).status).toBe(401);
  });
  it('reports what the member has done and lets them close the card', async () => {
    const { person, agent, csrf } = await signedIn();
    const before = await agent.get('/api/member/onboarding');
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ profileDone: true, notificationsOn: false, communityTapped: false, firstTeachingOpened: false, dismissed: false });
    expect(before.body.firstSignInAt).toBeTruthy();

    await prisma.pushSubscription.create({ data: { personId: person.id, endpoint: `https://push.example/${person.id}`, p256dh: 'x', auth: 'y' } });
    const reg = await prisma.registration.create({ data: { name: 'x', personId: person.id, visitorId: `v-${person.id}`, normalizedWhatsApp: person.whatsappNumber ?? '+237800000000' } as any });
    await prisma.event.create({ data: { type: 'GROUP_LINK_CLICKED', detail: 'whatsapp', registrationId: reg.id } });
    const after = await agent.get('/api/member/onboarding');
    expect(after.body.notificationsOn).toBe(true);
    expect(after.body.communityTapped).toBe(true);

    const noCsrf = await agent.post('/api/member/onboarding/dismiss').send({});
    expect(noCsrf.status).toBeGreaterThanOrEqual(400);
    const closed = await agent.post('/api/member/onboarding/dismiss').set('X-CSRF-Token', csrf).send({});
    expect(closed.status).toBe(200);
    expect((await agent.get('/api/member/onboarding')).body.dismissed).toBe(true);
  });
});

describe('Completing the profile', () => {
  it('sends the welcome once, the first time only', async () => {
    const from = await ensureFounder();
    const person = await newPerson('Fresh', 'en', { profileCompletedAt: null });
    const email = `ob-fresh${n}@example.com`;
    await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    const agent = agentWithIp();
    const { csrf } = await bootstrap(agent as any);
    expect((await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD })).status).toBe(200);
    const body = { name: 'Fresh Person', country: 'Nigeria', city: 'Lagos', preferredLanguage: 'en' };
    const first = await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send(body);
    expect(first.status).toBe(200);
    const second = await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send(body);
    expect(second.status).toBe(200);
    expect(await founderChat(from.id, person.id)).toHaveLength(1);
    void EmailService;
  });
});
