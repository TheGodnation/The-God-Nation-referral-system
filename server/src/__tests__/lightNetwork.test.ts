import crypto from 'crypto';
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
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  headObject: vi.fn(async () => null),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { bootstrap } from './testUtils';

// Light on slow networks: only-new-messages polling (`after` + `recent`),
// tiny photo previews, and a one-post "anything new?" check on Updates.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.130.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const email = `ln${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376554${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
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

// A real (tiny) base64 JPEG-looking preview is enough for validation.
const THUMB = 'data:image/jpeg;base64,' + Buffer.from('tiny-preview').toString('base64');

describe('Group chat: only new messages', () => {
  it('after=… returns only newer messages, oldest first, plus recent ticks/reactions', async () => {
    const g = await prisma.community.create({ data: { name: 'Light Group' } });
    const ada = await member('Ada', g.id);
    const ben = await member('Ben', g.id);
    const base = `/api/communities/${g.id}/conversation`;
    const ids: string[] = [];
    for (const body of ['one', 'two', 'three']) {
      ids.push((await ada.agent.post(`${base}/messages`).set('X-CSRF-Token', ada.csrf).send({ body })).body.id);
    }
    await ben.agent.put(`${base}/messages/${ids[0]}/reaction`).set('X-CSRF-Token', ben.csrf).send({ emoji: '🙏' });

    const res = await ada.agent.get(`${base}/messages?after=${ids[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((m: any) => m.body)).toEqual(['two', 'three']);
    expect(res.body.newerOverflow).toBe(false);
    const recentFirst = res.body.recent.find((r: any) => r.id === ids[0]);
    expect(recentFirst.reactions).toEqual([{ emoji: '🙏', count: 1, mine: false }]);
    expect(recentFirst.status).toBeDefined();

    // Nothing new: an (almost) empty answer.
    const none = await ada.agent.get(`${base}/messages?after=${ids[2]}`);
    expect(none.body.items).toEqual([]);

    // Too many new messages for one page: the app is told to reload.
    const overflow = await ada.agent.get(`${base}/messages?after=${ids[0]}&limit=1`);
    expect(overflow.body.newerOverflow).toBe(true);

    // A full load (no `after`) has no `recent` list.
    expect((await ada.agent.get(`${base}/messages`)).body.recent).toBeUndefined();
  });

  it('refuses a cursor from another group', async () => {
    const g1 = await prisma.community.create({ data: { name: 'LG1' } });
    const g2 = await prisma.community.create({ data: { name: 'LG2' } });
    const ada = await member('Ada', g1.id);
    const ben = await member('Ben', g2.id);
    const other = await ben.agent.post(`/api/communities/${g2.id}/conversation/messages`).set('X-CSRF-Token', ben.csrf).send({ body: 'x' });
    const res = await ada.agent.get(`/api/communities/${g1.id}/conversation/messages?after=${other.body.id}`);
    expect(res.status).toBe(400);
  });

  it('keeps a tiny photo preview with the attachment; refuses anything else', async () => {
    const g = await prisma.community.create({ data: { name: 'Thumb Group' } });
    const ada = await member('Ada', g.id);
    const base = `/api/communities/${g.id}/conversation`;
    const key = `communities/${g.id}/attachments/${crypto.randomUUID()}`;
    vi.mocked(storage.headObject).mockResolvedValue({ contentLength: 2000, contentType: 'image/jpeg' } as any);

    const bad = await ada.agent
      .post(`${base}/messages`)
      .set('X-CSRF-Token', ada.csrf)
      .send({ attachments: [{ storageKey: key, originalFilename: 'a.jpg', mimeType: 'image/jpeg', byteSize: 2000, thumb: 'data:image/png;base64,AAAA' }] });
    expect(bad.status).toBe(400);

    const ok = await ada.agent
      .post(`${base}/messages`)
      .set('X-CSRF-Token', ada.csrf)
      .send({ attachments: [{ storageKey: key, originalFilename: 'a.jpg', mimeType: 'image/jpeg', byteSize: 2000, thumb: THUMB }] });
    expect(ok.status).toBe(201);
    vi.mocked(storage.headObject).mockResolvedValue(null);

    const list = await ada.agent.get(`${base}/messages`);
    expect(list.body.items[0].attachments[0].thumb).toBe(THUMB);
  });
});

describe('Private chat: only new messages', () => {
  it('after=… returns only newer messages, plus recent ticks', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');
    await prisma.friendship.create({ data: { requesterPersonId: ada.person.id, addresseePersonId: ben.person.id, status: 'ACCEPTED', respondedAt: new Date() } });
    const open = await ada.agent.post('/api/member/messages/open').set('X-CSRF-Token', ada.csrf).send({ personId: ben.person.id });
    const base = `/api/private-messages/conversations/${open.body.conversationId}`;
    const first = await ada.agent.post(`${base}/messages`).set('X-CSRF-Token', ada.csrf).send({ body: 'first' });
    await ben.agent.post(`${base}/messages`).set('X-CSRF-Token', ben.csrf).send({ body: 'second' });

    const res = await ada.agent.get(`${base}/messages?after=${first.body.id}`);
    expect(res.body.items.map((m: any) => m.body)).toEqual(['second']);
    expect(res.body.recent.find((r: any) => r.id === first.body.id).status).toBeDefined();
  });
});

describe('Updates: light "any new posts?" check', () => {
  it('limit=1 returns just the newest post', async () => {
    const ada = await member('Ada');
    await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'older', createdAt: new Date(Date.now() - 60000) } });
    await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'newest' } });
    const res = await ada.agent.get('/api/updates?limit=1');
    expect(res.body.items.map((p: any) => p.body)).toEqual(['newest']);
    expect(res.body.nextBefore).toBeTruthy();
  });
});
