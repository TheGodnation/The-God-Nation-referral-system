import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { DEFAULTS, adminCelebration, publicCelebration, saveCelebration, teachingListNames } from '../lib/celebration';
import { metaFor, renderIndexHtml } from '../lib/ogMeta';

// The public "Congratulations" page: nothing is shown until the central admin switches it on, the words and names come from
// the admin (never from the code), and its link preview carries no names. All names here are made up.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

async function member(name: string, admin = false) {
  n += 1;
  const email = `cel${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2377400${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (admin) await prisma.user.create({ data: { name: 'Central Admin', email: `cel-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  const raw = request.agent(app);
  const ip = `10.181.${Math.floor(n / 256) % 256}.${n % 256}`;
  const call = (m: 'get' | 'put', p: string) => raw[m](p).set('X-Forwarded-For', ip);
  const { csrf } = await bootstrap(raw as any);
  const login = await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (login.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await raw.post('/api/member/auth/verify-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  return { person, get: (p: string) => call('get', p), put: (p: string, body: unknown) => call('put', p).set('X-CSRF-Token', csrf).send(body as object) };
}

const body = (over: Record<string, unknown> = {}) => ({ published: true, titleEn: 'Well done', titleFr: 'Bravo', introEn: 'They finished.', introFr: 'Ils ont fini.', messageEn: 'Para one.\n\nLast words.', messageFr: 'Un.\n\nFin.', names: ['Alpha Tester', 'Beta Tester'], ...over });

beforeEach(async () => {
  await prisma.celebration.deleteMany();
});
afterEach(() => vi.restoreAllMocks());

describe('the public Congratulations page', () => {
  it('shows nothing until it is switched on, and nothing again once it is closed', async () => {
    expect((await request(app).get('/api/celebration')).status).toBe(404);
    await saveCelebration(body({ published: false }));
    expect((await request(app).get('/api/celebration')).status).toBe(404);
    await saveCelebration(body());
    const open = await request(app).get('/api/celebration');
    expect(open.status).toBe(200);
    expect(open.body).toEqual({ title: { en: 'Well done', fr: 'Bravo' }, intro: { en: 'They finished.', fr: 'Ils ont fini.' }, message: { en: 'Para one.\n\nLast words.', fr: 'Un.\n\nFin.' }, names: ['Alpha Tester', 'Beta Tester'] });
    await saveCelebration(body({ published: false }));
    expect((await request(app).get('/api/celebration')).status).toBe(404);
  });

  it('falls back to English where the French is empty, and to the drafts where nothing is written', async () => {
    await saveCelebration(body({ titleFr: '', introFr: '', messageFr: '' }));
    const page = (await publicCelebration())!;
    expect(page.title.fr).toBe('Well done');
    expect(page.message.fr).toBe('Para one.\n\nLast words.');
    await saveCelebration(body({ titleEn: '', titleFr: '', introEn: '', introFr: '', messageEn: '', messageFr: '' }));
    const drafts = (await publicCelebration())!;
    expect(drafts.title.en).toBe(DEFAULTS.titleEn);
    expect(drafts.title.fr).toBe(DEFAULTS.titleFr);
  });

  it('shows the admin the drafts before anything is saved, and keeps no name in the drafts', async () => {
    const first = await adminCelebration();
    expect(first).toMatchObject({ saved: false, published: false, titleEn: DEFAULTS.titleEn, names: [] });
    expect(JSON.stringify(DEFAULTS)).not.toMatch(/Godwill|Nkeng|Ngami|Bomono/);
    expect(DEFAULTS.messageEn).toContain('Philippians 1:6');
    expect(DEFAULTS.messageFr).toContain('Philippiens 1.6');
  });
});

describe('writing it (the central admin)', () => {
  it('lets only the central admin read and save, over the member door, and rejects a bad body', async () => {
    const admin = await member('The Coordinator', true);
    const other = await member('Somebody');
    expect((await other.get('/api/member/central-celebration')).status).toBe(403);
    expect((await other.put('/api/member/central-celebration', body())).status).toBe(403);
    expect((await admin.put('/api/member/central-celebration', { nonsense: true })).status).toBe(400);
    expect((await admin.put('/api/member/central-celebration', body({ names: [''] }))).status).toBe(400);
    const saved = await admin.put('/api/member/central-celebration', body());
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ saved: true, published: true, names: ['Alpha Tester', 'Beta Tester'] });
    expect((await request(app).get('/api/celebration')).status).toBe(200);
    expect((await prisma.auditLog.findMany({ where: { action: 'CELEBRATION_SAVED' } })).length).toBe(1);
  });

  it('offers the names on the weekly teaching list (the member’s own name when matched), to save typing', async () => {
    await prisma.teachingTeacher.deleteMany();
    const real = await prisma.person.create({ data: { name: 'Zora Matched Name', whatsappNumber: `+2377500${String(++n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
    await prisma.teachingTeacher.createMany({
      data: [
        { name: 'Matched Name', personId: real.id, dayOfWeek: 1, startMinute: 420, startTopic: 1 },
        { name: 'Unmatched Person', dayOfWeek: 2, startMinute: 420, startTopic: 2 },
        { name: 'Stopped Person', dayOfWeek: 3, startMinute: 420, startTopic: 3, active: false },
      ],
    });
    try {
      expect(await teachingListNames()).toEqual(['Zora Matched Name', 'Unmatched Person']);
    } finally {
      await prisma.teachingTeacher.deleteMany();
    }
  });
});

describe('the link preview', () => {
  it('has its own card and wording, and never carries a name', () => {
    for (const lang of ['en', 'fr', 'both'] as const) {
      const meta = metaFor('/congratulations', lang);
      expect(meta.title).toMatch(/Congratulations|Félicitations/);
      expect(meta.image).toBe('congratulations-card.jpg');
    }
    expect(metaFor('/congratulations/', 'en').title).toMatch(/Congratulations/);
    expect(metaFor('/join', 'en').image).toBeUndefined();
    const html = renderIndexHtml('<html lang="en"><head><title>x</title><meta name="description" content="y" /></head><body></body></html>', { appUrl: 'https://example.org', path: '/congratulations', lang: 'both', meta: metaFor('/congratulations', 'both') });
    expect(html).toContain('property="og:image" content="https://example.org/congratulations-card.jpg"');
    expect(html).toContain('og:url" content="https://example.org/congratulations"');
  });
});
