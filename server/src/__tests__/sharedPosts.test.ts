import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { newsPathOf } from '../lib/ogMeta';
import { publicItem, shareByLink, stopSharing, sharedPreview, previewText, sharedPhotos, cardImagePath } from '../lib/sharedPosts';

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
    expect(item.body).toEqual({ en: 'Come and see what God is doing.\nSecond line.', fr: 'Venez voir.' });
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
    expect(await cardImagePath('post', post.id)).toBe(`api/shared/post/${post.id}/photo/0`);
    expect((await sharedPreview('post', post.id, 'en'))!.image).toBe(`api/shared/post/${post.id}/photo/0`);
    // a very large picture keeps the usual card (it cannot be made smaller here), but is still shown on the page
    const big = await makePost();
    await photoOf(big.id, { byteSize: 9_000_000 });
    await shareByLink('post', big.id);
    expect(await cardImagePath('post', big.id)).toBeNull();
    expect(await sharedPhotos('post', big.id)).toHaveLength(1);
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

