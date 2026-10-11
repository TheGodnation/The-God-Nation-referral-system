import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/upload/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/download/${storageKey}`,
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  })),
  headObject: vi.fn(async () => null),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Home page / chat background — Admin sets ONE for everyone, a built-in
// preset or an uploaded custom image, never both at once. See
// schema.prisma's Settings comment and server/src/routes/appBranding.ts.
const app = createApp();

let ipCounter = 50000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.120.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

let n = 0;
async function member() {
  n += 1;
  const email = `wallpaper-member${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `Wallpaper Member ${n}`, whatsappNumber: `+2376554${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf };
}

let adminN = 0;
async function admin() {
  adminN += 1;
  const email = `wallpaper-admin${adminN}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

const JPEG = { mimeType: 'image/jpeg', byteSize: 150_000 };

describe('Wallpaper — picking a built-in preset', () => {
  it('an Admin sets the home wallpaper preset, reflected in public settings', async () => {
    const a = await admin();
    const res = await a.agent.patch('/api/admin/wallpaper/home').set('X-CSRF-Token', a.csrf).send({ preset: 'sky' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ target: 'home', preset: 'sky', imageUrl: null });

    const pub = await request(app).get('/api/settings/public');
    expect(pub.body.homeWallpaper).toEqual({ preset: 'sky', imageUrl: null });
    expect(pub.body.chatWallpaper).toEqual({ preset: null, imageUrl: null });
  });

  it('home and chat wallpapers are set independently', async () => {
    const a = await admin();
    await a.agent.patch('/api/admin/wallpaper/home').set('X-CSRF-Token', a.csrf).send({ preset: 'sage' });
    await a.agent.patch('/api/admin/wallpaper/chat').set('X-CSRF-Token', a.csrf).send({ preset: 'blush' });

    const pub = await request(app).get('/api/settings/public');
    expect(pub.body.homeWallpaper.preset).toBe('sage');
    expect(pub.body.chatWallpaper.preset).toBe('blush');
  });

  it('rejects an unknown preset name', async () => {
    const a = await admin();
    const res = await a.agent.patch('/api/admin/wallpaper/home').set('X-CSRF-Token', a.csrf).send({ preset: 'neon' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown target', async () => {
    const a = await admin();
    const res = await a.agent.patch('/api/admin/wallpaper/garden').set('X-CSRF-Token', a.csrf).send({ preset: 'sky' });
    expect(res.status).toBe(404);
  });

  it('requires authentication, Admin role, and CSRF', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.patch('/api/admin/wallpaper/home').send({ preset: 'sky' })).status).toBe(401);

    const m = await member();
    const asMember = await m.agent.patch('/api/admin/wallpaper/home').set('X-CSRF-Token', m.csrf).send({ preset: 'sky' });
    expect(asMember.status).toBe(401);

    const { user } = await createLeader('Wallpaper Leader', 'wallpaper-leader@test.local', 'WPLEADC1');
    const leaderAgent = agentWithUniqueIp();
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent as any);
    await leaderAgent.post('/api/auth/login').set('X-CSRF-Token', leaderCsrf).send({ email: 'wallpaper-leader@test.local', password: 'password123' });
    const asLeader = await leaderAgent.patch('/api/admin/wallpaper/home').set('X-CSRF-Token', leaderCsrf).send({ preset: 'sky' });
    expect(asLeader.status).toBe(403);
    void user;

    const a = await admin();
    const noCsrf = await a.agent.patch('/api/admin/wallpaper/home').send({ preset: 'sky' });
    expect(noCsrf.status).toBe(403);
  });
});

describe('Wallpaper — uploading a custom image', () => {
  it('an uploaded image clears the preset, and setting a preset afterwards clears the image', async () => {
    const a = await admin();
    await a.agent.patch('/api/admin/wallpaper/chat').set('X-CSRF-Token', a.csrf).send({ preset: 'sand' });

    const auth = await a.agent.post('/api/admin/wallpaper/chat/authorize').set('X-CSRF-Token', a.csrf).send(JPEG);
    expect(auth.status).toBe(200);
    expect(auth.body.storageKey).toMatch(/^settings\/wallpaper\/chat\/[0-9a-f-]{36}$/);

    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: JPEG.byteSize, contentType: JPEG.mimeType } as any);
    const finalize = await a.agent.post('/api/admin/wallpaper/chat').set('X-CSRF-Token', a.csrf).send({ storageKey: auth.body.storageKey, ...JPEG });
    expect(finalize.status).toBe(200);
    expect(finalize.body.preset).toBeNull();
    expect(finalize.body.imageUrl).toContain('/api/wallpaper/chat?v=');

    const pub = await request(app).get('/api/settings/public');
    expect(pub.body.chatWallpaper.preset).toBeNull();
    expect(pub.body.chatWallpaper.imageUrl).toContain('/api/wallpaper/chat?v=');

    // Picking a preset afterwards clears the uploaded image.
    const back = await a.agent.patch('/api/admin/wallpaper/chat').set('X-CSRF-Token', a.csrf).send({ preset: 'classic' });
    expect(back.body.imageUrl).toBeNull();
    const pub2 = await request(app).get('/api/settings/public');
    expect(pub2.body.chatWallpaper).toEqual({ preset: 'classic', imageUrl: null });
  });

  it('rejects a storage key namespaced to the other target', async () => {
    const a = await admin();
    const authHome = await a.agent.post('/api/admin/wallpaper/home/authorize').set('X-CSRF-Token', a.csrf).send(JPEG);

    const res = await a.agent.post('/api/admin/wallpaper/chat').set('X-CSRF-Token', a.csrf).send({ storageKey: authHome.body.storageKey, ...JPEG });
    expect(res.status).toBe(400);
  });

  it('refuses an upload that cannot be verified in storage', async () => {
    const a = await admin();
    const auth = await a.agent.post('/api/admin/wallpaper/home/authorize').set('X-CSRF-Token', a.csrf).send(JPEG);
    // headObject default mock resolves to null (object not found).
    const res = await a.agent.post('/api/admin/wallpaper/home').set('X-CSRF-Token', a.csrf).send({ storageKey: auth.body.storageKey, ...JPEG });
    expect(res.status).toBe(400);
  });

  it('DELETE resets to the app default (no preset, no image)', async () => {
    const a = await admin();
    await a.agent.patch('/api/admin/wallpaper/home').set('X-CSRF-Token', a.csrf).send({ preset: 'sky' });
    const res = await a.agent.delete('/api/admin/wallpaper/home').set('X-CSRF-Token', a.csrf);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ target: 'home', preset: null, imageUrl: null });

    const pub = await request(app).get('/api/settings/public');
    expect(pub.body.homeWallpaper).toEqual({ preset: null, imageUrl: null });
  });
});

describe('Wallpaper — viewing an uploaded image', () => {
  async function setChatWallpaperImage(a: { agent: ReturnType<typeof agentWithUniqueIp>; csrf: string }) {
    const auth = await a.agent.post('/api/admin/wallpaper/chat/authorize').set('X-CSRF-Token', a.csrf).send(JPEG);
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: JPEG.byteSize, contentType: JPEG.mimeType } as any);
    await a.agent.post('/api/admin/wallpaper/chat').set('X-CSRF-Token', a.csrf).send({ storageKey: auth.body.storageKey, ...JPEG });
  }

  it('a signed-in Member can view the wallpaper image; an anonymous visitor cannot', async () => {
    const a = await admin();
    await setChatWallpaperImage(a);

    const m = await member();
    const asMember = await m.agent.get('/api/wallpaper/chat');
    expect(asMember.status).toBe(302);

    const anon = agentWithUniqueIp();
    const asAnon = await anon.get('/api/wallpaper/chat');
    expect(asAnon.status).toBe(401);
  });

  it('returns 404 when no custom image is set (a preset applies client-side instead)', async () => {
    const a = await admin();
    await a.agent.patch('/api/admin/wallpaper/home').set('X-CSRF-Token', a.csrf).send({ preset: 'sky' });
    const asAdmin = await a.agent.get('/api/wallpaper/home');
    expect(asAdmin.status).toBe(404);
  });
});
