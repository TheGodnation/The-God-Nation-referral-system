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

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
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

describe('Updates feed — deleting (author, admin, assigned leaders)', () => {
  it('lets the author delete their own post but not someone else’s', async () => {
    const a = await loginAsMember('Owner');
    const b = await loginAsMember('Not Owner');
    const { body } = await post(a.agent, a.csrf, { body: 'mine' });
    expect((await b.agent.delete(`/api/updates/${body.id}`).set('X-CSRF-Token', b.csrf)).status).toBe(403);
    expect((await a.agent.delete(`/api/updates/${body.id}`).set('X-CSRF-Token', a.csrf)).status).toBe(200);
    expect((await a.agent.get('/api/updates')).body.items).toHaveLength(0);
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
