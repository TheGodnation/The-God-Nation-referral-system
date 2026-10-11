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
import { bootstrap } from './testUtils';

// Profile wall: cover picture, short "about me" line, and the photos tab.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.124.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

let n = 0;
async function member(name = 'Wall Person') {
  n += 1;
  const email = `wall${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376558${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}

const JPEG = { mimeType: 'image/jpeg', byteSize: 200_000 };

afterEach(() => vi.clearAllMocks());

describe('Cover picture', () => {
  it('upload, show on /me and on the profile, then remove', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');

    const auth = await ada.agent.post('/api/member/me/cover/authorize').set('X-CSRF-Token', ada.csrf).send(JPEG);
    expect(auth.status).toBe(200);
    expect(auth.body.storageKey).toMatch(new RegExp(`^people/${ada.person.id}/cover/[0-9a-f-]{36}$`));

    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: JPEG.byteSize, contentType: JPEG.mimeType });
    const saved = await ada.agent.post('/api/member/me/cover').set('X-CSRF-Token', ada.csrf).send({ storageKey: auth.body.storageKey, ...JPEG });
    expect(saved.status).toBe(200);
    expect(saved.body.coverUrl).toContain(`/api/people/${ada.person.id}/cover?v=`);

    const me = await ada.agent.get('/api/member/auth/me');
    expect(me.body.member.coverUrl).toContain(`/api/people/${ada.person.id}/cover`);

    const seen = await ben.agent.get(`/api/member/people/${ada.person.id}`);
    expect(seen.body.coverUrl).toContain(`/api/people/${ada.person.id}/cover`);

    const view = await ben.agent.get(`/api/people/${ada.person.id}/cover`);
    expect(view.status).toBe(302);
    expect(view.headers.location).toContain(`people/${ada.person.id}/cover/`);

    const removed = await ada.agent.delete('/api/member/me/cover').set('X-CSRF-Token', ada.csrf);
    expect(removed.body.coverUrl).toBeNull();
    expect((await ben.agent.get(`/api/people/${ada.person.id}/cover`)).status).toBe(404);
  });

  it("refuses someone else's picture key, or a profile-photo key", async () => {
    const ada = await member();
    const ben = await member();
    vi.mocked(storage.headObject).mockResolvedValue({ contentLength: JPEG.byteSize, contentType: JPEG.mimeType });
    const otherKey = `people/${ben.person.id}/cover/11111111-1111-4111-8111-111111111111`;
    const photoKey = `people/${ada.person.id}/photo/11111111-1111-4111-8111-111111111111`;
    for (const storageKey of [otherKey, photoKey]) {
      const res = await ada.agent.post('/api/member/me/cover').set('X-CSRF-Token', ada.csrf).send({ storageKey, ...JPEG });
      expect(res.status).toBe(400);
    }
    expect((await prisma.person.findUnique({ where: { id: ada.person.id } }))!.coverStorageKey).toBeNull();
  });

  it('only signed-in people can view a cover', async () => {
    const ada = await member();
    await prisma.person.update({ where: { id: ada.person.id }, data: { coverStorageKey: `people/${ada.person.id}/cover/x`, coverUpdatedAt: new Date() } });
    const res = await request(app).get(`/api/people/${ada.person.id}/cover`);
    expect(res.status).toBe(401);
  });
});

describe('About me line', () => {
  it('saves a short bio, shows it, and clears it with an empty value', async () => {
    const ada = await member();
    const ben = await member();
    const saved = await ada.agent.patch('/api/member/me/profile').set('X-CSRF-Token', ada.csrf).send({ bio: '  Serving God in Buea  ' });
    expect(saved.status).toBe(200);
    expect(saved.body.bio).toBe('Serving God in Buea');
    expect((await ada.agent.get('/api/member/auth/me')).body.member.bio).toBe('Serving God in Buea');
    expect((await ben.agent.get(`/api/member/people/${ada.person.id}`)).body.bio).toBe('Serving God in Buea');

    await ada.agent.patch('/api/member/me/profile').set('X-CSRF-Token', ada.csrf).send({ bio: '' });
    expect((await ada.agent.get('/api/member/auth/me')).body.member.bio).toBeNull();
  });

  it('keeps it short (160 characters at most)', async () => {
    const ada = await member();
    const res = await ada.agent.patch('/api/member/me/profile').set('X-CSRF-Token', ada.csrf).send({ bio: 'x'.repeat(161) });
    expect(res.status).toBe(400);
  });
});

describe('Photos tab', () => {
  it("lists a person's posted photos, newest first, but not from removed posts", async () => {
    const ada = await member();
    const ben = await member();
    const older = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'old', createdAt: new Date(Date.now() - 60_000) } });
    const newer = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'new' } });
    const removed = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'gone', deletedAt: new Date() } });
    const photo = (postId: string, position: number) =>
      prisma.updatePostPhoto.create({ data: { postId, storageKey: `updates/${postId}/${position}`, mimeType: 'image/jpeg', byteSize: 10, position } });
    const p1 = await photo(older.id, 0);
    const p2 = await photo(newer.id, 0);
    const p3 = await photo(newer.id, 1);
    await photo(removed.id, 0);

    const res = await ben.agent.get(`/api/updates/photo-wall?authorPersonId=${ada.person.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.id)).toEqual([p2.id, p3.id, p1.id]);
    expect(res.body.items[0].url).toBe(`/api/updates/photos/${p2.id}`);
  });

  it('shows nothing when one person blocked the other', async () => {
    const ada = await member();
    const ben = await member();
    const post = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'pic' } });
    await prisma.updatePostPhoto.create({ data: { postId: post.id, storageKey: 'updates/x/0', mimeType: 'image/jpeg', byteSize: 10, position: 0 } });
    await prisma.personBlock.create({ data: { blockerPersonId: ada.person.id, blockedPersonId: ben.person.id } });

    const res = await ben.agent.get(`/api/updates/photo-wall?authorPersonId=${ada.person.id}`);
    expect(res.body.items).toEqual([]);
  });
});
