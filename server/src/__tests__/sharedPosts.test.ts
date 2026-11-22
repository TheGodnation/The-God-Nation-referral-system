import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import sharp from 'sharp';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { newsPathOf } from '../lib/ogMeta';
import { websiteState } from '../lib/sharedArticles';
import { DIVISIONS } from '../lib/publicSite/content';
import { publicItem, shareByLink, stopSharing, sharedPreview, previewText, sharedPhotos, cardImagePath, withoutTitle } from '../lib/sharedPosts';

// Stored files are faked: each key holds a real picture made here.
const stored = new Map<string, Buffer>();
vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  isStorageConfigured: () => true,
  putObject: async ({ storageKey, body }: { storageKey: string; body: Buffer }) => {
    stored.set(storageKey, body);
  },
  getObjectStream: async ({ storageKey }: { storageKey: string }) => (stored.has(storageKey) ? { body: Readable.from([stored.get(storageKey)!]), contentLength: stored.get(storageKey)!.length } : null),
}));

// Posts and announcements shared by link: closed until the central admin opens the link, readable by anyone once open,
// closed again by "stop sharing", never for a draft or archived item. All names are made up.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

async function member(name: string, admin = false) {
  n += 1;
  const email = `shr${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2377500${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  const user = admin ? await prisma.user.create({ data: { name: 'Central Admin', email: `shr-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } }) : null;
  const raw = request.agent(app);
  const ip = `10.191.${Math.floor(n / 256) % 256}.${n % 256}`;
  const { csrf } = await bootstrap(raw as any);
  const login = await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (login.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await raw.post('/api/member/auth/verify-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  const call = (m: 'get' | 'post' | 'delete', p: string) => (raw as any)[m](p).set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf);
  return { person, user, get: (p: string) => call('get', p), post: (p: string) => call('post', p), del: (p: string) => call('delete', p) };
}

async function adminUser() {
  n += 1;
  return prisma.user.create({ data: { name: 'Some Admin', email: `shr-u-${n}@test.local`, passwordHash: 'x', role: 'ADMIN' } });
}
async function makePost(over: Record<string, unknown> = {}) {
  const u = await adminUser();
  return prisma.headquartersPost.create({ data: { titleEn: 'Good news', titleFr: 'Bonne nouvelle', bodyEn: 'Come and see what God is doing.', bodyFr: 'Venez voir.', createdByUserId: u.id, publishedAt: new Date(), ...over } as any });
}
async function makeAnnouncement(over: Record<string, unknown> = {}) {
  const u = await adminUser();
  return prisma.announcement.create({ data: { titleEn: 'Meeting', bodyEn: 'Saturday at nine.', createdByUserId: u.id, publishedAt: new Date(), ...over } as any });
}

beforeEach(async () => {
  await prisma.updatePost.deleteMany();
  await prisma.headquartersPost.deleteMany();
  await prisma.announcement.deleteMany();
});
afterEach(() => vi.restoreAllMocks());

describe('reading a shared post', () => {
  it('is closed until shared, open once shared, closed again when sharing stops', async () => {
    const post = await makePost();
    expect((await request(app).get(`/api/shared/post/${post.id}`)).status).toBe(404);
    await shareByLink('post', post.id);
    const open = await request(app).get(`/api/shared/post/${post.id}`);
    expect(open.status).toBe(200);
    expect(open.body.title).toEqual({ en: 'Good news', fr: 'Bonne nouvelle' });
    expect(open.body.body.en).toContain('what God is doing');
    expect(JSON.stringify(open.body)).not.toMatch(/createdBy|email|comments|reactions/);
    await stopSharing('post', post.id);
    expect((await request(app).get(`/api/shared/post/${post.id}`)).status).toBe(404);
  });

  it('never shows a draft or an archived item, even if marked shared', async () => {
    const draft = await makePost({ publishedAt: null, sharedPublicAt: new Date() });
    const archived = await makeAnnouncement({ archivedAt: new Date(), sharedPublicAt: new Date() });
    expect(await publicItem('post', draft.id)).toBeNull();
    expect(await publicItem('announcement', archived.id)).toBeNull();
    await expect(shareByLink('post', draft.id)).rejects.toThrow();
  });

  it('works for announcements, falls back to English, and lists the other shared ones', async () => {
    const a = await makeAnnouncement();
    const other = await makePost();
    await shareByLink('announcement', a.id);
    await shareByLink('post', other.id);
    const res = await request(app).get(`/api/shared/announcement/${a.id}`);
    expect(res.body.title.fr).toBe('Meeting');
    expect(res.body.more.map((m: any) => m.id)).toEqual([other.id]);
    expect((await request(app).get('/api/shared/other/xyz')).status).toBe(404);
  });

  it('names the author only when the post is in a person’s own voice', async () => {
    const person = await prisma.person.create({ data: { name: 'Zora Mbeki Ndlovu', whatsappNumber: '+237750099999', profileCompletedAt: new Date() } });
    const own = await makePost({ authorPersonId: person.id, sharedPublicAt: new Date() });
    const plain = await makePost({ sharedPublicAt: new Date() });
    expect((await publicItem('post', own.id))!.author).toBe('Zora Mbeki Ndlovu');
    expect((await publicItem('post', plain.id))!.author).toBe('The God Nation');
  });
});

describe('who can open and close the link', () => {
  it('lets the central admin share and stop, and keeps an audit trail', async () => {
    const admin = await member('Alpha Tester', true);
    const post = await makePost();
    const on = await admin.post(`/api/member/central-shared/post/${post.id}/share`);
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ shared: true, path: `/news/post/${post.id}` });
    expect((await admin.get(`/api/member/central-shared/post/${post.id}`)).body.shared).toBe(true);
    expect((await admin.del(`/api/member/central-shared/post/${post.id}/share`)).body.shared).toBe(false);
    const logs = await prisma.auditLog.findMany({ where: { targetId: post.id } });
    expect(logs.map((l) => l.action).sort()).toEqual(['POST_SHARED_BY_LINK', 'POST_SHARING_STOPPED']);
  });

  it('refuses an ordinary member', async () => {
    const plain = await member('Beta Tester');
    const post = await makePost();
    expect((await plain.post(`/api/member/central-shared/post/${post.id}/share`)).status).toBe(403);
    expect((await prisma.headquartersPost.findUnique({ where: { id: post.id } }))!.sharedPublicAt).toBeNull();
  });

  it('refuses a draft with a clear code', async () => {
    const admin = await member('Gamma Tester', true);
    const draft = await makePost({ publishedAt: null });
    const res = await admin.post(`/api/member/central-shared/post/${draft.id}/share`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_PUBLISHED');
  });
});

describe('the link preview', () => {
  it('recognises the address and carries the title and first lines only for an open link', async () => {
    expect(newsPathOf('/news/post/abc-123')).toEqual({ kind: 'post', id: 'abc-123' });
    expect(newsPathOf('/news/other/abc')).toBeNull();
    const post = await makePost();
    expect(await sharedPreview('post', post.id, 'en')).toBeNull();
    await shareByLink('post', post.id);
    expect(await sharedPreview('post', post.id, 'fr')).toEqual({ title: 'Bonne nouvelle', text: 'Venez voir.', image: null, imageBytes: null });
  });
});

describe('sharing the central admin’s own Updates posts', () => {
  const makeUpdate = (authorPersonId: string, over: Record<string, unknown> = {}) =>
    prisma.updatePost.create({ data: { authorPersonId, body: 'Come and see what God is doing.\nSecond line.', audience: 'EVERYONE', ...over } as any });

  it('shares one only when the central admin wrote it for everyone, shows the text, and closes again', async () => {
    const admin = await member('Evangelist Tester', true);
    const plain = await member('Plain Poster');
    const mine = await makeUpdate(admin.person.id);
    const theirs = await makeUpdate(plain.person.id);
    const friends = await makeUpdate(admin.person.id, { audience: 'FRIENDS' });

    expect((await admin.post(`/api/member/central-shared/update/${mine.id}/share`)).status).toBe(200);
    expect((await admin.post(`/api/member/central-shared/update/${theirs.id}/share`)).status).toBe(409); // not the central admin's post
    expect((await admin.post(`/api/member/central-shared/update/${friends.id}/share`)).status).toBe(409); // friends only

    const open = await request(app).get(`/api/shared/update/${mine.id}`);
    expect(open.status).toBe(200);
    expect(open.body.title.en).toBe('Come and see what God is doing.');
    expect(open.body.body.en).toContain('Second line.');
    expect(open.body.author).toBe('Evangelist Tester');
    expect(JSON.stringify(open.body)).not.toMatch(/email|whatsapp/i);

    await admin.del(`/api/member/central-shared/update/${mine.id}/share`);
    expect((await request(app).get(`/api/shared/update/${mine.id}`)).status).toBe(404);
  });

  it('is closed again when the post is deleted or made friends-only, and carries the stored translation', async () => {
    const admin = await member('Evangelist Tester Two', true);
    const post = await makeUpdate(admin.person.id, { sharedPublicAt: new Date(), detectedLanguage: 'en', translatedBody: 'Venez voir.' });
    const item = (await publicItem('update', post.id))!;
    // the first line is the title, so the writing starts after it (the French is one short line: all of it is the title)
    expect(item.title).toEqual({ en: 'Come and see what God is doing.', fr: 'Venez voir.' });
    expect(item.body).toEqual({ en: 'Second line.', fr: '' });
    await prisma.updatePost.update({ where: { id: post.id }, data: { audience: 'FRIENDS' } });
    expect(await publicItem('update', post.id)).toBeNull();
    await prisma.updatePost.update({ where: { id: post.id }, data: { audience: 'EVERYONE', deletedAt: new Date() } });
    expect(await publicItem('update', post.id)).toBeNull();
  });
});

describe('the text of a link card', () => {
  it('has no ## or ** marks and does not start with its own heading again', () => {
    expect(previewText('THEY COULD COME AGAINST YOU!', '**THEY COULD COME AGAINST YOU!**\n\n## A DECLARATION OF VICTORY\nHeavenly Father, we thank You.')).toBe('A DECLARATION OF VICTORY Heavenly Father, we thank You.');
    expect(previewText('Good news', 'Come and see.')).toBe('Come and see.');
  });
});

describe('the picture of a shared post', () => {
  const photoOf = (postId: string, over: Record<string, unknown> = {}) =>
    prisma.headquartersPostMedia.create({ data: { headquartersPostId: postId, position: 0, storageKey: `test/${Math.random().toString(36).slice(2)}.jpg`, originalFilename: 'p.jpg', mimeType: 'image/jpeg', byteSize: 200_000, mediaType: 'IMAGE', ...over } as any });

  it('is used on the link card only while the link is open, and only when it is not too large', async () => {
    const post = await makePost();
    await photoOf(post.id);
    expect(await cardImagePath('post', post.id)).toBeNull(); // not shared yet: nothing is public
    expect(await sharedPhotos('post', post.id)).toEqual([]);
    await shareByLink('post', post.id);
    expect(await cardImagePath('post', post.id)).toBe(`api/shared/post/${post.id}/card.jpg`); // always cut to card size
    expect((await sharedPreview('post', post.id, 'en'))!.image).toBe(`api/shared/post/${post.id}/card.jpg`);
    // any size works now: a very large picture is cut down for the card; only one too big to open at all keeps the usual card
    const big = await makePost();
    await photoOf(big.id, { byteSize: 9_000_000 });
    await shareByLink('post', big.id);
    expect(await cardImagePath('post', big.id)).toBe(`api/shared/post/${big.id}/card.jpg`);
    const huge = await makePost();
    await photoOf(huge.id, { byteSize: 60_000_000 });
    await shareByLink('post', huge.id);
    expect(await cardImagePath('post', huge.id)).toBeNull();
    await stopSharing('post', post.id);
    expect(await cardImagePath('post', post.id)).toBeNull();
  });

  it('lists only pictures (not PDFs or videos) in order, and the public page lists them without any storage name', async () => {
    const post = await makePost();
    await photoOf(post.id, { position: 1 });
    await photoOf(post.id, { position: 0 });
    await photoOf(post.id, { position: 2, mimeType: 'application/pdf', mediaType: 'PDF' });
    await shareByLink('post', post.id);
    expect(await sharedPhotos('post', post.id)).toHaveLength(2);
    const page = await request(app).get(`/api/shared/post/${post.id}`);
    expect(page.body.photos).toEqual([{ url: `/api/shared/post/${post.id}/photo/0` }, { url: `/api/shared/post/${post.id}/photo/1` }]);
    expect(JSON.stringify(page.body)).not.toContain('test/');
    expect((await request(app).get(`/api/shared/post/${post.id}/photo/5`)).status).toBe(404);
  });

  it('serves nothing for a closed link', async () => {
    const post = await makePost();
    await photoOf(post.id);
    expect((await request(app).get(`/api/shared/post/${post.id}/photo/0`)).status).toBe(404);
  });
});

describe('pictures of any size and shape are made right for the card and the page', () => {
  const store = async (postId: string, width: number, height: number) => {
    const bytes = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .composite([{ input: Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)), raw: { width: 20, height: 50, channels: 1 }, top: 5, left: 5 }])
      .jpeg({ quality: 100 })
      .toBuffer();
    const key = `pic/${Math.random().toString(36).slice(2)}.jpg`;
    stored.set(key, bytes);
    await prisma.headquartersPostMedia.create({ data: { headquartersPostId: postId, position: 0, storageKey: key, originalFilename: 'p.jpg', mimeType: 'image/jpeg', byteSize: bytes.length, mediaType: 'IMAGE' } });
    return bytes.length;
  };

  it('cuts a big tall picture to exactly 1200x630 and well under WhatsApp’s limit', async () => {
    const post = await makePost();
    const original = await store(post.id, 3000, 4000);
    await shareByLink('post', post.id);
    const res = await request(app).get(`/api/shared/post/${post.id}/card.jpg`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(res.body as Buffer).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1200, 630, 'jpeg']);
    expect((res.body as Buffer).length).toBeLessThan(300 * 1024);
    expect((res.body as Buffer).length).toBeLessThan(original);
  });

  it('also works for a small or wide picture, and scales the page picture to fit a phone', async () => {
    const small = await makePost();
    await store(small.id, 400, 300);
    await shareByLink('post', small.id);
    const card = await request(app).get(`/api/shared/post/${small.id}/card.jpg`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(card.status).toBe(200);
    expect(await sharp(card.body as Buffer).metadata()).toMatchObject({ width: 1200, height: 630 });
    const wide = await makePost();
    await store(wide.id, 4000, 1000);
    await shareByLink('post', wide.id);
    const page = await request(app).get(`/api/shared/post/${wide.id}/photo/0`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(page.status).toBe(200);
    expect(await sharp(page.body as Buffer).metadata()).toMatchObject({ width: 1280, height: 320 });
  });

  it('gives nothing while the link is closed', async () => {
    const post = await makePost();
    await store(post.id, 800, 600);
    expect((await request(app).get(`/api/shared/post/${post.id}/card.jpg`)).status).toBe(404);
  });
});

describe('the title is not repeated in the writing', () => {
  it('drops a first line that only says the title again (headings and bold marks do not matter), and keeps everything else', () => {
    expect(withoutTitle('THEY MAY COME AGAINST YOU ONE WAY!', '## THEY MAY COME AGAINST YOU ONE WAY!\n\n## A DECLARATION OF VICTORY\nHeavenly Father…')).toBe('## A DECLARATION OF VICTORY\nHeavenly Father…');
    expect(withoutTitle('Good news', '**Good news**\nCome and see.')).toBe('Come and see.');
    expect(withoutTitle('Good news', 'Come and see.\nGood news')).toBe('Come and see.\nGood news');
    expect(withoutTitle('A long title that was cut…', 'A long title that was cut at ninety letters and goes on')).toBe('A long title that was cut at ninety letters and goes on');
  });
  it('shows on the public page: the writing starts after the title, not with it', async () => {
    const post = await makePost({ titleEn: 'Fasting week', bodyEn: '## Fasting week\n\nBeloved, from Monday we fast.' });
    await shareByLink('post', post.id);
    const res = await request(app).get(`/api/shared/post/${post.id}`);
    expect(res.body.title.en).toBe('Fasting week');
    expect(res.body.body.en).toBe('Beloved, from Monday we fast.');
  });
});


describe('also publishing a shared post on the website (so Google can list it)', () => {
  // The public website (the /en and /fr pages) is switched on only here.
  let site: ReturnType<typeof createApp>;
  beforeAll(() => {
    process.env.PUBLIC_SITE_ENABLED = 'true';
    site = createApp();
    delete process.env.PUBLIC_SITE_ENABLED;
  });
  const area = DIVISIONS[0].key;
  const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } }).png().toBuffer();

  it('makes a published English and French article from a post, with its picture, and the pages are public at once', async () => {
    const admin = await member('Alpha Tester', true);
    const post = await makePost({ titleEn: 'Fasting week', titleFr: 'Semaine de jeûne', bodyEn: '## Fasting week\n\nBeloved, from Monday we fast.', bodyFr: 'Bien-aimés, dès lundi nous jeûnons.' });
    const key = `test/${Math.random().toString(36).slice(2)}.png`;
    stored.set(key, await png(3000, 2000));
    await prisma.headquartersPostMedia.create({ data: { headquartersPostId: post.id, position: 0, storageKey: key, originalFilename: 'p.png', mimeType: 'image/png', byteSize: 5000, mediaType: 'IMAGE' } as any });

    const res = await admin.post(`/api/member/central-shared/post/${post.id}/website`).send({ divisionKey: area });
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(true);
    expect(res.body.paths.en).toContain('/en/knowledge/');
    expect(res.body.paths.fr).toContain('/fr/connaissance/');
    expect(res.body.frenchReviewed).toBe(false);

    // public at once, without any review: the English and the French page, with the picture and the writing
    const en = await request(site).get(res.body.paths.en);
    expect(en.status).toBe(200);
    expect(en.text).toContain('Beloved, from Monday we fast.');
    expect(en.text).toMatch(/\/media\/k\/[0-9a-f-]{36}\.jpg/);
    const fr = await request(site).get(res.body.paths.fr);
    expect(fr.status).toBe(200);
    expect(fr.text).toContain('Bien-aimés, dès lundi nous jeûnons.');
    expect((await request(site).get('/sitemap-public.xml')).text).toContain(res.body.paths.fr);

    // the picture was made website-sized and registered
    const media = await prisma.knowledgeMedia.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(media!.width).toBeLessThanOrEqual(1280);
    expect(stored.has(media!.storageKey)).toBe(true);

    // the link was opened too, and the audit trail records it
    expect((await prisma.headquartersPost.findUnique({ where: { id: post.id } }))!.sharedPublicAt).not.toBeNull();
    expect((await prisma.auditLog.findMany({ where: { targetId: post.id } })).map((l) => l.action)).toContain('POST_PUBLISHED_TO_WEBSITE');
  });

  it('publishing again updates the same article, keeps a read French, and sends changed French back to "not reviewed"', async () => {
    const admin = await member('Alpha Tester', true);
    const post = await makePost({ titleEn: 'Trust', titleFr: 'Confiance', bodyEn: 'Trust him.', bodyFr: 'Faites-lui confiance.' });
    const url = `/api/member/central-shared/post/${post.id}/website`;
    const first = (await admin.post(url).send({ divisionKey: area })).body;
    await prisma.knowledgeArticleTranslation.updateMany({ where: { articleId: first.articleId, lang: 'fr' }, data: { reviewedAt: new Date(), reviewedBy: 'x' } });
    const same = (await admin.post(url).send({ divisionKey: area })).body;
    expect(same.articleId).toBe(first.articleId);
    expect(same.frenchReviewed).toBe(true); // unchanged words keep their review
    await prisma.headquartersPost.update({ where: { id: post.id }, data: { bodyFr: 'Faites-lui toute confiance.' } });
    const changed = (await admin.post(url).send({ divisionKey: area })).body;
    expect(changed.frenchReviewed).toBe(false);
    expect(await prisma.knowledgeArticle.count({ where: { sourceNote: `post:post:${post.id}` } })).toBe(1);
  });

  it('only posts a French page when the post really has French words', async () => {
    const admin = await member('Alpha Tester', true);
    const post = await makeAnnouncement({ titleEn: 'Meeting', bodyEn: 'Saturday at nine.' });
    const res = await admin.post(`/api/member/central-shared/announcement/${post.id}/website`).send({ divisionKey: area });
    expect(res.body.paths.en).toBeTruthy();
    expect(res.body.paths.fr).toBeUndefined();
    expect(res.body.hasFrench).toBe(false);
  });

  it('can be taken off the website again, and put back', async () => {
    const admin = await member('Alpha Tester', true);
    const post = await makePost();
    const url = `/api/member/central-shared/post/${post.id}/website`;
    const on = (await admin.post(url).send({ divisionKey: area })).body;
    expect((await request(site).get(on.paths.en)).status).toBe(200);
    const off = (await admin.del(url)).body;
    expect(off.published).toBe(false);
    expect((await request(site).get(on.paths.en)).status).toBe(404);
    expect((await websiteState('post', post.id)).published).toBe(false);
    expect((await admin.post(url).send({ divisionKey: area })).body.published).toBe(true);
    expect((await request(site).get(on.paths.en)).status).toBe(200);
  });

  it('needs the central admin and a real area; a draft cannot be put on the website', async () => {
    const plain = await member('Beta Tester');
    const admin = await member('Alpha Tester', true);
    const post = await makePost();
    expect((await plain.post(`/api/member/central-shared/post/${post.id}/website`).send({ divisionKey: area })).status).toBe(403);
    expect((await admin.post(`/api/member/central-shared/post/${post.id}/website`).send({ divisionKey: 'nope' })).status).toBe(400);
    const draft = await makePost({ publishedAt: null });
    expect((await admin.post(`/api/member/central-shared/post/${draft.id}/website`).send({ divisionKey: area })).status).toBe(409);
  });
});
