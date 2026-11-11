import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../lib/prisma';

// Tap-to-translate in one-to-one private chats: made once, stored, and shared by both people.
const ORIGINAL_ENV = { ...process.env };
let n = 0;
const ok = (payload: unknown) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) });

async function freshApp(env: Partial<NodeJS.ProcessEnv>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  const { createApp } = await import('../app');
  const { bootstrap } = await import('./testUtils');
  const { EmailService } = await import('../lib/email');
  return { app: createApp(), bootstrap, EmailService };
}

async function signedIn(app: any, bootstrap: any, EmailService: any, language: 'en' | 'fr', name: string) {
  const p = await prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378700${String(n).padStart(5, '0')}`, preferredLanguage: language, profileCompletedAt: new Date() } });
  const account = await prisma.memberAccount.create({ data: { personId: p.id, email: `pt${++n}@example.com`, lastLoginAt: new Date() } });
  const raw = request.agent(app);
  const ip = `10.241.${Math.floor(n / 256) % 256}.${n % 256}`;
  const agent = {
    get: (u: string) => raw.get(u).set('X-Forwarded-For', ip),
    post: (u: string) => raw.post(u).set('X-Forwarded-For', ip),
    patch: (u: string) => raw.patch(u).set('X-Forwarded-For', ip),
  };
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email: account.email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  expect((await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email: account.email, code })).status).toBe(200);
  return { person: p, agent, csrf };
}

async function chat(app: any, bootstrap: any, EmailService: any) {
  const english = await signedIn(app, bootstrap, EmailService, 'en', 'Leader');
  const french = await signedIn(app, bootstrap, EmailService, 'fr', 'Membre');
  const conversation = await prisma.privateConversation.create({ data: { memberPersonId: french.person.id, initiatorPersonId: english.person.id } });
  const message = await prisma.privateMessage.create({ data: { conversationId: conversation.id, senderPersonId: english.person.id, body: 'Hello, how are you?' } });
  return { english, french, conversation, message, url: `/api/private-messages/conversations/${conversation.id}/messages/${message.id}/translate` };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Tap to translate in private chats', () => {
  it('translates once, stores it, and both people then read the same stored translation without another request', async () => {
    const { app, bootstrap, EmailService } = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const c = await chat(app, bootstrap, EmailService);
    const fetchSpy = vi.fn(async () => ok({ detectedLanguage: 'en', translated: 'Bonjour, comment allez-vous ?' }));
    vi.stubGlobal('fetch', fetchSpy);

    // Before anyone taps: no translation, and nobody has asked yet.
    const before = await c.french.agent.get(`/api/private-messages/conversations/${c.conversation.id}/messages`);
    expect(before.body.items[0].translation).toBeNull();
    expect(before.body.items[0].detectedLanguage).toBeUndefined();

    const tap = await c.french.agent.post(c.url).set('X-CSRF-Token', c.french.csrf).send({});
    expect(tap.status).toBe(200);
    expect(tap.body).toEqual({ detectedLanguage: 'en', translation: { sourceLanguage: 'en', translatedBody: 'Bonjour, comment allez-vous ?' } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A second tap, and the other person's tap, use the stored copy: still one request in all.
    await c.french.agent.post(c.url).set('X-CSRF-Token', c.french.csrf).send({});
    const theirs = await c.english.agent.post(c.url).set('X-CSRF-Token', c.english.csrf).send({});
    expect(theirs.status).toBe(200);
    expect(theirs.body.translation).toBeNull(); // the sender reads English: nothing to translate for them
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // The list now carries it for the French reader, and only marks it "checked" for the English one.
    const french = await c.french.agent.get(`/api/private-messages/conversations/${c.conversation.id}/messages`);
    expect(french.body.items[0]).toMatchObject({ detectedLanguage: 'en', translation: { sourceLanguage: 'en', translatedBody: 'Bonjour, comment allez-vous ?' } });
    const english = await c.english.agent.get(`/api/private-messages/conversations/${c.conversation.id}/messages`);
    expect(english.body.items[0]).toMatchObject({ detectedLanguage: 'en', translation: null });
    const stored = await prisma.privateMessage.findUniqueOrThrow({ where: { id: c.message.id } });
    expect(stored).toMatchObject({ detectedLanguage: 'en', translatedBody: 'Bonjour, comment allez-vous ?' });
  });

  it('says so, and stores nothing, when the translator is down; a later tap can try again', async () => {
    const { app, bootstrap, EmailService } = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const c = await chat(app, bootstrap, EmailService);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('This operation was aborted'))));
    const tap = await c.french.agent.post(c.url).set('X-CSRF-Token', c.french.csrf).send({});
    expect(tap.status).toBe(502);
    expect(tap.body.error).toMatch(/try again/i);
    expect((await prisma.privateMessage.findUniqueOrThrow({ where: { id: c.message.id } })).translatedAt).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ok({ detectedLanguage: 'en', translated: 'Bonjour, comment allez-vous ?' })));
    expect((await c.french.agent.post(c.url).set('X-CSRF-Token', c.french.csrf).send({})).status).toBe(200);
  });

  it('is unavailable (503) when translation is not set up', async () => {
    const { app, bootstrap, EmailService } = await freshApp({ GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '' });
    const c = await chat(app, bootstrap, EmailService);
    expect((await c.french.agent.post(c.url).set('X-CSRF-Token', c.french.csrf).send({})).status).toBe(503);
  });

  it('is only for the two people in the chat', async () => {
    const { app, bootstrap, EmailService } = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const c = await chat(app, bootstrap, EmailService);
    const stranger = await signedIn(app, bootstrap, EmailService, 'fr', 'Stranger');
    vi.stubGlobal('fetch', vi.fn(async () => ok({ detectedLanguage: 'en', translated: 'x' })));
    expect((await stranger.agent.post(c.url).set('X-CSRF-Token', stranger.csrf).send({})).status).toBe(404);
  });

  it('correcting a message throws away its old translation', async () => {
    const { app, bootstrap, EmailService } = await freshApp({ GEMINI_API_KEY: 'test-key' });
    const c = await chat(app, bootstrap, EmailService);
    vi.stubGlobal('fetch', vi.fn(async () => ok({ detectedLanguage: 'en', translated: 'Bonjour, comment allez-vous ?' })));
    await c.french.agent.post(c.url).set('X-CSRF-Token', c.french.csrf).send({});
    const edit = await c.english.agent.patch(`/api/private-messages/conversations/${c.conversation.id}/messages/${c.message.id}`).set('X-CSRF-Token', c.english.csrf).send({ body: 'Hello, I hope you are well.' });
    expect(edit.status).toBe(200);
    expect(await prisma.privateMessage.findUniqueOrThrow({ where: { id: c.message.id } })).toMatchObject({ translatedBody: null, translatedAt: null, detectedLanguage: null });
  });
});
