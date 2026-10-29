import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/upload/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/download/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  headObject: vi.fn(async () => null),
}));

// Route-wiring only — lib/translation.ts's own logic (Gemini calls,
// language detection, the DB writes it makes) is covered in its own
// translation.test.ts; here we only need to know the route calls it with
// the right arguments. GEMINI_API_KEY isn't set in this test environment,
// so the real function would no-op anyway (see lib/translation.ts's own
// "unconfigured" behavior) — mocking makes that explicit and lets the
// wiring test assert on the call itself, not on a live Gemini round-trip.
vi.mock('../lib/translation', () => ({
  translateAndStoreUpdatePost: vi.fn(async () => {}),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import * as translationLib from '../lib/translation';
import { parseYoutubeVideoId } from '../lib/updates';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.114.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}
type Agent = ReturnType<typeof agentWithUniqueIp>;

let phone = 0;
async function loginAsMember(name: string) {
  phone += 1;
  const whatsapp = `+2376703${String(phone).padStart(5, '0')}`;
  const email = `feed${phone}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, person };
}

async function loginAsAdmin(email: string) {
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

async function makeLeader(personId: string) {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } }) ?? (await createAdmin('assigner@test.local', 'AdminPass123!'));
  const community = await prisma.community.create({ data: { name: `Led ${personId.slice(0, 6)}` } });
  await prisma.roleAssignment.create({
    data: { personId, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: (admin as any).id },
  });
}

async function post(agent: Agent, csrf: string, body: Record<string, unknown>) {
  return agent.post('/api/updates').set('X-CSRF-Token', csrf).send(body);
}

describe('YouTube link parsing', () => {
  it('understands the common link shapes', () => {
    expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
    expect(parseYoutubeVideoId('https://m.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYoutubeVideoId('youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects anything else', () => {
    expect(parseYoutubeVideoId('https://vimeo.com/123456')).toBeNull();
    expect(parseYoutubeVideoId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYoutubeVideoId('hello')).toBeNull();
  });
});

describe('Updates feed — posting and viewing', () => {
  afterEach(() => vi.clearAllMocks());

  it('lets a member post text, and every member sees it', async () => {
    const a = await loginAsMember('Ada Poster');
    const b = await loginAsMember('Ben Reader');
    const created = await post(a.agent, a.csrf, { body: 'Praise God for this week!' });
    expect(created.status).toBe(201);

    const feed = await b.agent.get('/api/updates');
    expect(feed.status).toBe(200);
    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0]).toMatchObject({
      body: 'Praise God for this week!',
      author: { personId: a.person.id, name: 'Ada Poster', photoUrl: null },
      commentCount: 0,
      canDelete: false,
    });
  });

  it('refuses an empty post and a bad YouTube link', async () => {
    const a = await loginAsMember('Empty Poster');
    expect((await post(a.agent, a.csrf, { body: '   ' })).body.code).toBe('EMPTY_POST');
    expect((await post(a.agent, a.csrf, { body: 'hi', youtubeUrl: 'https://vimeo.com/1' })).body.code).toBe('INVALID_YOUTUBE');
  });

  it('stores only the YouTube video id', async () => {
    const a = await loginAsMember('Video Poster');
    await post(a.agent, a.csrf, { body: '', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    const feed = await a.agent.get('/api/updates');
    expect(feed.body.items[0].youtubeVideoId).toBe('dQw4w9WgXcQ');
  });

  it('posts photos the member uploaded, and refuses someone else’s', async () => {
    const a = await loginAsMember('Photo Poster');
    const b = await loginAsMember('Other Person');
    const photo = { mimeType: 'image/jpeg', byteSize: 50_000 };
    const auth = await a.agent.post('/api/updates/photos/authorize').set('X-CSRF-Token', a.csrf).send(photo);
    expect(auth.body.storageKey).toMatch(new RegExp(`^updates/${a.person.id}/`));

    const stolen = await post(b.agent, b.csrf, { body: 'x', photos: [{ storageKey: auth.body.storageKey, ...photo }] });
    expect(stolen.status).toBe(400);

    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: photo.byteSize, contentType: photo.mimeType });
    const ok = await post(a.agent, a.csrf, { body: 'Our meeting', photos: [{ storageKey: auth.body.storageKey, ...photo }] });
    expect(ok.status).toBe(201);

    const feed = await b.agent.get('/api/updates');
    const photoUrl = feed.body.items[0].photos[0].url;
    const view = await b.agent.get(photoUrl);
    expect(view.status).toBe(302);
  });

  it('is closed to anonymous visitors', async () => {
    const anon = agentWithUniqueIp();
    await bootstrap(anon as any);
    expect((await anon.get('/api/updates')).status).toBe(401);
  });

  it('pages through older posts', async () => {
    const a = await loginAsMember('Busy Poster');
    const base = Date.now();
    for (let i = 0; i < 23; i++) {
      await prisma.updatePost.create({ data: { authorPersonId: a.person.id, body: `post ${i}`, createdAt: new Date(base - i * 1000) } });
    }
    const first = await a.agent.get('/api/updates');
    expect(first.body.items).toHaveLength(20);
    expect(first.body.nextBefore).toBeTruthy();
    const second = await a.agent.get(`/api/updates?before=${encodeURIComponent(first.body.nextBefore)}`);
    expect(second.body.items).toHaveLength(3);
    expect(second.body.nextBefore).toBeNull();
  });

  it("shows one person's posts on their profile", async () => {
    const a = await loginAsMember('Profile A');
    const b = await loginAsMember('Profile B');
    await post(a.agent, a.csrf, { body: 'from A' });
    await post(b.agent, b.csrf, { body: 'from B' });
    const res = await b.agent.get(`/api/updates?authorPersonId=${a.person.id}`);
    expect(res.body.items.map((i: any) => i.body)).toEqual(['from A']);
  });
});

describe('Updates feed — reactions and comments', () => {
  it('keeps one reaction per person, changeable and removable', async () => {
    const a = await loginAsMember('React Author');
    const b = await loginAsMember('React Fan');
    const { body } = await post(a.agent, a.csrf, { body: 'react to me' });

    await b.agent.put(`/api/updates/${body.id}/reaction`).set('X-CSRF-Token', b.csrf).send({ type: 'LIKE' });
    await b.agent.put(`/api/updates/${body.id}/reaction`).set('X-CSRF-Token', b.csrf).send({ type: 'PRAY' });
    let feed = await b.agent.get('/api/updates');
    expect(feed.body.items[0].reactionCounts).toEqual({ PRAY: 1 });
    expect(feed.body.items[0].myReaction).toBe('PRAY');

    await b.agent.delete(`/api/updates/${body.id}/reaction`).set('X-CSRF-Token', b.csrf);
    feed = await b.agent.get('/api/updates');
    expect(feed.body.items[0].reactionCounts).toEqual({});
    expect(feed.body.items[0].myReaction).toBeNull();
  });

  it('adds comments and counts them', async () => {
    const a = await loginAsMember('Comment Author');
    const b = await loginAsMember('Commenter');
    const { body } = await post(a.agent, a.csrf, { body: 'comment please' });
    const c = await b.agent.post(`/api/updates/${body.id}/comments`).set('X-CSRF-Token', b.csrf).send({ body: 'Amen!' });
    expect(c.status).toBe(201);

    const list = await a.agent.get(`/api/updates/${body.id}/comments`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ body: 'Amen!', author: { name: 'Commenter' } });
    const feed = await a.agent.get('/api/updates');
    expect(feed.body.items[0].commentCount).toBe(1);
  });
});

describe('Updates feed — deleting (admin and assigned leaders only; members report)', () => {
  it('gives no delete to ordinary members, not even for their own post', async () => {
    const a = await loginAsMember('Owner');
    const b = await loginAsMember('Not Owner');
    const { body } = await post(a.agent, a.csrf, { body: 'mine' });
    expect((await b.agent.delete(`/api/updates/${body.id}`).set('X-CSRF-Token', b.csrf)).status).toBe(403);
    expect((await a.agent.delete(`/api/updates/${body.id}`).set('X-CSRF-Token', a.csrf)).status).toBe(403);
    const mine = await a.agent.get('/api/updates');
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].canDelete).toBe(false);
    expect((await b.agent.get('/api/updates')).body.items[0].canDelete).toBe(false);
  });

  it('lets a member report a post, once, and the central admin sees what was reported', async () => {
    const author = await loginAsMember('Reported Author');
    const reader = await loginAsMember('Reporting Reader');
    const { body } = await post(author.agent, author.csrf, { body: 'something unchristian' });
    const report = (agent: any, csrf: string, extra: Record<string, unknown> = {}) =>
      agent.post('/api/member/reports').set('X-CSRF-Token', csrf).send({ personId: author.person.id, targetType: 'UPDATE_POST', targetId: body.id, reason: 'Indecent: not a Christian standard', ...extra });

    const first = await report(reader.agent, reader.csrf);
    expect(first.status).toBe(201);
    const again = await report(reader.agent, reader.csrf);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, already: true });
    expect(await prisma.memberReport.count({ where: { reporterPersonId: reader.person.id, targetId: body.id } })).toBe(1);

    // No forged targets: someone else's post under this person, a missing post, or your own.
    const other = await loginAsMember('Somebody Else');
    expect((await report(reader.agent, reader.csrf, { personId: other.person.id })).status).toBe(404);
    expect((await report(reader.agent, reader.csrf, { targetId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
    expect((await report(reader.agent, reader.csrf, { targetId: undefined })).status).toBe(400);
    expect((await report(author.agent, author.csrf)).status).toBe(400);

    const admin = await loginAsAdmin('report-admin@test.local');
    const list = await admin.agent.get('/api/admin/member-reports');
    const row = list.body.items.find((r: any) => r.id === first.body.id);
    expect(row).toMatchObject({ targetType: 'UPDATE_POST', targetPreview: 'something unchristian', reporter: { name: 'Reporting Reader' } });

    // Once the post is removed, the report no longer carries its words.
    await admin.agent.delete(`/api/updates/${body.id}`).set('X-CSRF-Token', admin.csrf);
    const after = await admin.agent.get('/api/admin/member-reports');
    expect(after.body.items.find((r: any) => r.id === first.body.id).targetPreview).toBeNull();
  });

  it('lets the central admin remove any post, and records who did it', async () => {
    const a = await loginAsMember('Rule Breaker');
    const { body } = await post(a.agent, a.csrf, { body: 'bad content' });
    const admin = await loginAsAdmin('feed-admin@test.local');

    const view = await admin.agent.get('/api/updates');
    expect(view.body.viewer.canModerate).toBe(true);
    expect(view.body.items[0].canDelete).toBe(true);

    expect((await admin.agent.delete(`/api/updates/${body.id}`).set('X-CSRF-Token', admin.csrf)).status).toBe(200);
    const stored = await prisma.updatePost.findUnique({ where: { id: body.id } });
    expect(stored?.deletedAt).not.toBeNull();
    expect(stored?.deletedByUserId).toBeTruthy();
    const audit = await prisma.auditLog.findFirst({ where: { action: 'UPDATE_POST_REMOVED_BY_MODERATOR', targetId: body.id } });
    expect(audit).toBeTruthy();
  });

  it('lets a member with an active leader role remove posts and comments', async () => {
    const a = await loginAsMember('Poster X');
    const leader = await loginAsMember('Leader Y');
    await makeLeader(leader.person.id);
    const { body } = await post(a.agent, a.csrf, { body: 'needs removing' });
    const c = await a.agent.post(`/api/updates/${body.id}/comments`).set('X-CSRF-Token', a.csrf).send({ body: 'bad comment' });

    expect((await leader.agent.delete(`/api/updates/comments/${c.body.id}`).set('X-CSRF-Token', leader.csrf)).status).toBe(200);
    expect((await leader.agent.delete(`/api/updates/${body.id}`).set('X-CSRF-Token', leader.csrf)).status).toBe(200);
    const stored = await prisma.updatePost.findUnique({ where: { id: body.id } });
    expect(stored?.deletedByPersonId).toBe(leader.person.id);
  });

  it('hides photos of a deleted post', async () => {
    const a = await loginAsMember('Photo Deleter');
    const p = await prisma.updatePost.create({
      data: {
        authorPersonId: a.person.id,
        body: '',
        deletedAt: new Date(),
        photos: { create: [{ storageKey: `updates/${a.person.id}/x`, mimeType: 'image/png', byteSize: 10, position: 0 }] },
      },
      include: { photos: true },
    });
    expect((await a.agent.get(`/api/updates/photos/${p.photos[0].id}`)).status).toBe(404);
  });
});

describe('Updates feed — auto-translation', () => {
  afterEach(() => vi.clearAllMocks());

  // Simulates a translation that already completed in the background (see
  // lib/translation.ts) — these tests are about the read-side display logic
  // (updates.ts's own response mapping), not about actually calling Gemini.
  async function markTranslated(postId: string, detectedLanguage: 'en' | 'fr', translatedBody: string) {
    await prisma.updatePost.update({ where: { id: postId }, data: { detectedLanguage, translatedBody, translatedAt: new Date() } });
  }

  it('shows the translation (with the original still available) to a viewer whose language differs from the post', async () => {
    const author = await loginAsMember('French Poster');
    const reader = await loginAsMember('English Reader');
    const { body } = await post(author.agent, author.csrf, { body: 'Que Dieu vous bénisse' });
    await markTranslated(body.id, 'fr', 'God bless you');

    const feed = await reader.agent.get('/api/updates');
    expect(feed.body.items[0]).toMatchObject({
      body: 'Que Dieu vous bénisse',
      translation: { sourceLanguage: 'fr', translatedBody: 'God bless you' },
    });
  });

  it('shows no translation to a viewer reading in the post\'s own language', async () => {
    const author = await loginAsMember('French Poster 2');
    const reader = await loginAsMember('French Reader');
    await prisma.person.update({ where: { id: reader.person.id }, data: { preferredLanguage: 'fr' } });
    const { body } = await post(author.agent, author.csrf, { body: 'Bonjour à tous' });
    await markTranslated(body.id, 'fr', 'Hello everyone');

    const feed = await reader.agent.get('/api/updates');
    expect(feed.body.items[0].translation).toBeNull();
  });

  it('follows the language the app is shown in right now, not only the profile', async () => {
    const author = await loginAsMember('French Poster 4');
    const reader = await loginAsMember('French Profile, English App');
    await prisma.person.update({ where: { id: reader.person.id }, data: { preferredLanguage: 'fr' } });
    const { body } = await post(author.agent, author.csrf, { body: 'Gloire à Dieu' });
    await markTranslated(body.id, 'fr', 'Glory to God');

    const inEnglish = await reader.agent.get('/api/updates').set('X-App-Language', 'en');
    expect(inEnglish.body.items[0].translation).toEqual({ sourceLanguage: 'fr', translatedBody: 'Glory to God' });
    const inFrench = await reader.agent.get('/api/updates').set('X-App-Language', 'fr');
    expect(inFrench.body.items[0].translation).toBeNull();
  });

  it('shows no translation yet when the background translation has not landed', async () => {
    const author = await loginAsMember('French Poster 3');
    const reader = await loginAsMember('English Reader 2');
    const { body } = await post(author.agent, author.csrf, { body: 'Pas encore traduit' });

    const feed = await reader.agent.get('/api/updates');
    expect(feed.body.items[0].translation).toBeNull();
  });

  it('calls translateAndStoreUpdatePost with the new post\'s id and body when posting text', async () => {
    const a = await loginAsMember('Wiring Poster');
    const created = await post(a.agent, a.csrf, { body: 'Dieu merci' });
    expect(translationLib.translateAndStoreUpdatePost).toHaveBeenCalledWith(created.body.id, 'Dieu merci');
  });

  it('never calls translateAndStoreUpdatePost for a photo/video-only post with no text', async () => {
    const a = await loginAsMember('Wiring Poster 2');
    await post(a.agent, a.csrf, { body: '', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(translationLib.translateAndStoreUpdatePost).not.toHaveBeenCalled();
  });

  it('never exposes a translation for a deleted post', async () => {
    const author = await loginAsMember('French Poster 4');
    const reader = await loginAsMember('English Reader 3');
    const { body } = await post(author.agent, author.csrf, { body: 'Supprimé plus tard' });
    await markTranslated(body.id, 'fr', 'Deleted later');
    await prisma.updatePost.update({ where: { id: body.id }, data: { deletedAt: new Date() } });

    const feed = await reader.agent.get('/api/updates');
    expect(feed.body.items).toHaveLength(0);
  });
});

describe('Updates feed — live slot', () => {
  it('lets only the admin start and end a live, and members see it', async () => {
    const admin = await loginAsAdmin('live-admin@test.local');
    const m = await loginAsMember('Live Watcher');

    expect((await m.agent.put('/api/updates/live').set('X-CSRF-Token', m.csrf).send({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' })).status).toBe(401);

    const start = await admin.agent
      .put('/api/updates/live')
      .set('X-CSRF-Token', admin.csrf)
      .send({ youtubeUrl: 'https://www.youtube.com/live/dQw4w9WgXcQ', title: 'Sunday prayer' });
    expect(start.status).toBe(200);

    const seen = await m.agent.get('/api/updates/live');
    expect(seen.body.live).toMatchObject({ youtubeVideoId: 'dQw4w9WgXcQ', title: 'Sunday prayer' });

    await admin.agent.delete('/api/updates/live').set('X-CSRF-Token', admin.csrf);
    expect((await m.agent.get('/api/updates/live')).body.live).toBeNull();
  });
});
