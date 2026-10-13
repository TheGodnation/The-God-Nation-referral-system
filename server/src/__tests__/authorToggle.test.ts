import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Section 15: per-post personal-author toggle. Announcements, Headquarters
// Posts, and a Live session each get a per-post choice — plain
// institutional "Central Authority" (authorPersonId null) or the Admin
// personally (photo, name, and a shared Settings.authorTitle). Never
// affects which content-type a post is stored as, its targets/eligibility,
// or its placement on the home page.
const app = createApp();

let ipCounter = 9000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.88.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsAdmin(email: string) {
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

async function bridgeAdminToMember(agent: ReturnType<typeof agentWithUniqueIp>, csrf: string, whatsapp: string) {
  const res = await agent.post('/api/admin/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp, password: 'Testpass123' });
  expect(res.status).toBe(201);
  return res.body.personId as string;
}

async function loginAsMember(whatsapp: string, email: string, name = 'Author Toggle Member') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

describe('Section 15 — Announcement postAsSelf toggle', () => {
  it('rejects postAsSelf:true when the Admin has not bridged to a Member profile', async () => {
    const { agent, csrf } = await loginAsAdmin('author-ann-unbridged@test.local');
    const res = await agent.post('/api/admin/announcements').set('X-CSRF-Token', csrf).send({
      titleEn: 'Hello', bodyEn: 'Body', postAsSelf: true,
    });
    expect(res.status).toBe(400);
  });

  it('stores authorPersonId when postAsSelf is true, and the published recipient sees the author photo/name/title', async () => {
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      update: { authorTitle: 'Founder & Lead Pastor' },
      create: { id: 'singleton', authorTitle: 'Founder & Lead Pastor' },
    });
    const { agent, csrf } = await loginAsAdmin('author-ann-bridged@test.local');
    const personId = await bridgeAdminToMember(agent, csrf, '+237673900001');

    const community = await makeCommunity('Author Toggle Announcement Community');
    const createRes = await agent.post('/api/admin/announcements').set('X-CSRF-Token', csrf).send({
      titleEn: 'A personal word', bodyEn: 'Body', postAsSelf: true, targets: [{ communityId: community.id }],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.postAsSelf).toBe(true);

    const publishRes = await agent.post(`/api/admin/announcements/${createRes.body.id}/publish`).set('X-CSRF-Token', csrf).send({});
    expect(publishRes.status).toBe(200);

    const { agent: memberAgent, person } = await loginAsMember('+237673900002', 'author-ann-recipient@example.com');
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id, status: 'ACTIVE' } });

    const list = await memberAgent.get('/api/me/announcements');
    expect(list.status).toBe(200);
    const item = list.body.items.find((i: any) => i.id === createRes.body.id);
    expect(item.author).toMatchObject({ personId, title: 'Founder & Lead Pastor' });
    expect(item.author.name).toBeTruthy();
  });

  it('toggling postAsSelf back to false on a draft clears the author back to the institutional voice', async () => {
    const { agent, csrf } = await loginAsAdmin('author-ann-toggle-off@test.local');
    await bridgeAdminToMember(agent, csrf, '+237673900003');
    const createRes = await agent.post('/api/admin/announcements').set('X-CSRF-Token', csrf).send({
      titleEn: 'Toggle', bodyEn: 'Body', postAsSelf: true,
    });
    expect(createRes.body.postAsSelf).toBe(true);

    const patchRes = await agent.patch(`/api/admin/announcements/${createRes.body.id}`).set('X-CSRF-Token', csrf).send({ postAsSelf: false });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.postAsSelf).toBe(false);
  });
});

describe('Section 15 — HeadquartersPost postAsSelf toggle', () => {
  it('rejects postAsSelf:true when the Admin has not bridged to a Member profile', async () => {
    const { agent, csrf } = await loginAsAdmin('author-hqp-unbridged@test.local');
    const res = await agent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', csrf).send({
      titleEn: 'Hello', bodyEn: 'Body', postAsSelf: true,
    });
    expect(res.status).toBe(400);
  });

  it('stores authorPersonId when postAsSelf is true, and the published recipient sees the author', async () => {
    const { agent, csrf } = await loginAsAdmin('author-hqp-bridged@test.local');
    const personId = await bridgeAdminToMember(agent, csrf, '+237673900004');
    const hq = await makeCommunity('Author Toggle HQ');
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } });

    const createRes = await agent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', csrf).send({
      titleEn: 'HQ personal post', bodyEn: 'Body', postAsSelf: true,
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.postAsSelf).toBe(true);
    await agent.patch(`/api/admin/headquarters-posts/${createRes.body.id}`).set('X-CSRF-Token', csrf).send({ networkWide: true });
    const publishRes = await agent.post(`/api/admin/headquarters-posts/${createRes.body.id}/publish`).set('X-CSRF-Token', csrf).send({});
    expect(publishRes.status).toBe(200);

    const { agent: memberAgent, person } = await loginAsMember('+237673900005', 'author-hqp-recipient@example.com');
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: hq.id, status: 'ACTIVE' } });

    const detail = await memberAgent.get(`/api/me/headquarters-posts/${createRes.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.author?.personId).toBe(personId);
  });
});

describe('Section 15 — Live session postAsSelf toggle', () => {
  it('rejects postAsSelf:true when the Admin has not bridged to a Member profile', async () => {
    const { agent, csrf } = await loginAsAdmin('author-live-unbridged@test.local');
    const res = await agent.put('/api/updates/live').set('X-CSRF-Token', csrf).send({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', postAsSelf: true,
    });
    expect(res.status).toBe(400);
  });

  it('shows the author on GET /api/updates/live when posted as self, and clears it on DELETE', async () => {
    const { agent, csrf } = await loginAsAdmin('author-live-bridged@test.local');
    const personId = await bridgeAdminToMember(agent, csrf, '+237673900006');

    const putRes = await agent.put('/api/updates/live').set('X-CSRF-Token', csrf).send({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', postAsSelf: true,
    });
    expect(putRes.status).toBe(200);
    expect(putRes.body.live.author?.personId).toBe(personId);

    const { agent: memberAgent, person: _p } = await loginAsMember('+237673900007', 'author-live-recipient@example.com');
    void _p;
    const getRes = await memberAgent.get('/api/updates/live');
    expect(getRes.body.live.author?.personId).toBe(personId);

    await agent.delete('/api/updates/live').set('X-CSRF-Token', csrf).send({});
    const afterDelete = await memberAgent.get('/api/updates/live');
    expect(afterDelete.body.live).toBeNull();
  });
});
