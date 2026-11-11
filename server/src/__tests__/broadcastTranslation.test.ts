import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

// Writing to many people in two languages: the message is translated once (preview), the sender checks it, and each person
// then gets the version in their own language. Leaders and the coordinator share this.
const ORIGINAL_ENV = { ...process.env };
let n = 0;
const ok = (payload: unknown) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) });
const geminiFr = () => vi.fn(async () => ok({ detectedLanguage: 'en', translated: 'Que Dieu vous bénisse' }));

async function freshApp(env: Partial<NodeJS.ProcessEnv>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  const { createApp } = await import('../app');
  const { bootstrap } = await import('./testUtils');
  const { EmailService } = await import('../lib/email');
  return { app: createApp(), bootstrap, EmailService };
}

function wrap(app: any) {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.251.${Math.floor(n / 256) % 256}.${n % 256}`;
  return {
    get: (u: string) => raw.get(u).set('X-Forwarded-For', ip),
    post: (u: string) => raw.post(u).set('X-Forwarded-For', ip),
  };
}

async function member(env: Awaited<ReturnType<typeof freshApp>>, name: string, language: 'en' | 'fr') {
  const p = await prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378800${String(n).padStart(5, '0')}`, preferredLanguage: language, profileCompletedAt: new Date() } });
  const account = await prisma.memberAccount.create({ data: { personId: p.id, email: `bt${++n}@example.com`, lastLoginAt: new Date() } });
  const agent = wrap(env.app);
  const spy = vi.spyOn(env.EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const { csrf } = await env.bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email: account.email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  expect((await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email: account.email, code })).status).toBe(200);
  return { person: p, agent, csrf };
}

async function leaderWorld(env: Awaited<ReturnType<typeof freshApp>>) {
  const admin = await prisma.user.create({ data: { name: 'Admin', email: `bt-admin-${++n}@test.local`, passwordHash: await bcrypt.hash('GoodPass123!', 4), role: 'ADMIN' } });
  const community = await prisma.community.create({ data: { name: `BT ${++n}`, autoPlacementEligible: false } });
  const leader = await member(env, 'Leader', 'en');
  await prisma.roleAssignment.create({ data: { personId: leader.person.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: admin.id } });
  const english = await member(env, 'Anglo', 'en');
  const french = await member(env, 'Franco', 'fr');
  for (const p of [english, french]) {
    await prisma.communityMembership.create({ data: { personId: p.person.id, communityId: community.id } });
    await prisma.followUpAssignment.create({ data: { followerId: leader.person.id, followedPersonId: p.person.id, contextType: 'COMMUNITY', contextId: community.id, assignedByUserId: admin.id } });
  }
  return { admin, community, leader, english, french };
}

const messageTo = (personId: string) => prisma.privateMessage.findFirstOrThrow({ where: { conversation: { memberPersonId: personId } } });

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Message all my people — in two languages (a leader)', () => {
  it('lists each person with the language they read, and "My people" cards carry it with their WhatsApp number', async () => {
    const env = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const w = await leaderWorld(env);
    const people = await w.leader.agent.get('/api/member/broadcast/people');
    expect(people.body.items.map((p: any) => [p.name, p.language]).sort()).toEqual([[w.english.person.name, 'en'], [w.french.person.name, 'fr']].sort());
  });

  it('translates once for the preview, then each person gets the version in their own language', async () => {
    const env = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const w = await leaderWorld(env);
    const fetchSpy = geminiFr();
    vi.stubGlobal('fetch', fetchSpy);
    const preview = await w.leader.agent.post('/api/member/broadcast/translate-preview').set('X-CSRF-Token', w.leader.csrf).send({ text: 'God bless you' });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({ detectedLanguage: 'en', translatedBody: 'Que Dieu vous bénisse' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Sending uses what the sender confirmed (here a corrected translation), and asks the translator for nothing more.
    const res = await w.leader.agent.post('/api/member/broadcast').set('X-CSRF-Token', w.leader.csrf).send({ body: 'God bless you', translation: { language: 'en', body: 'Que Dieu vous bénisse tous' } });
    expect(res.status).toBe(201);
    expect(res.body.recipients).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await messageTo(w.english.person.id)).body).toBe('Hello, greetings from The God Nation 🙏\n\nGod bless you');
    expect((await messageTo(w.french.person.id)).body).toBe('Bonjour, salutations de The God Nation 🙏\n\nQue Dieu vous bénisse tous');
    // The record keeps both versions.
    expect(await prisma.leaderBroadcast.findFirstOrThrow({ where: { senderPersonId: w.leader.person.id } })).toMatchObject({ body: 'God bless you', translatedBody: 'Que Dieu vous bénisse tous', bodyLanguage: 'en' });
  });

  it('a message written in French goes to English readers translated, and French readers as written', async () => {
    const env = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const w = await leaderWorld(env);
    await w.leader.agent.post('/api/member/broadcast').set('X-CSRF-Token', w.leader.csrf).send({ body: 'Dieu est fidèle', translation: { language: 'fr', body: 'God is faithful' } });
    expect((await messageTo(w.english.person.id)).body).toContain('God is faithful');
    expect((await messageTo(w.french.person.id)).body).toContain('Dieu est fidèle');
  });

  it('without a translation everyone gets the text as written (as before), and an empty translation is ignored', async () => {
    const env = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const w = await leaderWorld(env);
    await w.leader.agent.post('/api/member/broadcast').set('X-CSRF-Token', w.leader.csrf).send({ body: 'God bless you', translation: { language: 'en', body: '   ' } });
    expect((await messageTo(w.french.person.id)).body).toContain('God bless you');
  });

  it('says so when the translator is down or not set up, and is only for leaders', async () => {
    const down = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const w = await leaderWorld(down);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('This operation was aborted'))));
    const failed = await w.leader.agent.post('/api/member/broadcast/translate-preview').set('X-CSRF-Token', w.leader.csrf).send({ text: 'God bless you' });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/try again/i);
    // A plain member is not a leader.
    const plain = await member(down, 'Plain', 'en');
    expect((await plain.agent.post('/api/member/broadcast/translate-preview').set('X-CSRF-Token', plain.csrf).send({ text: 'Hi' })).status).toBe(403);
    const off = await freshApp({ GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '' });
    const w2 = await leaderWorld(off);
    expect((await w2.leader.agent.post('/api/member/broadcast/translate-preview').set('X-CSRF-Token', w2.leader.csrf).send({ text: 'Hi' })).status).toBe(503);
  });

  it('"My people" cards show each person\'s WhatsApp number and language to their leader', async () => {
    const env = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const w = await leaderWorld(env);
    // The leader's own session reaches /api/leader/* through the paired leader account.
    const leaderUser = await prisma.user.create({ data: { name: 'L', email: `btl-${++n}@test.local`, passwordHash: await bcrypt.hash('GoodPass123!', 4), role: 'LEADER', personId: w.leader.person.id } });
    const agent = wrap(env.app);
    const { csrf } = await env.bootstrap(agent as any);
    expect((await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: leaderUser.email, password: 'GoodPass123!' })).status).toBe(200);
    const res = await agent.get('/api/leader/my-people');
    expect(res.status).toBe(200);
    const french = res.body.items.find((c: any) => c.personId === w.french.person.id);
    expect(french).toMatchObject({ language: 'fr', whatsapp: w.french.person.whatsappNumber });
  });
});

describe('The coordinator writing to many people in two languages', () => {
  async function coordinator(env: Awaited<ReturnType<typeof freshApp>>) {
    const w = await leaderWorld(env);
    const admin = await member(env, 'Founder', 'en');
    await prisma.user.create({ data: { name: 'Founder', email: `btf-${++n}@test.local`, passwordHash: await bcrypt.hash('GoodPass123!', 4), role: 'ADMIN', personId: admin.person.id } });
    return { ...w, admin: admin };
  }

  it('previews through the desk, then sends each person their language, as the coordinator', async () => {
    const env = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const w = await coordinator(env);
    vi.stubGlobal('fetch', geminiFr());
    const preview = await w.admin.agent.post('/api/member/central-needs-me/translate-preview').set('X-CSRF-Token', w.admin.csrf).send({ text: 'God bless you' });
    expect(preview.body).toEqual({ detectedLanguage: 'en', translatedBody: 'Que Dieu vous bénisse' });
    const res = await w.admin.agent.post('/api/member/central-needs-me/message').set('X-CSRF-Token', w.admin.csrf).send({ personIds: [w.english.person.id, w.french.person.id], body: 'God bless you', translation: { language: 'en', body: 'Que Dieu vous bénisse' } });
    expect(res.status).toBe(201);
    expect((await messageTo(w.english.person.id)).body).toContain('God bless you');
    expect((await messageTo(w.french.person.id)).body).toContain('Que Dieu vous bénisse');
    // An ordinary leader cannot use the desk's preview.
    expect((await w.leader.agent.post('/api/member/central-needs-me/translate-preview').set('X-CSRF-Token', w.leader.csrf).send({ text: 'Hi' })).status).toBe(403);
  });
});
