import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

// Headquarters posts have an English and a French box. When only one is written, the other is
// filled in by the translator (like Updates posts), never over something a person wrote.

const ORIGINAL_ENV = { ...process.env };
let prisma: typeof import('../lib/prisma').prisma;
let translation: typeof import('../lib/translation');
let app: import('express').Express;
let admin: { agent: ReturnType<typeof request.agent>; csrf: string; userId: string };

// A fake Gemini: "Bonjour…" is French, anything else English; the answer is marked so tests can see what was translated.
function fakeGemini() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    const prompt: string = JSON.parse(init.body as string).contents[0].parts[0].text;
    const text = prompt.split('"""')[1] ?? '';
    calls.push(text);
    const french = /^(Bonjour|Salut)/.test(text);
    const payload = { detectedLanguage: french ? 'fr' : 'en', translated: french ? `EN(${text})` : `FR(${text})` };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
  }));
  return calls;
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  vi.resetModules();
  ({ prisma } = await import('../lib/prisma'));
  translation = await import('../lib/translation');
  const { createApp } = await import('../app');
  app = createApp();
});
// Every test starts with empty tables (see setup.ts), so the admin is signed in again each time.
beforeEach(async () => {
  const { createAdmin } = await import('./helpers');
  const { bootstrap } = await import('./testUtils');
  const email = 'hq-translate-admin@test.local';
  const u = await createAdmin(email, 'AdminPass123!');
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent as never);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  admin = { agent, csrf, userId: u.id };
});
afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

const wait = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 50; i += 1) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
};
const hq = (id: string) => prisma.headquartersPost.findUniqueOrThrow({ where: { id } });
const make = (data: Record<string, unknown>) =>
  prisma.headquartersPost.create({ data: { titleEn: 'Welcome', bodyEn: 'Join us this Sunday.', createdByUserId: admin.userId, ...data } as never });

describe('Headquarters post: the missing language is translated', () => {
  it('fills an empty French from the English (title and text), and marks it as automatic', async () => {
    const calls = fakeGemini();
    const p = await make({});
    expect(await translation.attemptHeadquartersPostTranslation(p.id)).toBe('done');
    expect(calls).toEqual(['Join us this Sunday.', 'Welcome']);
    expect(await hq(p.id)).toMatchObject({ titleFr: 'FR(Welcome)', bodyFr: 'FR(Join us this Sunday.)', frAutoTranslated: true, bodyEn: 'Join us this Sunday.' });
  });

  it('never overwrites a French a person wrote, and does nothing when both are there', async () => {
    const calls = fakeGemini();
    const p = await make({ titleFr: 'Bienvenue', bodyFr: 'Rejoignez-nous dimanche.' });
    expect(await translation.attemptHeadquartersPostTranslation(p.id)).toBe('skip');
    expect(calls).toEqual([]);
    expect(await hq(p.id)).toMatchObject({ titleFr: 'Bienvenue', bodyFr: 'Rejoignez-nous dimanche.', frAutoTranslated: false });
  });

  it('only fills the empty one when the title is written in both languages but the text is not', async () => {
    fakeGemini();
    const p = await make({ titleFr: 'Bienvenue' });
    await translation.attemptHeadquartersPostTranslation(p.id);
    expect(await hq(p.id)).toMatchObject({ titleFr: 'Bienvenue', bodyFr: 'FR(Join us this Sunday.)' });
  });

  it('when the English box holds French, the French goes in the French box and English is the translation', async () => {
    fakeGemini();
    const p = await make({ titleEn: 'Bonjour à tous', bodyEn: 'Bonjour, venez dimanche.' });
    await translation.attemptHeadquartersPostTranslation(p.id);
    expect(await hq(p.id)).toMatchObject({ titleFr: 'Bonjour à tous', bodyFr: 'Bonjour, venez dimanche.', titleEn: 'EN(Bonjour à tous)', bodyEn: 'EN(Bonjour, venez dimanche.)' });
  });

  it('a failed translation leaves the post exactly as it was (and asks to be retried)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const p = await make({});
    expect(await translation.attemptHeadquartersPostTranslation(p.id, { attempts: 1 })).toBe('retry');
    expect(await hq(p.id)).toMatchObject({ titleFr: null, bodyFr: null, frAutoTranslated: false });
  });
});

describe('Headquarters post: creating and editing from the admin screen', () => {
  const body = (extra: Record<string, unknown> = {}) => ({ titleEn: 'Weekly update', bodyEn: 'We met on Sunday.', ...extra });

  it('a new English-only draft gets its French in the background', async () => {
    fakeGemini();
    const res = await admin.agent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', admin.csrf).send(body());
    expect(res.status).toBe(201);
    await wait(async () => (await hq(res.body.id)).bodyFr !== null);
    expect(await hq(res.body.id)).toMatchObject({ titleFr: 'FR(Weekly update)', bodyFr: 'FR(We met on Sunday.)', frAutoTranslated: true });
  });

  it('editing the English redoes the automatic French; writing the French by hand keeps it', async () => {
    fakeGemini();
    const created = await admin.agent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', admin.csrf).send(body());
    const id = created.body.id as string;
    await wait(async () => (await hq(id)).bodyFr !== null);

    // The admin form sends every field again: same French, new English.
    const edit = await admin.agent.patch(`/api/admin/headquarters-posts/${id}`).set('X-CSRF-Token', admin.csrf).send({ titleEn: 'Weekly update', titleFr: 'FR(Weekly update)', bodyEn: 'We met on Sunday and prayed.', bodyFr: 'FR(We met on Sunday.)' });
    expect(edit.status).toBe(200);
    await wait(async () => (await hq(id)).bodyFr === 'FR(We met on Sunday and prayed.)');
    expect(await hq(id)).toMatchObject({ bodyFr: 'FR(We met on Sunday and prayed.)', frAutoTranslated: true });

    // A person writes the French: it is theirs from now on, and a later English edit leaves it.
    await admin.agent.patch(`/api/admin/headquarters-posts/${id}`).set('X-CSRF-Token', admin.csrf).send({ bodyFr: 'Notre texte à nous.' });
    expect(await hq(id)).toMatchObject({ bodyFr: 'Notre texte à nous.', frAutoTranslated: false });
    await admin.agent.patch(`/api/admin/headquarters-posts/${id}`).set('X-CSRF-Token', admin.csrf).send({ bodyEn: 'Changed again.' });
    await new Promise((r) => setTimeout(r, 200));
    expect((await hq(id)).bodyFr).toBe('Notre texte à nous.');
  });

  it('a draft can be set to show as the Communication Department', async () => {
    fakeGemini();
    const res = await admin.agent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', admin.csrf).send(body({ voice: 'COMMUNICATION_DEPARTMENT' }));
    expect(res.body.voice).toBe('COMMUNICATION_DEPARTMENT');
    const patched = await admin.agent.patch(`/api/admin/headquarters-posts/${res.body.id}`).set('X-CSRF-Token', admin.csrf).send({ voice: 'CENTRAL_AUTHORITY' });
    expect(patched.body.voice).toBe('CENTRAL_AUTHORITY');
  });
});
