import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

// No real object storage in tests — same approach as headquartersPostMedia.test.ts.
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
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.113.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function loginAsMember(whatsapp: string, email: string) {
  const person = await prisma.person.create({ data: { name: 'Photo Member', whatsappNumber: whatsapp } });
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

const JPEG = { mimeType: 'image/jpeg', byteSize: 120_000 };

async function uploadPhoto(agent: ReturnType<typeof agentWithUniqueIp>, csrf: string) {
  const auth = await agent.post('/api/member/me/photo/authorize').set('X-CSRF-Token', csrf).send(JPEG);
  expect(auth.status).toBe(200);
  vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: JPEG.byteSize, contentType: JPEG.mimeType });
  return agent.post('/api/member/me/photo').set('X-CSRF-Token', csrf).send({ storageKey: auth.body.storageKey, ...JPEG });
}

describe('Profile photos', () => {
  afterEach(() => vi.clearAllMocks());

  it('issues an upload link namespaced to the member', async () => {
    const { agent, csrf, person } = await loginAsMember('+237670200001', 'p1@example.com');
    const res = await agent.post('/api/member/me/photo/authorize').set('X-CSRF-Token', csrf).send(JPEG);
    expect(res.status).toBe(200);
    expect(res.body.storageKey).toMatch(new RegExp(`^people/${person.id}/photo/[0-9a-f-]{36}$`));
  });

  it('rejects non-image types and oversized pictures', async () => {
    const { agent, csrf } = await loginAsMember('+237670200002', 'p2@example.com');
    const pdf = await agent.post('/api/member/me/photo/authorize').set('X-CSRF-Token', csrf).send({ mimeType: 'application/pdf', byteSize: 100 });
    expect(pdf.body.code).toBe('UNSUPPORTED_TYPE');
    const big = await agent.post('/api/member/me/photo/authorize').set('X-CSRF-Token', csrf).send({ mimeType: 'image/png', byteSize: 6 * 1024 * 1024 });
    expect(big.body.code).toBe('TOO_LARGE');
  });

  it('saves a verified upload and shows it on /me', async () => {
    const { agent, csrf, person } = await loginAsMember('+237670200003', 'p3@example.com');
    const res = await uploadPhoto(agent, csrf);
    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toMatch(new RegExp(`^/api/people/${person.id}/photo\\?v=\\d+$`));

    const me = await agent.get('/api/member/auth/me');
    expect(me.body.member.personId).toBe(person.id);
    expect(me.body.member.photoUrl).toBe(res.body.photoUrl);
  });

  it('refuses an upload that did not actually land in storage', async () => {
    const { agent, csrf } = await loginAsMember('+237670200004', 'p4@example.com');
    const auth = await agent.post('/api/member/me/photo/authorize').set('X-CSRF-Token', csrf).send(JPEG);
    const res = await agent.post('/api/member/me/photo').set('X-CSRF-Token', csrf).send({ storageKey: auth.body.storageKey, ...JPEG });
    expect(res.status).toBe(400);
  });

  it("refuses another person's storage key", async () => {
    const a = await loginAsMember('+237670200005', 'p5@example.com');
    const b = await loginAsMember('+237670200006', 'p6@example.com');
    const authA = await a.agent.post('/api/member/me/photo/authorize').set('X-CSRF-Token', a.csrf).send(JPEG);
    const res = await b.agent.post('/api/member/me/photo').set('X-CSRF-Token', b.csrf).send({ storageKey: authA.body.storageKey, ...JPEG });
    expect(res.status).toBe(400);
    expect(vi.mocked(storage.headObject)).not.toHaveBeenCalled();
  });

  it('removes the picture', async () => {
    const { agent, csrf, person } = await loginAsMember('+237670200007', 'p7@example.com');
    await uploadPhoto(agent, csrf);
    const del = await agent.delete('/api/member/me/photo').set('X-CSRF-Token', csrf);
    expect(del.body.photoUrl).toBeNull();
    const stored = await prisma.person.findUnique({ where: { id: person.id } });
    expect(stored?.photoStorageKey).toBeNull();
  });

  it('lets signed-in members and admins view a picture, but not anonymous visitors', async () => {
    const owner = await loginAsMember('+237670200008', 'p8@example.com');
    await uploadPhoto(owner.agent, owner.csrf);
    const viewer = await loginAsMember('+237670200009', 'p9@example.com');

    const asMember = await viewer.agent.get(`/api/people/${owner.person.id}/photo`);
    expect(asMember.status).toBe(302);
    expect(asMember.headers.location).toContain(`people/${owner.person.id}/photo/`);

    await createAdmin('photo-admin@test.local', 'AdminPass123!');
    const admin = agentWithUniqueIp();
    const { csrf } = await bootstrap(admin as any);
    await admin.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'photo-admin@test.local', password: 'AdminPass123!' });
    expect((await admin.get(`/api/people/${owner.person.id}/photo`)).status).toBe(302);

    const anon = agentWithUniqueIp();
    await bootstrap(anon as any);
    expect((await anon.get(`/api/people/${owner.person.id}/photo`)).status).toBe(401);
  });

  it('returns 404 for someone without a picture', async () => {
    const viewer = await loginAsMember('+237670200010', 'p10@example.com');
    const other = await prisma.person.create({ data: { name: 'No Photo', whatsappNumber: '+237670200011' } });
    expect((await viewer.agent.get(`/api/people/${other.id}/photo`)).status).toBe(404);
  });
});
