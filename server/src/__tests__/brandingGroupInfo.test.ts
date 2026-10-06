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
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Updates banner (picture + Mission / Vision / Purpose), group picture and
// purpose, chat-list last message, and the group info page's member list.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.131.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

let n = 0;
async function member(name: string, communityId?: string) {
  n += 1;
  const email = `bg${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376553${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  if (communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId, status: 'ACTIVE' } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}

let adminN = 0;
async function admin() {
  adminN += 1;
  const email = `branding-admin${adminN}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

const JPEG = { mimeType: 'image/jpeg', byteSize: 150_000 };

describe('Updates banner', () => {
  it('admin sets the picture and the Mission / Vision / Purpose texts; members see them', async () => {
    const a = await admin();
    const auth = await a.agent.post('/api/admin/app-banner/authorize').set('X-CSRF-Token', a.csrf).send(JPEG);
    expect(auth.status).toBe(200);
    expect(auth.body.storageKey).toMatch(/^settings\/app-banner\/[0-9a-f-]{36}$/);
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: JPEG.byteSize, contentType: JPEG.mimeType } as any);
    const saved = await a.agent.post('/api/admin/app-banner').set('X-CSRF-Token', a.csrf).send({ storageKey: auth.body.storageKey, ...JPEG });
    expect(saved.status).toBe(200);
    expect(saved.body.appBannerUrl).toContain('/api/app-banner?v=');

    const texts = await a.agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', a.csrf)
      .send({ content: { appSloganEn: 'Raising kingdom leaders', appMissionEn: 'To train leaders.', appVisionFr: 'Une nation pour Dieu.' } });
    expect(texts.status).toBe(200);

    const pub = await request(app).get('/api/settings/public');
    expect(pub.body.appBannerUrl).toContain('/api/app-banner');
    expect(pub.body.content).toMatchObject({ appSloganEn: 'Raising kingdom leaders', appMissionEn: 'To train leaders.', appVisionFr: 'Une nation pour Dieu.' });

    const m = await member('Ada');
    const pic = await m.agent.get('/api/app-banner');
    expect(pic.status).toBe(302);
    expect(pic.headers.location).toContain('settings/app-banner/');
    expect((await request(app).get('/api/app-banner')).status).toBe(401);

    const removed = await a.agent.delete('/api/admin/app-banner').set('X-CSRF-Token', a.csrf);
    expect(removed.body.appBannerUrl).toBeNull();
  });

  it('members cannot change the banner', async () => {
    const m = await member('Ben');
    const res = await m.agent.post('/api/admin/app-banner/authorize').set('X-CSRF-Token', m.csrf).send(JPEG);
    expect([401, 403]).toContain(res.status);
  });
});

describe('Group picture, purpose and chat list', () => {
  it('admin sets a picture and purpose; members see them with the last message', async () => {
    const g = await prisma.community.create({ data: { name: 'Buea Group' } });
    const a = await admin();
    const base = `/api/admin/communities/${g.id}`;

    const auth = await a.agent.post(`${base}/photo/authorize`).set('X-CSRF-Token', a.csrf).send(JPEG);
    expect(auth.body.storageKey).toMatch(new RegExp(`^communities/${g.id}/photo/`));
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: JPEG.byteSize, contentType: JPEG.mimeType } as any);
    expect((await a.agent.post(`${base}/photo`).set('X-CSRF-Token', a.csrf).send({ storageKey: auth.body.storageKey, ...JPEG })).status).toBe(200);
    await a.agent.patch(`${base}/about`).set('X-CSRF-Token', a.csrf).send({ aboutEn: 'We pray for Buea.', aboutFr: 'Nous prions pour Buea.' });

    const ada = await member('Ada', g.id);
    await ada.agent.post(`/api/communities/${g.id}/conversation/messages`).set('X-CSRF-Token', ada.csrf).send({ body: 'Amen 🙏' });

    const meta = await ada.agent.get(`/api/communities/${g.id}/conversation`);
    expect(meta.body).toMatchObject({ name: 'Buea Group', aboutEn: 'We pray for Buea.', aboutFr: 'Nous prions pour Buea.' });
    expect(meta.body.photoUrl).toContain(`/api/group-photos/${g.id}`);
    expect(meta.body.lastMessage).toMatchObject({ body: 'Amen 🙏', isOwn: true, deleted: false });

    const pic = await ada.agent.get(`/api/group-photos/${g.id}`);
    expect(pic.status).toBe(302);
  });

  it("a group key from another group is refused, and members can't edit groups", async () => {
    const g1 = await prisma.community.create({ data: { name: 'G1' } });
    const g2 = await prisma.community.create({ data: { name: 'G2' } });
    const a = await admin();
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: JPEG.byteSize, contentType: JPEG.mimeType } as any);
    const wrongKey = `communities/${g2.id}/photo/11111111-1111-4111-8111-111111111111`;
    const res = await a.agent.post(`/api/admin/communities/${g1.id}/photo`).set('X-CSRF-Token', a.csrf).send({ storageKey: wrongKey, ...JPEG });
    expect(res.status).toBe(400);

    const m = await member('Cy', g1.id);
    const edit = await m.agent.patch(`/api/admin/communities/${g1.id}/about`).set('X-CSRF-Token', m.csrf).send({ aboutEn: 'hack' });
    expect([401, 403]).toContain(edit.status);
  });
});

describe('Group info page members', () => {
  it('leaders first, then who is online, with "you" marked', async () => {
    const g = await prisma.community.create({ data: { name: 'Info Group' } });
    const ada = await member('Ada', g.id);
    const ben = await member('Ben', g.id);
    const cy = await member('Cy', g.id);
    const a = await createAdmin('roles-admin@test.local', 'AdminPass123!');
    await prisma.roleAssignment.create({ data: { personId: cy.person.id, roleType: 'SCOPED_LEADER', assignedByUserId: a.id, communityId: g.id } });
    await prisma.person.update({ where: { id: ben.person.id }, data: { lastSeenAt: new Date() } });

    const res = await ada.agent.get(`/api/communities/${g.id}/conversation/members`);
    expect(res.status).toBe(200);
    expect(res.body.memberCount).toBe(3);
    expect(res.body.members[0]).toMatchObject({ personId: cy.person.id, isLeader: true });
    const me = res.body.members.find((m: any) => m.personId === ada.person.id);
    expect(me).toMatchObject({ isYou: true, online: true });
    expect(res.body.members.find((m: any) => m.personId === ben.person.id).online).toBe(true);

    const outsider = await member('Dee');
    expect((await outsider.agent.get(`/api/communities/${g.id}/conversation/members`)).status).toBe(403);
  });
});
